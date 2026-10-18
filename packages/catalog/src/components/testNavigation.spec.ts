import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { TestScenario } from "@featurevisor/types";
jest.mock("react-markdown", () => () => null);
import { TestReferences, RelatedScenarios, getTestCheckRoute } from "./testNavigation";
import { EntityTests } from "./tests";
import { OverviewTab, TestsTab } from "../pages/EntityDetailPage";
import { getEntityRoute } from "../entityTypes";
import { getTestCheckPermalink } from "../testModel";
import { CatalogProvider } from "../context/CatalogContext";
import type { CatalogManifest } from "../types";

const scenario: TestScenario = {
  key: "journeys/checkout.spec",
  scenario: "journeys/checkout.spec",
  assertions: [
    {
      checks: [
        { key: "available", feature: "checkout/new", enabled: true },
        { variable: "message", operator: "equals", compareTo: { variable: "backup" } },
      ],
    },
  ],
};
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(React.createElement(MemoryRouter, {}, node));

describe("catalog test navigation", () => {
  it("links every explicit entity and comparison operand in the current set", () => {
    const html = render(
      React.createElement(TestReferences, { test: scenario, setKey: "staging/team" }),
    );
    expect(html).toContain('href="/sets/staging%252Fteam/features/checkout%252Fnew"');
    expect(html).toContain('href="/sets/staging%252Fteam/variables/backup"');
    expect(html).toContain("Comparison operand: variable value");
    expect(html).toContain("not test results or proof of coverage");
    const permalink = getTestCheckPermalink(scenario.key!, "1", [["key", "available"]]);
    expect(html).toContain(`href="${getTestCheckRoute(scenario.key!, permalink, "staging/team")}"`);
  });

  it("limits the explanation to the browsed entity and links to the complete scenario", () => {
    const html = render(
      React.createElement(EntityTests, {
        tests: [scenario],
        entity: { type: "feature", key: "checkout/new" },
        setKey: "staging",
      }),
    );
    expect(html).toContain("Referenced here through");
    expect(html).toContain("Open complete scenario");
    expect(html).toContain(`href="${getEntityRoute("test", scenario.key!, "staging")}"`);
    // The explanation names only the browsed entity. The check outline still links every operand.
    const start = html.indexOf("Referenced here through");
    const references = html.slice(start, html.indexOf("</section>", start));
    expect(references).not.toContain('href="/sets/staging/variables/backup"');
    expect(html).toContain('href="/sets/staging/variables/backup"');
  });

  it("keeps indirect scenarios collapsed and explicitly distinguishes them from segment tests", () => {
    const html = render(
      React.createElement(RelatedScenarios, {
        scenarios: [{ key: scenario.key!, via: [{ type: "feature", key: "checkout/new" }] }],
      }),
    );
    expect(html).toContain("Related tests through dependencies (1)");
    expect(html).toContain(
      "contain no explicit check for this segment and do not prove it was evaluated",
    );
    expect(html).toContain('href="/features/checkout%252Fnew"');
    expect(html).not.toContain("<details open");
    expect(render(React.createElement(RelatedScenarios, { scenarios: [] }))).toBe("");
  });

  function renderTab(
    tab: React.ReactElement,
    detail: unknown,
    testReport?: CatalogManifest["testReport"],
  ) {
    const children = React.createElement(
      Routes,
      {},
      React.createElement(
        Route,
        {
          element: React.createElement(Outlet, { context: { detail, setKey: "staging" } }),
        },
        React.createElement(Route, { index: true, element: tab }),
      ),
    );
    return render(
      React.createElement(CatalogProvider, {
        initialManifest: {
          schemaVersion: "1",
          generatedAt: "",
          sets: false,
          setKeys: [],
          projectConfig: { tags: [] },
          paths: { projectHistory: "" },
          counts: {},
          testReport,
        },
        children,
      }),
    );
  }

  it("renders a complete scenario and its navigation on the test overview", () => {
    const html = renderTab(React.createElement(OverviewTab), {
      type: "test",
      key: scenario.key,
      entity: scenario,
    });
    expect(html).toContain("Entities in this spec");
    expect(html).toContain("Case 1");
    expect(html).toContain('href="/sets/staging/variables/backup"');
    expect(html).not.toContain("Not run");
  });

  it.each(["current", "stale", "unverified"] as const)(
    "marks completely omitted specs only when a %s report was supplied",
    (verification) => {
      const testReport: NonNullable<CatalogManifest["testReport"]> = {
        verification,
        runner: "javascript",
        passed: true,
        summary: {},
        hasCoverage: false,
      };
      const overview = renderTab(
        React.createElement(OverviewTab),
        {
          type: "test",
          key: scenario.key,
          entity: scenario,
        },
        testReport,
      );
      const entityTests = renderTab(
        React.createElement(TestsTab),
        {
          type: "feature",
          key: "checkout/new",
          tests: [scenario],
        },
        testReport,
      );
      for (const html of [overview, entityTests]) {
        expect(html.match(/Not in supplied report/g)).toHaveLength(2);
        expect(html).not.toContain("✓ Passed");
        expect(html).not.toContain("cases in report");
      }
      const withoutReport = renderTab(React.createElement(TestsTab), {
        type: "feature",
        key: "checkout/new",
        tests: [scenario],
      });
      expect(withoutReport).not.toContain("Not run");
    },
  );

  it("groups entity tests and still shows empty state alongside indirect scenarios", () => {
    const html = renderTab(React.createElement(TestsTab), {
      type: "feature",
      key: "checkout/new",
      tests: [scenario, { key: "own", feature: "checkout/new", assertions: [] }],
    });
    expect(html).toContain("Own test specs");
    expect(html).toContain("Referenced by scenarios");
    const empty = renderTab(React.createElement(TestsTab), {
      type: "segment",
      key: "premium",
      relatedScenarios: [{ key: scenario.key, via: [] }],
    });
    expect(empty).toContain("No test specs found");
    expect(empty).toContain("Related tests through dependencies");
  });

  it("preserves disambiguated permalinks across separate entity test sections", () => {
    const key = "shared.spec";
    const html = renderTab(React.createElement(TestsTab), {
      type: "feature",
      key: "checkout",
      tests: [
        { key, feature: "checkout", assertions: [{ expectedToBeEnabled: true }] },
        { key, scenario: key, assertions: [{ checks: [{ feature: "checkout", enabled: true }] }] },
      ],
    });
    expect(html).toContain(`assertion-${encodeURIComponent(`test:${key}:1`)}`);
    expect(html).toContain(`assertion-${encodeURIComponent(`scenario:${key}:1`)}`);
  });
});
