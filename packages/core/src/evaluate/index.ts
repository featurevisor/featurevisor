import type { Attribute, Context, DatafileContent, Schema } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";

import { Dependencies } from "../dependencies";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { Plugin } from "../cli";
import { parseJsonObjectOption, parsePositiveIntegerOption } from "../cli/validation";
import { FeaturevisorCLIError } from "../error";
import { suggestKey } from "../linter/diagnostics";
import { getContextWarnings } from "../linter/contextWarnings";
import { explainEvaluation, getEvaluationValue, printExplanation } from "./explain";
import type { ExplanationOptions } from "./explain";
import { assertExplanationMatchesEvaluation } from "./validateExplanation";
import { probeConditions } from "./probeConditions";
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
      if (Object.prototype.hasOwnProperty.call(value, "defaultValue")) {
        console.log(`  ${colorize("defaultValue", CLI_COLOR_CYAN)}:`, value.defaultValue);
      }
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
  feature?: string;
  variable?: string;
  context: Record<string, unknown>;
  json?: boolean;
  pretty?: boolean;
  verbose?: boolean;
  explain?: boolean;
  inflate?: number;
  target?: string | string[];
}

async function evaluateFeatureWithDatafile(
  datafileContent: DatafileContent,
  options: EvaluateOptions,
  target?: string,
  explanationOptions?: ExplanationOptions,
  warnings: Array<{ attribute: string; message: string }> = [],
) {
  let diagnostics: FeaturevisorDiagnostic[] = [];
  const expressions = explanationOptions?.expressions;
  const explain = (
    evaluation: Evaluation,
    entries: FeaturevisorDiagnostic[],
    variable?: string,
  ) => {
    const featureKey = evaluation.featureKey || options.feature;
    const feature = featureKey ? datafileContent.features[featureKey] : undefined;
    const conditions = featureKey
      ? feature?.conditions
      : datafileContent.variables?.[evaluation.variableKey ?? variable ?? ""]?.conditions;
    const conditionsProbe =
      conditions !== undefined
        ? probeConditions(datafileContent, options.context as Context, conditions)
        : undefined;
    const selectionProbes = [
      ...(feature?.force || [])
        .filter((entry) => entry.conditions !== undefined)
        .map((entry, index) => ({
          ...probeConditions(datafileContent, options.context as Context, entry.conditions!),
          scope: "force" as const,
          index,
        })),
      ...(feature?.traffic || [])
        .filter((entry) => entry.conditions !== undefined)
        .map((entry, index) => ({
          ...probeConditions(datafileContent, options.context as Context, entry.conditions!),
          scope: "rule" as const,
          key: entry.key,
          index,
        })),
    ];
    const metadata = {
      ...explanationOptions,
      ...options,
      variable,
      target,
      conditionsProbe,
      selectionProbes,
    };
    const explanation = explainEvaluation(evaluation, datafileContent, entries, metadata);
    assertExplanationMatchesEvaluation(evaluation, explanation, datafileContent, metadata);
    return explanation;
  };
  const f = createFeaturevisor({
    datafile: datafileContent as DatafileContent,
    logLevel: "debug",
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  if (options.variable && !options.feature) {
    const evaluation = f.evaluateVariable(options.variable, options.context as Context);
    const evaluationDiagnostics = [...diagnostics];
    const explanation = options.explain
      ? explain(evaluation, evaluationDiagnostics, options.variable)
      : undefined;
    const result = {
      ...evaluation,
      ...(explanation ? { explanation } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
    if (options.json) return result;

    console.log("");
    console.log(CLI_FORMAT_BOLD, "Evaluating Featurevisor variable");
    console.log(`  ${colorize("Variable", CLI_COLOR_CYAN)}: ${options.variable}`);
    if (options.environment)
      console.log(`  ${colorize("Environment", CLI_COLOR_CYAN)}: ${options.environment}`);
    if (target) console.log(`  ${colorize("Target", CLI_COLOR_CYAN)}: ${target}`);
    console.log(`  ${colorize("Context", CLI_COLOR_CYAN)}: ${JSON.stringify(options.context)}`);
    if (warnings.length) {
      printHeader("Warnings");
      warnings.forEach((warning) => console.log(CLI_FORMAT_YELLOW, warning.message));
    }
    if (options.verbose) printDiagnostics(evaluationDiagnostics);
    if (explanation) {
      printExplanation(explanation, true, expressions);
    } else {
      console.log(CLI_FORMAT_GREEN, `Value: ${JSON.stringify(evaluation.variableValue)}`);
      const composition = datafileContent.variables?.[options.variable]?.compose;
      if (composition && evaluation.reason !== "conditions_unmet") {
        console.log("\nComposition:\n");
        const value = evaluation.variableValue;
        if (typeof composition === "string") {
          console.log(`  Alias source: ${composition}`);
          console.log(
            `  SDK result${evaluation.reason === "variable_override_rule" ? " after overrides" : ""}: ${value !== undefined ? JSON.stringify(value) : "unavailable"}`,
          );
        } else {
          for (const { key, ...source } of composition) {
            const hasValue =
              value !== null &&
              typeof value === "object" &&
              Object.prototype.hasOwnProperty.call(value, key);
            console.log(
              `  ${key}: ${JSON.stringify(source)} = ${hasValue ? JSON.stringify((value as Record<string, unknown>)[key]) : "unavailable"}`,
            );
          }
        }
      }
      console.log("\nDetails:\n");
      printEvaluationDetails(evaluation);
    }
    return result;
  }

  const featureKey = options.feature as string;
  const flagEvaluation = f.evaluateFlag(featureKey, options.context as Context);
  const flagEvaluationDiagnostics = [...diagnostics];
  diagnostics = [];

  const variationEvaluation = f.evaluateVariation(featureKey, options.context as Context);
  const variationEvaluationDiagnostics = [...diagnostics];
  diagnostics = [];

  const variableEvaluations: Record<string, Evaluation> = {};
  const variableEvaluationDiagnostics: Record<string, FeaturevisorDiagnostic[]> = {};

  const feature = f.getFeature(featureKey);
  if (feature?.variablesSchema) {
    const variableKeys = Array.isArray(feature.variablesSchema)
      ? feature.variablesSchema
      : Object.keys(feature.variablesSchema);

    variableKeys.forEach((variableKey) => {
      const variableEvaluation = f.evaluateVariable(
        featureKey,
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

  const explanation = options.explain
    ? {
        flag: explain(flagEvaluation, flagEvaluationDiagnostics),
        variation: explain(variationEvaluation, variationEvaluationDiagnostics),
        variables: Object.fromEntries(
          Object.entries(variableEvaluations).map(([key, evaluation]) => [
            key,
            explain(evaluation, variableEvaluationDiagnostics[key], key),
          ]),
        ),
      }
    : undefined;
  const result = {
    ...allEvaluations,
    ...(explanation ? { explanation } : {}),
    ...(warnings.length ? { warnings } : {}),
  };

  if (options.json) {
    return result;
  }

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Evaluating Featurevisor feature");
  console.log(`  ${colorize("Feature", CLI_COLOR_CYAN)}: ${featureKey}`);
  if (options.environment)
    console.log(`  ${colorize("Environment", CLI_COLOR_CYAN)}: ${options.environment}`);
  if (target) console.log(`  ${colorize("Target", CLI_COLOR_CYAN)}: ${target}`);
  console.log(`  ${colorize("Context", CLI_COLOR_CYAN)}: ${JSON.stringify(options.context)}`);
  if (warnings.length) {
    printHeader("Warnings");
    warnings.forEach((warning) => console.log(CLI_FORMAT_YELLOW, warning.message));
  }

  // flag
  printHeader("Is enabled?");

  if (options.verbose) {
    printDiagnostics(flagEvaluationDiagnostics);
  }

  if (explanation) {
    printExplanation(explanation.flag, true, expressions);
  } else {
    console.log(
      flagEvaluation.enabled ? CLI_FORMAT_GREEN : CLI_FORMAT_YELLOW,
      `Value: ${flagEvaluation.enabled}`,
    );
    console.log("\nDetails:\n");
    printEvaluationDetails(flagEvaluation);
  }

  // variation
  printHeader("Variation");

  if (feature?.variations) {
    if (options.verbose) {
      printDiagnostics(variationEvaluationDiagnostics);
    }

    if (explanation) {
      printExplanation(explanation.variation, false, expressions);
    } else {
      console.log(
        CLI_FORMAT_GREEN,
        `Value: ${JSON.stringify(getEvaluationValue(variationEvaluation))}`,
      );
      console.log("\nDetails:\n");
      printEvaluationDetails(variationEvaluation);
    }
  } else {
    if (explanation) printExplanation(explanation.variation, false, expressions);
    else console.log(CLI_FORMAT_YELLOW, "No variations defined.");
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
      if (explanation) {
        printExplanation(explanation.variables[key], false, expressions);
      } else {
        console.log(CLI_FORMAT_GREEN, `Value: ${variableValue}`);
        console.log("\nDetails:\n");
        printEvaluationDetails(value);
      }
    }
  } else {
    printHeader("Variables");

    console.log(CLI_FORMAT_YELLOW, "No variables defined.");
  }

  return result;
}

export async function evaluateFeature(deps: Dependencies, options: EvaluateOptions) {
  if (Boolean(options.feature) === Boolean(options.variable)) {
    throw new FeaturevisorCLIError("Pass exactly one of --feature or --variable.", {
      code: "invalid_evaluation_selection",
      details: { feature: options.feature, variable: options.variable },
    });
  }
  const definitionExists = options.variable
    ? await deps.datasource.variableExists(options.variable)
    : await deps.datasource.featureExists(options.feature as string);
  if (!definitionExists) {
    const entityType = options.variable ? "variable" : "feature";
    const key = (options.variable || options.feature) as string;
    const keys = options.variable
      ? await deps.datasource.listVariables()
      : await deps.datasource.listFeatures();
    throw new FeaturevisorCLIError(`Unknown ${entityType} "${key}".${suggestKey(key, keys)}`, {
      code: `unknown_${entityType}`,
      details: { entityType, key },
    });
  }
  const datafiles = await buildRuntimeDatafiles(deps, {
    environment: options.environment || false,
    target: options.target,
    revision: "include-all-features",
    inflate: options.inflate,
  });

  const explanationOptions: ExplanationOptions | undefined = options.explain
    ? {
        set: deps.datasource.getSet(),
        definitionExists,
        expressions: deps.projectConfig?.allowConditionExpressions
          ? { namespaceCharacter: deps.projectConfig.namespaceCharacter }
          : undefined,
        authoredVariable:
          options.variable && definitionExists
            ? await deps.datasource.readVariable(options.variable)
            : undefined,
      }
    : undefined;

  const attributes: Record<string, Attribute> = Object.create(null);
  const schemas: Record<string, Schema> = Object.create(null);
  if (Object.keys(options.context).length) {
    await Promise.all(
      (await deps.datasource.listAttributes()).map(async (key) => {
        try {
          attributes[key] = await deps.datasource.readAttribute(key);
        } catch {
          // Unreadable definitions remain lint's responsibility.
        }
      }),
    );
    await Promise.all(
      (await deps.datasource.listSchemas()).map(async (key) => {
        try {
          schemas[key] = await deps.datasource.readSchema(key);
        } catch {
          // Missing schema metadata must not introduce an evaluation gate.
        }
      }),
    );
  }
  const warnings = getContextWarnings(options.context, attributes, schemas).map(
    ({ attribute, message }) => ({ attribute, message }),
  );

  const results = [];
  for (const entry of datafiles) {
    const evaluations = await evaluateFeatureWithDatafile(
      entry.datafile,
      options,
      entry.target,
      explanationOptions,
      warnings,
    );
    results.push({ target: entry.target, evaluations });
  }

  if (options.json) {
    const output = results.length === 1 ? results[0].evaluations : results;
    console.log(options.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
  }
}

export const evaluatePlugin: Plugin = {
  command: "evaluate",
  description: "Evaluate a feature or global variable against provided context",
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
          variable: parsed.variable,
          context: parsed.context ? parseJsonObjectOption("--context", parsed.context) : {},
          // @NOTE: introduce optional --at?
          json: parsed.json,
          pretty: parsed.pretty,
          verbose: parsed.verbose,
          explain: parsed.explain,
          target: parsed.target,
          inflate:
            typeof parsed.inflate !== "undefined"
              ? parsePositiveIntegerOption("--inflate", parsed.inflate, 1)
              : undefined,
        },
      );
    }
  },
  examples: [
    {
      command: 'evaluate --feature=showCookieBanner --context=\'{"country":"nl"}\'',
      description: "Evaluate a feature against provided context",
    },
    {
      command: 'evaluate --feature=sidebar --context=\'{"userId":"123"}\'',
      description:
        "For a project defining sidebar: evaluate its flag, variation and feature variables",
    },
    {
      command: 'evaluate --variable=supportEmail --context=\'{"country":"nl"}\'',
      description: "For a project defining supportEmail: evaluate a global variable",
    },
    {
      command:
        'evaluate --feature=showCookieBanner --environment=production --context=\'{"country":"nl"}\'',
      description: "With environments configured: evaluate a feature in production",
    },
  ],
};
