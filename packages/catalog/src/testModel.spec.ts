import type { TestFeature, TestVariable } from "@featurevisor/types";

import { expandTestAssertions } from "./testModel";

describe("catalog test model", () => {
  it("expands nested values in global variable matrix assertions", () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          environment: "production",
          matrix: { value: ["configured"], enabled: [true] },
          stickyVariables: {
            settings: { nested: ["${{ value }}", { enabled: "${{ enabled }}" }] },
          },
          defaultVariableValue: { fallback: "${{ value }}" },
          expectedEvaluation: {
            variableValue: { nested: ["${{ value }}", "literal-${{ value }}"] },
          },
        },
      ],
    };

    expect(expandTestAssertions(test)[0].assertion).toMatchObject({
      stickyVariables: {
        settings: { nested: ["configured", { enabled: true }] },
      },
      defaultVariableValue: { fallback: "configured" },
      expectedEvaluation: {
        variableValue: { nested: ["configured", "literal-configured"] },
      },
    });
  });

  it("expands nested feature and child values", () => {
    const test: TestFeature = {
      feature: "checkout",
      assertions: [
        {
          environment: "production",
          matrix: { value: ["configured"], enabled: [true] },
          sticky: {
            checkout: { enabled: true, variables: { settings: { value: "${{ value }}" } } },
          },
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
        },
      ],
    };

    expect(expandTestAssertions(test)[0].assertion).toMatchObject({
      sticky: { checkout: { enabled: true, variables: { settings: { value: "configured" } } } },
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
});
