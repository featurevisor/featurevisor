import {
  getFeatureAssertionsFromMatrix,
  getMatrixCombinations,
  getSegmentAssertionsFromMatrix,
  getVariableAssertionsFromMatrix,
} from "./matrix";

describe("core :: tester :: matrix", function () {
  test("leaves feature expectations the author omitted absent", () => {
    const [assertion] = getFeatureAssertionsFromMatrix(0, {
      matrix: { country: ["nl"] },
      at: 50,
      context: { country: "${{ country }}" },
      expectedVariation: "treatment",
    });

    expect(assertion).not.toHaveProperty("expectedToBeEnabled");
    expect(assertion).not.toHaveProperty("defaultVariationValue");
    expect(assertion).not.toHaveProperty("environment");
    expect(assertion).not.toHaveProperty("stickyFeatures");
    expect(assertion).toMatchObject({ context: { country: "nl" }, expectedVariation: "treatment" });
  });

  test("leaves segment settings the author omitted absent", () => {
    const [assertion] = getSegmentAssertionsFromMatrix(0, {
      matrix: { country: ["nl"] },
      context: { country: "${{ country }}" },
      expectedToMatch: true,
    });

    expect(assertion).not.toHaveProperty("environment");
    expect(assertion).not.toHaveProperty("stickyFeatures");
    expect(assertion).toMatchObject({ context: { country: "nl" }, expectedToMatch: true });
  });

  test("substitutes segment dependency evaluation settings", () => {
    const result = getSegmentAssertionsFromMatrix(0, {
      matrix: { environment: ["production"], at: [25], enabled: [true] },
      environment: "${{ environment }}",
      at: "${{ at }}" as never,
      stickyFeatures: { rollout: { enabled: "${{ enabled }}" as never } },
      stickyVariables: { permission: "${{ enabled }}" },
      context: {},
      expectedToMatch: true,
    });
    expect(result[0]).toMatchObject({
      environment: "production",
      at: 25,
      stickyFeatures: { rollout: { enabled: true } },
      stickyVariables: { permission: true },
    });
  });
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

  test("allows absent or explicitly undefined variable and scenario matrices", function () {
    expect(
      getVariableAssertionsFromMatrix(0, {
        environment: "production",
        expectedValue: "configured",
      }),
    ).toHaveLength(1);
    expect(
      getVariableAssertionsFromMatrix(0, {
        environment: "production",
        matrix: undefined,
        checks: [{ variable: "settings", operator: "exists" }],
      } as any),
    ).toHaveLength(1);
  });

  test.each([
    ["null", null],
    ["false", false],
    ["an empty object", {}],
    ["an array", []],
    ["an empty axis", { value: [] }],
    ["a nonarray axis", { value: "configured" }],
  ])("rejects %s as a present matrix before expansion", (_name, matrix) => {
    expect(() =>
      getVariableAssertionsFromMatrix(0, {
        environment: "production",
        matrix,
        checks: [{ variable: "settings", operator: "exists" }],
      } as any),
    ).toThrow("Matrix");
  });

  test("substitutes nested global variable assertion values", function () {
    const assertions = getVariableAssertionsFromMatrix(0, {
      environment: "${{ environment }}",
      matrix: {
        environment: ["production"],
        at: [37.5],
        value: ["configured"],
        enabled: [true],
        variation: ["treatment"],
      },
      at: "${{ at }}" as never,
      stickyFeatures: {
        checkout: {
          enabled: "${{ enabled }}" as unknown as boolean,
          variation: "${{ variation }}",
        },
      },
      stickyVariables: {
        settings: { nested: ["${{ value }}", { enabled: "${{ enabled }}" }] },
      },
      defaultVariableValue: { fallback: "${{ value }}" },
      expectedValue: { nested: "${{ value }}" },
      expectedEvaluation: {
        variableValue: { nested: ["${{ value }}", "literal-${{ value }}"] },
      },
      children: [
        {
          context: { enabled: "${{ enabled }}" },
          stickyVariables: { settings: "child-${{ value }}" },
          expectedValue: "child-${{ value }}",
        },
      ],
    });

    expect(assertions).toHaveLength(1);
    expect(assertions[0].matrix).toBeUndefined();
    expect(assertions[0]).toMatchObject({
      environment: "production",
      at: 37.5,
      stickyFeatures: {
        checkout: { enabled: true, variation: "treatment" },
      },
      stickyVariables: {
        settings: { nested: ["configured", { enabled: true }] },
      },
      defaultVariableValue: { fallback: "configured" },
      expectedValue: { nested: "configured" },
      expectedEvaluation: {
        variableValue: { nested: ["configured", "literal-configured"] },
      },
      children: [
        {
          context: { enabled: true },
          stickyVariables: { settings: "child-configured" },
          expectedValue: "child-configured",
        },
      ],
    });
  });

  test("preserves structured matrix values as complete placeholder values", function () {
    const assertions = getVariableAssertionsFromMatrix(0, {
      environment: "production",
      matrix: {
        value: [["one", "two"], { enabled: true, nested: { count: 2 } }],
      },
      expectedValue: "${{ value }}",
    });

    expect(assertions).toHaveLength(2);
    expect(assertions[0].expectedValue).toEqual(["one", "two"]);
    expect(assertions[1].expectedValue).toEqual({ enabled: true, nested: { count: 2 } });
    expect(assertions.every((assertion) => typeof assertion.matrix === "undefined")).toBe(true);
  });

  test("substitutes scenario checks and child checks without changing native values", function () {
    const assertions = getVariableAssertionsFromMatrix(1, {
      environment: "${{ environment }}",
      target: "${{ target }}",
      matrix: {
        environment: ["production"],
        target: ["web"],
        at: [75],
        variable: ["settings"],
        path: [["items", 0, "limit"]],
        expected: [4],
        enabled: [true],
      },
      at: "${{ at }}" as never,
      description: "${{ variable }} at ${{ at }}",
      context: { enabled: "${{ enabled }}" },
      stickyVariables: { settings: { enabled: "${{ enabled }}" } },
      checks: [
        {
          variable: "${{ variable }}",
          path: "${{ path }}",
          operator: "equals",
          value: "${{ expected }}",
        },
      ],
      children: [
        {
          context: { enabled: "${{ enabled }}" },
          checks: [
            {
              variable: "${{ variable }}",
              operator: "notNull",
            },
          ],
        },
      ],
    } as any);

    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      description: "Assertion #2: settings at 75",
      environment: "production",
      target: "web",
      at: 75,
      context: { enabled: true },
      stickyVariables: { settings: { enabled: true } },
      checks: [
        {
          variable: "settings",
          path: ["items", 0, "limit"],
          operator: "equals",
          value: 4,
        },
      ],
      children: [
        {
          context: { enabled: true },
          checks: [{ variable: "settings", operator: "notNull" }],
        },
      ],
    });
    expect(assertions[0].matrix).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(assertions[0], "expectedValue")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(assertions[0], "expectedEvaluation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(assertions[0], "defaultVariableValue")).toBe(false);
  });

  test("substitutes nested feature and child assertion values", function () {
    const assertions = getFeatureAssertionsFromMatrix(0, {
      environment: "staging",
      at: 50,
      matrix: { value: ["configured"], enabled: [true] },
      stickyFeatures: {
        checkout: { enabled: true, variables: { settings: { value: "${{ value }}" } } },
      },
      defaultVariableValues: { settings: { value: "${{ value }}" } },
      expectedToBeEnabled: "${{ enabled }}" as unknown as boolean,
      expectedEvaluations: {
        variables: { settings: { variableValue: { value: "${{ value }}" } } },
      },
      children: [
        {
          context: { enabled: "${{ enabled }}" },
          expectedVariables: { settings: { value: "${{ value }}" } },
        },
      ],
    });

    expect(assertions[0]).toMatchObject({
      stickyFeatures: {
        checkout: { enabled: true, variables: { settings: { value: "configured" } } },
      },
      defaultVariableValues: { settings: { value: "configured" } },
      expectedToBeEnabled: true,
      expectedEvaluations: {
        variables: { settings: { variableValue: { value: "configured" } } },
      },
      children: [
        {
          context: { enabled: true },
          expectedVariables: { settings: { value: "configured" } },
        },
      ],
    });
  });

  test("preserves native matrix values in segment expectations", function () {
    const assertions = getSegmentAssertionsFromMatrix(0, {
      context: { active: "${{ active }}" },
      expectedToMatch: "${{ active }}" as unknown as boolean,
      matrix: { active: [true] },
    });

    expect(assertions[0]).toMatchObject({ context: { active: true }, expectedToMatch: true });
  });
});
