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
                expected: "variable_default",
                actual: "variable_override_rule",
                details: {
                  evaluationType: "variable",
                  evaluationKey: "reason",
                  childIndex: 0,
                },
              },
            ],
          },
        ],
      };

      printTestResult(result, "tests/variables/settings.spec.yml", "/project/");
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("expectedValue");
      expect(output).not.toContain("expectedVariables.settings");
      expect(output).toContain("children[0].expectedEvaluation.reason");
    } finally {
      log.mockRestore();
    }
  });
});
