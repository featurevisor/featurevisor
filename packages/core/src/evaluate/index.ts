import { Context } from "@featurevisor/types";
import { Evaluation, createInstance, createLogger } from "@featurevisor/sdk";

import { Dependencies } from "../dependencies";
import { SCHEMA_VERSION } from "../config";
import { buildDatafile } from "../builder";

function printEvaluationDetails(evaluation: Evaluation) {
  const ignoreKeys = ["featureKey", "traffic", "bucketValue", "bucketKey"];

  for (const [key, value] of Object.entries(evaluation)) {
    if (ignoreKeys.indexOf(key) !== -1) {
      continue;
    }

    if (key === "variation") {
      console.log(`-`, `${key}:`, value?.key);
      continue;
    }

    console.log(`-`, `${key}:`, value);
  }
}

function printHeader(message: string) {
  console.log("\n\n###############");
  console.log(`# ${message}`);
  console.log("###############\n");
}

export interface EvaluateOptions {
  environment: string;
  feature: string;
  context: Record<string, unknown>;
  print?: boolean;
  pretty?: boolean;
}

export async function evaluateFeature(deps: Dependencies, options: EvaluateOptions) {
  const { datasource, projectConfig } = deps;

  const existingState = await datasource.readState(options.environment);
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      schemaVersion: SCHEMA_VERSION,
      revision: "include-all-features",
      environment: options.environment,
    },
    existingState,
  );

  const logs: Array<any> = [];
  const f = createInstance({
    datafile: datafileContent,
    logger: createLogger({
      levels: ["error", "warn", "info", "debug"],
      handler: (level, message, details) => {
        logs.push({
          level,
          message,
          details,
        });
      },
    }),
  });

  const flagEvaluation = f.evaluateFlag(options.feature, options.context as Context);
  const variationEvaluation = f.evaluateVariation(options.feature, options.context as Context);
  const variableEvaluations: Array<Evaluation> = [];

  const feature = f.getFeature(options.feature);
  if (feature?.variablesSchema) {
    feature.variablesSchema.forEach((v) => {
      const variableEvaluation = f.evaluateVariable(
        options.feature,
        v.key,
        options.context as Context,
      );
      variableEvaluations.push(variableEvaluation);
    });
  }

  const allEvaluations = {
    flag: flagEvaluation,
    variation: variationEvaluation,
    variables: variableEvaluations,
  };

  if (options.print) {
    console.log(
      options.pretty ? JSON.stringify(allEvaluations, null, 2) : JSON.stringify(allEvaluations),
    );

    return;
  }

  console.log("");
  console.log(`Evaluating feature "${options.feature}" in environment "${options.environment}..."`);
  console.log(`Against context: ${JSON.stringify(options.context)}`);

  // bucketing
  printHeader("Bucketing");

  // console.log("Bucket key:", flagEvaluation.bucketKey); // @TODO
  console.log("Bucket value:", flagEvaluation.bucketValue);

  // flag
  printHeader("Is enabled?");

  console.log("Value:", flagEvaluation.enabled);
  console.log("\nDetails:\n");

  printEvaluationDetails(flagEvaluation);

  // variation
  printHeader("Variation");

  if (feature?.variations) {
    console.log("Value:", variationEvaluation.enabled);
    console.log("\nDetails:\n");

    printEvaluationDetails(variationEvaluation);
  } else {
    console.log("No variations available.");
  }
}
