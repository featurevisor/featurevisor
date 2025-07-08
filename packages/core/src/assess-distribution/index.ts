import { randomBytes } from "crypto";

import type { FeatureKey, AttributeKey, Context, DatafileContent } from "@featurevisor/types";
import { createInstance, createLogger } from "@featurevisor/sdk";

import { Dependencies } from "../dependencies";
import { buildDatafile } from "../builder";
import { SCHEMA_VERSION } from "../config";
import { prettyPercentage, prettyNumber } from "../utils";
import { Plugin } from "../cli";

const UUID_LENGTHS = [4, 2, 2, 2, 6];

function generateUUID(): string {
  return UUID_LENGTHS.map((len) => randomBytes(len).toString("hex")).join("-");
}

type EvaluationsCount = Record<string, number>;

function printCounts(evaluations: EvaluationsCount, n: number, sort = true) {
  let entries = Object.entries(evaluations);

  if (sort) {
    entries = entries.sort((a, b) => {
      if (a[1] > b[1]) {
        return -1;
      }

      if (a[1] < b[1]) {
        return 1;
      }

      return 0;
    });
  }

  const longestValueLength = Object.keys(evaluations).reduce(
    (acc, curr) => (curr.length > acc ? curr.length : acc),
    0,
  );

  const highestCount = Object.values(evaluations).reduce(
    (acc, curr) => (curr > acc ? curr : acc),
    0,
  );
  const prettyHighestCountLength = prettyNumber(highestCount).length;

  for (const [value, count] of entries) {
    console.log(
      `  - ${value}:`.padEnd(longestValueLength + 5, " "),
      `\t${prettyNumber(count).padStart(prettyHighestCountLength, " ")}`,
      `\t${prettyPercentage(count, n).padStart(7, " ")}`,
    );
  }
}

function createContext(providedContext: Context, populateUuid?: AttributeKey[]): Context {
  const context = { ...providedContext };

  if (populateUuid) {
    for (const key of populateUuid) {
      context[key] = generateUUID();
    }
  }

  return context;
}

export interface AssessDistributionOptions {
  environment?: string;
  feature: FeatureKey;
  context: Context;
  n: number;
  schemaVersion?: string;
  inflate?: number;

  populateUuid?: AttributeKey[];
  verbose?: boolean;
}

export async function assessDistribution(deps: Dependencies, options: AssessDistributionOptions) {
  const { projectConfig, datasource } = deps;

  console.log(`\nAssessing distribution for feature: "${options.feature}"...`);

  /**
   * Prepare datafile
   */
  const datafileBuildStart = Date.now();
  console.log(`\n\nBuilding datafile containing all features for "${options.environment}"...`);
  const existingState = await datasource.readState(options.environment || false);
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      schemaVersion: options.schemaVersion || SCHEMA_VERSION,
      revision: "include-all-features",
      environment: options.environment || false,
      inflate: options.inflate,
    },
    existingState,
  );
  const datafileBuildDuration = Date.now() - datafileBuildStart;
  console.log(`Datafile build duration: ${datafileBuildDuration}ms`);

  /**
   * Initialize SDK
   */
  const f = createInstance({
    datafile: datafileContent as DatafileContent,
    logger: createLogger({
      levels: ["warn", "error"],
    }),
  });
  console.log("\n\n...SDK initialized\n");

  /**
   * Evaluations
   */
  let hasVariations = false;
  const feature = f.getFeature(options.feature);

  if (feature && feature.variations) {
    hasVariations = true;
  }

  const flagEvaluations: EvaluationsCount = {
    enabled: 0,
    disabled: 0,
  };

  const variationEvaluations: EvaluationsCount = {};

  console.log(`\nEvaluating ${prettyNumber(options.n)} times...`);

  for (let i = 0; i < options.n; i++) {
    const context = createContext(options.context, options.populateUuid);
    if (options.verbose) {
      console.log(`[${i + 1}/${options.n}] Evaluating against context: ${JSON.stringify(context)}`);
    }

    // flag
    const flagEvaluation = f.isEnabled(options.feature, context);

    if (flagEvaluation) {
      flagEvaluations.enabled++;
    } else {
      flagEvaluations.disabled++;
    }

    // variation
    if (hasVariations) {
      const variationEvaluation = f.getVariation(options.feature, context) as string;

      if (!variationEvaluations[variationEvaluation]) {
        variationEvaluations[variationEvaluation] = 0;
      }

      variationEvaluations[variationEvaluation]++;
    }
  }

  /**
   * Print results
   */

  console.log("\n\nFlag evaluations:\n");
  printCounts(flagEvaluations, options.n);

  if (hasVariations) {
    console.log("\n\nVariation evaluations:\n");
    printCounts(variationEvaluations, options.n);
  }
}

export const assessDistributionPlugin: Plugin = {
  command: "assess-distribution",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    await assessDistribution(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      {
        environment: parsed.environment,
        feature: parsed.feature,
        n: parseInt(parsed.n, 10) || 1,
        context: parsed.context ? JSON.parse(parsed.context) : {},
        populateUuid: Array.isArray(parsed.populateUuid)
          ? parsed.populateUuid
          : [parsed.populateUuid as string].filter(Boolean),
        verbose: parsed.verbose,
      },
    );
  },
  examples: [
    {
      command:
        "assess-distribution --environment=production --feature=my_feature --context='{}' --populateUuid=userId -n=100",
      description: "test traffic distribution a feature against provided context",
    },
  ],
};
