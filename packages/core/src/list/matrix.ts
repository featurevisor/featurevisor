import type { AssertionMatrix, FeatureAssertion, SegmentAssertion } from "@featurevisor/types";

function generateCombinations(
  keys: string[],
  matrix: AssertionMatrix,
  idx: number,
  prev: any,
  combinations: any[],
) {
  const key = keys[idx];
  const values = matrix[key];

  for (let i = 0; i < values.length; i++) {
    const combination = { ...prev, [key]: values[i] };

    if (idx === keys.length - 1) {
      combinations.push(combination);
    } else {
      generateCombinations(keys, matrix, idx + 1, combination, combinations);
    }
  }
}

export function getMatrixCombinations(matrix: AssertionMatrix) {
  const keys = Object.keys(matrix);

  if (!keys.length) {
    return [];
  }

  const combinations: any[] = [];
  generateCombinations(keys, matrix, 0, {}, combinations);

  return combinations;
}

export function applyCombinationToValue(value: any, combination: any) {
  if (typeof value === "string") {
    const variableKeysInValue = value.match(/\${{(.+?)}}/g);

    // no variables found
    if (!variableKeysInValue) {
      return value;
    }

    // only 1 variable found, so we can insert the value directly
    if (variableKeysInValue.length === 1 && value.startsWith("${{") && value.endsWith("}}")) {
      const key = value.replace("${{", "").replace("}}", "").trim();

      return combination[key];
    }

    // multiple variables found, so we can replace each as a whole string
    return value.replace(/\${{(.+?)}}/g, (_, key) => combination[key.trim()]);
  }

  return value;
}

/**
 * Features
 */
export function applyCombinationToFeatureAssertion(
  combination: any,
  assertion: FeatureAssertion,
): FeatureAssertion {
  const flattenedAssertion = { ...assertion };

  // environment
  flattenedAssertion.environment = applyCombinationToValue(
    flattenedAssertion.environment,
    combination,
  );

  // context
  flattenedAssertion.context = Object.keys(flattenedAssertion.context || {}).reduce((acc, key) => {
    acc[key] = applyCombinationToValue(flattenedAssertion.context?.[key], combination);

    return acc;
  }, {});

  // at
  flattenedAssertion.at = applyCombinationToValue(flattenedAssertion.at, combination);
  if (typeof flattenedAssertion.at === "string") {
    flattenedAssertion.at =
      (flattenedAssertion.at as string).indexOf(".") > -1
        ? parseFloat(flattenedAssertion.at)
        : parseInt(flattenedAssertion.at, 10);
  }

  // description
  if (flattenedAssertion.description) {
    flattenedAssertion.description = applyCombinationToValue(
      flattenedAssertion.description,
      combination,
    );
  }

  // scope
  if (flattenedAssertion.scope) {
    flattenedAssertion.scope = applyCombinationToValue(flattenedAssertion.scope, combination);
  }

  // @TODO: support `tag` later, similar to `scope` above

  return flattenedAssertion;
}

export function getFeatureAssertionsFromMatrix(
  aIndex,
  assertionWithMatrix: FeatureAssertion,
): FeatureAssertion[] {
  if (!assertionWithMatrix.matrix) {
    const assertion = { ...assertionWithMatrix };

    let suffix;

    if (assertion.environment) {
      suffix = ` (${assertion.environment})`;
    }

    if (assertion.description) {
      suffix = `: ${assertion.description}`;
    } else {
      suffix = `: at ${assertion.at}%`;
    }

    assertion.description = `Assertion #${aIndex + 1}${suffix}`;

    return [assertion];
  }

  const assertions: FeatureAssertion[] = [];
  const combinations = getMatrixCombinations(assertionWithMatrix.matrix);

  for (let cIndex = 0; cIndex < combinations.length; cIndex++) {
    const combination = combinations[cIndex];
    const assertion = applyCombinationToFeatureAssertion(combination, assertionWithMatrix);

    let suffix;

    if (assertion.environment) {
      suffix = ` (${assertion.environment})`;
    }

    if (assertion.description) {
      suffix = `: ${assertion.description}`;
    } else {
      suffix = `: at ${assertion.at}%`;
    }

    assertion.description = `Assertion #${aIndex + 1}${suffix}`;

    assertions.push(assertion);
  }

  return assertions;
}

/**
 * Segments
 */
export function applyCombinationToSegmentAssertion(
  combination: any,
  assertion: SegmentAssertion,
): SegmentAssertion {
  const flattenedAssertion = { ...assertion };

  // context
  flattenedAssertion.context = Object.keys(flattenedAssertion.context).reduce((acc, key) => {
    acc[key] = applyCombinationToValue(flattenedAssertion.context[key], combination);

    return acc;
  }, {});

  // description
  if (flattenedAssertion.description) {
    flattenedAssertion.description = applyCombinationToValue(
      flattenedAssertion.description,
      combination,
    );
  }

  return flattenedAssertion;
}

export function getSegmentAssertionsFromMatrix(
  aIndex,
  assertionWithMatrix: SegmentAssertion,
): SegmentAssertion[] {
  if (!assertionWithMatrix.matrix) {
    const assertion = { ...assertionWithMatrix };
    assertion.description = `Assertion #${aIndex + 1}${
      assertion.description ? `: ${assertion.description}` : ""
    }`;

    return [assertion];
  }

  const assertions: SegmentAssertion[] = [];
  const combinations = getMatrixCombinations(assertionWithMatrix.matrix);

  for (let cIndex = 0; cIndex < combinations.length; cIndex++) {
    const combination = combinations[cIndex];
    const assertion = applyCombinationToSegmentAssertion(combination, assertionWithMatrix);
    assertion.description = `Assertion #${aIndex + 1}: ${
      assertion.description || `#${aIndex + 1}`
    }`;

    assertions.push(assertion);
  }

  return assertions;
}
