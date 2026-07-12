import { randomBytes } from "crypto";

import type { FeatureKey, AttributeKey, Context, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";

import { Dependencies } from "../dependencies";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { prettyPercentage, prettyNumber } from "../utils";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, colorize } from "../tester/cliFormat";

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
      `  ${colorize("•", CLI_COLOR_CYAN)} ${value}:`.padEnd(longestValueLength + 14, " "),
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
  inflate?: number;

  populateUuid?: AttributeKey[];
  verbose?: boolean;
  target?: string | string[];
}

async function assessDistributionWithDatafile(
  datafileContent: DatafileContent,
  options: AssessDistributionOptions,
  target?: string,
) {
  console.log("");
  console.log(CLI_FORMAT_BOLD, "Assess Featurevisor distribution");
  console.log(`  ${colorize("Feature", CLI_COLOR_CYAN)}: ${options.feature}`);
  console.log(`  ${colorize("Environment", CLI_COLOR_CYAN)}: ${options.environment || false}`);
  if (target) console.log(`  ${colorize("Target", CLI_COLOR_CYAN)}: ${target}`);
  console.log(`  ${colorize("Iterations", CLI_COLOR_CYAN)}: ${prettyNumber(options.n)}`);

  /**
   * Initialize SDK
   */
  const f = createFeaturevisor({
    datafile: datafileContent as DatafileContent,
    logLevel: "warn",
  });
  console.log("");
  console.log(CLI_FORMAT_GREEN, "SDK initialized");

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

  console.log("");
  console.log(`Evaluating ${prettyNumber(options.n)} times...`);

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

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Flag evaluations");
  console.log("");
  printCounts(flagEvaluations, options.n);

  if (hasVariations) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, "Variation evaluations");
    console.log("");
    printCounts(variationEvaluations, options.n);
  }
}

export async function assessDistribution(deps: Dependencies, options: AssessDistributionOptions) {
  const datafileBuildStart = Date.now();
  const datafiles = await buildRuntimeDatafiles(deps, {
    environment: options.environment || false,
    target: options.target,
    revision: "include-all-features",
    inflate: options.inflate,
  });
  const datafileBuildDuration = Date.now() - datafileBuildStart;

  console.log("");
  console.log(`Building ${datafiles.length} datafile${datafiles.length === 1 ? "" : "s"}...`);
  console.log(`  ${colorize("Build duration", CLI_COLOR_CYAN)}: ${datafileBuildDuration}ms`);

  for (const entry of datafiles) {
    await assessDistributionWithDatafile(entry.datafile, options, entry.target);
  }
}

export const assessDistributionPlugin: Plugin = {
  command: "assess-distribution",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await assessDistribution(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
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
          target: parsed.target,
        },
      );
    }
  },
  examples: [
    {
      command:
        "assess-distribution --environment=production --feature=my_feature --context='{}' --populateUuid=userId -n=100",
      description: "test traffic distribution a feature against provided context",
    },
  ],
};
