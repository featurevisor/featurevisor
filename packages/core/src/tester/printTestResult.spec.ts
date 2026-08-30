import type { TestResult } from "@featurevisor/types";

import { printTestResult } from "./printTestResult";

describe("core: print test result", () => {
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
      expect(output).toContain("children[0].expectedEvaluation.variableValue");
      expect(output).toContain('{"nested":["expected"]}');
      expect(output).not.toContain("[object Object]");
      expect(output).toContain("children[1].expectedValue");
      expect(output).toContain("expected: null");
    } finally {
      log.mockRestore();
    }
  });
});
