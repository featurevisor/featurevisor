import * as fs from "fs";
import * as path from "path";
import { resolveBuildEnvironments } from "./environments";
import { parsePositiveIntegerOption } from "../cli/validation";
import { inflateEntries } from "./inflate";

import { assertNoLegacyDatasourceGroups } from "../config/removedGroups";
import {
  DEPENDENCY_HANDOFF_LIMIT,
  describeDependencyChain,
  findDeepDependencyChains,
} from "../linter/dependencyDepth";
import type {
  DatafileVariable,
  DatafileVariableOverride,
  ParsedVariable,
  OrdinaryParsedVariable,
  ParsedVariableOverride,
  ParsedFeature,
  Schema,
  VariableKey,
  VariableType,
  VariableValue,
} from "@featurevisor/types";
import {
  Segment,
  Feature,
  DatafileContent,
  Variation,
  VariableOverride,
  Traffic,
  SegmentKey,
  AttributeKey,
  Conditions,
  ExistingState,
  FeatureKey,
  Allocation,
  Expose,
  Rule,
  Force,
} from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { isComposedVariable } from "../datasource/composition";
import {
  findDisallowedAuthoredOperators,
  findDisallowedCheckOperators,
} from "../linter/comparisonOperators";
import { Datasource, FilesystemAdapter, getExistingStateFilePath } from "../datasource";
import { generateHashForDatafile, refreshDatafileHashes } from "./hashes";

import { getTraffic } from "./traffic";
import {
  resolveMutationsForMultipleVariables,
  resolveMutationsForSingleVariable,
} from "./mutateVariables";
import { mutate } from "./mutator";
import { mutationEntries } from "./mutationEntries";
import {
  compileConditions,
  combineConditions,
  getConditionReferences,
} from "../datasource/conditions";
import {
  collectDependencyClosure,
  buildDependencyGraph,
  findDependencyCycles,
  findUnavailableCompositionDependency,
  readableDependencyChain,
  featureFlagNode,
  variableNode,
} from "../datasource/dependencies";
import {
  buildVariableOverrideProgram,
  hasContinuingVariableOverrides,
  hasVariableOverrideMutations,
} from "./variableOverrideProgram";

function buildFeatureVariableOverride(
  override: VariableOverride,
  variableKey: string,
  variablesSchema: ParsedFeature["variablesSchema"],
  baseValue: VariableValue | undefined,
  projectConfig: ProjectConfig,
  segmentKeysUsedByTag: Set<SegmentKey>,
  attributeKeysUsedByTag: Set<AttributeKey>,
): VariableOverride {
  const authoredValue = typeof override.mutate !== "undefined" ? override.mutate : override.value;
  const value = resolveMutationsForSingleVariable(
    variablesSchema,
    variableKey,
    authoredValue as VariableValue,
    baseValue,
    typeof override.mutate !== "undefined",
  );
  const result = { value } as VariableOverride;
  if (override.key !== undefined) result.key = override.key;
  const references = getConditionReferences(override.conditions);
  references.attributes.forEach((key) => attributeKeysUsedByTag.add(key));
  references.segments.forEach((key) => segmentKeysUsedByTag.add(key));
  result.conditions = compileConditions(override.conditions, projectConfig.stringify);
  return result;
}

/** Apply one authored global override's value or mutations to a base value. */
export function resolveVariableOverrideValue(
  variable: OrdinaryParsedVariable,
  override: ParsedVariableOverride,
  baseValue: VariableValue,
): VariableValue {
  if (typeof override.mutate === "undefined") return override.value;

  let value = JSON.parse(JSON.stringify(baseValue)) as VariableValue;
  for (const [mutationKey, mutationValue] of mutationEntries(override.mutate)) {
    value = mutate(variable, value, mutationKey, mutationValue);
  }
  return value;
}

