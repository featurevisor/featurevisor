import type { Context, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";

import { Dependencies } from "../dependencies";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { Plugin } from "../cli";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import {
  CLI_COLOR_CYAN,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_YELLOW,
  colorize,
} from "../tester/cliFormat";

function printEvaluationDetails(evaluation: Evaluation) {
  const ignoreKeys = ["featureKey", "variableKey", "traffic", "force"];

  for (const [key, value] of Object.entries(evaluation)) {
    if (ignoreKeys.indexOf(key) !== -1) {
      continue;
    }

    if (key === "variation") {
      console.log(`  ${colorize(key, CLI_COLOR_CYAN)}:`, value?.value);
      continue;
    }

    if (key === "variableSchema") {
      console.log(`  ${colorize("variableType", CLI_COLOR_CYAN)}:`, value.type);
      console.log(`  ${colorize("defaultValue", CLI_COLOR_CYAN)}:`, value.defaultValue);
      continue;
    }

    console.log(`  ${colorize(key, CLI_COLOR_CYAN)}:`, value);
  }
}

function printDiagnostics(diagnostics: FeaturevisorDiagnostic[]) {
  diagnostics.forEach((diagnostic) => {
    const levelColor = diagnostic.level === "error" ? 31 : diagnostic.level === "warn" ? 33 : 2;
    console.log(
      `${colorize(`[${diagnostic.level}]`, levelColor)} ${diagnostic.message}`,
      diagnostic,
    );
    console.log("");
  });
}

function printHeader(message: string) {
  console.log("");
  console.log(CLI_FORMAT_BOLD, message);
  console.log("");
}

export interface EvaluateOptions {
  environment?: string;
  feature: string;
  context: Record<string, unknown>;
  json?: boolean;
  pretty?: boolean;
  verbose?: boolean;
  inflate?: number;
  target?: string | string[];
}

async function evaluateFeatureWithDatafile(
  datafileContent: DatafileContent,
  options: EvaluateOptions,
  target?: string,
) {
  let diagnostics: FeaturevisorDiagnostic[] = [];
  const f = createFeaturevisor({
    datafile: datafileContent as DatafileContent,
    logLevel: "debug",
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  const flagEvaluation = f.evaluateFlag(options.feature, options.context as Context);
  const flagEvaluationDiagnostics = [...diagnostics];
  diagnostics = [];

  const variationEvaluation = f.evaluateVariation(options.feature, options.context as Context);
  const variationEvaluationDiagnostics = [...diagnostics];
  diagnostics = [];

  const variableEvaluations: Record<string, Evaluation> = {};
  const variableEvaluationDiagnostics: Record<string, FeaturevisorDiagnostic[]> = {};

  const feature = f.getFeature(options.feature);
  if (feature?.variablesSchema) {
    const variableKeys = Array.isArray(feature.variablesSchema)
      ? feature.variablesSchema
      : Object.keys(feature.variablesSchema);

    variableKeys.forEach((variableKey) => {
      const variableEvaluation = f.evaluateVariable(
        options.feature,
        variableKey,
        options.context as Context,
      );

      variableEvaluationDiagnostics[variableKey] = [...diagnostics];
      diagnostics = [];

      variableEvaluations[variableKey] = variableEvaluation;
    });
  }

  const allEvaluations = {
    flag: flagEvaluation,
    variation: variationEvaluation,
    variables: variableEvaluations,
  };

  if (options.json) {
    return allEvaluations;
  }

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Evaluating Featurevisor feature");
  console.log(`  ${colorize("Feature", CLI_COLOR_CYAN)}: ${options.feature}`);
  console.log(`  ${colorize("Environment", CLI_COLOR_CYAN)}: ${options.environment || false}`);
  if (target) console.log(`  ${colorize("Target", CLI_COLOR_CYAN)}: ${target}`);
  console.log(`  ${colorize("Context", CLI_COLOR_CYAN)}: ${JSON.stringify(options.context)}`);

  // flag
  printHeader("Is enabled?");

  if (options.verbose) {
    printDiagnostics(flagEvaluationDiagnostics);
  }

  console.log(
    flagEvaluation.enabled ? CLI_FORMAT_GREEN : CLI_FORMAT_YELLOW,
    `Value: ${flagEvaluation.enabled}`,
  );
  console.log("\nDetails:\n");

  printEvaluationDetails(flagEvaluation);

  // variation
  printHeader("Variation");

  if (feature?.variations) {
    if (options.verbose) {
      printDiagnostics(variationEvaluationDiagnostics);
    }

    console.log(CLI_FORMAT_GREEN, `Value: ${JSON.stringify(variationEvaluation.variation?.value)}`);
    console.log("\nDetails:\n");

    printEvaluationDetails(variationEvaluation);
  } else {
    console.log(CLI_FORMAT_YELLOW, "No variations defined.");
  }

  // variables
  if (feature?.variablesSchema) {
    for (const [key, value] of Object.entries(variableEvaluations)) {
      printHeader(`Variable: ${key}`);

      if (options.verbose) {
        printDiagnostics(variableEvaluationDiagnostics[key]);
      }

      const variableValue =
        typeof value.variableValue !== "undefined"
          ? JSON.stringify(value.variableValue)
          : value.variableValue;
      console.log(CLI_FORMAT_GREEN, `Value: ${variableValue}`);
      console.log("\nDetails:\n");

      printEvaluationDetails(value);
    }
  } else {
    printHeader("Variables");

    console.log(CLI_FORMAT_YELLOW, "No variables defined.");
  }

  return allEvaluations;
}

export async function evaluateFeature(deps: Dependencies, options: EvaluateOptions) {
  const datafiles = await buildRuntimeDatafiles(deps, {
    environment: options.environment || false,
    target: options.target,
    revision: "include-all-features",
    inflate: options.inflate,
  });

  const results = [];
  for (const entry of datafiles) {
    const evaluations = await evaluateFeatureWithDatafile(entry.datafile, options, entry.target);
    results.push({ target: entry.target, evaluations });
  }

  if (options.json) {
    const output = results.length === 1 ? results[0].evaluations : results;
    console.log(options.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
  }
}

export const evaluatePlugin: Plugin = {
  command: "evaluate",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    assertProjectSetJsonSelection(projectConfig, parsed.set, parsed.json);

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set, parsed.json);

      await evaluateFeature(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        {
          environment: parsed.environment,
          feature: parsed.feature,
          context: parsed.context ? JSON.parse(parsed.context) : {},
          // @NOTE: introduce optional --at?
          json: parsed.json,
          pretty: parsed.pretty,
          verbose: parsed.verbose,
          target: parsed.target,
        },
      );
    }
  },
  examples: [
    {
      command:
        'evaluate --environment=production --feature=my_feature --context=\'{"userId": "123"}\'',
      description: "evaluate a feature against provided context",
    },
  ],
};
