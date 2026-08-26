import type {
  AssertionMatrix,
  FeatureAssertion,
  SegmentAssertion,
  VariableAssertion,
  Test,
} from "@featurevisor/types";

export interface ExpandedTestAssertion {
  assertion: FeatureAssertion | SegmentAssertion | VariableAssertion;
  assertionIndex: number;
  caseIndex?: number;
  caseCount?: number;
  label: string;
  matrixValues?: Record<string, unknown>;
}

function getMatrixCombinations(matrix: AssertionMatrix) {
  const keys = Object.keys(matrix);

  if (keys.length === 0) {
    return [];
  }

  return keys.reduce<Array<Record<string, unknown>>>(
    (combinations, key) =>
      combinations.flatMap((combination) =>
        matrix[key].map((value) => ({ ...combination, [key]: value })),
      ),
    [{}],
  );
}

function applyCombinationToValue(value: unknown, combination: Record<string, unknown>) {
  if (typeof value === "string") {
    const placeholders = value.match(/\${{(.+?)}}/g);
    if (!placeholders) {
      return value;
    }

    if (placeholders.length === 1 && value.startsWith("${{") && value.endsWith("}}")) {
      const key = value.replace("${{", "").replace("}}", "").trim();
      return combination[key];
    }

    return value.replace(/\${{(.+?)}}/g, (_, key) => String(combination[key.trim()]));
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyCombinationToValue(item, combination));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, applyCombinationToValue(item, combination)]),
    );
  }

  return value;
}

function applyCombinationToContext(
  context: Record<string, unknown> | undefined,
  combination: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(context || {}).map(([key, value]) => [
      key,
      applyCombinationToValue(value, combination),
    ]),
  );
}

function applyCombinationToAssertion(
  test: Test,
  assertion: FeatureAssertion | SegmentAssertion | VariableAssertion,
  combination: Record<string, unknown>,
) {
  const result = {
    ...assertion,
    context: applyCombinationToContext(assertion.context, combination),
  };
  delete result.matrix;

  if (result.description) {
    result.description = String(applyCombinationToValue(result.description, combination));
  }

  if ("feature" in test) {
    const featureResult = result as FeatureAssertion;
    featureResult.environment = applyCombinationToValue(
      featureResult.environment,
      combination,
    ) as FeatureAssertion["environment"];
    featureResult.target = applyCombinationToValue(
      featureResult.target,
      combination,
    ) as FeatureAssertion["target"];
    const at = applyCombinationToValue(featureResult.at, combination);
    featureResult.at = (
      typeof at === "string" ? (at.includes(".") ? parseFloat(at) : parseInt(at, 10)) : at
    ) as FeatureAssertion["at"];
    featureResult.sticky = applyCombinationToValue(
      featureResult.sticky,
      combination,
    ) as FeatureAssertion["sticky"];
    featureResult.defaultVariationValue = applyCombinationToValue(
      featureResult.defaultVariationValue,
      combination,
    ) as FeatureAssertion["defaultVariationValue"];
    featureResult.defaultVariableValues = applyCombinationToValue(
      featureResult.defaultVariableValues,
      combination,
    ) as FeatureAssertion["defaultVariableValues"];
    featureResult.expectedToBeEnabled = applyCombinationToValue(
      featureResult.expectedToBeEnabled,
      combination,
    ) as FeatureAssertion["expectedToBeEnabled"];
    featureResult.expectedVariation = applyCombinationToValue(
      featureResult.expectedVariation,
      combination,
    ) as FeatureAssertion["expectedVariation"];
    featureResult.expectedVariables = applyCombinationToValue(
      featureResult.expectedVariables,
      combination,
    ) as FeatureAssertion["expectedVariables"];
    featureResult.expectedEvaluations = applyCombinationToValue(
      featureResult.expectedEvaluations,
      combination,
    ) as FeatureAssertion["expectedEvaluations"];
    featureResult.children = applyCombinationToValue(
      featureResult.children,
      combination,
    ) as FeatureAssertion["children"];
  }
  if ("segment" in test) {
    const segmentResult = result as SegmentAssertion;
    segmentResult.expectedToMatch = applyCombinationToValue(
      segmentResult.expectedToMatch,
      combination,
    ) as SegmentAssertion["expectedToMatch"];
  }
  if ("variable" in test) {
    const variableResult = result as VariableAssertion;
    variableResult.environment = applyCombinationToValue(
      variableResult.environment,
      combination,
    ) as VariableAssertion["environment"];
    variableResult.target = applyCombinationToValue(
      variableResult.target,
      combination,
    ) as VariableAssertion["target"];
    variableResult.expectedValue = applyCombinationToValue(
      variableResult.expectedValue,
      combination,
    ) as VariableAssertion["expectedValue"];
    variableResult.stickyVariables = applyCombinationToValue(
      variableResult.stickyVariables,
      combination,
    ) as VariableAssertion["stickyVariables"];
    variableResult.defaultVariableValue = applyCombinationToValue(
      variableResult.defaultVariableValue,
      combination,
    ) as VariableAssertion["defaultVariableValue"];
    variableResult.expectedEvaluation = applyCombinationToValue(
      variableResult.expectedEvaluation,
      combination,
    ) as VariableAssertion["expectedEvaluation"];
  }

  return result;
}

export function expandTestAssertions(test: Test): ExpandedTestAssertion[] {
  return test.assertions.flatMap((assertion, assertionIndex) => {
    const assertionLabel = assertion.key || String(assertionIndex + 1);

    if (!assertion.matrix) {
      return [
        {
          assertion: { ...assertion },
          assertionIndex,
          label: assertionLabel,
        },
      ];
    }

    const combinations = getMatrixCombinations(assertion.matrix);
    return combinations.map((combination, caseIndex) => ({
      assertion: applyCombinationToAssertion(test, assertion, combination),
      assertionIndex,
      caseIndex,
      caseCount: combinations.length,
      label: `${assertionLabel}.${caseIndex + 1}`,
      matrixValues: combination,
    }));
  });
}

export function getTestAssertionPermalink(testKey: string, assertionLabel: string) {
  return `${testKey}:${assertionLabel}`;
}
