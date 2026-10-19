import * as path from "path";

import type {
  ParsedFeature,
  Segment,
  Attribute,
  TestFeature,
  TestSegment,
  FeatureAssertion,
  SegmentAssertion,
  Target,
  Schema,
  ParsedVariable,
  TestVariable,
  VariableAssertion,
  TestScenario,
  ScenarioAssertion,
  Test,
  TestCheckReference,
  TestCaseExecutionMetadata,
  TestEntityType,
  TestExecutionDocument,
} from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import type { ProjectConfig } from "../config";
import type { DatafileFile } from "../datasource";
import { Plugin } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { FeaturevisorCLIError } from "../error";
import {
  getFeatureAssertionsFromMatrix,
  getMatrixCombinations,
  getSegmentAssertionsFromMatrix,
  getVariableAssertionsFromMatrix,
} from "./matrix";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import { getTargetFeatureKeys, getTargetVariableKeys, resolveTargets } from "../targeting";
import {
  CLI_COLOR_CYAN,
  CLI_COLOR_GREEN,
  CLI_COLOR_YELLOW,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_YELLOW,
  colorize,
} from "../tester/cliFormat";
import { getCheckReferences } from "../tester/checks";
import { compileConditions, walkConditionLeaves } from "../datasource/conditions";
import { listTestSpecs } from "./scenarios";

async function getEntitiesWithTests(
  deps: Dependencies,
): Promise<{ features: string[]; segments: string[]; variables: string[] }> {
  const { datasource } = deps;

  const featuresWithTests = new Set<string>();
  const segmentsWithTests = new Set<string>();
  const variablesWithTests = new Set<string>();

  const tests = await listTestSpecs(datasource);
  for (const test of tests) {
    if ("feature" in test) {
      featuresWithTests.add(test.feature);
    }

    if ("segment" in test) {
      segmentsWithTests.add(test.segment);
    }

    if ("variable" in test) {
      variablesWithTests.add(test.variable);
    }

    if ("variable" in test || "scenario" in test) {
      const owner = "variable" in test ? test.variable : undefined;
      const addReference = (reference: TestCheckReference) => {
        if (reference.segment) {
          segmentsWithTests.add(reference.segment);
        } else if (reference.feature) {
          featuresWithTests.add(reference.feature);
        } else if (reference.variable || owner) {
          variablesWithTests.add(reference.variable || owner!);
        }
      };

      for (let assertionIndex = 0; assertionIndex < test.assertions.length; assertionIndex++) {
        const authoredAssertion = test.assertions[assertionIndex];
        if (
          authoredAssertion.matrix &&
          getMatrixCombinations(authoredAssertion.matrix).length === 0
        ) {
          throw new Error("Cannot collect test coverage from an empty assertion matrix.");
        }
        const assertions = getVariableAssertionsFromMatrix(
          assertionIndex,
          authoredAssertion as VariableAssertion,
        );
        for (const assertion of assertions) {
          for (const expectation of [assertion, ...(assertion.children || [])]) {
            if (expectation.checks === undefined) continue;
            getCheckReferences(expectation.checks, owner).forEach(addReference);
          }
        }
      }
    }
  }

  return {
    features: Array.from(featuresWithTests),
    segments: Array.from(segmentsWithTests),
    variables: Array.from(variablesWithTests),
  };
}

function getBooleanOptionValue(value: unknown, fallback = false) {
  if (typeof value === "undefined") {
    return fallback;
  }

  if (typeof value === "string") {
    return value !== "false";
  }

  return value === true;
}

function matchesBooleanOption(option: unknown, value: unknown, defaultOption?: boolean) {
  return (
    getBooleanOptionValue(value, defaultOption) === getBooleanOptionValue(option, defaultOption)
  );
}

function getTestSource(deps: Dependencies, storageKey: string, entityType: TestEntityType): string {
  const { datasource, projectConfig, rootDirectoryPath } = deps;
  if (entityType === "scenario" && datasource.getScenarioSourcePath) {
    return path
      .relative(rootDirectoryPath, datasource.getScenarioSourcePath(storageKey))
      .split(path.sep)
      .join("/");
  }
  if (entityType !== "scenario" && datasource.getTestSourcePath) {
    return path
      .relative(rootDirectoryPath, datasource.getTestSourcePath(storageKey))
      .split(path.sep)
      .join("/");
  }
  const namespaceCharacter = projectConfig.namespaceCharacter;
  const fallbackKey = storageKey.endsWith(".spec") ? storageKey : `${storageKey}.spec`;
  const segments = namespaceCharacter ? fallbackKey.split(namespaceCharacter) : [fallbackKey];
  if (
    segments.length > 1 &&
    ["spec", "feature", "segment"].includes(segments[segments.length - 1])
  ) {
    const suffix = segments.pop();
    segments[segments.length - 1] = `${segments[segments.length - 1]}.${suffix}`;
  }
  const parser = projectConfig.parser as { extension?: string } | string;
  const extension =
    typeof datasource.getExtension === "function"
      ? datasource.getExtension()
      : typeof parser === "string"
        ? parser
        : parser.extension;
  const directory = projectConfig.testsDirectoryPath;
  const extensionSuffix = extension ? `.${extension}` : "";
  const source = path.relative(
    rootDirectoryPath,
    `${path.join(directory, ...segments)}${extensionSuffix}`,
  );

  return source.split(path.sep).join("/");
}

