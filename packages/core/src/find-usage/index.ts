import type {
  FeatureKey,
  SegmentKey,
  AttributeKey,
  SchemaKey,
  VariableOverride,
  VariableKey,
} from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { FeaturevisorCLIError } from "../error";
import { suggestKey } from "../linter/diagnostics";
import { conditionLeaves, definitionConditionLeaves } from "../utils/conditionReferences";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { extractSchemaReferences } from "../utils/schemaReferences";
import { flattenVariableOverrides } from "../datasource/variableOverrides";
import {
  collectDependencyClosure,
  buildDependencyGraph,
  featureFlagNode,
  segmentNode,
  variableNode,
} from "../datasource/dependencies";
import { listTestSpecs } from "../list/scenarios";
import { getCheckReferences } from "../tester/checks";
import {
  CLI_COLOR_CYAN,
  CLI_COLOR_DIM,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_YELLOW,
  colorize,
} from "../tester/cliFormat";

export interface UsageInFeatures {
  [featureKey: string]: {
    features: Set<FeatureKey>;
    segments: Set<SegmentKey>;
    attributes: Set<AttributeKey>;
    variables?: Set<VariableKey>;
  };
}

function addConditionUsage(
  usage: {
    features: Set<string>;
    segments: Set<string>;
    attributes: Set<string>;
    variables?: Set<string>;
  },
  leaves: ReturnType<typeof conditionLeaves>,
) {
  for (const leaf of leaves) {
    if (typeof leaf === "string") usage.segments.add(leaf);
    else if ("attribute" in leaf) usage.attributes.add(leaf.attribute.split(".")[0]);
    else if ("variable" in leaf) {
      if (leaf.feature) usage.features.add(leaf.feature);
      else usage.variables?.add(leaf.variable);
    } else if ("feature" in leaf) usage.features.add(leaf.feature);
  }
}

async function addReferencedSegmentUsage(
  deps: Dependencies,
  usage: Parameters<typeof addConditionUsage>[0],
) {
  const pending = Array.from(usage.segments);
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index];
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await deps.datasource.segmentExists(key))) continue;
    addConditionUsage(usage, conditionLeaves((await deps.datasource.readSegment(key)).conditions));
    for (const dependency of usage.segments) if (!seen.has(dependency)) pending.push(dependency);
  }
}

export interface ArchivedKeys {
  features: Set<FeatureKey>;
  segments: Set<SegmentKey>;
  attributes: Set<AttributeKey>;
  variables: Set<VariableKey>;
}

/** Archived definitions are retired. Their references never keep anything in use. */
export async function readArchivedKeys(deps: Dependencies): Promise<ArchivedKeys> {
  const datasource = deps.datasource as Partial<Dependencies["datasource"]>;
  const collect = async (
    list: (() => Promise<string[]>) | undefined,
    read: ((key: string) => Promise<{ archived?: boolean }>) | undefined,
  ) => {
    const archived = new Set<string>();
    if (!list || !read) return archived;
    for (const key of await list()) {
      try {
        if ((await read(key))?.archived === true) archived.add(key);
      } catch {
        // Unreadable definitions are reported by lint, not here.
      }
    }
    return archived;
  };
  const bind = <F extends (...args: never[]) => unknown>(method: F | undefined) =>
    method?.bind(datasource) as F | undefined;
  return {
    features: await collect(bind(datasource.listFeatures), bind(datasource.readFeature)),
    segments: await collect(bind(datasource.listSegments), bind(datasource.readSegment)),
    attributes: await collect(bind(datasource.listAttributes), bind(datasource.readAttribute)),
    variables: await collect(bind(datasource.listVariables), bind(datasource.readVariable)),
  };
}

