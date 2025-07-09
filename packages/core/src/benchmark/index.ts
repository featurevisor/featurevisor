import type { Context, DatafileContent } from "@featurevisor/types";
import { FeaturevisorInstance, createInstance } from "@featurevisor/sdk";

import { SCHEMA_VERSION } from "../config";
import { buildDatafile } from "../builder";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "../tester/prettyDuration";
import { Plugin } from "../cli";

export interface BenchmarkOutput {
  value: any;
  duration: number; // ms
}

export function benchmarkFeatureFlag(
  f: FeaturevisorInstance,
  featureKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  const start = Date.now();
  let value: any;

  for (let i = 0; i < n; i++) {
    value = f.isEnabled(featureKey, context as Context);
  }

  const duration = Date.now() - start;

  return {
    value,
    duration,
  };
}

export function benchmarkFeatureVariation(
  f: FeaturevisorInstance,
  featureKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  const start = Date.now();
  let value: any;

  for (let i = 0; i < n; i++) {
    value = f.getVariation(featureKey, context as Context);
  }

  const duration = Date.now() - start;

  return {
    value,
    duration,
  };
}

export function benchmarkFeatureVariable(
  f: FeaturevisorInstance,
  featureKey: string,
  variableKey: string,
  context: Record<string, unknown>,
  n: number,
): BenchmarkOutput {
  const start = Date.now();
  let value: any;

  for (let i = 0; i < n; i++) {
    value = f.getVariable(featureKey, variableKey, context as Context);
  }

  const duration = Date.now() - start;

  return {
    value,
    duration,
  };
}

export interface BenchmarkOptions {
  environment?: string;
  feature: string;
  n: number;
  context: Record<string, unknown>;
  variation?: boolean;
  variable?: string;
  schemaVersion?: string;
  inflate?: number;
}

export async function benchmarkFeature(
  deps: Dependencies,
  options: BenchmarkOptions,
): Promise<void> {
  const { datasource, projectConfig } = deps;

  console.log("");
  console.log(`Running benchmark for feature "${options.feature}"...`);

  console.log("");

  console.log(`Building datafile containing all features for "${options.environment}"...`);
  const datafileBuildStart = Date.now();
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
  console.log(`Datafile size: ${(JSON.stringify(datafileContent).length / 1024).toFixed(2)} kB`);

  if (options.inflate) {
    console.log("");
    console.log("Features count:", Object.keys(datafileContent.features).length);
    console.log("Segments count:", Object.keys(datafileContent.segments).length);
  }

  console.log("");

  const f = createInstance({
    datafile: datafileContent as DatafileContent,
    logLevel: "warn",
  });
  console.log("...SDK initialized");

  console.log("");
  console.log(`Against context: ${JSON.stringify(options.context)}`);

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

  console.log(`Evaluated value : ${JSON.stringify(output.value)}`);
  console.log(`Total duration  : ${prettyDuration(output.duration)}`);
  console.log(`Average duration: ${prettyDuration(output.duration / options.n)}`);
}

export const benchmarkPlugin: Plugin = {
  command: "benchmark",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    await benchmarkFeature(
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
        variation: parsed.variation || undefined,
        variable: parsed.variable || undefined,
        schemaVersion: parsed.schemaVersion || undefined,
        inflate: parseInt(parsed.inflate, 10) || undefined,
      },
    );
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
