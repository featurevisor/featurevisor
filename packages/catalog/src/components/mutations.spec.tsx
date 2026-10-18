import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

jest.mock("react-markdown", () => () => null);

import { CatalogProvider } from "../context/CatalogContext";
import type { CatalogManifest } from "../types";
import {
  FeatureRulesTab,
  FeatureVariationsTab,
  VariableOverridesTab,
} from "../pages/EntityDetailPage";
import { EnvironmentComparison } from "../pages/entityDetail/environments";
import { getMutationEntries, MutationView } from "./mutations";

const mutations = [
  { "methods:append": "first payment method with a deliberately long value" },
  { "methods:append": "second payment method with a deliberately long value" },
  { methods: ["final"] },
];

function expectOrderedMutations(html: string, count = 1) {
  const lists = html.match(/<ol aria-label="Mutations in application order"[\s\S]*?<\/ol>/g) || [];
  expect(lists).toHaveLength(count);
  for (const list of lists) {
    expect(list.match(/methods:append/g)).toHaveLength(2);
    expect(list.indexOf("first payment")).toBeLessThan(list.indexOf("second payment"));
    expect(list.indexOf("second payment")).toBeLessThan(list.indexOf("final"));
    expect(list).toContain("1.</span>");
    expect(list).toContain("2.</span>");
    expect(list).toContain("3.</span>");
  }
}

function renderTab(type: string, entity: unknown, tab: React.ReactNode, route: string) {
  const manifest: CatalogManifest = {
    schemaVersion: "1",
    generatedAt: "",
    sets: false,
    setKeys: [],
    projectConfig: { tags: [] },
    paths: { projectHistory: "data/project/history" },
    counts: {},
  };
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider initialManifest={manifest}>
        <Routes>
          <Route element={<Outlet context={{ detail: { type, key: "checkout", entity } }} />}>
            <Route path="*" element={tab} />
          </Route>
        </Routes>
      </CatalogProvider>
    </MemoryRouter>,
  );
}

describe("ordered Catalog mutations", () => {
  it.each([90, true, "", "short", null])(
    "separates the path from its mutation value (%j)",
    (value) => {
      const html = renderToStaticMarkup(<MutationView value={{ "policy.limit": value }} />);
      expect(html).toContain('<code class="block text-xs font-semibold [overflow-wrap:anywhere]">');
      expect(html).toContain('policy.limit</code><div class="mt-1" data-mutation-value="">');
    },
  );

  it("renders equivalent maps and lists identically without changing map key order", () => {
    const map = { currency: "GBP", "methods:append": "ideal" };
    expect(renderToStaticMarkup(<MutationView value={map} />)).toBe(
      renderToStaticMarkup(
        <MutationView value={[{ currency: "GBP" }, { "methods:append": "ideal" }]} />,
      ),
    );
    expect(getMutationEntries({ z: true, "0": false, a: null })).toEqual([
      ["0", false],
      ["z", true],
      ["a", null],
    ]);
    expect(getMutationEntries([{ z: true }, { "0": false }])).toEqual([
      ["z", true],
      ["0", false],
    ]);
    expect(getMutationEntries([])).toEqual([]);
    expect(getMutationEntries({})).toEqual([]);
  });

  it("keeps repeated paths in global and nested continuing overrides", () => {
    expectOrderedMutations(
      renderTab(
        "variable",
        {
          defaultValue: { methods: [] },
          overrides: [
            {
              conditions: "*",
              key: "global",
              continue: true,
              mutate: mutations,
              overrides: [{ conditions: "*", key: "nested", mutate: mutations }],
            },
          ],
        },
        <VariableOverridesTab />,
        "/variables/checkout/overrides",
      ),
      2,
    );
  });

  it.each(["rule", "variation"])("keeps repeated paths in a feature %s override", (scope) => {
    const owner = {
      key: "everyone",
      value: "treatment",
      conditions: "*",
      percentage: 100,
      variableOverrides: { config: [{ conditions: "*", mutate: mutations }] },
    };
    expectOrderedMutations(
      renderTab(
        "feature",
        {
          variablesSchema: { config: { type: "object", defaultValue: {} } },
          rules: [owner],
          variations: [owner],
        },
        scope === "rule" ? <FeatureRulesTab /> : <FeatureVariationsTab />,
        `/features/checkout/${scope === "rule" ? "rules" : "variations"}`,
      ),
    );
  });

  it("shows every mutation in an environment selected override", () => {
    expectOrderedMutations(
      renderTab(
        "variable",
        { overrides: { staging: [{ conditions: "*", mutate: mutations }], production: [] } },
        <VariableOverridesTab />,
        "/variables/checkout/overrides",
      ),
    );
  });

  it.each(["overrides", "rules"] as const)(
    "preserves map mutation order in environment %s",
    (kind) => {
      const mutate = { "methods:append": "ideal", currency: "GBP" };
      const row =
        kind === "overrides"
          ? { key: "everyone", conditions: "*", mutate }
          : {
              key: "everyone",
              conditions: "*",
              variableOverrides: { config: [{ conditions: "*", mutate }] },
            };
      const html = renderToStaticMarkup(
        <EnvironmentComparison
          compared={["staging", "production"]}
          kind={kind}
          rowsByEnvironment={{ staging: [row], production: [row] }}
        />,
      );
      expect(html).toContain("Both environments are identical.");
      const lists =
        html.match(/<ol aria-label="Mutations in application order"[\s\S]*?<\/ol>/g) || [];
      expect(lists).toHaveLength(2);
      for (const list of lists) {
        expect(list.indexOf("methods:append")).toBeLessThan(list.indexOf("currency"));
        expect(list).toContain("ideal");
        expect(list).toContain("GBP");
      }
    },
  );

  it.each(["overrides", "rules"] as const)(
    "compares full ordered mutations in environment %s",
    (kind) => {
      const row = (value: unknown) =>
        kind === "overrides"
          ? { conditions: "*", key: "everyone", mutate: value }
          : {
              key: "everyone",
              conditions: "*",
              variableOverrides: { config: [{ conditions: "*", mutate: value }] },
            };
      const html = renderToStaticMarkup(
        <EnvironmentComparison
          compared={["staging", "production"]}
          kind={kind}
          rowsByEnvironment={{
            staging: [row(mutations)],
            production: [row([...mutations].reverse())],
          }}
        />,
      );
      expect(html).toContain(`1 of 1 ${kind} differ`);
      expect(html).toContain("bg-amber-100");
      const cells = html.split('<td class="px-3 py-2 align-top">');
      expectOrderedMutations(cells[1]);
      expect(cells[2].indexOf("final")).toBeLessThan(cells[2].indexOf("second payment"));
      expect(cells[2].indexOf("second payment")).toBeLessThan(cells[2].indexOf("first payment"));
      expect(cells[2].match(/methods:append/g)).toHaveLength(2);
    },
  );
});
