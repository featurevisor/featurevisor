import { Dependencies } from "../dependencies";
import { getMatrixCombinations } from "../list/matrix";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, colorize } from "../tester/cliFormat";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";

const INFO_LABEL_WIDTH = "Total feature variables:".length;

function printInfoLine(label: string, value: string | number | boolean) {
  console.log(`  ${colorize(`${label}:`.padEnd(INFO_LABEL_WIDTH), CLI_COLOR_CYAN)} ${value}`);
}

function countFeatureVariables(features: Record<string, { variablesSchema?: unknown }>): number {
  return Object.values(features).reduce((count, feature) => {
    const schemas = feature.variablesSchema;
    if (!schemas || typeof schemas !== "object") return count;
    return count + Object.keys(schemas).length;
  }, 0);
}

async function showTargetInfo(deps: Dependencies, target: string | string[]) {
  const { projectConfig } = deps;
  const environments = Array.isArray(projectConfig.environments)
    ? projectConfig.environments
    : [false as const];

  for (const environment of environments) {
    const datafiles = await buildRuntimeDatafiles(deps, {
      environment,
      target,
      revision: "info",
    });

    for (const entry of datafiles) {
      const featureVariables = countFeatureVariables(entry.datafile.features);

      console.log("");
      console.log(CLI_FORMAT_BOLD, `Target "${entry.target}"`);
      printInfoLine("Environment", environment);
      printInfoLine("Features", Object.keys(entry.datafile.features).length);
      printInfoLine("Segments", Object.keys(entry.datafile.segments).length);
      printInfoLine("Total global variables", Object.keys(entry.datafile.variables || {}).length);
      printInfoLine("Total feature variables", featureVariables);
      printInfoLine(
        "Datafile size",
        `${(JSON.stringify(entry.datafile).length / 1024).toFixed(2)} kB`,
      );
    }
  }
}

export async function showProjectInfo(deps: Dependencies) {
  const { datasource, options } = deps;

  if (options.target) {
    await showTargetInfo(deps, options.target);
    return;
  }

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Project info");
  console.log("");

  const revision = await datasource.readRevision();
  printInfoLine("Revision", revision);

  console.log("");

  const attributes = await datasource.listAttributes();
  const segments = await datasource.listSegments();
  const features = await datasource.listFeatures();
  const groups = await datasource.listGroups();
  const schemas = await datasource.listSchemas();
  const targets = await datasource.listTargets();
  const globalVariables = await datasource.listVariables();

  let variablesCount = 0;
  for (const featureKey of features) {
    const feature = await datasource.readFeature(featureKey);

    if (feature.variablesSchema) {
      variablesCount += Object.keys(feature.variablesSchema).length;
    }
  }

  printInfoLine("Total attributes", attributes.length);
  printInfoLine("Total segments", segments.length);
  printInfoLine("Total features", features.length);
  printInfoLine("Total global variables", globalVariables.length);
  printInfoLine("Total feature variables", variablesCount);
  printInfoLine("Total groups", groups.length);
  printInfoLine("Total schemas", schemas.length);
  printInfoLine("Total targets", targets.length);

  console.log("");

  const tests = await datasource.listTests();
  printInfoLine("Total test specs", tests.length);

  let assertionsCount = 0;
  for (const test of tests) {
    const testSpec = await datasource.readTest(test);

    for (const assertion of testSpec.assertions) {
      if (assertion.matrix) {
        const combinations = getMatrixCombinations(assertion.matrix);
        assertionsCount += combinations.length;
      } else {
        assertionsCount += 1;
      }
    }
  }

  printInfoLine("Total assertions", assertionsCount);
}

export const infoPlugin: Plugin = {
  command: "info",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await showProjectInfo({
        rootDirectoryPath,
        projectConfig: execution.projectConfig,
        datasource: execution.datasource,
        options: parsed,
      });
    }
  },
  examples: [
    {
      command: "info",
      description: "show various stats for the project",
    },
  ],
};