function buildVariableOverrides(
  parsedVariable: OrdinaryParsedVariable,
  sourceOverrides: ParsedVariableOverride[] | undefined,
  projectConfig: ProjectConfig,
  segmentKeysUsedByTag: Set<SegmentKey>,
  attributeKeysUsedByTag: Set<AttributeKey>,
): DatafileVariableOverride[] {
  const result: DatafileVariableOverride[] = [];
  const visit = (
    overrides: ParsedVariableOverride[] | undefined,
    baseValue: VariableValue,
    inheritedConditions: Conditions | undefined,
    inheritedPath: string[],
  ) => {
    for (const override of overrides || []) {
      const references = getConditionReferences(override.conditions);
      references.segments.forEach((key) => segmentKeysUsedByTag.add(key));
      references.attributes.forEach((key) => attributeKeysUsedByTag.add(key));
      const value = resolveVariableOverrideValue(parsedVariable, override, baseValue);
      const conditions = combineConditions(inheritedConditions, override.conditions);
      const keyPath = [...inheritedPath, override.key];
      // Descendants are more specific than their parent fallback.
      visit(override.overrides, value, conditions, keyPath);
      const built: DatafileVariableOverride = { key: override.key, value };
      if (keyPath.length > 1) built.keyPath = keyPath;
      built.conditions = compileConditions(conditions, projectConfig.stringify);
      result.push(built);
    }
  };
  visit(sourceOverrides, parsedVariable.defaultValue, undefined, []);
  return result;
}

export interface CustomDatafileOptions {
  featureKey?: string;
  variableKey?: string;
  environment: string | false;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  revision?: string;
  inflate?: number;
  tag?: string;
  tags?: BuildTags;
  includeFeatures?: "*" | FeatureKey[];
  excludeFeatures?: "*" | FeatureKey[];
  includeVariables?: "*" | VariableKey[];
  excludeVariables?: "*" | VariableKey[];
  featurevisorVersion?: string;
  revisionFromHash?: boolean;
}

export async function getCustomDatafile(options: CustomDatafileOptions): Promise<DatafileContent> {
  resolveBuildEnvironments(options.projectConfig, options.environment, true);
  const existingState = await options.datasource.readState(options.environment);
  const datafileContent = await buildDatafile(
    options.projectConfig,
    options.datasource,
    {
      revision: options.revision || "tester",
      environment: options.environment,
      features: options.featureKey ? [options.featureKey] : options.variableKey ? [] : undefined,
      variables: options.variableKey ? [options.variableKey] : options.featureKey ? [] : undefined,
      inflate: options.inflate,
      tag: options.tag,
      tags: options.tags,
      includeFeatures: options.includeFeatures,
      excludeFeatures: options.excludeFeatures,
      includeVariables: options.includeVariables,
      excludeVariables: options.excludeVariables,
      featurevisorVersion: options.featurevisorVersion,
      revisionFromHash: options.revisionFromHash,
    },
    existingState,
  );

  return datafileContent;
}

export interface BuildOrTags {
  or: string[];
}

export interface BuildAndTags {
  and: string[];
}

export type BuildTags = BuildOrTags | BuildAndTags | string[];

function matchesBuildTags(candidateTags: string[], buildTags?: BuildTags): boolean {
  if (!buildTags) {
    return true;
  }

  if (Array.isArray(buildTags)) {
    return buildTags.some((searchTag) => candidateTags.indexOf(searchTag) !== -1);
  }

  if ("or" in buildTags) {
    return buildTags.or.some((searchTag) => candidateTags.indexOf(searchTag) !== -1);
  }

  if ("and" in buildTags) {
    return buildTags.and.every((searchTag) => candidateTags.indexOf(searchTag) !== -1);
  }

  return true;
}

function matchesFeaturePatterns(featureKey: FeatureKey, patterns?: "*" | FeatureKey[]): boolean {
  if (!patterns) {
    return false;
  }

  const normalizedPatterns = patterns === "*" ? [patterns] : patterns;

  return normalizedPatterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(featureKey);
  });
}

export interface BuildOptions {
  /** Names the trial completeness diagnostic without changing datafile contents. */
  compositionTargetKey?: string;
  revision: string;
  featurevisorVersion?: string;
  revisionFromHash?: boolean;
  environment: string | false;
  tag?: string;
  tags?: BuildTags;
  includeFeatures?: "*" | FeatureKey[];
  excludeFeatures?: "*" | FeatureKey[];
  includeVariables?: "*" | VariableKey[];
  excludeVariables?: "*" | VariableKey[];
  features?: FeatureKey[];
  variables?: VariableKey[];
  inflate?: number;
  /**
   * The dependency graph, when a caller builds several datafiles from the same
   * definitions. It depends only on those definitions, never on the Target or environment.
   */
  dependencyGraph?: Map<string, Set<string>>;
}