export async function findAllUsageInFeatures(deps: Dependencies): Promise<UsageInFeatures> {
  const result: UsageInFeatures = {};
  const graph = await buildDependencyGraph(deps.datasource);
  for (const key of await deps.datasource.listFeatures()) {
    const feature = await deps.datasource.readFeature(key);
    const usage = {
      features: new Set<string>(),
      segments: new Set<string>(),
      attributes: new Set<string>(),
      variables: new Set<string>(),
    };
    addConditionUsage(usage, definitionConditionLeaves(feature));
    const structural = await collectDependencyClosure(deps.datasource, [featureFlagNode(key)], {
      graph,
    });
    structural.features.forEach((reference) => {
      if (reference !== key) usage.features.add(reference);
    });
    structural.variables.forEach((reference) => usage.variables.add(reference));
    structural.segments.forEach((reference) => usage.segments.add(reference));
    const bucketBy = feature.bucketBy;
    if (typeof bucketBy === "string") usage.attributes.add(bucketBy);
    else if (Array.isArray(bucketBy))
      bucketBy.forEach((reference) => usage.attributes.add(reference));
    else bucketBy?.or.forEach((reference) => usage.attributes.add(reference));
    await addReferencedSegmentUsage(deps, usage);
    result[key] = usage;
  }
  return result;
}

export interface UsageInSegments {
  [segmentKey: string]: {
    attributes: Set<AttributeKey>;
    features?: Set<FeatureKey>;
    variables?: Set<VariableKey>;
    segments?: Set<SegmentKey>;
  };
}

export interface UsageInVariables {
  [variableKey: string]: {
    features: Set<FeatureKey>;
    segments: Set<SegmentKey>;
    attributes: Set<AttributeKey>;
    schemas: Set<SchemaKey>;
    variables?: Set<VariableKey>;
  };
}

export async function findAllUsageInVariables(deps: Dependencies): Promise<UsageInVariables> {
  const result: UsageInVariables = {};
  const graph = await buildDependencyGraph(deps.datasource);
  for (const key of await deps.datasource.listVariables()) {
    const variable = await deps.datasource.readVariable(key);
    const usage = {
      features: new Set<string>(),
      segments: new Set<string>(),
      attributes: new Set<string>(),
      schemas: new Set<string>(),
      variables: new Set<string>(),
    };
    extractSchemaReferences(variable).forEach((reference) => usage.schemas.add(reference));
    const pendingSchemas = Array.from(usage.schemas);
    for (let index = 0; index < pendingSchemas.length; index++) {
      for (const reference of extractSchemaReferences(
        await deps.datasource.readSchema(pendingSchemas[index]),
      )) {
        if (!usage.schemas.has(reference)) {
          usage.schemas.add(reference);
          pendingSchemas.push(reference);
        }
      }
    }
    addConditionUsage(usage, definitionConditionLeaves(variable));
    const structural = await collectDependencyClosure(deps.datasource, [variableNode(key)], {
      graph,
    });
    structural.features.forEach((reference) => usage.features.add(reference));
    structural.variables.forEach((reference) => {
      if (reference !== key) usage.variables.add(reference);
    });
    structural.segments.forEach((reference) => usage.segments.add(reference));
    await addReferencedSegmentUsage(deps, usage);
    result[key] = usage;
  }
  return result;
}

export async function findAllUsageInSegments(deps: Dependencies): Promise<UsageInSegments> {
  const result: UsageInSegments = {};
  const graph = await buildDependencyGraph(deps.datasource);
  for (const key of await deps.datasource.listSegments()) {
    const usage = {
      features: new Set<string>(),
      segments: new Set<string>(),
      attributes: new Set<string>(),
      variables: new Set<string>(),
    };
    addConditionUsage(usage, conditionLeaves((await deps.datasource.readSegment(key)).conditions));
    const structural = await collectDependencyClosure(deps.datasource, [segmentNode(key)], {
      graph,
    });
    structural.features.forEach((reference) => usage.features.add(reference));
    structural.variables.forEach((reference) => usage.variables.add(reference));
    structural.segments.forEach((reference) => {
      if (reference !== key) usage.segments.add(reference);
    });
    await addReferencedSegmentUsage(deps, usage);
    result[key] = usage;
  }
  return result;
}

export async function findFeatureUsage(
  usageInFeatures: UsageInFeatures,
  searchFeatureKey: FeatureKey,
): Promise<Set<FeatureKey>> {
  const usedInFeatures = new Set<FeatureKey>();

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].features.has(searchFeatureKey)) {
      usedInFeatures.add(featureKey);
    }
  }

  return usedInFeatures;
}

