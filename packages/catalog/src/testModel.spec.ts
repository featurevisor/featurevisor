import type { TestFeature, TestScenario, TestVariable } from "@featurevisor/types";

import {
  expandTestAssertions,
  findTestReportCase,
  getTestReportCoverage,
  getTestReportStatus,
} from "./testModel";
import type { TestReportResult } from "./types";

describe("report completeness", () => {
  const test: TestVariable = {
    key: "limit",
    variable: "limit",
    assertions: [
      { key: "0", matrix: { country: ["gb", "nl"], tier: ["free", "paid"] }, expectedValue: 10 },
      { expectedValue: 20 },
    ],
  };
  const ids = [
    ...[0, 1, 2, 3].map((index) => ["dev", "variable", "limit", "0", index]),
    ["dev", "variable", "limit", 1, null],
  ];
  const report = (identities = ids): TestReportResult => ({
    verification: "current",
    passed: true,
    cases: identities.map((id) => ({ id: JSON.stringify(id), passed: true, errors: [] })),
  });

  it("requires all expanded identities, including keyed matrices and positional assertions", () => {
    expect(getTestReportCoverage(report(ids.slice(0, 2)), test, "dev")).toMatchObject({
      total: 5,
      executed: 2,
      complete: false,
      passed: true,
    });
    expect(getTestReportCoverage(report(), test, "dev")).toMatchObject({
      total: 5,
      executed: 5,
      complete: true,
      passed: true,
    });
    expect(getTestReportCoverage(report([]), test, "dev")).toMatchObject({
      total: 5,
      executed: 0,
      complete: false,
    });
  });

  it.each([
    ["prod", "variable", "limit", "0", 3],
    [null, "variable", "limit", "0", 3],
    ["dev", "feature", "limit", "0", 3],
    ["dev", "variable", "other", "0", 3],
    ["dev", "variable", "limit", 0, 3],
    ["dev", "variable", "limit", "0", null],
    ["dev", "variable", "limit", "0", 4],
  ])("does not use equal row counts to fill a mismatched identity %j", (...identity) => {
    expect(
      getTestReportCoverage(report([...ids.slice(0, 3), identity, ids[4]]), test, "dev"),
    ).toMatchObject({ total: 5, executed: 4, complete: false, unmatched: 1 });
  });

  it("does not fill missing cases with duplicate rows or discard their failure", () => {
    const saved = report([...ids.slice(0, 4), ids[0]]);
    saved.cases[4].passed = false;
    const before = JSON.stringify(saved);
    expect(getTestReportCoverage(saved, test, "dev")).toMatchObject({
      executed: 4,
      complete: false,
      duplicates: 1,
      passed: false,
    });
    expect(findTestReportCase(saved, test, expandTestAssertions(test)[0], "dev")).toMatchObject({
      id: saved.cases[0].id,
      passed: false,
    });
    expect(JSON.stringify(saved)).toBe(before);
  });

  it.each(["current", "stale", "unverified"] as const)(
    "preserves all duplicate failures in either order with %s provenance",
    (verification) => {
      const saved = report();
      saved.verification = verification;
      saved.passed = false;
      saved.cases.push(
        { ...saved.cases[0], passed: false, errors: [{ message: "First failure" }] },
        { ...saved.cases[0], passed: false, errors: [{ message: "Second failure" }] },
      );
      for (const cases of [saved.cases, [...saved.cases].reverse()]) {
        const ordered = { ...saved, cases };
        const before = JSON.stringify(ordered);
        expect(getTestReportCoverage(ordered, test, "dev")).toMatchObject({
          total: 5,
          executed: 5,
          duplicates: 2,
          unmatched: 0,
          complete: false,
          passed: false,
        });
        const result = findTestReportCase(ordered, test, expandTestAssertions(test)[0], "dev");
        expect(result?.passed).toBe(false);
        expect(result?.errors).toHaveLength(2);
        expect(result?.errors).toEqual(
          expect.arrayContaining([{ message: "First failure" }, { message: "Second failure" }]),
        );
        const status = getTestReportStatus(ordered, test, "dev");
        expect(status).toContain("2 duplicate case results. Completeness cannot be confirmed");
        expect(status).toContain("Reported result: failed");
        expect(JSON.stringify(ordered)).toBe(before);
      }
    },
  );

  it("flags extra or duplicate rows even when all expected identities are present", () => {
    expect(getTestReportCoverage(report([...ids, ids[0]]), test, "dev")).toMatchObject({
      executed: 5,
      complete: false,
      duplicates: 1,
    });
    const saved = report();
    saved.cases.push({ passed: true, errors: [] });
    expect(getTestReportCoverage(saved, test, "dev")).toMatchObject({
      executed: 5,
      complete: false,
      unmatched: 1,
    });
  });

  it("separates case failures and completeness from the raw report result", () => {
    const saved = report();
    saved.cases[2].passed = false;
    expect(getTestReportCoverage(saved, test, "dev")).toMatchObject({
      complete: true,
      passed: false,
    });
    expect(saved.passed).toBe(true);
  });
});

