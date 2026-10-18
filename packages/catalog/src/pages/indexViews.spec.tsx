import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

jest.mock("react-markdown", () => () => null);

let mockIndex: unknown;
jest.mock("../useCatalogIndex", () => ({
  useCatalogIndex: () => ({ index: mockIndex, error: null }),
}));

import { CatalogProvider } from "../context/CatalogContext";
import { ListPage, getListEntities, getFilterChips } from "./ListPage";
import { OverviewPage } from "./HomePage";
import { getHistoryMatcher } from "./HistoryPage";
import { findNamespacedKey, getExtraKeySegments } from "./EntityDetailPage";
import type { CatalogIndex, CatalogManifest, EntitySummary, HistoryEntry } from "../types";

const manifest: CatalogManifest = {
  schemaVersion: "1",
  generatedAt: "",
  sets: false,
  setKeys: [],
  projectConfig: { tags: [] },
  paths: { projectHistory: "data/project/history" },
  counts: {},
};

function withIndex(entities: Partial<Record<string, Array<Partial<EntitySummary>>>>) {
  mockIndex = {
    set: "",
    counts: {},
    entities: Object.fromEntries(
      Object.entries(entities).map(([type, list]) => [
        type,
        (list || []).map((entity) => ({ href: "", ...entity })),
      ]),
    ),
  } as unknown as CatalogIndex;
}

function render(route: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider initialManifest={manifest}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/:entityPath" element={<ListPage />} />
        </Routes>
      </CatalogProvider>
    </MemoryRouter>,
  );
}

const textContent = (markup: string) => markup.replace(/<[^>]*>/g, "");