export async function findSegmentUsage(
  usageInFeatures: UsageInFeatures,
  segmentKey: SegmentKey,
): Promise<Set<FeatureKey>> {
  const usedInFeatures = new Set<FeatureKey>();

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].segments.has(segmentKey)) {
      usedInFeatures.add(featureKey);
    }
  }

  return usedInFeatures;
}

export interface AttributeUsage {
  features: Set<FeatureKey>;
  segments: Set<SegmentKey>;
}

export async function findAttributeUsage(
  usageInFeatures: UsageInFeatures,
  usageInSegments: UsageInSegments,
  attributeKey: AttributeKey,
): Promise<AttributeUsage> {
  const usedIn: AttributeUsage = {
    features: new Set<FeatureKey>(),
    segments: new Set<SegmentKey>(),
  };

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].attributes.has(attributeKey)) {
      usedIn.features.add(featureKey);
    }
  }

  for (const segmentKey in usageInSegments) {
    if (usageInSegments[segmentKey].attributes.has(attributeKey)) {
      usedIn.segments.add(segmentKey);
    }
  }

  return usedIn;
}

export async function findUnusedSegments(
  deps: Dependencies,
  usageInFeatures: UsageInFeatures,
  usageInVariables: UsageInVariables = {},
): Promise<Set<SegmentKey>> {
  const { datasource } = deps;
  const unusedSegments = new Set<SegmentKey>();
  const archived = await readArchivedKeys(deps);

  const allSegmentKeys = await datasource.listSegments();
  const usedSegmentKeys = new Set<SegmentKey>();

  for (const featureKey in usageInFeatures) {
    if (archived.features.has(featureKey)) continue;
    usageInFeatures[featureKey].segments.forEach((segmentKey) => {
      usedSegmentKeys.add(segmentKey);
    });
  }
  for (const [variableKey, usage] of Object.entries(usageInVariables)) {
    if (archived.variables.has(variableKey)) continue;
    usage.segments.forEach((segmentKey) => usedSegmentKeys.add(segmentKey));
  }
  for (const key of allSegmentKeys) {
    if (archived.segments.has(key)) continue;
    for (const leaf of conditionLeaves((await datasource.readSegment(key)).conditions)) {
      if (typeof leaf === "string") usedSegmentKeys.add(leaf);
    }
  }

  allSegmentKeys.forEach((segmentKey) => {
    if (!usedSegmentKeys.has(segmentKey) && !archived.segments.has(segmentKey)) {
      unusedSegments.add(segmentKey);
    }
  });

  return unusedSegments;
}

