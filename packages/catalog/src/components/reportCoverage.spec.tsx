import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Test } from "@featurevisor/types";
import type { TestReportResult } from "../types";
import { EntityTests } from "./tests";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const test: Test = {
  key: "limit",
  variable: "limit",
  assertions: [
    {
      key: "named",
      matrix: { region: ["gb", "nl", "de"], tier: [0, 1, 2, 3] },
      expectedValue: 10,
    },
  ],
};

function report(
  count: number,
  verification: TestReportResult["verification"] = "current",
): TestReportResult {
  return {
    verification,
    passed: true,
    cases: Array.from({ length: count }, (_, index) => ({
      id: JSON.stringify(["dev", "variable", "limit", "named", index]),
      passed: true,
      errors: [],
    })),
  };
}

function render(saved?: TestReportResult, reportSupplied = false, spec = test, setKey = "dev") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <EntityTests
        tests={[{ ...spec, ...(saved ? { report: saved } : {}) }]}
        setKey={setKey}
        reportSupplied={reportSupplied}
      />
    </MemoryRouter>,
  );
}

describe("Catalog partial report presentation", () => {
  it("distinguishes selected passing cases from a whole spec pass", () => {
    const html = render(report(3));
    expect(html).toContain("3 of 12 cases in report. All reported cases passed");
    expect(html.match(/Not in supplied report/g)).toHaveLength(9);
    expect(html.match(/✓ Passed/g)).toHaveLength(3);
  });

  it("shows a whole spec result only when every exact case was executed", () => {
    const html = render(report(12));
    // The badge already says it, so the status sentence is left out.
    expect(html).not.toContain("cases passed");
    expect(html).not.toContain("Not in");
    expect(html.match(/✓ Passed/g)).toHaveLength(13);
  });

  it.each([3, 12])("shows failures independently of completeness (%i rows)", (count) => {
    const saved = report(count);
    saved.passed = false;
    saved.cases[0].passed = false;
    saved.cases[0].errors = [{ message: "Wrong value" }];
    const html = render(saved);
    expect(html).toContain(
      count === 12 ? "11 passed, 1 failed" : "3 of 12 cases in report. 1 failed",
    );
    expect(html).toContain("Wrong value");
    expect(html.match(/✗ Failed/g)).toHaveLength(count === 12 ? 2 : 1);
  });

  it("does not imply cases were skipped when no report was supplied", () => {
    const html = render();
    expect(html).not.toContain("Not in");
    expect(html).not.toContain("in report");
    expect(html).not.toContain("Passed");
  });

  it("marks every case in an entirely omitted spec when a report was supplied", () => {
    const html = render(undefined, true);
    expect(html.match(/Not in supplied report/g)).toHaveLength(13);
    expect(html).not.toContain("Passed");
  });

  it("marks an empty spec report without claiming a passing execution", () => {
    const html = render(report(0));
    expect(html.match(/Not in supplied report/g)).toHaveLength(13);
    expect(html).not.toContain("✓ Passed");
  });

  it("does not confuse Sets even when all other case fields match", () => {
    const html = render(report(12), false, test, "production");
    expect(html).toContain("Not in supplied report. 12 unmatched case results");
    expect(html).not.toContain("✓ Passed");
  });

  it.each(["stale", "unverified", undefined] as const)(
    "keeps %s matching and missing cases historical",
    (verification) => {
      const saved = report(3);
      saved.verification = verification;
      const html = render(saved);
      expect(html).toContain("3 of 12 cases found in an earlier report");
      expect(html).toContain(
        verification === "stale"
          ? "Inputs changed since that report"
          : "Report inputs could not be verified",
      );
      expect(html).toContain(verification === "stale" ? "stale inputs" : "unverified inputs");
      expect(html.match(/Not in earlier report/g)).toHaveLength(9);
      expect(html).not.toContain("cases in report");
      expect(html).not.toContain("All reported cases passed");
      expect(html).not.toContain("✓ Passed");
    },
  );

  it("keeps a historical failure distinct from a current failure", () => {
    const saved = report(12, "stale");
    saved.passed = false;
    saved.cases[0].passed = false;
    const html = render(saved);
    expect(html).toContain("Historical failure (stale inputs)");
    expect(html).not.toContain("✗ Failed");
    expect(html).not.toContain("cases in report");
  });

  it.each(["stale", "unverified"] as const)(
    "does not turn repeated %s cases into complete current execution",
    (verification) => {
      const saved = report(3, verification);
      saved.cases = [...saved.cases, ...saved.cases, ...saved.cases, ...saved.cases];
      const html = render(saved);
      expect(html).toContain("3 of 12 cases found in an earlier report");
      expect(html).toContain("9 duplicate case results. Completeness cannot be confirmed");
      expect(html.match(/Not in earlier report/g)).toHaveLength(9);
      expect(html).not.toContain("cases in report");
      expect(html).not.toContain("✓ Passed");
    },
  );

  it("flags duplicates and extra identities while preserving the raw report outcome", () => {
    const saved = report(12);
    saved.cases.push({ ...saved.cases[0], passed: false });
    saved.cases.push({ id: "extra", passed: true, errors: [] });
    const before = JSON.stringify(saved);
    const html = render(saved);
    expect(html).toContain("11 passed, 1 failed. 1 duplicate case result. 1 unmatched case result");
    expect(html).toContain("Completeness cannot be confirmed. Reported result: passed");
    expect(html.match(/✓ Passed/g)).toHaveLength(11);
    expect(html.match(/✗ Failed/g)).toHaveLength(1);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it.each(["current", "stale", "unverified"] as const)(
    "shows all duplicate failure details in either order for %s reports",
    (verification) => {
      const saved = report(12, verification);
      saved.passed = false;
      saved.cases.push(
        { ...saved.cases[0], passed: false, errors: [{ message: "First duplicate failure" }] },
        { ...saved.cases[0], passed: false, errors: [{ message: "Second duplicate failure" }] },
      );
      for (const cases of [saved.cases, [...saved.cases].reverse()]) {
        const html = render({ ...saved, cases });
        expect(html).toContain("2 duplicate case results. Completeness cannot be confirmed");
        expect(html).toContain("Reported result: failed");
        expect(html).toContain("First duplicate failure");
        expect(html).toContain("Second duplicate failure");
        if (verification === "current") {
          expect(html).toContain("11 passed, 1 failed");
          expect(html.match(/✓ Passed/g)).toHaveLength(11);
          expect(html.match(/✗ Failed/g)).toHaveLength(1);
        } else {
          expect(html).toContain(`Historical failure (${verification} inputs)`);
          expect(html).not.toContain("✓ Passed");
          expect(html).not.toContain("✗ Failed");
          expect(html).not.toContain("cases in report");
        }
      }
    },
  );

  it("retains a raw failure even when the selected case rows pass", () => {
    const saved = report(3);
    saved.passed = false;
    expect(render(saved)).toContain("All reported cases passed. Reported result: failed");
  });

  it("counts scenario cases, not their nested checks", () => {
    const scenario: Test = {
      key: "readiness",
      scenario: "readiness",
      assertions: [
        {
          key: "ready",
          checks: [
            { feature: "flag", enabled: true },
            { variable: "limit", operator: "equals", value: 10 },
          ],
        },
        { checks: [{ feature: "flag", enabled: true }] },
      ],
    };
    const saved = report(1);
    saved.cases[0].id = JSON.stringify(["dev", "scenario", "readiness", "ready", null]);
    const html = render(saved, false, scenario);
    expect(html).toContain("1 of 2 cases in report. All reported cases passed");
    expect(html.match(/Not in supplied report/g)).toHaveLength(1);
  });
});
