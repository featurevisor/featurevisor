import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

jest.mock("react-markdown", () => () => null);

import { CatalogProvider } from "../context/CatalogContext";
import { AppShell } from "../components/ui";
import { ConditionTree } from "../components/trees";
import { AttributeConditionValues } from "../components/insights";
import { EditLink } from "../components/editLink";
import { describeConditions, parseEntityConditions } from "../components/conditionExpression";
import {
  EntityDetailPage,
  FeatureRulesTab,
  FeatureVariablesTab,
  FeatureVariationsTab,
  OverviewTab,
  UsageTab,
  VariableOverridesTab,
  getVariableSetters,
} from "./EntityDetailPage";
import {
  ListPage,
  getFilterChips,
  getListEntities,
  getUnknownQualifiers,
  getUsesSuggestion,
  matchesQuery,
  parseSearchQuery,
} from "./ListPage";
import type { CatalogIndex, CatalogManifest, EntitySummary } from "../types";

const manifest: CatalogManifest = {
  schemaVersion: "1",
  generatedAt: "",
  sets: false,
  setKeys: [],
  projectConfig: { tags: [] },
  paths: { projectHistory: "data/project/history" },
  counts: {},
};

function render(node: React.ReactNode, route = "/") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <CatalogProvider initialManifest={manifest}>{node}</CatalogProvider>
    </MemoryRouter>,
  );
}

