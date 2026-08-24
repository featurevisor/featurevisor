import type { DatafileContent, TestVariable } from "@featurevisor/types";

import { testVariable } from "./testVariable";

function datafile(value: unknown): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "test",
    segments: {},
    features: {},
    variables: {
      settings: {
        type: "object",
        defaultValue: value as any,
      },
    },
  };
}

describe("core: test top-level variable", () => {
  it("compares nested values, evaluation fields, sticky values, and target datafiles", async () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          description: "base",
          environment: "production",
          expectedValue: { items: ["one", { enabled: true }] },
          expectedEvaluation: { reason: "default_value" },
        },
        {
          description: "sticky",
          environment: "production",
          stickyVariables: { settings: { items: ["sticky"] } },
          expectedValue: { items: ["sticky"] },
          expectedEvaluation: { reason: "sticky" },
        },
        {
          description: "target",
          environment: "production",
          target: "web",
          expectedValue: { target: true },
        },
      ],
    };
    const result = await testVariable(
      test,
      { quiet: true } as any,
      new Map([
        ["production", datafile({ items: ["one", { enabled: true }] })],
        ["production-target-web", datafile({ target: true })],
      ]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
  });

  it("reports value and evaluation mismatches", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedValue: { expected: true },
            expectedEvaluation: { reason: "override_matched" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", datafile({ actual: true })]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({ type: "variable" }),
      expect.objectContaining({ type: "evaluation" }),
    ]);
  });
});
