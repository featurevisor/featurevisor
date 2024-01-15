import { AssertionMatrix } from "@featurevisor/types";

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

function getFeatureAssertionsFromMatrix(
  aIndex,
  assertionWithMatrix: FeatureAssertion,
): FeatureAssertion[] {
  if (!assertionWithMatrix.matrix) {
    const assertion = { ...assertionWithMatrix };
    assertion.description = `  Assertion #${aIndex + 1}: (${assertion.environment}) ${
      assertion.description || `at ${assertion.at}%`
    }`;

    return [assertion];
  }

  const assertions = [];
  const combinations = getMatrixCombinations(assertionWithMatrix.matrix);

  for (let cIndex = 0; cIndex < combinations.length; cIndex++) {
    const combination = combinations[cIndex];
    const assertion = { ...assertionWithMatrix };
    assertion.context = { ...assertion.context, ...combination };
    assertion.description = `  Assertion #${aIndex + 1}.${cIndex + 1}: (${assertion.environment}) ${
      assertion.description || `at ${assertion.at}%`
    }`;

    assertions.push(assertion);
  }

  return assertions;
}