describe("Catalog index views", () => {
  it("badges and filters compositions without hiding their object type", () => {
    const entities = [
      { key: "screen", href: "", variableType: "object", isComposed: true },
      { key: "settings", href: "", variableType: "object" },
      { key: "legacy", href: "", variableType: "json" },
    ];
    withIndex({ variable: entities });
    const html = render("/variables");
    expect(html).toContain(">composed</span>");
    const chips = getFilterChips(mockIndex as CatalogIndex, "variables");
    expect(chips).toEqual([
      { label: "json", token: "type:json", group: "Type" },
      { label: "object", token: "type:object", group: "Type" },
      { label: "Composed", token: "with:composition", group: "Type" },
    ]);
    expect(html).toContain(">Composed</button>");
    const keys = (query: string) => getListEntities(entities, query, "name").map((e) => e.key);
    expect(keys("with:composition")).toEqual(["screen"]);
    expect(keys("type:object")).toEqual(["screen", "settings"]);
    expect(keys("type:object with:composition")).toEqual(["screen"]);
    expect(keys("without:composition")).toEqual(["legacy", "settings"]);
    expect(render("/variables?q=with%3Acomposition")).not.toContain(">settings<");
    expect(textContent(render("/variables?q=with%3Acomposition"))).toContain("1 of 3 variables");
    expect(textContent(render("/variables?q=missing"))).toContain("0 of 3 variables");
    withIndex({ variable: [entities[1]] });
    expect(render("/variables")).not.toContain(">Composed</button>");
  });

  it("shows attribute formats beside their type and filters by either", () => {
    const entities = [
      { key: "signupDate", href: "", attributeType: "string", attributeFormat: "date-time" },
      { key: "appVersion", href: "", attributeType: "string", attributeFormat: "semver" },
      { key: "country", href: "", attributeType: "string" },
      { key: "externalId", href: "", attributeType: "oneOf" },
    ];
    withIndex({ attribute: entities });
    const html = render("/attributes");
    expect(html).toContain(">string · date-time</code>");
    expect(html).toContain(">string · semver</code>");
    expect(html).toContain(">oneOf</code>");
    expect(getFilterChips(mockIndex as CatalogIndex, "attributes")).toEqual([
      { label: "oneOf", token: "type:oneOf", group: "Type" },
      { label: "string", token: "type:string", group: "Type" },
      { label: "date-time", token: "format:date-time", group: "Format" },
      { label: "semver", token: "format:semver", group: "Format" },
    ]);
    const keys = (query: string) => getListEntities(entities, query, "name").map((e) => e.key);
    expect(keys("type:string")).toEqual(["appVersion", "country", "signupDate"]);
    expect(keys("format:date-time")).toEqual(["signupDate"]);
    expect(keys("type:oneOf")).toEqual(["externalId"]);
  });

  it("labels JSON aliases as decoded while retaining the existing json filter", () => {
    const entities = [
      { key: "raw", href: "", variableType: "json" },
      { key: "rawAlias", href: "", variableType: "json", isComposed: true },
      { key: "rawChain", href: "", variableType: "json", isComposed: true },
      { key: "policyAlias", href: "", variableType: "object", isComposed: true },
    ];
    withIndex({ variable: entities });
    const html = render("/variables?q=type%3Ajson");
    expect(html.match(/>json, decoded<\/code>/g)).toHaveLength(2);
    expect(html.match(/>json<\/code>/g)).toHaveLength(1);
    expect(html).toContain(
      'title="The alias receives the evaluated, decoded JSON value, which may be an object, array, scalar or null."',
    );
    expect(getFilterChips(mockIndex as CatalogIndex, "variables")).toContainEqual({
      label: "json",
      token: "type:json",
      group: "Type",
    });
    expect(
      getListEntities(entities, "type:json with:composition", "name").map((e) => e.key),
    ).toEqual(["rawAlias", "rawChain"]);
    expect(
      getFilterChips(mockIndex as CatalogIndex, "variables").some((chip) =>
        chip.token.includes("decoded"),
      ),
    ).toBe(false);
  });

  it("distinguishes visible rows, matching rows and total rows when pagination is capped", () => {
    withIndex({
      variable: [
        ...Array.from({ length: 1001 }, (_, index) => ({
          key: `object${index}`,
          variableType: "object",
        })),
        { key: "text", variableType: "string" },
      ],
    });
    const filtered = render("/variables?q=type%3Aobject");
    expect(textContent(filtered)).toContain("1000 of 1002 variables (1001 matches)");
    expect(textContent(filtered)).toContain("Load all 1001 variables");
    expect(textContent(render("/variables"))).toContain("1000 of 1002 variables");
  });

  it("shows feature and variable chips as one row and groups the others", () => {
    withIndex({
      feature: [{ key: "checkout", environments: ["production"], tags: ["web"], hasTests: false }],
    });
    const features = render("/features");
    expect(features.match(/role="group"/g)).toHaveLength(1);
    expect(features).toContain('role="group" aria-label="Filters"');
    expect(features).not.toContain(">Environment</span>");
    expect(features).toContain(">production</button>");
    expect(features).toContain(">#web</button>");

    withIndex({
      variable: [{ key: "limit", variableType: "integer", hasTests: false }],
    });
    const variables = render("/variables");
    expect(variables).toContain('role="group" aria-label="Filters"');
    expect(variables).not.toContain(">Type</span>");
    expect(variables).toContain(">integer</button>");
    expect(variables).toContain(">Without tests</button>");

    withIndex({ segment: [{ key: "netherlands", usedByCount: 0 }] });
    const segments = render("/segments");
    expect(segments).toContain('role="group" aria-label="Usage"');
    // Both apply whenever the type has usage counts, even when nothing is used.
    expect(segments).toContain(">Unused</button>");
    expect(segments).toContain(">Used</button>");
    // One group needs no label.
    expect(segments).not.toContain(">Usage</span>");
  });

  it.each([
    ["attributes", "attribute"],
    ["segments", "segment"],
    ["schemas", "schema"],
  ])("filters %s by whether anything uses them", (entityPath, type) => {
    const entities = [
      { key: "used", usedByCount: 2, attributeType: type === "attribute" ? "string" : undefined },
      { key: "unused", usedByCount: 0 },
    ];
    withIndex({ [type]: entities });
    const html = render(`/${entityPath}`);
    expect(html).toContain(">Used</button>");
    expect(html).toContain(">Unused</button>");
    if (type === "attribute") expect(html).toContain(">string</button>");

    const keys = (query: string) =>
      getListEntities(entities as EntitySummary[], query, "name").map((entity) => entity.key);
    expect(keys("with:usage")).toEqual(["used"]);
    expect(keys("without:usage")).toEqual(["unused"]);
    withIndex({ [type]: [entities[0]] });
    expect(render(`/${entityPath}?q=without%3Ausage`)).toContain(`No unused ${entityPath}`);
    expect(render(`/${entityPath}?q=without%3Ausage%20x`)).toContain("No results found");

    // Types without a usage count never match either.
    expect(getListEntities([{ key: "x", href: "" }], "with:usage", "name")).toEqual([]);
    expect(getListEntities([{ key: "x", href: "" }], "without:usage", "name")).toEqual([]);
  });

  it("reads a spec result as one badge and drops a subject the key already names", () => {
    withIndex({
      test: [
        {
          key: "features.checkout",
          testKind: "feature",
          testSubject: "checkout",
          assertionCount: 3,
          testPassed: true,
          testReportStatus: "13 cases passed. 2 skipped by the runner",
        },
        {
          key: "legacy-spec",
          testKind: "segment",
          testSubject: "netherlands",
          assertionCount: 1,
        },
      ],
    });
    const html = render("/tests");
    expect(html).toContain("✓ 13 cases passed");
    expect(html).toContain("2 skipped by the runner");
    expect(html).not.toContain("Tests feature checkout");
    expect(html).toContain("Tests segment netherlands");
  });

  it("lists unused segments, attributes and schemas and failing specs on the Overview", () => {
    withIndex({
      segment: [
        { key: "netherlands", usedByCount: 0 },
        { key: "germany", usedByCount: 2 },
      ],
      attribute: [{ key: "legacyId", usedByCount: 0 }],
      schema: [{ key: "price", usedByCount: 1 }],
      test: [{ key: "features.checkout", testPassed: false }],
    });
    const html = render("/");
    expect(html).toContain("Failing test specs");
    expect(html).toContain(`href="/tests?q=${encodeURIComponent("status:failed")}"`);
    expect(html).toContain("Unused segments");
    expect(html).toContain(`href="/segments?q=${encodeURIComponent("without:usage")}"`);
    expect(html).toContain("netherlands");
    expect(html).not.toContain(">germany<");
    expect(html).toContain("Unused attributes");
    expect(html).not.toContain("Unused schemas");
  });

  it("matches history by text and by the type of entity changed", () => {
    const entry = (fields: Partial<HistoryEntry>): HistoryEntry => ({
      commit: "abc1234",
      author: "Ada",
      timestamp: "2026-10-09T00:00:00Z",
      subject: "feat: checkout",
      entities: [{ type: "feature", key: "checkout" }],
      ...fields,
    });
    expect(getHistoryMatcher("")).toBeUndefined();
    const matches = getHistoryMatcher("CHECKOUT ada")!;
    expect(matches(entry({}))).toBe(true);
    expect(matches(entry({ author: "Bo" }))).toBe(false);
    // Changed keys count as text, so a commit is found by what it touched.
    expect(
      getHistoryMatcher("netherlands")!(
        entry({ entities: [{ type: "segment", key: "netherlands" }] }),
      ),
    ).toBe(true);
    const segmentsOnly = getHistoryMatcher("", "segment")!;
    expect(segmentsOnly(entry({}))).toBe(false);
    expect(
      segmentsOnly(
        entry({
          entities: [
            { type: "feature", key: "checkout" },
            { type: "segment", key: "netherlands" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("resolves a key whose namespace was written as extra path segments", () => {
    expect(getExtraKeySegments("/tests/scenarios/signup/history", "tests", "scenarios")).toEqual([
      "signup",
      "history",
    ]);
    // A tab after the key is not part of the key.
    expect(getExtraKeySegments("/tests/scenarios/history", "tests", "scenarios")).toEqual([]);
    expect(getExtraKeySegments("/sets/web/tests/a%2Fb", "tests", "a/b")).toEqual([]);

    const keys = ["scenarios.signup", "checkout/cart"];
    expect(findNamespacedKey(keys, "scenarios", ["signup"])).toBe("scenarios.signup");
    expect(findNamespacedKey(keys, "checkout", ["cart"])).toBe("checkout/cart");
    expect(findNamespacedKey(keys, "checkout", [])).toBeUndefined();
    expect(findNamespacedKey(keys, "checkout", ["basket"])).toBeUndefined();
  });
});
