import type {
  AssertionMatrix,
  FeatureAssertion,
  SegmentAssertion,
  VariableAssertion,
} from "@featurevisor/types";

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

  if (Array.isArray(value)) {
    return value.map((item) => applyCombinationToValue(item, combination));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value).reduce((result, key) => {
      result[key] = applyCombinationToValue(value[key], combination);
      return result;
    }, {});
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
  delete flattenedAssertion.matrix;

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

  // target
  if (flattenedAssertion.target) {
    flattenedAssertion.target = applyCombinationToValue(flattenedAssertion.target, combination);
  }

  flattenedAssertion.sticky = applyCombinationToValue(flattenedAssertion.sticky, combination);
  flattenedAssertion.defaultVariationValue = applyCombinationToValue(
    flattenedAssertion.defaultVariationValue,
    combination,
  );
  flattenedAssertion.defaultVariableValues = applyCombinationToValue(
    flattenedAssertion.defaultVariableValues,
    combination,
  );
  flattenedAssertion.expectedToBeEnabled = applyCombinationToValue(
    flattenedAssertion.expectedToBeEnabled,
    combination,
  );
  flattenedAssertion.expectedVariation = applyCombinationToValue(
    flattenedAssertion.expectedVariation,
    combination,
  );
  flattenedAssertion.expectedVariables = applyCombinationToValue(
    flattenedAssertion.expectedVariables,
    combination,
  );
  flattenedAssertion.expectedEvaluations = applyCombinationToValue(
    flattenedAssertion.expectedEvaluations,
    combination,
  );
  flattenedAssertion.children = applyCombinationToValue(flattenedAssertion.children, combination);

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
  delete flattenedAssertion.matrix;

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

  flattenedAssertion.expectedToMatch = applyCombinationToValue(
    flattenedAssertion.expectedToMatch,
    combination,
  );

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

export function getVariableAssertionsFromMatrix(
  aIndex: number,
  assertionWithMatrix: VariableAssertion,
): VariableAssertion[] {
  const combinations = assertionWithMatrix.matrix
    ? getMatrixCombinations(assertionWithMatrix.matrix)
    : [{}];

  return combinations.map((combination) => {
    const assertion = { ...assertionWithMatrix };
    delete assertion.matrix;
    assertion.environment = applyCombinationToValue(assertion.environment, combination);
    assertion.context = Object.keys(assertion.context || {}).reduce((acc, key) => {
      acc[key] = applyCombinationToValue(assertion.context?.[key], combination);
      return acc;
    }, {});
    if (assertion.target) {
      assertion.target = applyCombinationToValue(assertion.target, combination);
    }
    if (assertion.description) {
      assertion.description = applyCombinationToValue(assertion.description, combination);
    }
    const at = applyCombinationToValue(assertion.at, combination);
    assertion.at =
      typeof at === "string" ? (at.indexOf(".") > -1 ? parseFloat(at) : parseInt(at, 10)) : at;
    assertion.expectedValue = applyCombinationToValue(assertion.expectedValue, combination);
    assertion.stickyFeatures = applyCombinationToValue(assertion.stickyFeatures, combination);
    assertion.stickyVariables = applyCombinationToValue(assertion.stickyVariables, combination);
    assertion.defaultVariableValue = applyCombinationToValue(
      assertion.defaultVariableValue,
      combination,
    );
    assertion.expectedEvaluation = applyCombinationToValue(
      assertion.expectedEvaluation,
      combination,
    );
    assertion.children = applyCombinationToValue(assertion.children, combination);
    assertion.description = `Assertion #${aIndex + 1}${
      assertion.description ? `: ${assertion.description}` : ""
    }`;
    return assertion;
  });
}