describe("catalog test model", () => {
  it("does not confuse numeric keys, assertion indices, Sets, test kinds or matrix cases", () => {
    const test: TestVariable = {
      key: "limit",
      variable: "limit",
      assertions: [
        { key: "0", matrix: { country: ["gb", "nl"] }, expectedValue: 10 },
        { expectedValue: 10 },
      ],
    };
    const expanded = expandTestAssertions(test);
    const ids = [
      ["dev", "variable", "limit", 0, 0],
      ["prod", "variable", "limit", "0", 0],
      ["dev", "feature", "limit", "0", 0],
      ["dev", "variable", "other", "0", 0],
      ["dev", "variable", "limit", "0", 1],
      ["dev", "variable", "limit", "0", 0],
      ["dev", "variable", "limit", 1, null],
    ];
    const report = {
      passed: true,
      cases: ids.map((id, index) => ({
        id: JSON.stringify(id),
        passed: index >= 4,
        errors: index < 4 ? [{ message: "Unrelated failure" }] : [],
      })),
    };
    expect(findTestReportCase(report, test, expanded[0], "dev")).toBe(report.cases[5]);
    expect(findTestReportCase(report, test, expanded[1], "dev")).toBe(report.cases[4]);
    expect(findTestReportCase(report, test, expanded[2], "dev")).toBe(report.cases[6]);
    expect(findTestReportCase(report, test, expanded[0])).toBeUndefined();
  });
  it("expands nested values in global variable matrix assertions", () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          environment: "production",
          matrix: { at: [37.5], value: ["configured"], enabled: [true] },
          at: "${{ at }}" as never,
          stickyFeatures: {
            checkout: { enabled: "${{ enabled }}" as unknown as boolean },
          },
          stickyVariables: {
            settings: { nested: ["${{ value }}", { enabled: "${{ enabled }}" }] },
          },
          defaultVariableValue: { fallback: "${{ value }}" },
          expectedEvaluation: {
            variableValue: { nested: ["${{ value }}", "literal-${{ value }}"] },
          },
          children: [
            {
              context: { enabled: "${{ enabled }}" },
              expectedValue: { nested: "${{ value }}" },
            },
          ],
        },
      ],
    };

    expect(expandTestAssertions(test)[0].assertion).toMatchObject({
      at: 37.5,
      stickyFeatures: {
        checkout: { enabled: true },
      },
      stickyVariables: {
        settings: { nested: ["configured", { enabled: true }] },
      },
      defaultVariableValue: { fallback: "configured" },
      expectedEvaluation: {
        variableValue: { nested: ["configured", "literal-configured"] },
      },
      children: [
        {
          context: { enabled: true },
          expectedValue: { nested: "configured" },
        },
      ],
    });
  });

  it("expands nested feature and child values", () => {
    const test: TestFeature = {
      feature: "checkout",
      assertions: [
        {
          environment: "production",
          matrix: { value: ["configured"], enabled: [true] },
          at: 0,
          stickyFeatures: {
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
      stickyFeatures: {
        checkout: { enabled: true, variables: { settings: { value: "configured" } } },
      },
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

  it("expands scenario selectors, checks, and child checks", () => {
    const test: TestScenario = {
      scenario: "regional checkout readiness",
      assertions: [
        {
          matrix: {
            environment: ["production"],
            variable: ["supportEmail"],
            expected: ["nl@example.com"],
            sticky: ["sticky@example.com"],
          },
          environment: "${{ environment }}",
          target: "${{ environment }}-web",
          stickyVariables: { supportEmail: "${{ sticky }}" },
          checks: [
            {
              variable: "${{ variable }}",
              operator: "equals",
              value: "${{ expected }}",
            },
          ],
          children: [
            {
              context: { expected: "${{ expected }}" },
              checks: [
                {
                  variable: "${{ variable }}",
                  operator: "equals",
                  value: "${{ sticky }}",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(expandTestAssertions(test)[0].assertion).toMatchObject({
      environment: "production",
      target: "production-web",
      stickyVariables: { supportEmail: "sticky@example.com" },
      checks: [
        {
          variable: "supportEmail",
          operator: "equals",
          value: "nl@example.com",
        },
      ],
      children: [
        {
          context: { expected: "nl@example.com" },
          checks: [
            {
              variable: "supportEmail",
              operator: "equals",
              value: "sticky@example.com",
            },
          ],
        },
      ],
    });
  });
});
