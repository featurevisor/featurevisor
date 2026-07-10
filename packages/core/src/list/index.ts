import type {
  ParsedFeature,
  Segment,
  Attribute,
  TestFeature,
  TestSegment,
  FeatureAssertion,
  SegmentAssertion,
  Target,
} from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import type { DatafileFile } from "../datasource";
import { Plugin } from "../cli";
import { getFeatureAssertionsFromMatrix, getSegmentAssertionsFromMatrix } from "./matrix";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
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
): Promise<{ features: string[]; segments: string[] }> {
  const { datasource } = deps;

  const featuresWithTests = new Set<string>();
  const segmentsWithTests = new Set<string>();

  const tests = await datasource.listTests();
  for (const testKey of tests) {
    const test = await datasource.readTest(testKey);

    if ((test as TestFeature).feature) {
      featuresWithTests.add((test as TestFeature).feature);
    }

    if ((test as TestSegment).segment) {
      segmentsWithTests.add((test as TestSegment).segment);
    }
  }

  return {
    features: Array.from(featuresWithTests),
    segments: Array.from(segmentsWithTests),
  };
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
  } else if (entityType === "test") {
    entityKeys = await datasource.listTests();
  } else if (entityType === "target") {
    entityKeys = await datasource.listTargets();
  }

  if (entityKeys.length === 0) {
    return result;
  }

  let entitiesWithTests: { features: string[]; segments: string[] } = {
    features: [],
    segments: [],
  };
  let entitiesWithTestsInitialized = false;

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
    } else if (entityType === "test") {
      entity = (await datasource.readTest(key)) as T;
    } else if (entityType === "target") {
      entity = (await datasource.readTarget(key)) as T;
    }

    // filter
    if (entityType === "feature") {
      const parsedFeature = entity as ParsedFeature;

      // --archived=true|false
      if (parsedFeature.archived) {
        const archivedStatus = options.archived === "false";

        if (parsedFeature.archived !== archivedStatus) {
          continue;
        }
      }

      // --description=<pattern>
      if (options.description) {
        const description = parsedFeature.description || "";

        const regex = new RegExp(options.description, "i");
        if (!regex.test(description)) {
          continue;
        }
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
      if (options.enabledIn && parsedFeature.rules && parsedFeature.rules[options.enabledIn]) {
        const enabledInEnvironment = parsedFeature.rules[options.enabledIn].some((rule) => {
          return rule.percentage > 0;
        });

        if (!enabledInEnvironment) {
          continue;
        }
      }

      // --keyPattern=<pattern>
      if (options.keyPattern) {
        const regex = new RegExp(options.keyPattern, "i");
        if (!regex.test(key)) {
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
        const hasVariables = parsedFeature.variablesSchema;

        if (!hasVariables) {
          continue;
        }
      }

      // --with-variations
      if (options.withVariations) {
        const hasVariations = parsedFeature.variations;

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
        const hasVariables = parsedFeature.variablesSchema;

        if (hasVariables) {
          continue;
        }
      }

      // --without-variations
      if (options.withoutVariations) {
        const hasVariations = parsedFeature.variations;

        if (hasVariations) {
          continue;
        }
      }
    } else if (entityType === "segment") {
      const segment = entity as Segment;

      // --archived=true|false
      if (segment.archived) {
        const archivedStatus = options.archived === "false";

        if (segment.archived !== archivedStatus) {
          continue;
        }
      }

      // --description=<pattern>
      if (options.description) {
        const description = segment.description || "";

        const regex = new RegExp(options.description, "i");
        if (!regex.test(description)) {
          continue;
        }
      }

      // --keyPattern=<pattern>
      if (options.keyPattern) {
        const regex = new RegExp(options.keyPattern, "i");
        if (!regex.test(key)) {
          continue;
        }
      }

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
    } else if (entityType === "attribute") {
      const attribute = entity as Attribute;

      // --archived=true|false
      if (options.archived) {
        const archivedStatus = options.archived === "false";

        if (attribute.archived !== archivedStatus) {
          continue;
        }
      }

      // --description=<pattern>
      if (options.description) {
        const description = attribute.description || "";

        const regex = new RegExp(options.description, "i");
        if (!regex.test(description)) {
          continue;
        }
      }

      // --keyPattern=<pattern>
      if (options.keyPattern) {
        const regex = new RegExp(options.keyPattern, "i");
        if (!regex.test(key)) {
          continue;
        }
      }
    } else if (entityType === "test") {
      let test = entity as TestFeature | TestSegment;
      const testEntityKey = (test as TestFeature).feature || (test as TestSegment).segment;
      const testEntityType = (test as TestSegment).segment ? "segment" : "feature";
      let testAssertions = test.assertions;

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
        }
      }

      // --keyPattern=<pattern>
      if (options.keyPattern) {
        const regex = new RegExp(options.keyPattern, "i");
        if (!regex.test(testEntityKey)) {
          continue;
        }
      }

      // --assertionPattern=<pattern>
      if (options.assertionPattern) {
        const regex = new RegExp(options.assertionPattern, "i");
        testAssertions = testAssertions.filter((assertion) => {
          if (!assertion.description) {
            return false;
          }

          return regex.test(assertion.description);
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
  console.log(CLI_FORMAT_BOLD, "Datafiles");
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

export async function listProject(deps: Dependencies) {
  const { options } = deps;

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

  console.log("");
  console.log(CLI_FORMAT_YELLOW, "Nothing to list.");
  console.log("");
  console.log(
    "Please pass `--datafiles`, `--features`, `--segments`, `--attributes`, or `--targets`.",
  );
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