export async function buildDatafile(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  options: BuildOptions,
  existingState: ExistingState,
): Promise<DatafileContent> {
  await assertNoLegacyDatasourceGroups(datasource);
  const inflation = parsePositiveIntegerOption("--inflate", options.inflate, 1);
  const disallowedOperators = projectConfig.disallowOperators || [];
  const segmentKeysUsedByTag = new Set<SegmentKey>();
  const attributeKeysUsedByTag = new Set<AttributeKey>();
  const collectConditions = (conditions: Conditions | undefined) => {
    const references = getConditionReferences(conditions);
    references.segments.forEach((key) => segmentKeysUsedByTag.add(key));
    references.attributes.forEach((key) => attributeKeysUsedByTag.add(key));
  };

  const variableFiles = await datasource.listVariables();
  const featureFiles = await datasource.listFeatures();
  const parsedVariablesByKey = new Map<VariableKey, ParsedVariable>();
  const parsedFeaturesByKey: Record<FeatureKey, ParsedFeature> = {};
  const dependencyDatasource = {
    listVariables: async () => variableFiles,
    listFeatures: async () => featureFiles,
    listSegments: () => datasource.listSegments(),
    readSegment: (key: SegmentKey) => datasource.readSegment(key),
    readVariable: async (key: VariableKey) => {
      const cached = parsedVariablesByKey.get(key);
      if (cached) return cached;
      const value = await datasource.readVariable(key);
      if (disallowedOperators.length > 0) {
        const issue = findDisallowedAuthoredOperators(value, disallowedOperators)[0];
        if (issue)
          throw new Error(
            `Variable "${key}" at ${issue.path.join(".")}: operator "${issue.operator}" is disallowed by project configuration.`,
          );
      }
      parsedVariablesByKey.set(key, value);
      return value;
    },
    readFeature: async (key: FeatureKey) => {
      if (parsedFeaturesByKey[key]) return parsedFeaturesByKey[key];
      const value = await datasource.readFeature(key);
      if (Object.prototype.hasOwnProperty.call(value, "required")) {
        throw new Error(
          `Feature "${key}" at required: legacy feature \`required\` was removed. Use \`conditions\` and rename \`{ key }\` to \`{ feature }\`.`,
        );
      }
      if (disallowedOperators.length > 0) {
        const issue = findDisallowedAuthoredOperators(value, disallowedOperators)[0];
        if (issue)
          throw new Error(
            `Feature "${key}" at ${issue.path.join(".")}: operator "${issue.operator}" is disallowed by project configuration.`,
          );
      }
      parsedFeaturesByKey[key] = value;
      return value;
    },
  };
  const parsedVariables: Array<{ key: string; value: ParsedVariable }> = [];
  const dependencyGraph =
    options.dependencyGraph || (await buildDependencyGraph(dependencyDatasource));
  // Cycles are unsafe at runtime even when a build deliberately skips lint.
  // Reuse the acquired graph, including a caller's shared graph, before allocation.
  const dependencyCycles = await findDependencyCycles(dependencyDatasource, dependencyGraph);
  if (dependencyCycles.length) throw dependencyCycles[0];
  // SDKs fail every evaluation of a chain at the runtime limit, so it is never publishable.
  const tooDeep = findDeepDependencyChains(dependencyGraph, DEPENDENCY_HANDOFF_LIMIT)[0];
  if (tooDeep)
    throw new Error(
      `Evaluation needs ${tooDeep.handoffs} dependency handoffs, more than the runtime limit of ${DEPENDENCY_HANDOFF_LIMIT}: ${describeDependencyChain(tooDeep.nodes)}.`,
    );
  let policySegmentFiles: SegmentKey[] | undefined;
  const policySegments = new Map<SegmentKey, Segment>();
  if (disallowedOperators.length > 0) {
    policySegmentFiles = await datasource.listSegments();
    for (const key of policySegmentFiles) {
      const segment = await datasource.readSegment(key);
      const issue = findDisallowedAuthoredOperators(segment, disallowedOperators)[0];
      if (issue)
        throw new Error(
          `Segment "${key}" at ${issue.path.join(".")}: operator "${issue.operator}" is disallowed by project configuration.`,
        );
      policySegments.set(key, segment);
    }
  }
  const featureKeysRequiredByVariables = new Set<FeatureKey>();
  const variableKeysRequiredStructurally = new Set<VariableKey>();
  const selectedVariableRoots: string[] = [];
  for (const variableKey of variableFiles) {
    const parsedVariable = await dependencyDatasource.readVariable(variableKey);
    const variableTags = parsedVariable.tags || [];

    if (parsedVariable.archived === true) continue;
    if (options.variables && options.variables.indexOf(variableKey) === -1) continue;
    if (options.tag && variableTags.indexOf(options.tag) === -1) continue;
    if (options.tags && matchesBuildTags(variableTags, options.tags) === false) continue;
    if (
      options.includeVariables &&
      !matchesFeaturePatterns(variableKey, options.includeVariables)
    ) {
      continue;
    }
    if (matchesFeaturePatterns(variableKey, options.excludeVariables)) continue;

    parsedVariables.push({ key: variableKey, value: parsedVariable });
    selectedVariableRoots.push(variableNode(variableKey));
  }

  if (selectedVariableRoots.length > 0) {
    const structural = await collectDependencyClosure(datasource, selectedVariableRoots, {
      graph: dependencyGraph,
    });
    structural.segments.forEach((key) => segmentKeysUsedByTag.add(key));
    structural.features.forEach((key) => featureKeysRequiredByVariables.add(key));
    structural.variables.forEach((key) => variableKeysRequiredStructurally.add(key));
  }

  for (const variableKey of variableKeysRequiredStructurally) {
    if (parsedVariables.some((entry) => entry.key === variableKey)) continue;
    if (await datasource.variableExists(variableKey)) {
      parsedVariables.push({
        key: variableKey,
        value: await dependencyDatasource.readVariable(variableKey),
      });
    }
  }
  if (disallowedOperators.length > 0) {
    for (const key of (await datasource.listTests?.()) || []) {
      const issue = findDisallowedCheckOperators(
        await datasource.readTest(key),
        disallowedOperators,
      )[0];
      if (issue)
        throw new Error(
          `Test "${key}" at ${issue.path.join(".")}: operator "${issue.operator}" is disallowed by project configuration.`,
        );
    }
    for (const key of (await datasource.listScenarios?.()) || []) {
      const issue = findDisallowedCheckOperators(
        await datasource.readScenario(key),
        disallowedOperators,
      )[0];
      if (issue)
        throw new Error(
          `Scenario "${key}" at ${issue.path.join(".")}: operator "${issue.operator}" is disallowed by project configuration.`,
        );
    }
  }

  // Load schemas for resolving variable schema references in features
  const schemaKeys = await datasource.listSchemas();
  const schemasByKey: Record<string, Schema> = {};
  for (const key of schemaKeys) {
    try {
      schemasByKey[key] = await datasource.readSchema(key);
    } catch {
      // Schema file may be invalid; skip for datafile build
    }
  }

  // features
  let features: Feature[] = [];
  const featuresDirectory = projectConfig.featuresDirectoryPath;

  if (fs.existsSync(featuresDirectory)) {
    for (const featureKey of featureFiles) {
      parsedFeaturesByKey[featureKey] = await dependencyDatasource.readFeature(featureKey);
    }
    const featureKeysRequiredByFeatures = new Set<FeatureKey>();
    const hasFeatureSelection = Boolean(
      options.tag ||
      options.tags ||
      options.includeFeatures ||
      options.excludeFeatures ||
      options.features ||
      options.includeVariables ||
      options.excludeVariables ||
      options.variables,
    );

    if (hasFeatureSelection) {
      const selectedFeatureRoots: string[] = [];
      for (const featureKey of featureFiles) {
        const parsedFeature = parsedFeaturesByKey[featureKey];
        if (parsedFeature.archived === true) continue;
        const featureTags = parsedFeature.tags || [];
        if (options.tag && featureTags.indexOf(options.tag) === -1) continue;
        if (options.tags && matchesBuildTags(featureTags, options.tags) === false) continue;
        if (
          options.includeFeatures &&
          matchesFeaturePatterns(featureKey, options.includeFeatures) === false
        ) {
          continue;
        }
        if (
          options.excludeFeatures &&
          matchesFeaturePatterns(featureKey, options.excludeFeatures)
        ) {
          continue;
        }
        if (options.features && options.features.indexOf(featureKey) === -1) continue;

        const expose = options.environment
          ? (parsedFeature.expose?.[options.environment] as Expose | undefined)
          : (parsedFeature.expose as Expose | undefined);
        if (expose === false) continue;
        if (Array.isArray(expose)) {
          if (options.tag && expose.indexOf(options.tag) === -1) continue;
          if (options.tags && matchesBuildTags(expose, options.tags) === false) continue;
        }

        selectedFeatureRoots.push(featureFlagNode(featureKey));
      }
      const structural = await collectDependencyClosure(datasource, selectedFeatureRoots, {
        graph: dependencyGraph,
      });
      structural.segments.forEach((key) => segmentKeysUsedByTag.add(key));
      structural.features.forEach((key) => featureKeysRequiredByFeatures.add(key));
      structural.variables.forEach((key) => variableKeysRequiredStructurally.add(key));
    }

    for (const variableKey of variableKeysRequiredStructurally) {
      if (parsedVariables.some((entry) => entry.key === variableKey)) continue;
      if (await datasource.variableExists(variableKey)) {
        parsedVariables.push({
          key: variableKey,
          value: await dependencyDatasource.readVariable(variableKey),
        });
      }
    }

    for (const featureKey of featureFiles) {
      const parsedFeature = parsedFeaturesByKey[featureKey];

      if (parsedFeature.archived === true) {
        continue;
      }

      const featureTags = parsedFeature.tags || [];

      const isRequiredByVariable = featureKeysRequiredByVariables.has(featureKey);
      const isRequiredByFeature = featureKeysRequiredByFeatures.has(featureKey);
      const isRequired = isRequiredByVariable || isRequiredByFeature;

      if (!isRequired && options.tag && featureTags.indexOf(options.tag) === -1) {
        continue;
      }

      if (!isRequired && options.tags && matchesBuildTags(featureTags, options.tags) === false) {
        continue;
      }

      if (
        !isRequired &&
        options.includeFeatures &&
        matchesFeaturePatterns(featureKey, options.includeFeatures) === false
      ) {
        continue;
      }

      if (
        !isRequired &&
        options.excludeFeatures &&
        matchesFeaturePatterns(featureKey, options.excludeFeatures)
      ) {
        continue;
      }

      if (!isRequired && options.features && options.features.indexOf(featureKey) === -1) {
        continue;
      }

      let expose: Expose | undefined;
      let rules: Rule[];
      let force: Force[] | undefined;

      if (options.environment) {
        expose = parsedFeature.expose?.[options.environment] as Expose | undefined;
        rules = (parsedFeature.rules?.[options.environment] || []) as Rule[];
        force = parsedFeature.force?.[options.environment] as Force[] | undefined;
      } else {
        expose = parsedFeature.expose as Expose | undefined;
        rules = parsedFeature.rules as Rule[];
        force = parsedFeature.force as Force[] | undefined;
      }

      if (expose === false) {
        continue;
      }

      if (Array.isArray(expose)) {
        const exposeTags = expose;

        if (options.tag && exposeTags.indexOf(options.tag) === -1) {
          continue;
        }

        if (options.tags && matchesBuildTags(exposeTags, options.tags) === false) {
          continue;
        }
      }

      collectConditions(parsedFeature.conditions);
      for (const parsedRule of rules) collectConditions(parsedRule.conditions);

      const feature: Feature = {
        key: featureKey,
        deprecated: parsedFeature.deprecated === true ? true : undefined,
        bucketBy: parsedFeature.bucketBy || projectConfig.defaultBucketBy,
        conditions: compileConditions(parsedFeature.conditions, projectConfig.stringify),
        disabledVariationValue: parsedFeature.disabledVariationValue,
        variations: Array.isArray(parsedFeature.variations)
          ? parsedFeature.variations.map((variation: Variation) => {
              const mappedVariation: any = {
                value: variation.value,
                weight: variation.weight, // @NOTE: added so state files can maintain weight info, but datafiles don't need this. find a way to remove it from datafiles later
                variables: resolveMutationsForMultipleVariables(
                  parsedFeature.variablesSchema,
                  variation.variables,
                ),
                // A new object, filled below in the same key order. Writing into the
                // authored one would change the input for every later Target build.
                variableOverrides: variation.variableOverrides ? {} : variation.variableOverrides,
              };

              if (variation.variableOverrides) {
                const variableOverrides = variation.variableOverrides;
                const variableKeys = Object.keys(variableOverrides);

                for (const variableKey of variableKeys) {
                  const baseValue = mappedVariation.variables
                    ? mappedVariation.variables[variableKey]
                    : undefined;

                  mappedVariation.variableOverrides[variableKey] = variableOverrides[
                    variableKey
                  ].map((override: VariableOverride) =>
                    buildFeatureVariableOverride(
                      override,
                      variableKey,
                      parsedFeature.variablesSchema,
                      baseValue,
                      projectConfig,
                      segmentKeysUsedByTag,
                      attributeKeysUsedByTag,
                    ),
                  );
                }
              }

              return mappedVariation;
            })
          : undefined,
        traffic: getTraffic(
          parsedFeature.variations,
          rules,
          existingState.features[featureKey],
          featureKey,
          projectConfig.adapter === FilesystemAdapter ||
            projectConfig.adapter?.prototype instanceof FilesystemAdapter
            ? path.relative(
                datasource.getRootDirectoryPath() || process.cwd(),
                getExistingStateFilePath(projectConfig, options.environment),
              )
            : undefined,
        ).map((t: Traffic) => {
          const resolvedVariables = resolveMutationsForMultipleVariables(
            parsedFeature.variablesSchema,
            t.variables,
          );

          let resolvedVariableOverrides = t.variableOverrides;

          if (t.variableOverrides) {
            resolvedVariableOverrides = {};
            const variableKeys = Object.keys(t.variableOverrides);

            for (const variableKey of variableKeys) {
              const overrides = t.variableOverrides[variableKey];
              const baseValue = resolvedVariables ? resolvedVariables[variableKey] : undefined;

              resolvedVariableOverrides[variableKey] = overrides.map((override: VariableOverride) =>
                buildFeatureVariableOverride(
                  override,
                  variableKey,
                  parsedFeature.variablesSchema,
                  baseValue,
                  projectConfig,
                  segmentKeysUsedByTag,
                  attributeKeysUsedByTag,
                ),
              );
            }
          }

          return {
            ...t,
            variables: resolvedVariables,
            variableOverrides: resolvedVariableOverrides,
            conditions: compileConditions(t.conditions, projectConfig.stringify),
          };
        }),
      };

      // update state in memory, so that next datafile build can use it (in case it contains the same feature)
      existingState.features[featureKey] = {
        variations: Array.isArray(feature.variations)
          ? feature.variations.map((v: Variation) => {
              return {
                value: v.value,
                weight: v.weight || 0,
              };
            })
          : undefined,
        traffic: feature.traffic.map((t: Traffic) => {
          return {
            key: t.key,
            percentage: t.percentage,
            allocation:
              t.allocation &&
              t.allocation.map((a: Allocation) => {
                return {
                  variation: a.variation,
                  range: a.range,
                };
              }),
          };
        }),
      };

      if (parsedFeature.variablesSchema) {
        const variableKeys = Object.keys(parsedFeature.variablesSchema);
        feature.variablesSchema = {};

        for (const variableKey of variableKeys) {
          const v = parsedFeature.variablesSchema[variableKey];
          const resolved =
            "schema" in v && v.schema
              ? schemasByKey[v.schema]
              : (v as { type: string; properties?: Schema; required?: string[]; items?: Schema });

          feature.variablesSchema[variableKey] = {
            key: variableKey,
            type: (resolved?.type ?? "string") as VariableType,
            defaultValue: v.defaultValue,
            deprecated: v.deprecated === true ? true : undefined,
            useDefaultWhenDisabled: v.useDefaultWhenDisabled === true ? true : undefined,
            disabledValue: typeof v.disabledValue !== "undefined" ? v.disabledValue : undefined,
          };
        }
      }

      if (force) {
        feature.force = force.map((authored) => {
          // Assign to a copy. The authored entry is input to every Target and environment.
          const f: Force = {
            conditions: authored.conditions,
            enabled: authored.enabled,
            variation: authored.variation,
            variables: authored.variables,
          };
          collectConditions(f.conditions);
          f.conditions = compileConditions(f.conditions, projectConfig.stringify);

          if (f.variables) {
            f.variables = resolveMutationsForMultipleVariables(
              parsedFeature.variablesSchema,
              f.variables,
            );
          }

          return f;
        });
      }

      features.push(feature);
    }
  }

  // global variables
  const includedFeatureKeys = new Set(features.map((feature) => feature.key));
  const unavailableCompositionDependency = findUnavailableCompositionDependency(
    dependencyGraph,
    parsedVariables
      .filter(({ value }) => isComposedVariable(value))
      .map(({ key }) => variableNode(key)),
    (node) => {
      if (node[0] === "variable") {
        const definition = parsedVariablesByKey.get(node[1]);
        if (!definition) return `variable "${node[1]}" has a missing definition`;
        if (definition.archived) return `variable "${node[1]}" is archived`;
      } else if (node[0] !== "segment") {
        if (!includedFeatureKeys.has(node[1])) {
          const definition = parsedFeaturesByKey[node[1]];
          if (!definition) return `feature "${node[1]}" has a missing definition`;
          if (definition.archived) return `feature "${node[1]}" is archived`;
          return `feature "${node[1]}" is excluded by exposure`;
        }
        if (
          node[0] === "feature-variable" &&
          !Object.prototype.hasOwnProperty.call(
            parsedFeaturesByKey[node[1]]?.variablesSchema || {},
            node[2],
          )
        )
          return `feature "${node[1]}" references missing variable "${node[1]}:${node[2]}"`;
      }
      return undefined;
    },
  );
  if (unavailableCompositionDependency) {
    const { root, alias, nodes, reason } = unavailableCompositionDependency;
    throw new Error(
      `Composition ${JSON.stringify(JSON.parse(root)[1])}${alias === undefined ? "" : ` property ${JSON.stringify(alias)}`} cannot include its dependency in Target "${options.compositionTargetKey || "custom"}" and environment "${options.environment || "none"}" with filters ${JSON.stringify({ tag: options.tag, tags: options.tags, includeFeatures: options.includeFeatures, excludeFeatures: options.excludeFeatures, includeVariables: options.includeVariables, excludeVariables: options.excludeVariables, features: options.features, variables: options.variables })}. Dependency chain ${readableDependencyChain(dependencyGraph, nodes)} is unavailable: ${reason}.`,
    );
  }
  let variables: Array<{ key: string; value: DatafileVariable }> = [];
  const compositionTypes = new Map<ParsedVariable, VariableType>();
  const compositionType = (variable: ParsedVariable): VariableType => {
    const seen = new Set<ParsedVariable>();
    let type = compositionTypes.get(variable);
    while (type === undefined && typeof variable.compose === "string") {
      if (seen.has(variable)) throw new Error("circular dependency found through compose");
      seen.add(variable);
      variable = parsedVariablesByKey.get(variable.compose)!;
      type = compositionTypes.get(variable);
    }
    if (type === undefined) {
      if (isComposedVariable(variable)) type = "object";
      else {
        let schema: Schema | ParsedVariable | undefined = variable;
        const seenSchemas = new Set<string>();
        while (schema?.schema) {
          if (seenSchemas.has(schema.schema)) throw new Error("circular schema reference found");
          seenSchemas.add(schema.schema);
          schema = schemasByKey[schema.schema];
        }
        type = (schema?.type || "string") as VariableType;
      }
      compositionTypes.set(variable, type);
    }
    for (const alias of seen) compositionTypes.set(alias, type);
    return type;
  };
  for (const { key, value: parsedVariable } of parsedVariables) {
    const sourceOverrides = options.environment
      ? (parsedVariable.overrides as Record<string, ParsedVariableOverride[]> | undefined)?.[
          options.environment
        ]
      : (parsedVariable.overrides as ParsedVariableOverride[] | undefined);
    // A composition has no static starting value, even without continuation.
    const useProgram =
      (isComposedVariable(parsedVariable) && !!sourceOverrides?.length) ||
      hasContinuingVariableOverrides(sourceOverrides) ||
      (projectConfig.precomputeMutations === false &&
        hasVariableOverrideMutations(sourceOverrides));
    const program = useProgram
      ? buildVariableOverrideProgram(sourceOverrides!, projectConfig.stringify)
      : undefined;
    collectConditions(parsedVariable.conditions);
    for (const step of program || []) collectConditions(step.conditions);
    if (isComposedVariable(parsedVariable)) {
      const definition = parsedVariable.compose;
      const compose =
        typeof definition === "string"
          ? definition
          : Object.keys(definition)
              .sort()
              .map((alias) => ({ key: alias, ...definition[alias] }));
      variables.push({
        key,
        value: {
          type: compositionType(parsedVariable),
          compose,
          conditions: compileConditions(parsedVariable.conditions, projectConfig.stringify),
          disabledValue: parsedVariable.disabledValue,
          ...(program ? { overrideProgram: program } : {}),
          ...(parsedVariable.deprecated ? { deprecated: true } : {}),
        },
      });
      continue;
    }
    const resolvedSchema = parsedVariable.schema
      ? schemasByKey[parsedVariable.schema]
      : parsedVariable;
    const overrides = program
      ? []
      : buildVariableOverrides(
          parsedVariable,
          sourceOverrides,
          projectConfig,
          segmentKeysUsedByTag,
          attributeKeysUsedByTag,
        );
    variables.push({
      key,
      value: {
        deprecated: parsedVariable.deprecated === true ? true : undefined,
        // `oneOf` schemas intentionally have no root type. Use a neutral
        // non-JSON fallback so plain string branches are not parsed as JSON by
        // SDKs. Runtime type-specific getters still inspect the selected value.
        type: (resolvedSchema?.type || "string") as VariableType,
        defaultValue: parsedVariable.defaultValue,
        disabledValue: parsedVariable.disabledValue,
        useDefaultWhenDisabled: parsedVariable.useDefaultWhenDisabled === true ? true : undefined,
        conditions: compileConditions(parsedVariable.conditions, projectConfig.stringify),
        overrides: overrides.length > 0 ? overrides : undefined,
        ...(program ? { overrideProgram: program } : {}),
      },
    });
  }

  // segments
  let segments: Segment[] = [];
  const segmentsDirectory = projectConfig.segmentsDirectoryPath;

  if (fs.existsSync(segmentsDirectory)) {
    const segmentFiles = policySegmentFiles || (await datasource.listSegments());
    const pending = [...segmentKeysUsedByTag];
    const visited = new Set<string>();
    while (pending.length) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!segmentFiles.includes(key)) continue;
      const segment = policySegments.get(key) || (await datasource.readSegment(key));
      policySegments.set(key, segment);
      for (const ref of getConditionReferences(segment.conditions).segments) {
        segmentKeysUsedByTag.add(ref);
        pending.push(ref);
      }
    }

    for (const segmentKey of segmentFiles) {
      const parsedSegment =
        policySegments.get(segmentKey) || (await datasource.readSegment(segmentKey));

      if (parsedSegment.archived === true) {
        continue;
      }

      if (segmentKeysUsedByTag.has(segmentKey) === false) {
        continue;
      }

      collectConditions(parsedSegment.conditions);

      const segment: Segment = {
        key: segmentKey,
        conditions: compileConditions(parsedSegment.conditions, projectConfig.stringify)!,
      };

      segments.push(segment);
    }
  }

  // Attributes are not part of datafiles. Reading each one still rejects invalid
  // attribute files during build, including attributes nothing uses.
  if (fs.existsSync(projectConfig.attributesDirectoryPath)) {
    for (const attributeKey of await datasource.listAttributes()) {
      await datasource.readAttribute(attributeKey);
    }
  }

  if (inflation > 1) {
    features = inflateEntries(features, inflation);
    segments = inflateEntries(segments, inflation);
    variables = inflateEntries(variables, inflation);
  }

  const datafileContent: DatafileContent = {
    schemaVersion: "4",
    featurevisorVersion: options.featurevisorVersion,
    revision: options.revision,
    segments: {},
    features: {},
    variables: {},
  };

  datafileContent.segments = segments.reduce((acc, segment) => {
    if (segment.key) {
      acc[segment.key] = segment;
      delete acc[segment.key].key; // remove key from segment, as it is not needed in v2 datafile
    }

    return acc;
  }, {});

  datafileContent.features = features.reduce((acc, feature) => {
    if (!feature.key) {
      return acc;
    }

    const featureKey = feature.key as FeatureKey;
    const featureV2 = feature;

    // remove key, as it is not needed in v2 datafile
    delete featureV2.key;

    // remove variablesSchema[key].key
    if (featureV2.variablesSchema) {
      for (const [variableKey, variable] of Object.entries(featureV2.variablesSchema)) {
        if (variable.key) {
          delete featureV2.variablesSchema[variableKey].key;
        }
      }
    }

    acc[featureKey] = featureV2;

    return acc;
  }, {});

  datafileContent.variables = variables.reduce(
    (acc, variable) => {
      acc[variable.key] = variable.value;
      return acc;
    },
    {} as Record<VariableKey, DatafileVariable>,
  );

  // Hash the complete graph, including feature dependencies on global variables.
  refreshDatafileHashes(datafileContent);
  Object.keys(datafileContent.features).forEach((featureKey) => {
    // check needed to support --inflate option
    if (existingState.features[featureKey]) {
      existingState.features[featureKey].hash = datafileContent.features[featureKey].hash;
    }
  });

  if (options.revisionFromHash) {
    const datafileHash = generateHashForDatafile(datafileContent);
    datafileContent.revision = `${datafileHash}`;
  }

  return datafileContent;
}
