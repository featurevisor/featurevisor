import type {
  ParsedFeature,
  Segment,
  Attribute,
  TestFeature,
  TestSegment,
  FeatureAssertion,
  SegmentAssertion,
  Target,
  Group,
  Schema,
  ParsedVariable,
  TestVariable,
  VariableAssertion,
} from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import type { DatafileFile } from "../datasource";
import { Plugin } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { FeaturevisorCLIError } from "../error";
import {
  getFeatureAssertionsFromMatrix,
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

async function getEntitiesWithTests(
  deps: Dependencies,
): Promise<{ features: string[]; segments: string[]; variables: string[] }> {
  const { datasource } = deps;

  const featuresWithTests = new Set<string>();
  const segmentsWithTests = new Set<string>();
  const variablesWithTests = new Set<string>();

  const tests = await datasource.listTests();
  for (const testKey of tests) {
    const test = await datasource.readTest(testKey);

    if ((test as TestFeature).feature) {
      featuresWithTests.add((test as TestFeature).feature);
    }

    if ((test as TestSegment).segment) {
      segmentsWithTests.add((test as TestSegment).segment);
    }

    if ((test as TestVariable).variable) {
      variablesWithTests.add((test as TestVariable).variable);
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

export async function listEntities<T>(deps: Dependencies, entityType): Promise<T[]> {
  const { datasource, options } = deps;

  const result: T[] = [];
  let entityKeys: string[] = [];

  if (entityType === "feature") {
    entityKeys = await datasource.listFeatures();
  } else if (entityType === "segment") {
    entityKeys = await datasource.listSegments();
  } else if (entityType === "attribute") {
    entityKeys = await datasource.listAttributes();
  } else if (entityType === "group") {
    entityKeys = await datasource.listGroups();
  } else if (entityType === "schema") {
    entityKeys = await datasource.listSchemas();
  } else if (entityType === "test") {
    entityKeys = await datasource.listTests();
  } else if (entityType === "target") {
    entityKeys = await datasource.listTargets();
  } else if (entityType === "variable") {
    entityKeys = await datasource.listVariables();
  }

  if (entityKeys.length === 0) {
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
    ? parseRegexOption("--keyPattern", options.keyPattern, "i")
    : undefined;
  const assertionRegex = options.assertionPattern
    ? parseRegexOption("--assertionPattern", options.assertionPattern, "i")
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

  for (const key of entityKeys) {
    let entity = {} as T;

    if (entityType === "feature") {
      entity = (await datasource.readFeature(key)) as T;
    } else if (entityType === "segment") {
      entity = (await datasource.readSegment(key)) as T;
    } else if (entityType === "attribute") {
      entity = (await datasource.readAttribute(key)) as T;
    } else if (entityType === "group") {
      entity = (await datasource.readGroup(key)) as T;
    } else if (entityType === "schema") {
      entity = (await datasource.readSchema(key)) as T;
    } else if (entityType === "test") {
      entity = (await datasource.readTest(key)) as T;
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

      // --disabledIn=<environment>
      if (options.disabledIn && parsedFeature.rules && parsedFeature.rules[options.disabledIn]) {
        const disabledInEnvironment = parsedFeature.rules[options.disabledIn].every((rule) => {
          return rule.percentage === 0;
        });

        if (!disabledInEnvironment) {
          continue;
        }
      }

      // --enabledIn=<environment>
      if (options.enabledIn) {
        const rules = parsedFeature.rules && parsedFeature.rules[options.enabledIn];
        const enabledInEnvironment = Boolean(
          rules?.some((rule) => {
            return rule.percentage > 0;
          }),
        );

        if (!enabledInEnvironment) {
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
      let test = entity as TestFeature | TestSegment | TestVariable;
      const testEntityKey =
        (test as TestFeature).feature ||
        (test as TestSegment).segment ||
        (test as TestVariable).variable;
      const testEntityType = (test as TestSegment).segment
        ? "segment"
        : (test as TestVariable).variable
          ? "variable"
          : "feature";
      let testAssertions = test.assertions;

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

      // --apply-matrix
      if (options.applyMatrix) {
        if (testEntityType === "feature") {
          let assertionsAfterApplyingMatrix: FeatureAssertion[] = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            const processedAssertions = getFeatureAssertionsFromMatrix(
              aIndex,
              testAssertions[aIndex] as FeatureAssertion,
            );
            assertionsAfterApplyingMatrix =
              assertionsAfterApplyingMatrix.concat(processedAssertions);
          }

          testAssertions = assertionsAfterApplyingMatrix;
        } else if (testEntityType === "segment") {
          let assertionsAfterApplyingMatrix: SegmentAssertion[] = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            const processedAssertions = getSegmentAssertionsFromMatrix(
              aIndex,
              testAssertions[aIndex] as SegmentAssertion,
            );
            assertionsAfterApplyingMatrix =
              assertionsAfterApplyingMatrix.concat(processedAssertions);
          }

          testAssertions = assertionsAfterApplyingMatrix;
        } else if (testEntityType === "variable") {
          let assertionsAfterApplyingMatrix: VariableAssertion[] = [];
          for (let aIndex = 0; aIndex < testAssertions.length; aIndex++) {
            assertionsAfterApplyingMatrix = assertionsAfterApplyingMatrix.concat(
              getVariableAssertionsFromMatrix(aIndex, testAssertions[aIndex] as VariableAssertion),
            );
          }
          testAssertions = assertionsAfterApplyingMatrix;
        }
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
        }) as FeatureAssertion[] | SegmentAssertion[];

        if (testAssertions.length === 0) {
          continue;
        }
      }

      (entity as TestFeature | TestSegment).assertions = testAssertions;
    }

    result.push({
      ...entity,
      key,
    });
  }

  return result;
}

function ucfirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function printResult({ result, entityType, options }) {
  if (options.json) {
    console.log(options.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
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
    console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${item.key}`);
  }

  console.log("");
  console.log(CLI_FORMAT_GREEN, `Found ${result.length} ${entityType}s.`);
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
  console.log(CLI_FORMAT_GREEN, `Found ${sortedResult.length} datafiles.`);
}

const listSelectors = [
  "datafiles",
  "features",
  "segments",
  "groups",
  "schemas",
  "attributes",
  "tests",
  "targets",
  "variables",
] as const;

function assertListOptions(options: Record<string, any>) {
  const selected = listSelectors.filter((selector) => options[selector]);

  if (selected.length !== 1) {
    throw new FeaturevisorCLIError(
      selected.length === 0
        ? "Select one entity type to list."
        : `Select only one entity type to list. Received: ${selected.join(", ")}.`,
      {
        code: "invalid_list_selection",
        details: { selected },
      },
    );
  }

  const opposingOptions = [
    ["withTests", "withoutTests"],
    ["withVariables", "withoutVariables"],
    ["withVariations", "withoutVariations"],
  ];
  for (const [positive, negative] of opposingOptions) {
    if (options[positive] && options[negative]) {
      throw new FeaturevisorCLIError(
        `Options --${positive} and --${negative} cannot be combined.`,
        {
          code: "conflicting_cli_options",
          details: { options: [positive, negative] },
        },
      );
    }
  }

  const selector = selected[0];
  const featureOnly = [
    "disabledIn",
    "enabledIn",
    "variable",
    "variation",
    "withVariables",
    "withoutVariables",
    "withVariations",
    "withoutVariations",
  ];
  const testOnly = ["entityType", "applyMatrix", "assertionPattern"];

  for (const option of ["target", "tag"]) {
    if (!["features", "variables"].includes(selector) && typeof options[option] !== "undefined") {
      throw new FeaturevisorCLIError(
        `Option --${option} can only be used with --features or --variables.`,
        { code: "incompatible_cli_options", details: { selector, option } },
      );
    }
  }

  if (selector !== "features") {
    const unsupported = featureOnly.filter((option) => typeof options[option] !== "undefined");
    if (unsupported.length > 0) {
      throw new FeaturevisorCLIError(
        `Option --${unsupported[0]} can only be used with --features.`,
        { code: "incompatible_cli_options", details: { selector, option: unsupported[0] } },
      );
    }
  }

  if (selector !== "tests") {
    const unsupported = testOnly.filter((option) => typeof options[option] !== "undefined");
    if (unsupported.length > 0) {
      throw new FeaturevisorCLIError(`Option --${unsupported[0]} can only be used with --tests.`, {
        code: "incompatible_cli_options",
        details: { selector, option: unsupported[0] },
      });
    }
  }

  if (
    !["features", "segments", "variables"].includes(selector) &&
    (options.withTests || options.withoutTests)
  ) {
    throw new FeaturevisorCLIError(
      "Options --withTests and --withoutTests can only be used with --features, --segments, or --variables.",
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
      throw new FeaturevisorCLIError(`Option --${unsupported} cannot be used with --datafiles.`, {
        code: "incompatible_cli_options",
        details: { selector, option: unsupported },
      });
    }
  }

  if (selector === "tests" && typeof options.description !== "undefined") {
    throw new FeaturevisorCLIError(
      "Option --description cannot be used with --tests. Use --assertionPattern instead.",
      {
        code: "incompatible_cli_options",
        details: { selector, option: "description" },
      },
    );
  }
}

export async function listProject(deps: Dependencies) {
  const { options } = deps;

  assertListOptions(options);

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

  // groups
  if (options.groups) {
    const result = await listEntities<Group>(deps, "group");

    return printResult({ result, entityType: "group", options });
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
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    assertProjectSetJsonSelection(projectConfig, parsed.set, parsed.json);

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set, parsed.json);

      await listProject({
        rootDirectoryPath,
        projectConfig: execution.projectConfig,
        datasource: execution.datasource,
        options: parsed,
      });
    }
  },
  examples: [
    {
      command: "list",
      description: "list entities",
    },
  ],
};
