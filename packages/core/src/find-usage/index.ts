import type {
  Condition,
  FeatureKey,
  SegmentKey,
  AttributeKey,
  SchemaKey,
} from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { FeaturevisorCLIError } from "../error";
import {
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "../utils/extractKeys";
import { getProjectSetExecutions, printSetHeader } from "../sets";
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
  };
}

export async function findAllUsageInFeatures(deps: Dependencies): Promise<UsageInFeatures> {
  const { datasource, projectConfig } = deps;
  const usageInFeatures: UsageInFeatures = {};

  const featureKeys = await datasource.listFeatures();

  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    usageInFeatures[featureKey] = {
      features: new Set<FeatureKey>(),
      segments: new Set<SegmentKey>(),
      attributes: new Set<AttributeKey>(),
    };

    // required
    if (feature.required) {
      feature.required.forEach((required) => {
        if (typeof required === "string") {
          usageInFeatures[featureKey].features.add(required);
        } else if (typeof required === "object" && required.key) {
          usageInFeatures[featureKey].features.add(required.key);
        }
      });
    }

    // bucketBy
    if (feature.bucketBy) {
      if (typeof feature.bucketBy === "string") {
        usageInFeatures[featureKey].attributes.add(feature.bucketBy);
      } else if (Array.isArray(feature.bucketBy)) {
        feature.bucketBy.forEach((b) => usageInFeatures[featureKey].attributes.add(b));
      } else if (typeof feature.bucketBy === "object" && feature.bucketBy.or) {
        feature.bucketBy.or.forEach((b) => usageInFeatures[featureKey].attributes.add(b));
      }
    }

    // variable overrides inside variations
    if (feature.variations) {
      feature.variations.forEach((variation) => {
        if (variation.variableOverrides) {
          Object.keys(variation.variableOverrides).forEach((variableKey) => {
            const overrides = variation.variableOverrides?.[variableKey];

            if (overrides) {
              overrides.forEach((override) => {
                if (override.segments) {
                  extractSegmentKeysFromGroupSegments(override.segments).forEach((segmentKey) =>
                    usageInFeatures[featureKey].segments.add(segmentKey),
                  );
                }

                if (override.conditions) {
                  extractAttributeKeysFromConditions(override.conditions).forEach((attributeKey) =>
                    usageInFeatures[featureKey].attributes.add(attributeKey),
                  );
                }
              });
            }
          });
        }
      });
    }

    // with environments
    if (Array.isArray(projectConfig.environments)) {
      projectConfig.environments.forEach((environment) => {
        // force
        if (feature.force && feature.force[environment]) {
          feature.force[environment].forEach((force) => {
            if (force.segments) {
              extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) =>
                usageInFeatures[featureKey].segments.add(segmentKey),
              );
            }

            if (force.conditions) {
              extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) =>
                usageInFeatures[featureKey].attributes.add(attributeKey),
              );
            }
          });
        }

        // rules
        if (feature.rules && feature.rules[environment]) {
          feature.rules[environment].forEach((rule) => {
            extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) =>
              usageInFeatures[featureKey].segments.add(segmentKey),
            );
          });
        }
      });
    }

    // no environments
    if (!Array.isArray(projectConfig.environments)) {
      // force
      if (Array.isArray(feature.force)) {
        feature.force.forEach((force) => {
          if (force.segments) {
            extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) =>
              usageInFeatures[featureKey].segments.add(segmentKey),
            );
          }

          if (force.conditions) {
            extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) =>
              usageInFeatures[featureKey].attributes.add(attributeKey),
            );
          }
        });
      }

      // rules
      if (Array.isArray(feature.rules)) {
        feature.rules.forEach((rule) => {
          extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) =>
            usageInFeatures[featureKey].segments.add(segmentKey),
          );
        });
      }
    }
  }

  return usageInFeatures;
}

export interface UsageInSegments {
  [segmentKey: string]: {
    attributes: Set<AttributeKey>;
  };
}

export interface UsageInVariables {
  [variableKey: string]: {
    features: Set<FeatureKey>;
    segments: Set<SegmentKey>;
    attributes: Set<AttributeKey>;
    schemas: Set<SchemaKey>;
  };
}