function getTestCaseMetadata(
  set: string | null,
  entityType: TestEntityType,
  storageKey: string,
  assertion: FeatureAssertion | SegmentAssertion | VariableAssertion | ScenarioAssertion,
  assertionIndex: number,
  matrixIndex: number | null,
  matrixValues: TestCaseExecutionMetadata["matrixValues"],
): TestCaseExecutionMetadata {
  return {
    id: JSON.stringify([set, entityType, storageKey, assertion.key ?? assertionIndex, matrixIndex]),
    assertionIndex,
    matrixIndex,
    matrixValues,
  };
}

function throwTestCaseNotFound(caseId: string): never {
  throw new FeaturevisorCLIError(`No test case matched --case=${caseId}.`, {
    code: "test_case_not_found",
    details: { case: caseId },
  });
}

/**
 * Feature assertions renamed `sticky` to `stickyFeatures`. Lint names the
 * replacement. Running specs must not silently ignore the old field either.
 */
function assertNoRemovedSticky(assertions: FeatureAssertion[], key: string) {
  const own = (value: unknown) =>
    !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "sticky");
  const found = assertions.some(
    (assertion) =>
      own(assertion) ||
      (Array.isArray(assertion?.children) && assertion.children.some((child) => own(child))),
  );
  if (found) {
    throw new FeaturevisorCLIError(
      `Test "${key}" uses \`sticky\`. Replace it with \`stickyFeatures\`, then run lint.`,
      { code: "removed_test_field", details: { test: key, field: "sticky" } },
    );
  }
}

/** A feature's rules for one environment, or its direct list when environments are not configured. */
function getRulesIn(feature: ParsedFeature, environment: string | false) {
  const rules = feature.rules as unknown;
  if (Array.isArray(rules)) return environment === false ? rules : [];
  if (environment === false || !rules || typeof rules !== "object") return [];
  return (rules as Record<string, Array<{ percentage: number }>>)[environment] || [];
}