export async function findUnusedAttributes(
  deps: Dependencies,
  usageInFeatures: UsageInFeatures,
  usageInSegments: UsageInSegments,
  usageInVariables: UsageInVariables = {},
): Promise<Set<AttributeKey>> {
  const { datasource } = deps;
  const unusedAttributes = new Set<AttributeKey>();
  const archived = await readArchivedKeys(deps);

  const allAttributeKeys = await datasource.listAttributes();
  const usedAttributeKeys = new Set<AttributeKey>();

  for (const featureKey in usageInFeatures) {
    if (archived.features.has(featureKey)) continue;
    usageInFeatures[featureKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }

  for (const segmentKey in usageInSegments) {
    if (archived.segments.has(segmentKey)) continue;
    usageInSegments[segmentKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }
  for (const [variableKey, usage] of Object.entries(usageInVariables)) {
    if (archived.variables.has(variableKey)) continue;
    usage.attributes.forEach((attributeKey) => usedAttributeKeys.add(attributeKey));
  }

  allAttributeKeys.forEach((attributeKey) => {
    if (!usedAttributeKeys.has(attributeKey) && !archived.attributes.has(attributeKey)) {
      unusedAttributes.add(attributeKey);
    }
  });

  return unusedAttributes;
}

export interface FindUsageOptions {
  feature?: string;
  segment?: string;
  attribute?: string;
  variable?: string;

  unusedSegments?: boolean;
  unusedAttributes?: boolean;

  authors?: boolean;
}

export function assertFindUsageOptions(options: FindUsageOptions) {
  const queries = [
    "feature",
    "segment",
    "attribute",
    "variable",
    "unusedSegments",
    "unusedAttributes",
  ].filter((key) => Boolean(options[key]));

  if (queries.length !== 1) {
    throw new FeaturevisorCLIError(
      queries.length === 0
        ? "Specify one usage query."
        : `Specify only one usage query. Received: ${queries.join(", ")}.`,
      {
        code: "invalid_find_usage_selection",
        details: { queries },
      },
    );
  }
}

function requiresVariable(value: unknown, key: string) {
  return conditionLeaves(value).some(
    (required) =>
      typeof required !== "string" &&
      "variable" in required &&
      !required.feature &&
      required.variable === key,
  );
}

type MarkArchived = (type: "feature" | "segment" | "variable", key: string) => string;

async function findVariableReferenceSites(
  deps: Dependencies,
  variableKey: string,
  mark: MarkArchived = (_type, key) => key,
) {
  const overrideSites = new Set<string>();
  const requiredByFeatures = new Set<string>();
  const requiredByVariables = new Set<string>();
  const composedBy = new Set<string>();
  const aliasedBy = new Set<string>();
  const testChecks = new Set<string>();
  const requiredBySegments = new Set<string>();
  for (const key of await deps.datasource.listSegments()) {
    if (requiresVariable((await deps.datasource.readSegment(key)).conditions, variableKey))
      requiredBySegments.add(key);
  }

  for (const featureKey of await deps.datasource.listFeatures()) {
    const feature = await deps.datasource.readFeature(featureKey);
    if (
      definitionConditionLeaves(feature).some(
        (leaf) =>
          typeof leaf !== "string" &&
          "variable" in leaf &&
          !leaf.feature &&
          leaf.variable === variableKey,
      )
    ) {
      requiredByFeatures.add(featureKey);
    }
    const collect = (overrides: Record<string, VariableOverride[]> | undefined, site: string) => {
      for (const [key, entries] of Object.entries(overrides || {})) {
        if (entries.some((entry) => requiresVariable(entry.conditions, variableKey))) {
          overrideSites.add(`feature ${mark("feature", featureKey)}, ${site}, variable ${key}`);
          requiredByFeatures.add(featureKey);
        }
      }
    };
    for (const variation of feature.variations || []) {
      collect(variation.variableOverrides, `variation ${variation.value}`);
    }
    const ruleGroups = Array.isArray(feature.rules)
      ? [["default", feature.rules] as const]
      : Object.entries(feature.rules || {});
    for (const [environment, rules] of ruleGroups) {
      if (!Array.isArray(rules)) continue;
      for (const rule of rules)
        collect(rule.variableOverrides, `rule ${rule.key} (${environment})`);
    }
  }

  for (const ownerKey of await deps.datasource.listVariables()) {
    const variable = await deps.datasource.readVariable(ownerKey);
    if (requiresVariable(variable.conditions, variableKey)) {
      requiredByVariables.add(ownerKey);
    }
    if (typeof variable.compose === "string") {
      if (variable.compose === variableKey) aliasedBy.add(ownerKey);
    } else if (
      Object.values(variable.compose || {}).some(
        (source) => source.feature === undefined && source.variable === variableKey,
      )
    ) {
      composedBy.add(ownerKey);
    }
    for (const override of flattenVariableOverrides(variable.overrides)) {
      if (requiresVariable(override.conditions, variableKey)) {
        overrideSites.add(
          `global variable ${mark("variable", ownerKey)}, override ${override.key}`,
        );
        requiredByVariables.add(ownerKey);
      }
    }
  }

  if (deps.datasource.listTests && deps.datasource.listScenarios) {
    for (const test of await listTestSpecs(deps.datasource)) {
      const owner = "variable" in test ? test.variable : undefined;
      for (const assertion of test.assertions || []) {
        for (const expectation of [
          assertion,
          ...("children" in assertion ? assertion.children || [] : []),
        ]) {
          if (!("checks" in expectation) || !expectation.checks) continue;
          if (
            getCheckReferences(expectation.checks, owner).some(
              (reference) => !reference.feature && (reference.variable || owner) === variableKey,
            )
          )
            testChecks.add(test.key || ("scenario" in test ? test.scenario : owner || ""));
        }
      }
    }
  }

  return {
    overrideSites,
    requiredByFeatures,
    requiredBySegments,
    requiredByVariables,
    composedBy,
    aliasedBy,
    testChecks,
  };
}

export async function findUsageInProject(deps: Dependencies, options: FindUsageOptions) {
  const { datasource } = deps;

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Finding Featurevisor usage");
  console.log("");

  for (const [type, key, list] of [
    ["feature", options.feature, () => datasource.listFeatures()],
    ["segment", options.segment, () => datasource.listSegments()],
    ["attribute", options.attribute?.split(".")[0], () => datasource.listAttributes()],
  ] as const) {
    if (!key) continue;
    const keys = await list();
    if (keys.includes(key)) continue;
    const namespaced = deps.projectConfig?.namespaceCharacter || ".";
    const alternative = key.replace(/[./]/g, namespaced);
    const hint = keys.includes(alternative)
      ? ` Did you mean "${alternative}"? This project separates namespaces with "${namespaced}".`
      : suggestKey(key, keys);
    throw new FeaturevisorCLIError(
      `Unknown ${type} "${type === "attribute" ? options.attribute : key}".${hint}`,
      {
        code:
          type === "feature"
            ? "feature_not_found"
            : type === "segment"
              ? "segment_not_found"
              : "attribute_not_found",
        details: { [type]: key },
      },
    );
  }

  const usageInFeatures = await findAllUsageInFeatures(deps);
  const usageInSegments = await findAllUsageInSegments(deps);
  const usageInVariables = await findAllUsageInVariables(deps);
  const archived = await readArchivedKeys(deps);
  const mark: MarkArchived = (type, key) =>
    archived[type === "feature" ? "features" : type === "segment" ? "segments" : "variables"].has(
      key,
    )
      ? `${key} ${colorize("(archived)", CLI_COLOR_DIM)}`
      : key;

  if (options.variable) {
    const usage = usageInVariables[options.variable];
    if (!usage) {
      throw new FeaturevisorCLIError(`Variable "${options.variable}" was not found.`, {
        code: "variable_not_found",
        details: { variable: options.variable },
      });
    }

    console.log(CLI_FORMAT_BOLD, `Dependencies of global variable "${options.variable}"`);
    console.log("");
    const groups: Array<[string, Set<string>]> = [
      ["Features", usage.features],
      ["Variables", usage.variables || new Set()],
      ["Segments", usage.segments],
      ["Attributes", usage.attributes],
      ["Schemas", usage.schemas],
    ];
    let found = false;
    for (const [label, keys] of groups) {
      if (keys.size === 0) continue;
      found = true;
      console.log(`  ${colorize(label, CLI_COLOR_CYAN)}: ${Array.from(keys).sort().join(", ")}`);
    }
    if (!found) console.log(CLI_FORMAT_GREEN, "  No dependencies.");
    console.log("");

    const {
      overrideSites,
      requiredByFeatures,
      requiredBySegments,
      requiredByVariables,
      composedBy,
      aliasedBy,
      testChecks,
    } = await findVariableReferenceSites(deps, options.variable, mark);
    console.log(CLI_FORMAT_BOLD, `References to global variable "${options.variable}"`);
    console.log("");
    console.log("  Direct references only.");
    const references: Array<[string, string[], boolean]> = [
      ["Aliased by", Array.from(aliasedBy, (key) => mark("variable", key)), false],
      ["Composed by", Array.from(composedBy, (key) => mark("variable", key)), false],
      [
        "Conditions in features",
        Array.from(requiredByFeatures, (key) => mark("feature", key)),
        false,
      ],
      [
        "Conditions in global variables",
        Array.from(requiredByVariables, (key) => mark("variable", key)),
        false,
      ],
      [
        "Conditions in segments",
        Array.from(requiredBySegments, (key) => mark("segment", key)),
        false,
      ],
      ["Override conditions", Array.from(overrideSites), true],
      ["Test checks", Array.from(testChecks), true],
    ];
    let hasReferences = false;
    for (const [label, keys, multiline] of references) {
      if (!keys.length) continue;
      hasReferences = true;
      if (multiline) {
        console.log(`  ${colorize(label, CLI_COLOR_CYAN)}:`);
        for (const key of keys.sort()) console.log(`    ${colorize("•", CLI_COLOR_CYAN)} ${key}`);
      } else {
        console.log(`  ${colorize(label, CLI_COLOR_CYAN)}: ${keys.sort().join(", ")}`);
      }
    }
    if (!hasReferences) console.log(CLI_FORMAT_GREEN, "  No project references found.");
    console.log("");
    return;
  }

  // feature
  if (options.feature) {
    const usedInFeatures = await findFeatureUsage(usageInFeatures, options.feature);
    const usedInVariables = Object.keys(usageInVariables).filter((key) =>
      usageInVariables[key].features.has(options.feature as string),
    );
    const usedInSegments = Object.keys(usageInSegments).filter((key) =>
      usageInSegments[key].features?.has(options.feature!),
    );
    if (usedInSegments.length) {
      console.log(CLI_FORMAT_BOLD, `Feature "${options.feature}" is used in these segments`);
      console.log("");
      for (const key of usedInSegments)
        console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", key)}`);
      console.log("");
    }

    if (usedInFeatures.size === 0 && usedInVariables.length === 0 && usedInSegments.length === 0) {
      console.log(CLI_FORMAT_GREEN, `Feature "${options.feature}" is not used by other entities.`);
    } else if (usedInFeatures.size > 0) {
      console.log(CLI_FORMAT_BOLD, `Feature "${options.feature}" is used in these features`);
      console.log("");

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)}`);
        }
      }
    }

    if (usedInVariables.length > 0) {
      console.log(CLI_FORMAT_BOLD, `Feature "${options.feature}" is used in these variables`);
      console.log("");
      for (const key of usedInVariables) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("variable", key);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));
          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)}`);
        }
      }
      console.log("");
    }

    return;
  }

  // segment
  if (options.segment) {
    const usedInFeatures = await findSegmentUsage(usageInFeatures, options.segment);
    const usedInVariables = Object.keys(usageInVariables).filter((key) =>
      usageInVariables[key].segments.has(options.segment as string),
    );
    const usedInSegments = Object.keys(usageInSegments).filter((key) =>
      usageInSegments[key].segments?.has(options.segment!),
    );
    if (usedInSegments.length) {
      console.log(CLI_FORMAT_BOLD, `Segment "${options.segment}" is used in these segments`);
      console.log("");
      for (const key of usedInSegments)
        console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", key)}`);
      console.log("");
    }

    if (usedInFeatures.size === 0 && usedInVariables.length === 0 && usedInSegments.length === 0) {
      console.log(
        CLI_FORMAT_GREEN,
        `Segment "${options.segment}" is not used in any features, variables or segments.`,
      );
    } else if (usedInFeatures.size > 0) {
      console.log(CLI_FORMAT_BOLD, `Segment "${options.segment}" is used in these features`);
      console.log("");

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)}`);
        }
      }
    }

    if (usedInVariables.length > 0) {
      console.log(CLI_FORMAT_BOLD, `Segment "${options.segment}" is used in these variables`);
      console.log("");
      for (const key of usedInVariables) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("variable", key);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));
          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)}`);
        }
      }
      console.log("");
    }

    return;
  }

  // attribute
  if (options.attribute) {
    const usedIn = await findAttributeUsage(usageInFeatures, usageInSegments, options.attribute);
    const usedInVariables = Object.keys(usageInVariables).filter((key) =>
      usageInVariables[key].attributes.has(options.attribute as string),
    );

    if (usedIn.features.size === 0 && usedIn.segments.size === 0 && usedInVariables.length === 0) {
      console.log(
        CLI_FORMAT_GREEN,
        `Attribute "${options.attribute}" is not used in any features, segments, or variables.`,
      );

      return;
    }

    if (usedIn.segments.size > 0) {
      console.log(CLI_FORMAT_BOLD, `Attribute "${options.attribute}" is used in these segments`);
      console.log("");

      for (const segmentKey of Array.from(usedIn.segments)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("segment", segmentKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", segmentKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", segmentKey)}`);
        }
      }

      // features affected by above segments
      const affectedFeatures = new Set<FeatureKey>();

      for (const segmentKey of Array.from(usedIn.segments)) {
        const featureKeys = await findSegmentUsage(usageInFeatures, segmentKey);
        featureKeys.forEach((featureKey) => affectedFeatures.add(featureKey));
      }

      if (affectedFeatures.size > 0) {
        console.log("");
        console.log(CLI_FORMAT_BOLD, "Segments above are used in these features");
        console.log("");

        for (const featureKey of Array.from(affectedFeatures)) {
          if (options.authors) {
            const entries = await datasource.listHistoryEntries("feature", featureKey);
            const authors = Array.from(new Set(entries.map((entry) => entry.author)));

            console.log(
              `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
            );
          } else {
            console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)}`);
          }
        }

        console.log("");
      }
    }

    if (usedIn.features.size > 0) {
      console.log(
        CLI_FORMAT_BOLD,
        `Attribute "${options.attribute}" is used directly in these features`,
      );
      console.log("");

      for (const featureKey of Array.from(usedIn.features)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("feature", featureKey)}`);
        }
      }

      console.log("");
    }

    if (usedInVariables.length > 0) {
      console.log(CLI_FORMAT_BOLD, `Attribute "${options.attribute}" is used in these variables`);
      console.log("");
      for (const key of usedInVariables) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("variable", key);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));
          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("variable", key)}`);
        }
      }
      console.log("");
    }

    return;
  }

  // unused segments
  if (options.unusedSegments) {
    const unusedSegments = await findUnusedSegments(deps, usageInFeatures, usageInVariables);

    if (unusedSegments.size === 0) {
      console.log(CLI_FORMAT_GREEN, "No unused segments found.");
    } else {
      console.log(CLI_FORMAT_YELLOW, "Unused segments");
      console.log("");

      for (const segmentKey of Array.from(unusedSegments)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("segment", segmentKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", segmentKey)} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${mark("segment", segmentKey)}`);
        }
      }
    }

    return;
  }

  // unused attributes
  if (options.unusedAttributes) {
    const unusedAttributes = await findUnusedAttributes(
      deps,
      usageInFeatures,
      usageInSegments,
      usageInVariables,
    );

    if (unusedAttributes.size === 0) {
      console.log(CLI_FORMAT_GREEN, "No unused attributes found.");
    } else {
      console.log(CLI_FORMAT_YELLOW, "Unused attributes");
      console.log("");

      for (const attributeKey of Array.from(unusedAttributes)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("attribute", attributeKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${attributeKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${attributeKey}`);
        }
      }
    }

    return;
  }

  console.log(CLI_FORMAT_YELLOW, "Please specify a feature, segment, attribute, or unused query.");
}

export const findUsagePlugin: Plugin = {
  command: "find-usage",
  description: "Find entity dependencies, project references and unused segments or attributes",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    assertFindUsageOptions(parsed as FindUsageOptions);

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await findUsageInProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        {
          feature: parsed.feature,
          segment: parsed.segment,
          attribute: parsed.attribute,
          variable: parsed.variable,
          unusedSegments: parsed.unusedSegments,
          unusedAttributes: parsed.unusedAttributes,
          authors: parsed.authors,
        },
      );
    }
  },
  examples: [
    {
      command: "find-usage --variable=<variableKey>",
      description: "Show dependencies and project references of a global variable",
    },
    {
      command: "find-usage --segment=<segmentKey>",
      description: "Find usage of a segment",
    },
    {
      command: "find-usage --attribute=<attributeKey>",
      description: "Find usage of an attribute",
    },
    {
      command: "find-usage --unused-segments",
      description: "Find unused segments",
    },
    {
      command: "find-usage --unused-attributes",
      description: "Find unused attributes",
    },
  ],
};