export async function findAllUsageInVariables(deps: Dependencies): Promise<UsageInVariables> {
  const result: UsageInVariables = {};
  for (const variableKey of await deps.datasource.listVariables()) {
    const variable = await deps.datasource.readVariable(variableKey);
    const usage = {
      features: new Set<FeatureKey>(),
      segments: new Set<SegmentKey>(),
      attributes: new Set<AttributeKey>(),
      schemas: new Set<SchemaKey>(),
    };
    if (variable.schema) usage.schemas.add(variable.schema);
    [
      ...(variable.requiredFeatures || []),
      ...Object.values(variable.overrides || {})
        .flat()
        .flatMap((override) => override.requiredFeatures || []),
    ].forEach((required) =>
      usage.features.add(typeof required === "string" ? required : required.key),
    );
    Object.values(variable.overrides || {})
      .flat()
      .forEach((override) => {
        extractSegmentKeysFromGroupSegments(override.segments || []).forEach((key) =>
          usage.segments.add(key),
        );
        extractAttributeKeysFromConditions(override.conditions || []).forEach((key) =>
          usage.attributes.add(key),
        );
      });
    result[variableKey] = usage;
  }
  return result;
}

export async function findAllUsageInSegments(deps: Dependencies): Promise<UsageInSegments> {
  const { datasource } = deps;
  const usageInSegments: UsageInSegments = {};

  const segmentKeys = await datasource.listSegments();

  for (const segmentKey of segmentKeys) {
    const segment = await datasource.readSegment(segmentKey);
    usageInSegments[segmentKey] = {
      attributes: new Set<AttributeKey>(),
    };

    extractAttributeKeysFromConditions(segment.conditions as Condition | Condition[]).forEach(
      (attributeKey) => {
        usageInSegments[segmentKey].attributes.add(attributeKey);
      },
    );
  }

  return usageInSegments;
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

  const allSegmentKeys = await datasource.listSegments();
  const usedSegmentKeys = new Set<SegmentKey>();

  for (const featureKey in usageInFeatures) {
    usageInFeatures[featureKey].segments.forEach((segmentKey) => {
      usedSegmentKeys.add(segmentKey);
    });
  }
  Object.values(usageInVariables).forEach((usage) =>
    usage.segments.forEach((segmentKey) => usedSegmentKeys.add(segmentKey)),
  );

  allSegmentKeys.forEach((segmentKey) => {
    if (!usedSegmentKeys.has(segmentKey)) {
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

  const allAttributeKeys = await datasource.listAttributes();
  const usedAttributeKeys = new Set<AttributeKey>();

  for (const featureKey in usageInFeatures) {
    usageInFeatures[featureKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }

  for (const segmentKey in usageInSegments) {
    usageInSegments[segmentKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }
  Object.values(usageInVariables).forEach((usage) =>
    usage.attributes.forEach((attributeKey) => usedAttributeKeys.add(attributeKey)),
  );

  allAttributeKeys.forEach((attributeKey) => {
    if (!usedAttributeKeys.has(attributeKey)) {
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

export async function findUsageInProject(deps: Dependencies, options: FindUsageOptions) {
  const { datasource } = deps;

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Finding Featurevisor usage");
  console.log("");

  const usageInFeatures = await findAllUsageInFeatures(deps);
  const usageInSegments = await findAllUsageInSegments(deps);
  const usageInVariables = await findAllUsageInVariables(deps);

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
    return;
  }

  // feature
  if (options.feature) {
    const usedInFeatures = await findFeatureUsage(usageInFeatures, options.feature);
    const usedInVariables = Object.keys(usageInVariables).filter((key) =>
      usageInVariables[key].features.has(options.feature as string),
    );

    if (usedInFeatures.size === 0 && usedInVariables.length === 0) {
      console.log(CLI_FORMAT_GREEN, `Feature "${options.feature}" is not used by other entities.`);
    } else if (usedInFeatures.size > 0) {
      console.log(CLI_FORMAT_BOLD, `Feature "${options.feature}" is used in these features`);
      console.log("");

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${key} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${key}`);
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

    if (usedInFeatures.size === 0 && usedInVariables.length === 0) {
      console.log(
        CLI_FORMAT_GREEN,
        `Segment "${options.segment}" is not used in any features or variables.`,
      );
    } else if (usedInFeatures.size > 0) {
      console.log(CLI_FORMAT_BOLD, `Segment "${options.segment}" is used in these features`);
      console.log("");

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(
            `  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${key} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${key}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${segmentKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${segmentKey}`);
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
              `  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
            );
          } else {
            console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${featureKey}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${key} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${key}`);
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
            `  ${colorize("•", CLI_COLOR_CYAN)} ${segmentKey} ${colorize(`(Authors: ${authors.join(", ")})`, CLI_COLOR_DIM)}`,
          );
        } else {
          console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${segmentKey}`);
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
      description: "Show dependencies of a global variable",
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
