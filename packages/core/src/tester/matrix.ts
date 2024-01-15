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