describe("Catalog entity surfaces", () => {
  it("retains the entity route and query in rule permalinks", () => {
    const detail = {
      type: "feature",
      key: "checkout/cart",
      environments: [],
      entity: { rules: [{ key: "everyone", conditions: "*", enabled: true, percentage: 100 }] },
    };
    const html = render(
      <Routes>
        <Route element={<Outlet context={{ detail }} />}>
          <Route path="*" element={<FeatureRulesTab />} />
        </Route>
      </Routes>,
      "/features/checkout%252Fcart/rules?view=detail",
    );
    expect(html).toContain('href="/features/checkout%252Fcart/rules?view=detail#rules-everyone"');
    expect(html).not.toContain('href="#rules-everyone"');
  });

  it.each(["", "/sets/production"])("omits Groups from navigation at %s", (base) => {
    const html = render(<AppShell>Content</AppShell>, `${base}/features`);
    for (const section of [
      "features",
      "variables",
      "attributes",
      "segments",
      "targets",
      "schemas",
      "tests",
    ]) {
      expect(html).toContain(`href="${base}/${section}"`);
    }
    expect(html).not.toContain("/groups");
    expect(html).not.toContain(">Groups<");
  });

  it("names a watch mode refresh to the second and a static export to the minute", () => {
    // The visible text only, since the tooltip always carries the full timestamp.
    const footer = (props: { live?: boolean; dev?: boolean }) =>
      /<time[^>]*>(.*?)<\/time>/.exec(
        renderToStaticMarkup(
          <MemoryRouter>
            <CatalogProvider
              initialManifest={{
                ...manifest,
                generatedAt: "2026-10-09T21:59:37.069Z",
                dev: props.dev ? { editors: [] } : undefined,
              }}
              live={props.live}
            >
              <AppShell>Content</AppShell>
            </CatalogProvider>
          </MemoryRouter>,
        ),
      )?.[1];
    const seconds = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
      new Date("2026-10-09T21:59:37.069Z"),
    );
    expect(footer({})).toContain("Generated on");
    expect(footer({})).not.toContain(seconds);
    // The Vite dev server passes live, and the CLI's watch mode exports a dev manifest.
    for (const props of [{ live: true }, { dev: true }]) {
      expect(footer(props)).toContain("Refreshed on");
      expect(footer(props)).toContain(seconds);
    }
  });

  it.each(["", "/sets/production"])("rejects Groups list and detail routes at %s", (base) => {
    const list = render(
      <Routes>
        <Route path={`${base}/:entityPath`} element={<ListPage />} />
      </Routes>,
      `${base}/groups`,
    );
    const detail = render(
      <Routes>
        <Route path={`${base}/:entityPath/:entityKey`} element={<EntityDetailPage />} />
      </Routes>,
      `${base}/groups/experiment`,
    );
    // Redirects render no page, whereas supported routes render their loading state.
    expect(list).toBe("");
    expect(detail).toBe("");
    expect(
      render(
        <Routes>
          <Route path={`${base}/:entityPath`} element={<ListPage />} />
        </Routes>,
        `${base}/features`,
      ),
    ).toContain("Loading features");
    expect(
      render(
        <Routes>
          <Route path={`${base}/:entityPath/:entityKey`} element={<EntityDetailPage />} />
        </Routes>,
        `${base}/features/experiment`,
      ),
    ).toContain("Loading feature");
  });

  it("preserves logical requirements, ordinary rollout and shared variation allocation", () => {
    const detail = {
      type: "feature",
      key: "checkout",
      entity: {
        conditions: {
          and: [
            { not: [{ feature: "priorityFeature" }] },
            { or: [{ feature: "eligible" }, { feature: "allocation", variation: "treatment" }] },
          ],
        },
        rules: [{ key: "rollout", conditions: "*", percentage: 35, enabled: true }],
        variations: [
          { value: "control", weight: 60 },
          { value: "treatment", weight: 40 },
        ],
      },
    };
    const html = render(
      <Routes>
        <Route element={<Outlet context={{ detail, setKey: "production" }} />}>
          <Route index element={<OverviewTab />} />
        </Route>
      </Routes>,
    );
    expect(html).toContain(">Root conditions</h2>");
    expect(html).toContain(">treatment</code>");
    expect(html).not.toContain("Unsupported requirement");
    for (const operator of ["and", "or", "not"]) expect(html).toContain(`>${operator}<`);
    for (const feature of ["priorityFeature", "eligible", "allocation"]) {
      expect(html).toContain(`href="/sets/production/features/${feature}"`);
    }
    expect(html).toContain("35%");
    expect(html).toContain("control");
    expect(html).toContain("treatment");
    expect(html).toContain("width:60%");
    expect(html).toContain("width:40%");
    expect(html).not.toContain(">Slots<");
  });

  it("preserves nested logical segment and condition groups", () => {
    const html = render(
      <>
        <ConditionTree
          conditions={{ and: ["eligible", { or: ["staff", { not: ["blocked"] }] }] }}
        />
        <ConditionTree
          conditions={{
            and: [
              { attribute: "country", operator: "equals", value: "nl" },
              { or: [{ not: [{ attribute: "banned", operator: "equals", value: true }] }] },
            ],
          }}
        />
      </>,
    );
    for (const operator of ["and", "or", "not"]) {
      expect(html).toContain(`>${operator}<`);
    }
    expect(html).toContain('href="/segments/blocked"');
    expect(html).toContain('href="/attributes/banned"');
  });

  describe("list qualifiers", () => {
    const summary = (fields: Partial<EntitySummary>): EntitySummary => ({
      key: "checkout",
      href: "entities/feature/checkout.json",
      ...fields,
    });

    it("parses quoted qualifier values and free terms", () => {
      expect(parseSearchQuery('tag:"web app" in:production Cart')).toEqual({
        terms: ["cart"],
        qualifiers: [
          { key: "tag", value: "web app" },
          { key: "in", value: "production" },
        ],
      });
    });

    it("filters by environment, drift, tests and status", () => {
      const feature = summary({
        environments: ["staging", "production"],
        environmentsDiffer: true,
      });
      expect(matchesQuery(feature, "in:production")).toBe(true);
      expect(matchesQuery(feature, "in:development")).toBe(false);
      expect(matchesQuery(feature, "with:drift")).toBe(true);
      expect(matchesQuery(summary({ hasTests: false }), "without:tests")).toBe(true);
      // Unknown test coverage is not the same as no tests.
      expect(matchesQuery(summary({}), "without:tests")).toBe(false);
      expect(matchesQuery(summary({ testPassed: false }), "status:failed")).toBe(true);
      expect(matchesQuery(summary({ testPassed: undefined }), "status:failed")).toBe(false);
      expect(matchesQuery(summary({ testPassed: undefined }), "status:passed")).toBe(false);
    });

    it("ignores qualifiers it does not know instead of hiding every entity", () => {
      expect(matchesQuery(summary({}), "enabled:production")).toBe(true);
      expect(matchesQuery(summary({}), "enabled:production other")).toBe(false);
    });

    it("names unknown qualifiers and suggests the uses filter they likely meant", () => {
      const index = {
        set: "",
        counts: {},
        entities: { segment: [summary({ key: "regions.eu", usedByCount: 2 })], feature: [] },
      } as unknown as CatalogIndex;
      expect(getUnknownQualifiers("segment:Regions.EU tag:web segment:other")).toEqual([
        { key: "segment", value: "regions.eu" },
      ]);
      expect(getUsesSuggestion(index, getUnknownQualifiers("segment:regions.eu"))).toEqual({
        key: "regions.eu",
        named: true,
      });
      expect(getUsesSuggestion(index, getUnknownQualifiers("owner:nobody"))).toEqual({
        key: "regions.eu",
        named: false,
      });
    });

    it("filters by what depends on an entity and what it depends on, directly or not", () => {
      // banner -> premium -> eu, and checkout -> eu directly.
      const index = {
        set: "",
        counts: {},
        entities: {
          feature: [
            summary({ key: "banner", references: ["segment:premium"] }),
            summary({ key: "checkout", references: ["segment:eu"] }),
            summary({ key: "standalone" }),
          ],
          segment: [
            summary({ key: "premium", references: ["segment:eu", "attribute:plan"] }),
            summary({ key: "eu", references: ["attribute:country"] }),
          ],
          attribute: [summary({ key: "plan" }), summary({ key: "country" })],
        },
      } as unknown as CatalogIndex;
      const keys = (type: "feature" | "segment" | "attribute", query: string) =>
        getListEntities(index.entities[type], query, "name", { index, type }).map(
          (entity) => entity.key,
        );

      expect(keys("feature", "uses:eu")).toEqual(["banner", "checkout"]);
      expect(keys("feature", "uses:segment:premium")).toEqual(["banner"]);
      expect(keys("feature", "uses:country")).toEqual(["banner", "checkout"]);
      expect(keys("segment", "usedby:banner")).toEqual(["eu", "premium"]);
      expect(keys("attribute", "usedby:Banner")).toEqual(["country", "plan"]);
      expect(keys("feature", "with:dependencies")).toEqual(["banner", "checkout"]);
      expect(keys("feature", "without:dependencies")).toEqual(["standalone"]);
      // Without an index there is no graph, so nothing can match.
      expect(matchesQuery(index.entities.feature[0], "uses:eu")).toBe(false);
    });

    it("filters by dependents and deprecated dependencies", () => {
      expect(matchesQuery(summary({ usedInVariableCount: 1 }), "with:dependents")).toBe(true);
      expect(matchesQuery(summary({}), "with:dependents")).toBe(false);
      expect(matchesQuery(summary({}), "without:dependents")).toBe(true);
      expect(
        matchesQuery(summary({ dependsOnDeprecated: true }), "with:deprecated-dependency"),
      ).toBe(true);
    });

    it("offers status chips only for outcomes the index contains", () => {
      const index = (tests: Array<Partial<EntitySummary>>) =>
        ({
          set: "",
          counts: {},
          entities: {
            test: tests.map((test, position) => summary({ key: `t${position}`, ...test })),
          },
        }) as unknown as CatalogIndex;
      const tokens = (tests: Array<Partial<EntitySummary>>) =>
        getFilterChips(index(tests), "tests").map((chip) => chip.token);

      expect(tokens([{ testKind: "scenario", testPassed: true }])).toEqual([
        "kind:scenario",
        "status:passed",
      ]);
      expect(tokens([{ testPassed: false }, { testPassed: true }])).toEqual([
        "status:failed",
        "status:passed",
      ]);
      // Partial or absent report results earn neither chip.
      expect(tokens([{ testPassed: undefined }])).toEqual([]);
    });
  });

  describe("Requires and Rules", () => {
    const renderRules = (entity: Record<string, unknown>, route = "/features/checkout/rules") =>
      render(
        <Routes>
          <Route
            element={<Outlet context={{ detail: { type: "feature", key: "checkout", entity } }} />}
          >
            <Route path="*" element={<FeatureRulesTab />} />
          </Route>
        </Routes>,
        route,
      );

    it("describes requirements with their logic and both requirement kinds", () => {
      const node = parseEntityConditions({
        conditions: [
          { or: [{ feature: "foo" }, { feature: "bar", variation: "treatment" }] },
          { variable: "limit", operator: "greaterThan", value: 3 },
        ],
      });
      expect(describeConditions(node!)).toBe(
        '(foo is enabled or bar has variation "treatment") and limit greaterThan 3',
      );
      expect(
        describeConditions(
          parseEntityConditions({
            conditions: [{ not: [{ feature: "foo" }, { feature: "bar" }] }],
          })!,
        ),
      ).toBe("not (foo is enabled and bar is enabled)");
      expect(parseEntityConditions({})).toBeUndefined();
    });

    it("keeps every authored detail in requirement summaries", () => {
      const describe = (entity: Record<string, unknown>) =>
        describeConditions(parseEntityConditions(entity)!);
      expect(
        describe({ conditions: [{ variable: "message", operator: "equals", value: "" }] }),
      ).toBe('message equals ""');
      expect(
        describe({
          conditions: [{ variable: "config", path: ["a.b", 0], operator: "equals", value: "3" }],
        }),
      ).toBe('config["a.b"][0] equals "3"');
      expect(
        describe({
          conditions: [{ variable: "config", path: "a.b.0", operator: "equals", value: 3 }],
        }),
      ).toBe("config.a.b[0] equals 3");
      expect(
        describe({
          conditions: [{ variable: "title", operator: "matches", value: "^new", regexFlags: "i" }],
        }),
      ).toBe("title matches /^new/i");
      expect(describe({ conditions: [{ feature: "foo", variation: "bar", enabled: false }] })).toBe(
        'foo is disabled with variation "bar"',
      );
    });

    it("gates rules on requirements and says what happens to everyone else", () => {
      const html = renderRules({
        conditions: { or: [{ feature: "foo" }, { feature: "bar" }] },
        rules: [{ key: "everyone", conditions: "*", percentage: 50 }],
      });
      expect(html).toContain(">Root conditions</h3>");
      expect(html).toContain(
        "Checked before these rules. When they are not met, the feature is disabled.",
      );
      expect(html).toContain('href="/features/foo"');
      expect(html).toContain(">or<");
      // The only rule targets everyone, so nobody falls through.
      expect(html).not.toContain("Users who match no rule above");
      expect(
        renderRules({ rules: [{ key: "nl", conditions: "netherlands", percentage: 100 }] }),
      ).toContain("Users who match no rule above get the feature disabled.");
    });

    it("leaves room for force entries, which decide before requirements and rules", () => {
      const forceOnly = renderRules({
        conditions: [{ feature: "foo" }],
        rules: { staging: [], production: [] },
        force: {
          staging: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "qa" }],
              enabled: true,
            },
          ],
        },
      });
      expect(forceOnly).not.toContain("disabled for everyone");
      expect(forceOnly).toContain("Only force entries can enable it here.");
      expect(forceOnly).toContain(
        "Force entries are checked first and apply even when these conditions are not met.",
      );

      const withRules = renderRules({
        rules: [{ key: "nl", conditions: "netherlands", percentage: 100 }],
        force: [{ conditions: "qa", enabled: false }],
      });
      expect(withRules).toContain(
        "Users matched by no force entry and no rule above get the feature disabled.",
      );

      // A force entry that only sets a variation does not decide whether the feature is enabled.
      const variationOnly = renderRules({
        rules: [],
        force: [{ conditions: "qa", variation: "treatment" }],
      });
      expect(variationOnly).toContain("The feature is disabled for everyone.");
    });

    it("shows every rule's outcome, including what it inherits", () => {
      const html = renderRules({
        variations: [
          { value: "control", weight: 10 },
          { value: "treatment", weight: 90 },
        ],
        rules: [
          { key: "qa", conditions: "qa", percentage: 100, variation: "treatment" },
          { key: "everyone", conditions: "*", percentage: 50 },
          { key: "off", conditions: "legacy", percentage: 100, enabled: false },
        ],
      });
      // Every rule gets an outcome, not only those that set something.
      expect(html.match(/>Outcome</g)).toHaveLength(3);
      expect(html.match(/by default/g)).toHaveLength(2);
      // Only the rule that names no variation and stays enabled falls back to the feature.
      expect(html.match(/Variation weights, from the feature/g)).toHaveLength(1);
    });

    it("compares environments with positions and weights as percentages", () => {
      const compared = renderRules(
        {
          rules: {
            staging: [
              { key: "qa", conditions: "qa", percentage: 100 },
              {
                key: "everyone",
                conditions: "*",
                percentage: 50,
                variationWeights: { control: 10, treatment: 90 },
              },
            ],
            production: [
              { key: "everyone", conditions: "*", percentage: 50, variation: "control" },
            ],
          },
        },
        "/features/checkout/rules?compare=staging,production",
      );
      expect(compared).toContain("Rules are paired by key.");
      expect(compared).toContain("#2 · #1");
      expect(compared).toContain("#1 · none");
      expect(compared).toContain("control 10%, treatment 90%");
      expect(compared).toContain("from feature weights");
    });

    it("explains an empty rule list as disabled for everyone", () => {
      const html = renderRules({ rules: { staging: [], production: [] } });
      expect(html).toContain("The feature is disabled for everyone in staging.");
      expect(html).not.toContain("evaluated only when");
    });

    it("words the environment comparison by what differs", () => {
      const rules = {
        staging: [
          { key: "internal", conditions: "qa", percentage: 100 },
          { key: "everyone", conditions: "*", percentage: 50 },
        ],
        production: [
          { key: "internal", conditions: "qa", percentage: 100 },
          { key: "everyone", conditions: "*", percentage: 10 },
        ],
      };
      expect(renderRules({ rules })).toContain("Compare environments");
      const compared = renderRules(
        { rules },
        "/features/checkout/rules?compare=staging,production",
      );
      expect(compared).toContain("1 of 2 rules differ. Differences are highlighted.");
      expect(compared).toContain("Done comparing");
      expect(compared).toContain(">vs<");
      const same = renderRules(
        { rules: { staging: rules.staging, production: rules.staging } },
        "/features/checkout/rules?compare=staging,production",
      );
      expect(same).toContain("Both environments are identical.");
    });
  });

  it("lets attribute values reveal their users only when the export lists them", () => {
    const html = render(
      <AttributeConditionValues
        values={[
          {
            path: "country",
            operator: "equals",
            uses: 2,
            values: ["nl", "de"],
            users: [[{ type: "segment", key: "netherlands" }], []],
          },
        ]}
      />,
    );
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(html).toContain(">nl</button>");
    expect(html).toContain(">de</code>");
  });

  it("keeps source links to one split button with Propose change behind the caret", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogProvider
          initialManifest={{
            ...manifest,
            links: {
              provider: "github",
              source: "https://github.com/acme/flags/blob/main/{{path}}",
              edit: "https://github.com/acme/flags/edit/main/{{path}}",
              commit: "https://github.com/acme/flags/commit/{{commit}}",
            },
          }}
        >
          <EditLink sourcePath="features/checkout.yml" />
        </CatalogProvider>
      </MemoryRouter>,
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://github.com/acme/flags/blob/main/features/checkout.yml"');
    expect(html).toContain("View on GitHub");
    expect(html).toContain('aria-label="More ways to open this file"');
    // The menu, and Propose change with it, only renders once the caret is opened.
    expect(html).not.toContain("Propose change");
  });

  it("encodes source paths and only calls an origin HEAD branch the default", () => {
    const linkFor = (links: Partial<NonNullable<CatalogManifest["links"]>>) =>
      renderToStaticMarkup(
        <MemoryRouter>
          <CatalogProvider
            initialManifest={{
              ...manifest,
              links: {
                provider: "github",
                source: "https://github.com/acme/flags/blob/main/{{path}}",
                commit: "https://github.com/acme/flags/commit/{{commit}}",
                ...links,
              },
            }}
          >
            <EditLink sourcePath="features/a#b/what?.yml" />
          </CatalogProvider>
        </MemoryRouter>,
      );
    expect(linkFor({})).toContain(
      'href="https://github.com/acme/flags/blob/main/features/a%23b/what%3F.yml"',
    );
    // Without an edit template there is nothing behind the caret.
    expect(linkFor({})).not.toContain("More ways to open this file");
  });

  it("filters and sorts lists by key or last change", () => {
    const at = (key: string, timestamp?: string): EntitySummary => ({
      key,
      href: "",
      description: `${key} flag`,
      ...(timestamp ? { lastModified: { commit: "c", author: "a", timestamp } } : {}),
    });
    const entities = [
      at("beta", "2026-01-02T00:00:00Z"),
      at("alpha10", "2026-01-03T00:00:00Z"),
      at("alpha2"),
      at("Alpha1", "2026-01-01T00:00:00Z"),
    ];
    const keys = (query: string, order: "name" | "-name" | "modified") =>
      getListEntities(entities, query, order).map((entity) => entity.key);

    expect(keys("", "name")).toEqual(["Alpha1", "alpha10", "alpha2", "beta"]);
    expect(keys("", "-name")).toEqual(["beta", "alpha2", "alpha10", "Alpha1"]);
    // Entities without history sort last, by key.
    expect(keys("", "modified")).toEqual(["alpha10", "beta", "Alpha1", "alpha2"]);
    expect(keys("alpha flag", "name")).toEqual(["Alpha1", "alpha10", "alpha2"]);
    // The source list is never reordered in place.
    expect(entities.map((entity) => entity.key)).toEqual(["beta", "alpha10", "alpha2", "Alpha1"]);
  });

  describe("variable overrides", () => {
    const renderOverrides = (entity: Record<string, unknown>) =>
      render(
        <Routes>
          <Route
            element={<Outlet context={{ detail: { type: "variable", key: "limit", entity } }} />}
          >
            <Route path="*" element={<VariableOverridesTab />} />
          </Route>
        </Routes>,
        "/variables/limit/overrides",
      );

    it("says how overrides combine and what everyone else gets", () => {
      const html = renderOverrides({
        defaultValue: 10,
        overrides: [{ key: "nl", conditions: "netherlands", value: 20 }],
      });
      expect(html).toContain("the first match supplies the value.");
      expect(html).not.toContain("continue lets later matches");
      expect(html).toContain("Users matched by no override get the default value");
      expect(html).toContain(">10</code>");

      const continued = renderOverrides({
        defaultValue: { limit: 10 },
        overrides: [
          { key: "nl", conditions: "netherlands", continue: true, mutate: { limit: 20 } },
          { key: "everyone", conditions: "*", value: { limit: 5 } },
        ],
      });
      expect(continued).toContain("continue lets later matches keep changing it.");
      // A catch-all override leaves nobody for the default.
      expect(continued).not.toContain("Users matched by no override");

      expect(renderOverrides({ defaultValue: 10, overrides: [] })).toContain(
        "Everyone gets the default value.",
      );
    });
  });

  describe("variations and variables", () => {
    const feature = {
      variablesSchema: {
        color: { type: "string", defaultValue: "blue" },
        methods: { type: "array", defaultValue: [] },
        size: { type: "integer", defaultValue: 1 },
      },
      variations: [
        { value: "control", weight: 50 },
        {
          value: "treatment",
          weight: 50,
          variables: { color: "red", "methods:appendUnique": "card" },
          variableOverrides: { color: [{ conditions: "nl", value: "orange" }] },
        },
      ],
      rules: {
        production: [{ key: "everyone", conditions: "*", percentage: 100, variables: { size: 2 } }],
      },
      force: { production: [{ conditions: "qa", variables: { color: "green" } }] },
    };
    const renderTab = (element: React.ReactNode, route: string) =>
      render(
        <Routes>
          <Route
            element={
              <Outlet context={{ detail: { type: "feature", key: "checkout", entity: feature } }} />
            }
          >
            <Route path="*" element={element} />
          </Route>
        </Routes>,
        route,
      );

    it("tabulates every variable against every variation", () => {
      const html = renderTab(<FeatureVariationsTab />, "/features/checkout/variations");
      expect(html).toContain("Variable values by variation");
      expect(html).toContain('href="/features/checkout/variations#treatment-variables-color"');
      // A mutation links to its own entry under the full key.
      expect(html).toContain(">mutated</a>");
      expect(html).toContain("treatment-variables-methods-appendunique");
      expect(html).toContain(">+1 override</a>");
      // Control sets nothing, so every cell reads default and the card says so.
      expect(html).toContain("Uses every variable&#x27;s default value.");
      // Short sections start open.
      expect(html).toContain('aria-expanded="true"');
      expect(html).not.toContain('aria-expanded="false"');
    });

    it("keeps a short section closed once the reader closes it", () => {
      const html = renderTab(
        <FeatureVariationsTab />,
        "/features/checkout/variations?variables-closed=treatment",
      );
      expect(html).toContain('aria-expanded="false"');
    });

    it("lists what sets each variable, counting mutations for their variable", () => {
      const setters = getVariableSetters(feature, "", "checkout");
      expect(setters.color.map((setter) => setter.label)).toEqual([
        "variation treatment",
        "variation treatment overrides",
        "force #1 in production",
      ]);
      expect(setters.methods).toEqual([
        {
          label: "variation treatment",
          to: "/features/checkout/variations#treatment-variables-methods-appendunique",
        },
      ]);
      expect(setters.size).toEqual([
        {
          label: "rule everyone in production",
          to: "/features/checkout/rules/production#rules-production-everyone",
        },
      ]);

      const html = renderTab(<FeatureVariablesTab />, "/features/checkout/variables");
      expect(html).toContain("Set by");
      expect(html).toContain(
        'href="/features/checkout/rules/production#rules-production-everyone"',
      );
    });
  });

  it("lists a Target's segments in its contents and overview", () => {
    const detail = {
      type: "target",
      key: "web",
      entity: { includeFeatures: ["checkout"] },
      relationships: {
        features: ["checkout"],
        variables: [],
        segments: ["countries.germany", "countries.netherlands"],
      },
    };
    const renderTab = (element: React.ReactNode, route: string) =>
      render(
        <Routes>
          <Route element={<Outlet context={{ detail }} />}>
            <Route path="*" element={element} />
          </Route>
        </Routes>,
        route,
      );
    const contents = renderTab(<UsageTab />, "/targets/web/contents");
    expect(contents).toContain("Segments in this target");
    expect(contents).toContain('href="/segments/countries.netherlands"');
    expect(renderTab(<OverviewTab />, "/targets/web")).toContain(
      "1 feature, 0 variables, 2 segments",
    );
  });

  it("starts long usage lists collapsed with a filter", () => {
    const usedBy = Array.from({ length: 20 }, (_, index) => ({
      type: "segment" as const,
      key: `segment${String(index).padStart(2, "0")}`,
      locations: ["conditions"],
    }));
    const html = render(
      <Routes>
        <Route
          element={
            <Outlet
              context={{ detail: { type: "attribute", key: "country", entity: {}, usedBy } }}
            />
          }
        >
          <Route path="*" element={<UsageTab />} />
        </Route>
      </Routes>,
      "/attributes/country/usage",
    );
    // Each entry links its key and its location, so count distinct entities.
    expect(new Set(html.match(/href="\/segments\/segment\d+"/g))).toHaveProperty("size", 12);
    expect(html).toContain("Show all 20 segments");
    expect(html).toContain('aria-label="Filter segments"');
  });

  it("names the type of every entity using a feature, so segments never read as features", () => {
    const detail = {
      type: "feature",
      key: "checkout",
      entity: {},
      usedBy: [
        { type: "feature", key: "banner", locations: ["conditions"] },
        { type: "segment", key: "ready", locations: ["conditions"] },
        { type: "variable", key: "limits", locations: ["overrides › production › eu"] },
      ],
    };
    const html = render(
      <Routes>
        <Route element={<Outlet context={{ detail }} />}>
          <Route path="*" element={<OverviewTab />} />
        </Route>
      </Routes>,
      "/features/checkout",
    );
    for (const [type, key] of [
      ["feature", "banner"],
      ["segment", "ready"],
      ["variable", "limits"],
    ]) {
      expect(html).toMatch(new RegExp(`>${type}</span>${key}</a>`));
    }
  });

  it("counts segment use through features and variables, and calls a dead chain unused", () => {
    const renderOverview = (detail: Record<string, unknown>) =>
      render(
        <Routes>
          <Route element={<Outlet context={{ detail }} />}>
            <Route path="*" element={<OverviewTab />} />
          </Route>
        </Routes>,
        "/segments/eu",
      );
    const used = renderOverview({
      type: "segment",
      key: "eu",
      entity: { conditions: [] },
      relationships: { features: ["a", "b", "c"], variables: ["v"] },
      usedBy: [
        { type: "feature", key: "a", locations: ["rules › production › eu"] },
        { type: "segment", key: "dach", locations: ["conditions"] },
      ],
    });
    expect(used).toContain("3 features · 1 variable");
    expect(used).toContain("directly by 1 feature and 1 segment");

    const unused = renderOverview({
      type: "segment",
      key: "eu",
      entity: { conditions: [] },
      relationships: { features: [], variables: [] },
      usedBy: [{ type: "segment", key: "orphan", locations: ["conditions"] }],
    });
    expect(unused).toContain("unused");
    expect(unused).toContain("only referred to by 1 segment that no feature or variable uses");
  });
});
