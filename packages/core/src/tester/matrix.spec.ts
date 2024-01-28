import { getMatrixCombinations } from "./matrix";

describe("core :: tester :: matrix", function () {
  test("should empty array when no keys are available", function () {
    const matrix = {};
    const combinations = getMatrixCombinations(matrix);

    expect(combinations).toEqual([]);
  });

  test("should get combinations from matrix with two keys", function () {
    const matrix = {
      a: [1, 2],
      b: ["x", "y"],
    };
    const combinations = getMatrixCombinations(matrix);

    expect(combinations).toEqual([
      { a: 1, b: "x" },
      { a: 1, b: "y" },

      { a: 2, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  test("should get combinations from matrix with three keys", function () {
    const matrix = {
      a: [1, 2],
      b: ["x", "y"],
      c: [true, false],
    };
    const combinations = getMatrixCombinations(matrix);

    expect(combinations).toEqual([
      { a: 1, b: "x", c: true },
      { a: 1, b: "x", c: false },

      { a: 1, b: "y", c: true },
      { a: 1, b: "y", c: false },

      { a: 2, b: "x", c: true },
      { a: 2, b: "x", c: false },

      { a: 2, b: "y", c: true },
      { a: 2, b: "y", c: false },
    ]);
  });
});
