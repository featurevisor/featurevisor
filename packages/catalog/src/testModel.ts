import type {
  AssertionMatrix,
  FeatureAssertion,
  SegmentAssertion,
  Test,
} from "@featurevisor/types";

export interface ExpandedTestAssertion {
  assertion: FeatureAssertion | SegmentAssertion;
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
  if (typeof value !== "string") {
    return value;
  }

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
  assertion: FeatureAssertion | SegmentAssertion,
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
  }

  return result;
}

export function expandTestAssertions(test: Test): ExpandedTestAssertion[] {
  return test.assertions.flatMap((assertion, assertionIndex) => {
    if (!assertion.matrix) {
      return [
        {
          assertion: { ...assertion },
          assertionIndex,
          label: String(assertionIndex + 1),
        },
      ];
    }

    const combinations = getMatrixCombinations(assertion.matrix);
    return combinations.map((combination, caseIndex) => ({
      assertion: applyCombinationToAssertion(test, assertion, combination),
      assertionIndex,
      caseIndex,
      caseCount: combinations.length,
      label: `${assertionIndex + 1}.${caseIndex + 1}`,
      matrixValues: combination,
    }));
  });
}

export function getTestAssertionPermalink(testKey: string, assertionLabel: string) {
  return `${testKey}:${assertionLabel}`;
}
