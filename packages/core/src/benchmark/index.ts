import type { Context, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Featurevisor } from "@featurevisor/sdk";

import { buildDatafile } from "../builder";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "../tester/prettyDuration";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, colorize } from "../tester/cliFormat";

export interface BenchmarkOutput {
  value: any;
  duration: number; // ms
  minDuration: number; // ms
  averageDuration: number; // ms
  maxDuration: number; // ms
}

function benchmarkEvaluation(n: number, evaluate: () => any): BenchmarkOutput {
  let value: any;
  let totalDurationNs = 0n;
  let minDurationNs: bigint | undefined;
  let maxDurationNs = 0n;

  for (let i = 0; i < n; i++) {
    const start = process.hrtime.bigint();
    value = evaluate();
    const durationNs = process.hrtime.bigint() - start;

    totalDurationNs += durationNs;
    if (typeof minDurationNs === "undefined" || durationNs < minDurationNs) {
      minDurationNs = durationNs;
    }
    if (durationNs > maxDurationNs) {
      maxDurationNs = durationNs;
    }
  }

  const duration = Number(totalDurationNs) / 1_000_000;

  return {
    value,
    duration,
    minDuration: Number(minDurationNs || 0n) / 1_000_000,
    averageDuration: duration / n,
    maxDuration: Number(maxDurationNs) / 1_000_000,
  };
}

function formatDurationMs(duration: number): string {
  return `${duration.toFixed(6)}ms`;
}

export function benchmarkFeatureFlag(
  f: Featurevisor,
  featureKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  return benchmarkEvaluation(n, () => f.isEnabled(featureKey, context as Context));
}

export function benchmarkFeatureVariation(
  f: Featurevisor,
  featureKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  return benchmarkEvaluation(n, () => f.getVariation(featureKey, context as Context));
}

export function benchmarkFeatureVariable(
  f: Featurevisor,
  featureKey: string,
  variableKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  return benchmarkEvaluation(n, () =>
    f.getVariable(featureKey, variableKey, context as Context),
  );
}

export interface BenchmarkOptions {
  environment?: string;
  feature: string;
  n: number;
  context: Record<string, unknown>;
  variation?: boolean;
  variable?: string;
  inflate?: number;
}

export async function benchmarkFeature(
  deps: Dependencies,
  options: BenchmarkOptions,
): Promise<void> {
  const { datasource, projectConfig } = deps;

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Benchmark Featurevisor feature");
  console.log(`  ${colorize("Feature", CLI_COLOR_CYAN)}: ${options.feature}`);
  console.log(`  ${colorize("Environment", CLI_COLOR_CYAN)}: ${options.environment || false}`);
  console.log(`  ${colorize("Iterations", CLI_COLOR_CYAN)}: ${options.n}`);

  console.log("");
  console.log(`Building datafile containing all features...`);
  const datafileBuildStart = Date.now();
  const existingState = await datasource.readState(options.environment || false);
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      revision: "include-all-features",
      environment: options.environment || false,
      inflate: options.inflate,
    },
    existingState,
  );
  const datafileBuildDuration = Date.now() - datafileBuildStart;
  console.log(`  ${colorize("Build duration", CLI_COLOR_CYAN)}: ${datafileBuildDuration}ms`);
  console.log(
    `  ${colorize("Datafile size", CLI_COLOR_CYAN)}: ${(JSON.stringify(datafileContent).length / 1024).toFixed(2)} kB`,
  );

  if (options.inflate) {
    console.log("");
    console.log(
      `  ${colorize("Features count", CLI_COLOR_CYAN)}: ${Object.keys(datafileContent.features).length}`,
    );
    console.log(
      `  ${colorize("Segments count", CLI_COLOR_CYAN)}: ${Object.keys(datafileContent.segments).length}`,
    );
  }

  console.log("");

  const f = createFeaturevisor({
    datafile: datafileContent as DatafileContent,
    logLevel: "warn",
  });
  console.log(CLI_FORMAT_GREEN, "SDK initialized");

  console.log("");
  console.log(`  ${colorize("Context", CLI_COLOR_CYAN)}: ${JSON.stringify(options.context)}`);

  let output: BenchmarkOutput;
  if (options.variable) {
    // variable
    console.log(`Evaluating variable "${options.variable}" ${options.n} times...`);
    output = benchmarkFeatureVariable(
      f,
      options.feature,
      options.variable,
      options.context,
      options.n,
    );
  } else if (options.variation) {
    // variation
    console.log(`Evaluating variation ${options.n} times...`);
    output = benchmarkFeatureVariation(f, options.feature, options.context, options.n);
  } else {
    // flag
    console.log(`Evaluating flag ${options.n} times...`);
    output = benchmarkFeatureFlag(f, options.feature, options.context, options.n);
  }

  console.log("");

  console.log(`  ${colorize("Evaluated value", CLI_COLOR_CYAN)}: ${JSON.stringify(output.value)}`);
  console.log(
    `  ${colorize("Total duration", CLI_COLOR_CYAN)}: ${prettyDuration(output.duration)}`,
  );
  console.log(
    `  ${colorize("Minimum duration", CLI_COLOR_CYAN)}: ${formatDurationMs(output.minDuration)}`,
  );
  console.log(
    `  ${colorize("Average duration", CLI_COLOR_CYAN)}: ${formatDurationMs(output.averageDuration)}`,
  );
  console.log(
    `  ${colorize("Maximum duration", CLI_COLOR_CYAN)}: ${formatDurationMs(output.maxDuration)}`,
  );
}

export const benchmarkPlugin: Plugin = {
  command: "benchmark",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await benchmarkFeature(
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
          variation: parsed.variation || undefined,
          variable: parsed.variable || undefined,
          inflate: parseInt(parsed.inflate, 10) || undefined,
        },
      );
    }
  },
  examples: [
    {
      command:
        'benchmark --environment=production --feature=my_feature -n=1000 --context=\'{"userId": "123"}\'',
      description: "Benchmark a feature flag",
    },
    {
      command:
        'benchmark --environment=production --feature=my_feature -n=1000 --context=\'{"userId": "123"}\' --variation',
      description: "Benchmark a feature variation",
    },
    {
      command:
        'benchmark --environment=production --feature=my_feature -n=1000 --context=\'{"userId": "123"}\' --variable=my-variable',
      description: "Benchmark a feature variable",
    },
  ],
};