export async function listEntities<T>(deps: Dependencies, entityType): Promise<T[]> {
  const { datasource, options } = deps;
  if (
    options.case !== undefined &&
    (typeof options.case !== "string" || options.case.length === 0)
  ) {
    throw new FeaturevisorCLIError("Pass one nonempty case ID with --case.", {
      code: "invalid_test_case",
    });
  }

  const result: T[] = [];
  let entityKeys: string[] = [];
  let testSpecs: Test[] = [];

  if (entityType === "feature") {
    entityKeys = await datasource.listFeatures();
  } else if (entityType === "segment") {
    entityKeys = await datasource.listSegments();
  } else if (entityType === "attribute") {
    entityKeys = await datasource.listAttributes();
  } else if (entityType === "schema") {
    entityKeys = await datasource.listSchemas();
  } else if (entityType === "test") {
    testSpecs = await listTestSpecs(datasource);
    entityKeys = testSpecs.map((test) => test.key!);
  } else if (entityType === "scenario") {
    entityKeys = await datasource.listScenarios();
  } else if (entityType === "target") {
    entityKeys = await datasource.listTargets();
  } else if (entityType === "variable") {
    entityKeys = await datasource.listVariables();
  }

  if (entityKeys.length === 0) {
    if (entityType === "test" && typeof options.case === "string") {
      throwTestCaseNotFound(options.case);
    }
    return result;
  }

  let entitiesWithTests: { features: string[]; segments: string[]; variables: string[] } = {
    features: [],
    segments: [],
    variables: [],
  };
  let entitiesWithTestsInitialized = false;
  let targetFeatureKeys: Set<string> | undefined;
  let targetVariableKeys: Set<string> | undefined;
  const descriptionRegex = options.description
    ? parseRegexOption("--description", options.description, "i")
    : undefined;
  const keyRegex = options.keyPattern
    ? parseRegexOption("--key-pattern", options.keyPattern)
    : undefined;
  const assertionRegex = options.assertionPattern
    ? parseRegexOption("--assertion-pattern", options.assertionPattern, "i")
    : undefined;

  if (entityType === "feature" && options.target) {
    const targets = await resolveTargets(datasource, options.target, { defaultToAll: false });
    targetFeatureKeys = await getTargetFeatureKeys(datasource, targets);
  }

  if (entityType === "variable" && options.target) {
    const targets = await resolveTargets(datasource, options.target, { defaultToAll: false });
    targetVariableKeys = await getTargetVariableKeys(datasource, targets);
  }

  async function initializeEntitiesWithTests() {
    if (entitiesWithTestsInitialized) {
      return;
    }

    entitiesWithTests = await getEntitiesWithTests(deps);
    entitiesWithTestsInitialized = true;
  }

  for (const [entityIndex, key] of entityKeys.entries()) {
    let entity = {} as T;

    if (entityType === "feature") {
      entity = (await datasource.readFeature(key)) as T;
    } else if (entityType === "segment") {
      entity = (await datasource.readSegment(key)) as T;
    } else if (entityType === "attribute") {
      entity = (await datasource.readAttribute(key)) as T;
    } else if (entityType === "schema") {
      entity = (await datasource.readSchema(key)) as T;
    } else if (entityType === "test") {
      entity = testSpecs[entityIndex] as T;
    } else if (entityType === "scenario") {
      entity = (await datasource.readScenario(key)) as T;
    } else if (entityType === "target") {
      entity = (await datasource.readTarget(key)) as T;
    } else if (entityType === "variable") {
      entity = (await datasource.readVariable(key)) as T;
    }

    if (entityType !== "test") {
      const definition = entity as {
        archived?: boolean;
        promotable?: boolean;
        description?: string;
      };

      if (
        ["feature", "segment", "attribute", "variable"].includes(entityType) &&
        !matchesBooleanOption(options.archived, definition.archived, false)
      ) {
        continue;
      }

      if (
        typeof options.promotable !== "undefined" &&
        !matchesBooleanOption(options.promotable, definition.promotable, true)
      ) {
        continue;
      }

      if (descriptionRegex) {
        if (!descriptionRegex.test(definition.description || "")) {
          continue;
        }
      }

      if (keyRegex) {
        if (!keyRegex.test(key)) {
          continue;
        }
      }
    }

    // filter
    if (entityType === "feature") {
      const parsedFeature = entity as ParsedFeature;

      if (targetFeatureKeys && !targetFeatureKeys.has(key)) {
        continue;
      }

      // --disabled, or --disabled-in=<environment>: every rule is at 0%, or there are none
      const disabledIn = options.disabled ? false : options.disabledIn;
      if (typeof disabledIn !== "undefined") {
        const rules = getRulesIn(parsedFeature, disabledIn);
        if (rules.some((rule) => rule.percentage > 0)) {
          continue;
        }
      }

      // --enabled, or --enabled-in=<environment>: a rule is above 0%
      const enabledIn = options.enabled ? false : options.enabledIn;
      if (typeof enabledIn !== "undefined") {
        const rules = getRulesIn(parsedFeature, enabledIn);
        if (!rules.some((rule) => rule.percentage > 0)) {
          continue;
        }
      }

      // --tag=<tag>
      if (options.tag) {
        const tags = Array.isArray(options.tag) ? options.tag : [options.tag];
        const featureTags = parsedFeature.tags || [];
        const hasTags = tags.every((tag) => featureTags.includes(tag));

        if (!hasTags) {
          continue;
        }
      }

      // --variable=<variableKey>
      if (options.variable) {
        const lookForVariables = Array.isArray(options.variable)
          ? options.variable
          : [options.variable];

        let variablesInFeature: string[] = Object.keys(parsedFeature.variablesSchema || {});

        const hasVariables = lookForVariables.every((variable) =>
          variablesInFeature.includes(variable),
        );

        if (!hasVariables) {
          continue;
        }
      }

      // --variation=<variationValue>
      if (options.variation) {
        const lookForVariations = Array.isArray(options.variation)
          ? options.variation
          : [options.variation];

        let variationsInFeature: string[] = parsedFeature.variations
          ? parsedFeature.variations.map((v) => v.value)
          : [];

        const hasVariations = lookForVariations.every((variation) =>
          variationsInFeature.includes(variation),
        );

        if (!hasVariations) {
          continue;
        }
      }

      // --with-tests
      if (options.withTests) {
        await initializeEntitiesWithTests();

        if (!entitiesWithTests.features.includes(key)) {
          continue;
        }
      }

      // --with-variables
      if (options.withVariables) {
        const hasVariables = Object.keys(parsedFeature.variablesSchema || {}).length > 0;

        if (!hasVariables) {
          continue;
        }
      }

      // --with-variations
      if (options.withVariations) {
        const hasVariations = (parsedFeature.variations || []).length > 0;

        if (!hasVariations) {
          continue;
        }
      }

      // --without-tests
      if (options.withoutTests) {
        await initializeEntitiesWithTests();

        if (entitiesWithTests.features.includes(key)) {
          continue;
        }
      }

      // --without-variables
      if (options.withoutVariables) {
        const hasVariables = Object.keys(parsedFeature.variablesSchema || {}).length > 0;

        if (hasVariables) {
          continue;
        }
      }

      // --without-variations
      if (options.withoutVariations) {
        const hasVariations = (parsedFeature.variations || []).length > 0;

        if (hasVariations) {
          continue;
        }
      }
    } else if (entityType === "variable") {
      const parsedVariable = entity as ParsedVariable;

      if (targetVariableKeys && !targetVariableKeys.has(key)) {
        continue;
      }

      if (options.tag) {
        const tags = Array.isArray(options.tag) ? options.tag : [options.tag];
        const variableTags = parsedVariable.tags || [];
        if (!tags.every((tag) => variableTags.includes(tag))) {
          continue;
        }
      }

      if (options.withTests || options.withoutTests) {
        await initializeEntitiesWithTests();
        const hasTests = entitiesWithTests.variables.includes(key);
        if ((options.withTests && !hasTests) || (options.withoutTests && hasTests)) {
          continue;
        }
      }
    } else if (entityType === "segment") {
      // --with-tests
      if (options.withTests) {
        await initializeEntitiesWithTests();

        if (!entitiesWithTests.segments.includes(key)) {
          continue;
        }
      }

      // --without-tests
      if (options.withoutTests) {
        await initializeEntitiesWithTests();

        if (entitiesWithTests.segments.includes(key)) {
          continue;
        }
      }
    } else if (entityType === "test") {
      let test = entity as TestFeature | TestSegment | TestVariable | TestScenario;
      const testEntityKey =
        (test as TestFeature).feature ||
        (test as TestSegment).segment ||
        (test as TestVariable).variable ||
        (test as TestScenario).scenario;
      const testEntityType = (test as TestSegment).segment
        ? "segment"
        : (test as TestVariable).variable
          ? "variable"
          : (test as TestScenario).scenario
            ? "scenario"
            : "feature";
      let testAssertions = test.assertions;
      const set =
        typeof options.set === "string"
          ? options.set
          : options.set === null
            ? null
            : typeof datasource.getSet === "function" && typeof datasource.getSet() === "string"
              ? datasource.getSet()!
              : null;
      const applyMatrix = options.applyMatrix || typeof options.case === "string";

      if (
        typeof options.promotable !== "undefined" &&
        !matchesBooleanOption(options.promotable, test.promotable, true)
      ) {
        continue;
      }

      // --entityType=<type>
      if (options.entityType && options.entityType !== testEntityType) {
        continue;
      }

      if (testEntityType === "feature") {
        assertNoRemovedSticky(testAssertions as FeatureAssertion[], key);
      }

      // --apply-matrix
      if (applyMatrix) {
        if (testEntityType === "feature") {
          let assertionsAfterApplyingMatrix: FeatureAssertion[] = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            const authoredAssertion = testAssertions[aIndex] as FeatureAssertion;
            const matrixValues = authoredAssertion.matrix
              ? getMatrixCombinations(authoredAssertion.matrix)
              : [{}];
            const processedAssertions = getFeatureAssertionsFromMatrix(
              aIndex,
              authoredAssertion,
            ).map((assertion, matrixIndex) => ({
              ...assertion,
              _case: getTestCaseMetadata(
                set,
                testEntityType,
                key,
                authoredAssertion,
                aIndex,
                authoredAssertion.matrix ? matrixIndex : null,
                matrixValues[matrixIndex],
              ),
            }));
            assertionsAfterApplyingMatrix =
              assertionsAfterApplyingMatrix.concat(processedAssertions);
          }

          testAssertions = assertionsAfterApplyingMatrix;
        } else if (testEntityType === "segment") {
          let assertionsAfterApplyingMatrix: SegmentAssertion[] = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            const authoredAssertion = testAssertions[aIndex] as SegmentAssertion;
            const matrixValues = authoredAssertion.matrix
              ? getMatrixCombinations(authoredAssertion.matrix)
              : [{}];
            const processedAssertions = getSegmentAssertionsFromMatrix(
              aIndex,
              authoredAssertion,
            ).map((assertion, matrixIndex) => ({
              ...assertion,
              _case: getTestCaseMetadata(
                set,
                testEntityType,
                key,
                authoredAssertion,
                aIndex,
                authoredAssertion.matrix ? matrixIndex : null,
                matrixValues[matrixIndex],
              ),
            }));
            assertionsAfterApplyingMatrix =
              assertionsAfterApplyingMatrix.concat(processedAssertions);
          }

          testAssertions = assertionsAfterApplyingMatrix;
        } else if (testEntityType === "variable" || testEntityType === "scenario") {
          let assertionsAfterApplyingMatrix: Array<VariableAssertion | ScenarioAssertion> = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            const authoredAssertion = testAssertions[aIndex] as
              | VariableAssertion
              | ScenarioAssertion;
            const matrixValues = authoredAssertion.matrix
              ? getMatrixCombinations(authoredAssertion.matrix)
              : [{}];
            assertionsAfterApplyingMatrix = assertionsAfterApplyingMatrix.concat(
              getVariableAssertionsFromMatrix(
                aIndex,
                authoredAssertion,
                testEntityType === "scenario" ? "scenario" : "assertion",
              ).map((assertion, matrixIndex) => ({
                ...assertion,
                _case: getTestCaseMetadata(
                  set,
                  testEntityType,
                  key,
                  authoredAssertion,
                  aIndex,
                  authoredAssertion.matrix ? matrixIndex : null,
                  matrixValues[matrixIndex],
                ),
              })),
            );
          }
          testAssertions = assertionsAfterApplyingMatrix;
        }
      }

      if (typeof options.case === "string") {
        testAssertions = testAssertions.filter(
          (assertion) => assertion._case?.id === options.case,
        ) as FeatureAssertion[] | SegmentAssertion[] | VariableAssertion[] | ScenarioAssertion[];
        if (testAssertions.length === 0) continue;
      }

      if (!options.executionMetadata) {
        delete test._test;
        testAssertions = testAssertions.map((assertion) => {
          const withoutMetadata = { ...assertion };
          delete withoutMetadata._case;
          return withoutMetadata;
        }) as FeatureAssertion[] | SegmentAssertion[] | VariableAssertion[] | ScenarioAssertion[];
      } else {
        test._test = {
          source: getTestSource(deps, key, testEntityType),
          set,
          entityType: testEntityType,
        };
        // Child descriptions are documentation for readers. Native runners do not receive them.
        testAssertions = testAssertions.map((assertion) => {
          const children = (assertion as { children?: Array<Record<string, unknown>> }).children;
          if (!Array.isArray(children)) return assertion;
          return {
            ...assertion,
            children: children.map((child) => {
              const withoutDescription = { ...child };
              delete withoutDescription.description;
              return withoutDescription;
            }),
          };
        }) as FeatureAssertion[] | SegmentAssertion[] | VariableAssertion[] | ScenarioAssertion[];
      }

      // --keyPattern=<pattern>
      if (keyRegex) {
        if (!keyRegex.test(testEntityKey)) {
          continue;
        }
      }

      // --assertionPattern=<pattern>
      if (assertionRegex) {
        testAssertions = testAssertions.filter((assertion) => {
          if (!assertion.description) {
            return false;
          }

          return assertionRegex.test(assertion.description);
        }) as FeatureAssertion[] | SegmentAssertion[] | VariableAssertion[] | ScenarioAssertion[];

        if (testAssertions.length === 0) {
          continue;
        }
      }

      (entity as TestFeature | TestSegment | TestVariable | TestScenario).assertions =
        testAssertions;
      if (
        applyMatrix &&
        ("variable" in test ||
          "scenario" in test ||
          (options.executionProtocol && "segment" in test))
      ) {
        const keys = new Set<string>();
        if ("segment" in test) keys.add(test.segment);
        const owner = "variable" in test ? test.variable : undefined;
        for (const assertion of test.assertions) {
          for (const expectation of [
            assertion,
            ...("children" in assertion ? assertion.children || [] : []),
          ]) {
            if (!("checks" in expectation)) continue;
            if (!expectation.checks) continue;
            for (const reference of getCheckReferences(expectation.checks, owner)) {
              if (reference.segment) keys.add(reference.segment);
            }
          }
        }
        if (keys.size) {
          const definitions: Array<[string, Segment]> = [];
          const pending = Array.from(keys);
          for (let index = 0; index < pending.length; index++) {
            const segment = pending[index];
            if (!(await datasource.segmentExists(segment)))
              throw new Error(`Unknown segment "${segment}"`);
            const definition = await datasource.readSegment(segment);
            definitions.push([
              segment,
              options.executionProtocol
                ? { ...definition, conditions: compileConditions(definition.conditions)! }
                : definition,
            ]);
            walkConditionLeaves(definition.conditions, (leaf) => {
              if (typeof leaf === "string" && !keys.has(leaf)) {
                keys.add(leaf);
                pending.push(leaf);
              }
            });
          }
          test._segments = Object.fromEntries(definitions);
        }
      }
    }

    result.push({
      ...entity,
      key,
    });
  }

  if (entityType === "test" && typeof options.case === "string" && result.length === 0) {
    throwTestCaseNotFound(options.case);
  }

  return result;
}

function ucfirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function printResult({ result, entityType, options }) {
  if (options.json) {
    const output = options.executionProtocol
      ? ({
          kind: "featurevisor.test-execution",
          schemaVersion: 1,
          tests: result,
        } satisfies TestExecutionDocument)
      : result;
    console.log(options.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
    return;
  }

  if (result.length === 0) {
    console.log(CLI_FORMAT_YELLOW, `No ${entityType}s found.`);
    return;
  }

  console.log("");
  console.log(CLI_FORMAT_BOLD, `${ucfirst(entityType)}s`);
  console.log("");

  for (const item of result) {
    const composition = entityType === "variable" && item.compose ? " (composed)" : "";
    console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${item.key}${composition}`);
  }

  console.log("");
  console.log(
    CLI_FORMAT_GREEN,
    `Found ${result.length} ${entityType}${result.length === 1 ? "" : "s"}.`,
  );
}

function getDatafileSizeParts(size: number): { value: string; unit: string; color: number } {
  if (size < 1024) {
    return { value: size.toFixed(2), unit: "B", color: CLI_COLOR_YELLOW };
  }

  if (size < 1024 * 1024) {
    return { value: (size / 1024).toFixed(2), unit: "kB", color: CLI_COLOR_CYAN };
  }

  return { value: (size / (1024 * 1024)).toFixed(2), unit: "mB", color: CLI_COLOR_GREEN };
}

export function formatDatafileSize(size: number): string {
  const { value, unit, color } = getDatafileSizeParts(size);

  return `${value} ${colorize(unit, color)}`;
}

function formatDatafileSizeColumn(size: number, valueWidth: number): string {
  const { value, unit, color } = getDatafileSizeParts(size);

  return `${value.padStart(valueWidth)} ${" ".repeat(2 - unit.length)}${colorize(unit, color)}`;
}

function getDatafileDirectory(datafilePath: string): string {
  const lastSlashIndex = datafilePath.lastIndexOf("/");

  return lastSlashIndex === -1 ? "" : datafilePath.slice(0, lastSlashIndex);
}

function getDatafileDirectoryPriority(datafilePath: string): number {
  const directory = datafilePath.split("/", 1)[0].toLowerCase();

  if (directory.startsWith("dev")) {
    return 0;
  }

  if (directory.startsWith("prod")) {
    return 2;
  }

  return 1;
}

function sortDatafiles(datafiles: DatafileFile[]): DatafileFile[] {
  return datafiles.slice().sort((a, b) => {
    const priorityDifference =
      getDatafileDirectoryPriority(a.path) - getDatafileDirectoryPriority(b.path);

    return priorityDifference || a.path.localeCompare(b.path);
  });
}

function printDatafiles({ result, options }: { result: DatafileFile[]; options: any }) {
  const sortedResult = sortDatafiles(result);

  if (options.json) {
    console.log(
      options.pretty ? JSON.stringify(sortedResult, null, 2) : JSON.stringify(sortedResult),
    );
    return;
  }

  if (sortedResult.length === 0) {
    console.log(CLI_FORMAT_YELLOW, "No datafiles found.");
    return;
  }

  console.log("");

  const pathWidth = Math.max(
    "Datafile".length,
    ...sortedResult.map((datafile) => datafile.path.length),
  );
  const sizeValueWidth = Math.max(
    ...sortedResult.map((datafile) => {
      const { value } = getDatafileSizeParts(datafile.size);
      return value.length;
    }),
  );
  const gzipSizeValueWidth = Math.max(
    ...sortedResult.map((datafile) => {
      const { value } = getDatafileSizeParts(datafile.gzipSize);
      return value.length;
    }),
  );
  const sizeWidth = Math.max("Size".length, sizeValueWidth + 3);
  const gzipSizeWidth = Math.max("Gzip".length, gzipSizeValueWidth + 3);

  console.log(
    `  ${colorize("Datafile".padEnd(pathWidth), CLI_COLOR_CYAN)}  ${colorize(
      "Size".padStart(sizeWidth),
      CLI_COLOR_CYAN,
    )}  ${colorize("Gzip".padStart(gzipSizeWidth), CLI_COLOR_CYAN)}`,
  );
  console.log(`  ${"-".repeat(pathWidth)}  ${"-".repeat(sizeWidth)}  ${"-".repeat(gzipSizeWidth)}`);

  let previousDirectory: string | undefined;
  for (const datafile of sortedResult) {
    const directory = getDatafileDirectory(datafile.path);
    if (previousDirectory !== undefined && directory !== previousDirectory) {
      console.log("");
    }

    const formattedSize = formatDatafileSizeColumn(datafile.size, sizeValueWidth);
    const formattedGzipSize = formatDatafileSizeColumn(datafile.gzipSize, gzipSizeValueWidth);
    console.log(`  ${datafile.path.padEnd(pathWidth)}  ${formattedSize}  ${formattedGzipSize}`);
    previousDirectory = directory;
  }

  console.log("");
  console.log(
    CLI_FORMAT_GREEN,
    `Found ${sortedResult.length} datafile${sortedResult.length === 1 ? "" : "s"}.`,
  );
}

const listSelectors = [
  "datafiles",
  "features",
  "segments",
  "schemas",
  "attributes",
  "tests",
  "targets",
  "variables",
  "scenarios",
] as const;

function toFlag(option: string) {
  return `--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function assertListEnvironmentOptions(
  options: Record<string, any>,
  environments: ProjectConfig["environments"],
) {
  for (const option of ["enabledIn", "disabledIn"]) {
    const environment = options[option];
    if (typeof environment === "undefined") continue;

    if (!Array.isArray(environments)) {
      const replacement = option === "enabledIn" ? "--enabled" : "--disabled";
      throw new FeaturevisorCLIError(
        `This project does not configure environments. Use ${replacement} instead of ${toFlag(option)}.`,
        { code: "invalid_environment", details: { option, environment, available: [] } },
      );
    }

    if (!environments.includes(environment)) {
      throw new FeaturevisorCLIError(
        `Unknown environment "${environment}" for ${toFlag(option)}. Available environments: ${environments.join(", ")}.`,
        { code: "invalid_environment", details: { option, environment, available: environments } },
      );
    }
  }

  for (const option of ["enabled", "disabled"]) {
    if (typeof options[option] === "undefined" || !Array.isArray(environments)) continue;

    throw new FeaturevisorCLIError(
      `This project configures environments. Use ${toFlag(`${option}In`)}=<environment> instead of --${option}.`,
      { code: "invalid_environment", details: { option, available: environments } },
    );
  }
}

function assertListOptions(options: Record<string, any>, projectConfig?: ProjectConfig) {
  const selected = listSelectors.filter((selector) => options[selector]);

  if (selected.length !== 1) {
    throw new FeaturevisorCLIError(
      selected.length === 0
        ? `Select one entity type to list: ${listSelectors.map((selector) => `--${selector}`).join(", ")}.`
        : `Select only one entity type to list. Received: ${selected.join(", ")}.`,
      {
        code: "invalid_list_selection",
        details: { selected },
      },
    );
  }

  const opposingOptions = [
    ["enabled", "disabled"],
    ["withTests", "withoutTests"],
    ["withVariables", "withoutVariables"],
    ["withVariations", "withoutVariations"],
  ];
  for (const [positive, negative] of opposingOptions) {
    if (options[positive] && options[negative]) {
      throw new FeaturevisorCLIError(
        `Options ${toFlag(positive)} and ${toFlag(negative)} cannot be combined.`,
        {
          code: "conflicting_cli_options",
          details: { options: [positive, negative] },
        },
      );
    }
  }

  const selector = selected[0];
  const featureOnly = [
    "disabled",
    "disabledIn",
    "enabled",
    "enabledIn",
    "variable",
    "variation",
    "withVariables",
    "withoutVariables",
    "withVariations",
    "withoutVariations",
  ];
  const testOnly = [
    "entityType",
    "applyMatrix",
    "assertionPattern",
    "executionMetadata",
    "executionProtocol",
    "case",
  ];

  for (const option of ["target", "tag"]) {
    if (!["features", "variables"].includes(selector) && typeof options[option] !== "undefined") {
      throw new FeaturevisorCLIError(
        `Option ${toFlag(option)} can only be used with --features or --variables.`,
        { code: "incompatible_cli_options", details: { selector, option } },
      );
    }
  }

  if (selector === "features") {
    assertListEnvironmentOptions(options, projectConfig?.environments);
  }

  if (selector !== "features") {
    const unsupported = featureOnly.filter((option) => typeof options[option] !== "undefined");
    if (unsupported.length > 0) {
      throw new FeaturevisorCLIError(
        `Option ${toFlag(unsupported[0])} can only be used with --features.`,
        { code: "incompatible_cli_options", details: { selector, option: unsupported[0] } },
      );
    }
  }

  if (selector !== "tests") {
    const unsupported = testOnly.filter((option) => typeof options[option] !== "undefined");
    if (unsupported.length > 0) {
      throw new FeaturevisorCLIError(
        `Option ${toFlag(unsupported[0])} can only be used with --tests.`,
        {
          code: "incompatible_cli_options",
          details: { selector, option: unsupported[0] },
        },
      );
    }
  }

  if (
    !["features", "segments", "variables"].includes(selector) &&
    (options.withTests || options.withoutTests)
  ) {
    throw new FeaturevisorCLIError(
      "Options --with-tests and --without-tests can only be used with --features, --segments, or --variables.",
      { code: "incompatible_cli_options", details: { selector } },
    );
  }

  if (
    !["features", "segments", "attributes", "variables"].includes(selector) &&
    typeof options.archived !== "undefined"
  ) {
    throw new FeaturevisorCLIError(
      "Option --archived can only be used with --features, --segments, --attributes, or --variables.",
      { code: "incompatible_cli_options", details: { selector, option: "archived" } },
    );
  }

  if (selector === "datafiles") {
    const entityFilters = ["keyPattern", "description", "promotable"];
    const unsupported = entityFilters.find((option) => typeof options[option] !== "undefined");
    if (unsupported) {
      throw new FeaturevisorCLIError(
        `Option ${toFlag(unsupported)} cannot be used with --datafiles.`,
        {
          code: "incompatible_cli_options",
          details: { selector, option: unsupported },
        },
      );
    }
  }

  if (selector === "tests" && typeof options.description !== "undefined") {
    throw new FeaturevisorCLIError(
      "Option --description cannot be used with --tests. Use --assertion-pattern instead.",
      {
        code: "incompatible_cli_options",
        details: { selector, option: "description" },
      },
    );
  }
}

function getExecutionOptions(options: Dependencies["options"]) {
  return options.executionProtocol
    ? { ...options, json: true, applyMatrix: true, executionMetadata: true }
    : options;
}

export async function listProject(deps: Dependencies) {
  const options = getExecutionOptions(deps.options);
  deps = { ...deps, options };

  assertListOptions(options, deps.projectConfig);

  if (options.scenarios) {
    return printResult({
      result: await listEntities(deps, "scenario"),
      entityType: "scenario",
      options,
    });
  }

  // datafiles
  if (options.datafiles) {
    const result = await deps.datasource.listDatafiles();

    return printDatafiles({ result, options });
  }

  // features
  if (options.features) {
    const result = await listEntities<ParsedFeature>(deps, "feature");

    return printResult({
      result,
      entityType: "feature",
      options,
    });
  }

  // segments
  if (options.segments) {
    const result = await listEntities<Segment>(deps, "segment");

    return printResult({
      result,
      entityType: "segment",
      options,
    });
  }

  // schemas
  if (options.schemas) {
    const result = await listEntities<Schema>(deps, "schema");

    return printResult({ result, entityType: "schema", options });
  }

  // attributes
  if (options.attributes) {
    const result = await listEntities<Attribute>(deps, "attribute");

    return printResult({
      result,
      entityType: "attribute",
      options,
    });
  }

  // tests
  if (options.tests) {
    const result = await listEntities<Attribute>(deps, "test");

    return printResult({
      result,
      entityType: "test",
      options,
    });
  }

  // targets
  if (options.targets) {
    const result = await listEntities<Target>(deps, "target");

    return printResult({
      result,
      entityType: "target",
      options,
    });
  }

  if (options.variables) {
    const result = await listEntities<ParsedVariable>(deps, "variable");
    return printResult({ result, entityType: "variable", options });
  }
}

export const listPlugin: Plugin = {
  command: "list",
  description: "List project entities or built datafiles",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const options = getExecutionOptions(parsed);
    assertProjectSetJsonSelection(projectConfig, options.set, options.json);

    const executions = await getProjectSetExecutions(projectConfig, datasource, options.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set, options.json);

      await listProject({
        rootDirectoryPath,
        projectConfig: execution.projectConfig,
        datasource: execution.datasource,
        options,
      });
    }
  },
  examples: [
    {
      command: "list --features",
      description: "List features",
    },
    {
      command: "list --tests",
      description: "List tests",
    },
  ],
};
