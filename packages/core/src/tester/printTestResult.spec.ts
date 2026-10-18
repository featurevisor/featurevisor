import type { TestResult } from "@featurevisor/types";

import { printTestResult } from "./printTestResult";

describe("core: print test result", () => {
  it("shows scenario checks with resolved operands, group paths and child positions", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printTestResult(
        {
          type: "scenario",
          key: "capacity",
          passed: false,
          duration: 1,
          assertions: [
            {
              description: "bounds",
              passed: false,
              duration: 1,
              errors: [
                {
                  type: "check",
                  expected: true,
                  actual: false,
                  details: {
                    childIndex: 0,
                    checkIndex: 1,
                    evaluated: [
                      {
                        path: [1, "and", 0],
                        reference: { variable: "limit" },
                        actual: 30,
                        operator: "lessThanOrEquals",
                        compareTo: { variable: "settings", path: "maximum" },
                        expected: 20,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        "tests/capacity.spec.yml",
        "/project/",
      );
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain('scenario "capacity"');
      expect(output).toContain("Child 1, check 2: did not match");
      expect(output).toContain("global variable limit = 30");
      expect(output).toContain('lessThanOrEquals global variable settings at "maximum": 20');
      expect(output).toContain("2.and.1");
    } finally {
      log.mockRestore();
    }
  });
  it("prints feature and segment expectations without calling them variables", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printTestResult(
        {
          type: "scenario",
          key: "checkout",
          passed: false,
          duration: 0,
          assertions: [
            {
              description: "child checkout",
              passed: false,
              duration: 0,
              errors: [
                {
                  type: "check",
                  expected: true,
                  actual: false,
                  details: {
                    childIndex: 0,
                    checkIndex: 1,
                    evaluated: [
                      {
                        path: [1, "or", 0],
                        reference: { feature: "checkout" },
                        property: "enabled",
                        expected: true,
                        actual: false,
                      },
                      {
                        path: [1, "or", 0],
                        reference: { feature: "checkout" },
                        property: "variation",
                        expected: "treatment",
                        actual: null,
                      },
                      {
                        path: [1, "or", 1],
                        reference: { segment: "premium" },
                        property: "matches",
                        expected: true,
                        actual: false,
                      },
                      {
                        path: [1, "or", 2],
                        reference: { segment: "excluded" },
                        property: "matches",
                        expected: false,
                        actual: true,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        "tests/checkout.yml",
        "/project/",
      );
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("Child 1, check 2");
      expect(output).toContain("feature checkout, enabled: expected true, received false (2.or.1)");
      expect(output).toContain(
        "feature checkout, variation: expected treatment, received null (2.or.1)",
      );
      expect(output).not.toContain("variable undefined");
      expect(output).toContain(
        "segment premium: expected matches, received does not match (2.or.2)",
      );
      expect(output).toContain(
        "segment excluded: expected does not match, received matches (2.or.3)",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("uses global variable assertion field names in failures", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const result: TestResult = {
        type: "variable",
        key: "settings",
        passed: false,
        duration: 1,
        assertions: [
          {
            description: "global variable",
            passed: false,
            duration: 1,
            errors: [
              {
                type: "variable",
                expected: "expected",
                actual: "actual",
                details: { variableKey: "settings" },
              },
              {
                type: "evaluation",
                expected: { nested: ["expected"] },
                actual: { nested: ["actual"] },
                details: {
                  evaluationType: "variable",
                  evaluationKey: "variableValue",
                  childIndex: 0,
                },
              },
              {
                type: "variable",
                expected: null,
                actual: "actual",
                details: { variableKey: "settings", childIndex: 1 },
              },
            ],
          },
        ],
      };

      printTestResult(result, "tests/variables/settings.spec.yml", "/project/");
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("expectedValue");
      expect(output).not.toContain("expectedVariables.settings");
      expect(output).toContain("Child 1, expectedEvaluation.variableValue");
      expect(output).toContain('{"nested":["expected"]}');
      expect(output).not.toContain("[object Object]");
      expect(output).toContain("Child 2, expectedValue");
      expect(output).toContain("expected: null");
    } finally {
      log.mockRestore();
    }
  });
});
