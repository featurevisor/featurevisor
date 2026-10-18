import type {
  AssertionMatrix,
  FeatureAssertion,
  SegmentAssertion,
  VariableAssertion,
  ScenarioAssertion,
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
 * Substitutes placeholders in the fields an assertion actually has. Absent
 * fields stay absent, so an expectation the author left out is never
 * created as `undefined` and then compared.
 */
function applyCombinationToFields<T extends object>(
  assertion: T,
  fields: readonly (keyof T)[],
  combination: any,
) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(assertion, field)) {
      assertion[field] = applyCombinationToValue(assertion[field], combination);
    }
  }
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

  applyCombinationToFields(
    flattenedAssertion,
    [
      "environment",
      "target",
      "stickyFeatures",
      "stickyVariables",
      "defaultVariationValue",
      "defaultVariableValues",
      "expectedToBeEnabled",
      "expectedVariation",
      "expectedVariables",
      "expectedEvaluations",
      "children",
    ],
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

  applyCombinationToFields(
    flattenedAssertion,
    ["environment", "target", "at", "stickyFeatures", "stickyVariables"],
    combination,
  );
  if (typeof flattenedAssertion.at === "string")
    flattenedAssertion.at = Number(flattenedAssertion.at);

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

export function getVariableAssertionsFromMatrix<T extends VariableAssertion | ScenarioAssertion>(
  aIndex: number,
  assertionWithMatrix: T,
  kind: "assertion" | "scenario" = "assertion",
): T[] {
  const matrixValue = (assertionWithMatrix as { matrix?: unknown }).matrix;
  const hasMatrix =
    Object.prototype.hasOwnProperty.call(assertionWithMatrix, "matrix") &&
    matrixValue !== undefined;
  if (hasMatrix) {
    if (!matrixValue || typeof matrixValue !== "object" || Array.isArray(matrixValue)) {
      throw new Error("Matrix must be an object");
    }
    const keys = Object.keys(matrixValue);
    if (!keys.length) throw new Error("Matrix must contain at least one key");
    keys.forEach((key) => {
      const values = (matrixValue as Record<string, unknown>)[key];
      if (!Array.isArray(values)) throw new Error(`Matrix values for "${key}" must be arrays`);
      if (!values.length) throw new Error(`Matrix values for "${key}" cannot be empty`);
    });
  }
  const combinations = hasMatrix ? getMatrixCombinations(matrixValue as AssertionMatrix) : [{}];

  return combinations.map((combination, caseIndex) => {
    const assertion = applyCombinationToValue({ ...assertionWithMatrix }, combination) as T;
    delete assertion.matrix;
    assertion.context = assertion.context || {};
    const at = assertion.at as number | string | undefined;
    assertion.at =
      typeof at === "string" ? (at.indexOf(".") > -1 ? parseFloat(at) : parseInt(at, 10)) : at;
    if (kind === "scenario") {
      assertion.description = hasMatrix
        ? `Case ${caseIndex + 1} of ${combinations.length}${assertion.description ? `: ${assertion.description}` : ""}`
        : assertion.description || "Checks";
    } else {
      assertion.description = `Assertion #${aIndex + 1}${
        assertion.description ? `: ${assertion.description}` : ""
      }`;
    }
    return assertion;
  });
}
