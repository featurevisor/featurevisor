import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TestReportSummary } from "./testReport";
import { EntityTests } from "./tests";
import type { TestReportResult } from "../types";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("Catalog report provenance presentation", () => {
  it("mentions partial coverage only when the report leaves cases out", () => {
    const render = (cases: { executed: number; total: number }) =>
      renderToStaticMarkup(
        <TestReportSummary
          report={{
            runner: "javascript",
            passed: true,
            verification: "current",
            summary: { entityAssertions: { passed: 1, failed: 0 } },
            hasCoverage: false,
            cases,
          }}
        />,
      );
    expect(render({ executed: 315, total: 320 })).toContain("This report covers 315 of 320 cases.");
    expect(render({ executed: 320, total: 320 })).not.toContain("This report covers");
  });

  it.each([undefined, "unverified", "stale", "current"] as const)(
    "labels %s results at summary, spec and case level",
    (verification) => {
      const summary = renderToStaticMarkup(
        <TestReportSummary
          report={{
            runner: "javascript",
            passed: true,
            verification,
            summary: { entityAssertions: { passed: 1, failed: 0 } },
            hasCoverage: false,
          }}
        />,
      );
      const report: TestReportResult = {
        passed: true,
        verification,
        cases: [
          {
            id: JSON.stringify([null, "variable", "limit", "named", null]),
            assertionKey: "named",
            passed: true,
            errors: [],
          },
        ],
      };
      const tests = renderToStaticMarkup(
        <MemoryRouter>
          <EntityTests
            tests={[
              {
                key: "limit",
                variable: "limit",
                assertions: [{ key: "named", expectedValue: 10 }],
                report,
              } as any,
            ]}
          />
        </MemoryRouter>,
      );
      if (verification === "current") {
        expect(summary).toContain("Reported cases passed");
        expect(summary).not.toContain("This report covers");
        expect(tests.match(/✓ Passed/g)).toHaveLength(2);
        expect(summary).toContain("bg-emerald-500");
      } else {
        const reason = verification === "stale" ? "stale inputs" : "unverified inputs";
        expect(summary).toContain(`Historical report (${reason})`);
        expect(tests.match(new RegExp(`Historical pass \\(${reason}\\)`, "g"))).toHaveLength(2);
        expect(summary).not.toContain("bg-emerald-500");
        expect(tests).not.toContain("✓ Passed");
      }
    },
  );
});
