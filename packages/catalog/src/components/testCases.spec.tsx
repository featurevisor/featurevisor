import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Test, TestCheck } from "@featurevisor/types";

import type { TestReportResult } from "../types";
import { describeCheck } from "./checkSentence";
import { describeCheckCount } from "./testNavigation";
import { EntityTests, getAssertionSummary } from "./tests";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const scenario = (buckets: number[]): Test => ({
  key: "allocation",
  scenario: "allocation",
  assertions: [
    {
      key: "exclusive",
      matrix: { bucket: buckets },
      environment: "staging",
      at: "${{ bucket }}" as unknown as number,
      checks: [
        {
          key: "one-path",
          or: [
            {
              and: [
                { feature: "allocation", variation: "bar" },
                { feature: "bar", enabled: true },
              ],
            },
            { not: [{ feature: "qux", enabled: true }] },
          ],
        },
        { variable: "limit", operator: "greaterThan", value: 3 },
      ],
    },
  ],
});

function render(test: Test, route = "/tests/allocation") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <EntityTests tests={[test]} />
    </MemoryRouter>,
  );
}

function report(failedCase?: number): TestReportResult {
  return {
    verification: "current",
    passed: failedCase === undefined,
    cases: [0, 1, 2, 3].map((index) => ({
      id: JSON.stringify([null, "scenario", "allocation", "exclusive", index]),
      passed: index !== failedCase,
      errors: index === failedCase ? [{ message: "Wrong variation" }] : [],
    })),
  };
}

const expanded = (html: string) => (html.match(/aria-expanded="true"/g) || []).length;
const collapsed = (html: string) => (html.match(/aria-expanded="false"/g) || []).length;

describe("Catalog test cases", () => {
  it("keeps small specs open", () => {
    const html = render(scenario([0, 50, 100]));
    expect(expanded(html)).toBe(3);
    expect(html).toContain("Collapse all");
  });

  it("collapses larger specs to one line per case without repeating matrix values", () => {
    const html = render(scenario([0, 20, 40, 60]));
    expect(collapsed(html)).toBe(4);
    expect(html).toContain("Expand all");
    // Environment is authored, the bucket comes from the matrix and shows as a badge.
    expect(html).toContain("in staging · 2 checks");
    expect(html).not.toContain("at 20%");
    expect(html).not.toContain("All of these hold");
  });

  it("opens failed cases and the case a permalink points to", () => {
    const failed = render({ ...scenario([0, 20, 40, 60]), report: report(2) } as unknown as Test);
    expect(expanded(failed)).toBe(1);
    expect(failed).toContain("Wrong variation");

    const linked = render(
      scenario([0, 20, 40, 60]),
      `/tests/allocation?assertion=${encodeURIComponent('allocation:exclusive.3:check:[["key","one-path"]]')}`,
    );
    expect(expanded(linked)).toBe(1);
    expect(linked).toContain("At least one of these holds");
  });

  it("writes checks as a linked outline", () => {
    const html = render(scenario([0]));
    for (const text of [
      "At least one of these holds",
      "All of these hold",
      "This does not hold",
      "has variation",
      "is enabled",
      "greaterThan",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/features/allocation"');
    expect(html).toContain('href="/variables/limit"');
    // No nested key and value tables.
    expect(html).not.toContain("<dt");
  });

  it("describes every kind of check in plain words", () => {
    const checks: Array<[TestCheck, string]> = [
      [{ feature: "foo", enabled: true, variation: "bar" }, 'foo is enabled with variation "bar"'],
      [{ feature: "foo", variation: null }, "foo has no variation"],
      [{ segment: "netherlands", matches: false }, "context does not match segment netherlands"],
      [
        { feature: "foo", variable: "config", path: ["items", 0], operator: "equals", value: "" },
        'foo › config.items[0] equals ""',
      ],
      [
        { variable: "max", operator: "greaterThan", compareTo: { variable: "min" } },
        "max greaterThan min",
      ],
      [{ operator: "notEmpty" } as TestCheck, "limit notEmpty"],
      [
        { variable: "config", path: ["a.b", 0], operator: "matches", value: "^x", regexFlags: "i" },
        'config["a.b"][0] matches "^x" (flags i)',
      ],
      [
        {
          not: [
            { feature: "a", enabled: true },
            { feature: "b", enabled: true },
          ],
        },
        "These do not all hold",
      ],
    ];
    for (const [check, text] of checks) expect(describeCheck(check, "limit")).toBe(text);
  });

  it("summarises feature, variable and segment assertions", () => {
    expect(
      getAssertionSummary(
        { key: "f", feature: "f", assertions: [] },
        { environment: "production", at: 40, expectedToBeEnabled: true, expectedVariation: "on" },
      ),
    ).toBe("in production · at 40% · expects enabled, variation on");
    expect(
      getAssertionSummary(
        { key: "v", variable: "v", assertions: [] },
        { expectedValue: "x".repeat(60) },
      ),
    ).toBe(`expects ${"x".repeat(39)}…`);
    expect(
      getAssertionSummary(
        { key: "s", segment: "s", assertions: [] },
        { context: {}, expectedToMatch: false },
      ),
    ).toBe("expects no match");
  });

  it("counts checks against the cases that hold them", () => {
    expect(describeCheckCount(54, 18, "case")).toBe("54 checks across 18 cases");
    expect(describeCheckCount(1, 1, "assertion")).toBe("1 check");
  });
});
