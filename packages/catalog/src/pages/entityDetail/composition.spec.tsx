import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { CompositionTable, OverviewTab } from "./OverviewTab";
import { CatalogProvider } from "../../context/CatalogContext";
import { VariableOverridesTab } from "./OverridesTab";
import { UsageTab } from "./UsageTab";
import type { EntityDetail } from "../../types";

jest.mock("react-markdown", () => () => null);

function renderDetail(
  detail: EntityDetail,
  tab = <OverviewTab />,
  setKey?: string,
  path = "/overrides",
) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <CatalogProvider
        initialManifest={{
          schemaVersion: "1",
          generatedAt: "",
          sets: !!setKey,
          setKeys: setKey ? [setKey] : [],
          projectConfig: { tags: [] },
          paths: { projectHistory: "history" },
          counts: {},
        }}
      >
        <Routes>
          <Route element={<Outlet context={{ detail, setKey }} />}>
            <Route path="overrides/:environmentKey?" element={tab} />
          </Route>
        </Routes>
      </CatalogProvider>
    </MemoryRouter>,
  );
}

test.each([
  { compose: { label: { variable: "source" } } },
  { compose: { label: { variable: "source" } }, disabledValue: { label: "Unavailable" } },
  { compose: "source" },
  { compose: "source", disabledValue: false },
  { compose: "source", disabledValue: 0 },
  { compose: "source", disabledValue: "" },
  { compose: "source", disabledValue: null },
])(
  "composition root gate is shown before sources, with the exact unavailable value: %j",
  (composition) => {
    const detail: EntityDetail = {
      type: "variable",
      key: "gated",
      entity: {
        ...composition,
        conditions: { or: ["premium", { feature: "checkout", enabled: false }] },
      },
    };
    const html = renderDetail(detail);
    expect(html).toContain(">Root conditions</h2>");
    expect(html).toContain(
      "Checked before composition sources and overrides. When they are not met, neither runs.",
    );
    expect(html).toContain('href="/segments/premium"');
    expect(html).toContain('href="/features/checkout"');
    expect(html).toContain("Returned when they are not met:");
    const unavailable = html.slice(
      html.indexOf("Returned when they are not met:"),
      html.indexOf("</section>", html.indexOf("Returned when they are not met:")),
    );
    const fallback = "disabledValue" in composition ? composition.disabledValue : null;
    if (fallback && typeof fallback === "object") expect(unavailable).toContain("Unavailable");
    else if (fallback === "") expect(unavailable).toContain("&quot;&quot;");
    else if (fallback === null) expect(unavailable).toContain(">null</code>");
    else expect(unavailable).toContain(`>${String(fallback)}</span>`);
    expect(html.indexOf(">Root conditions</h2>")).toBeLessThan(
      html.indexOf(typeof composition.compose === "string" ? ">Alias</h2>" : ">Composition</h2>"),
    );
    expect(html).not.toContain("Default value");
    const overrides = renderDetail(detail, <VariableOverridesTab />);
    expect(overrides).toContain(">Root conditions</h3>");
    expect(overrides).toContain(
      "Checked before composition sources and overrides. The values below apply only when these conditions are met.",
    );
    expect(overrides).toContain('href="/segments/premium"');
    expect(overrides).toContain('href="/features/checkout"');
  },
);

test.each([undefined, "release/eu"])(
  "composition overview has no environment or default UI in Set %s",
  (setKey) => {
    const detail: EntityDetail = {
      type: "variable",
      key: "config",
      environments: ["staging", "production"],
      entity: { compose: { enabled: { feature: "checkout" } } },
    };
    const html = renderDetail(detail, <OverviewTab />, setKey);
    expect(html).not.toContain("staging");
    expect(html).not.toContain("production");
    expect(html).not.toContain("Default value");
    expect(html).toContain(">object</span>");
    expect(html).toContain(">composed</span>");
    const overrides = renderDetail(detail, <VariableOverridesTab />, setKey);
    expect(overrides).toContain("No overrides found");
    expect(overrides).toContain("object assembled from the composition sources");
    expect(overrides).not.toMatch(/default value|staging|production/i);
  },
);

test.each([undefined, "release/eu"])(
  "string alias preserves source links and type in Set %s",
  (setKey) => {
    const detail: EntityDetail = {
      type: "variable",
      key: "alias",
      aliasSourceType: "json",
      entity: { compose: "checkout/source.with.dots" },
    };
    const html = renderDetail(detail, <OverviewTab />, setKey);
    expect(html).toContain(">Alias</h2>");
    expect(html).toContain(">json, decoded</span>");
    expect(html).toContain(
      "The alias receives the evaluated, decoded JSON value, which may be an object, array, scalar or null.",
    );
    expect(html).toContain(">composed</span>");
    expect(html).toContain("Returns the source variable value, including null.");
    expect(html).toContain(
      `${setKey ? "/sets/release%252Feu" : ""}/variables/checkout%252Fsource.with.dots`,
    );
    expect(html).not.toMatch(/<tbody|Default value|Structure|>object<|>Kind</);
    const empty = renderDetail(detail, <VariableOverridesTab />, setKey);
    expect(empty).toContain("Everyone gets the source variable value, including null.");
    expect(empty).not.toMatch(/default value|assembled object|Accumulating value preview/i);
    detail.entity = {
      ...detail.entity,
      overrides: [
        {
          key: "regional",
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
          value: null,
        },
      ],
    };
    const overrides = renderDetail(detail, <VariableOverridesTab />, setKey);
    expect(overrides).toContain("The source variable is evaluated first.");
    expect(overrides).toContain(
      "Users matched by no override keep the source variable value, including null.",
    );
    expect(overrides).not.toMatch(/default value|assembled object|Accumulating value preview/i);
  },
);

test.each([undefined, "release/eu"])(
  "usage distinguishes a string alias from a map property named alias in Set %s",
  (setKey) => {
    const detail: EntityDetail = {
      type: "variable",
      key: "policy",
      entity: { type: "object", defaultValue: {} },
      usedBy: [
        { type: "variable", key: "policyAlias", locations: ["alias of policy"] },
        { type: "variable", key: "screen", locations: ["compose alias", "compose policy"] },
      ],
    };
    const html = renderDetail(detail, <UsageTab />, setKey);
    expect(html).toContain("policyAlias");
    // The page is the source, so a string alias needs no repeat of its key.
    expect(html).toContain(">alias</a>");
    expect(html).not.toContain("alias of policy");
    expect(html).toContain(">property alias</a>");
    expect(html).toContain(">property policy</a>");
    expect(html).not.toMatch(/compose alias|compose policy|alias of screen/);
    expect(html).toContain(`href="${setKey ? "/sets/release%252Feu" : ""}/variables/policyAlias"`);
    const overview = renderDetail(
      { ...detail, usedBy: detail.usedBy!.slice(0, 1) },
      <OverviewTab />,
      setKey,
    );
    expect(overview).toContain("Composed by");
    expect(overview).not.toContain("Required by");
  },
);

test.each(["string", "object", "integer", "unknown"])(
  "non JSON alias type %s is not labelled decoded or given a structure",
  (type) => {
    const html = renderDetail({
      type: "variable",
      key: "policyAlias",
      entity: { compose: "policy" },
      aliasSourceType: type,
    });
    expect(html).toContain(`>${type}</span>`);
    expect(html).toContain(">Alias</h2>");
    expect(html).not.toMatch(/decoded|Structure|<th>Property/);
  },
);

test("ordinary object variables do not show a composed marker", () => {
  const html = renderDetail({
    type: "variable",
    key: "policy",
    entity: { type: "object", defaultValue: {} },
  });
  expect(html).toContain(">object</span>");
  expect(html).not.toContain(">composed</span>");
});

test.each([
  [undefined, false],
  [[], false],
  [{ staging: [], production: [] }, false],
  [[{ conditions: "*", key: "regional", mutate: { enabled: true } }], true],
  [{ staging: [], production: [{ key: "regional", value: { enabled: true } }] }, true],
])("composition caption reflects actual overrides (%j)", (overrides, hasOverrides) => {
  const html = renderDetail({
    type: "variable",
    key: "config",
    entity: { compose: { enabled: { feature: "checkout" } }, overrides },
  });
  expect(html.includes("Each property starts with its source value.")).toBe(hasOverrides);
  expect(html.includes("Overrides then run in order and can change it.")).toBe(hasOverrides);
  expect(html.includes("Each property contains its source value.")).toBe(!hasOverrides);
  expect(html).toContain("<th>Property</th>");
  expect(html).not.toMatch(/Each alias|<th>Alias</);
  expect(html).toContain("False and null values do not gate other members.");
});

test("composition overview uses exported source kinds without fetching source details", () => {
  const html = renderDetail({
    type: "variable",
    key: "screen",
    entity: {
      compose: {
        nested: { variable: "config" },
        ordinary: { variable: "policy" },
        featureVariable: { feature: "delivery", variable: "config" },
      },
    },
    composedSourceAliases: ["nested"],
  });
  expect(html).toMatch(/nested<\/span><\/td><td>Composed variable<\/td>/);
  expect(html).toMatch(/ordinary<\/span><\/td><td>Global variable<\/td>/);
  expect(html).toContain("Feature variable");
});

test.each([false, true])("composed overrides render authored behaviour, environments=%s", (env) => {
  const rows = [
    {
      key: "regional",
      conditions: [
        { attribute: "country", operator: "equals", value: "nl" },
        { feature: "checkout" },
      ],

      continue: true,
      mutate: { enabled: true },
      overrides: [
        {
          key: "premium",
          conditions: ["premiumUsers", { variable: "policy", operator: "equals", value: true }],

          value: { enabled: false },
        },
      ],
    },
  ];
  const detail: EntityDetail = {
    type: "variable",
    key: "config",
    entity: {
      compose: { enabled: { feature: "checkout" } },
      overrides: env ? { staging: rows, production: [] } : rows,
    },
    // Even an old or malformed export must not imply a static evaluated value.
    accumulationPreview: {
      [env ? "staging" : ""]: [{ path: ["regional"], continues: true, value: "fictional" }],
    },
  };
  const html = renderDetail(detail, <VariableOverridesTab />, "release/eu");
  for (const text of [
    "regional",
    "premium",
    "Nested overrides",
    "Conditions",
    "Mutation",
    "continues to next sibling",
    "All composition sources are evaluated first",
    "no override keep the object assembled",
  ])
    expect(html).toContain(text);
  expect(html).toContain('id="overrides-' + (env ? "staging-" : "") + 'regional-premium"');
  expect(html).not.toMatch(/default value|fictional|Accumulation when/i);
  expect(html.includes("Compare environments")).toBe(env);
  if (env) {
    const empty = renderDetail(
      detail,
      <VariableOverridesTab />,
      undefined,
      "/overrides/production",
    );
    expect(empty).toContain("No overrides found");
    expect(empty).not.toContain("regional");
    expect(empty).not.toMatch(/default value/i);
  } else {
    expect(html).not.toMatch(/staging|production/);
  }
});

test.each(["feature", "variable"] as const)(
  "%s sources show composition consumers without implying gating",
  (type) => {
    const html = renderDetail(
      {
        type,
        key: "checkout/cart",
        entity: type === "variable" ? { type: "boolean", defaultValue: false } : {},
        usedBy: [
          {
            type: "variable",
            key: "page/config",
            locations: ["compose enabled", "compose layout"],
          },
        ],
      },
      <OverviewTab />,
      "release/eu",
    );
    expect(html).toContain("Composed by");
    expect(html).not.toContain("Required by");
    expect(html).toContain('href="/sets/release%252Feu/variables/page%252Fconfig"');
  },
);

test("composed environment comparison shows variable selectors without evaluated values", () => {
  const html = renderDetail(
    {
      type: "variable",
      key: "config",
      entity: {
        compose: { enabled: { feature: "checkout" } },
        overrides: {
          staging: [
            {
              key: "eligible",
              conditions: [{ variable: "policy", operator: "equals", value: true }],
              continue: true,
              mutate: { enabled: false },
            },
          ],
          production: [],
        },
      },
    },
    <VariableOverridesTab />,
    undefined,
    "/overrides/staging?compare=staging,production",
  );
  for (const text of ["eligible", "conditions", "policy", "mutate", "continue", "Not defined"])
    expect(html).toContain(text);
  expect(html).not.toMatch(/default value|Accumulation when|Resulting value/i);
});

test("composition overview replaces ordinary default and structure sections", () => {
  const detail = {
    type: "variable",
    key: "config",
    entity: { description: "Composition", compose: { enabled: { feature: "checkout" } } },
  };
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <CatalogProvider
        initialManifest={{
          schemaVersion: "1",
          generatedAt: "",
          sets: false,
          setKeys: [],
          projectConfig: { tags: [] },
          paths: { projectHistory: "history" },
          counts: {},
        }}
      >
        <Routes>
          <Route element={<Outlet context={{ detail }} />}>
            <Route path="*" element={<OverviewTab />} />
          </Route>
        </Routes>
      </CatalogProvider>
    </MemoryRouter>,
  );
  expect(html).toContain("Composition");
  expect(html).toContain("object");
  expect(html).not.toContain("Default value");
  expect(html).not.toContain("Disabled value");
  expect(html).not.toContain("Structure");
});

test("composition shows all source kinds with encoded entity and Set links", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <CompositionTable
        setKey="release/eu"
        compose={{
          "enabled.v2": { feature: "checkout/cart" },
          layout: { feature: "checkout/cart", variation: true },
          label: { feature: "checkout/cart", variable: "button.label" },
          "policy/eu": { variable: "delivery/policy" },
        }}
      />
    </MemoryRouter>,
  );
  for (const text of [
    "Composition",
    "Property",
    "Kind",
    "Source",
    "Flag",
    "Variation",
    "Feature variable",
    "Global variable",
    "enabled.v2",
    "policy/eu",
    "button.label",
  ]) {
    expect(html.replace(/<wbr\/>/g, "")).toContain(text);
  }
  expect(html).toContain('href="/sets/release%252Feu/features/checkout%252Fcart"');
  expect(html).toContain(
    'href="/sets/release%252Feu/features/checkout%252Fcart/variables#button-label"',
  );
  expect(html).toContain('href="/sets/release%252Feu/variables/delivery%252Fpolicy"');
  expect(html).not.toContain("Default value");
});

test("feature variable sources link to the existing Variables tab anchor without Sets", () => {
  const html = renderDetail({
    type: "variable",
    key: "screen",
    entity: { compose: { label: { feature: "delivery", variable: "button.label" } } },
  });
  expect(html).toContain('href="/features/delivery/variables#button-label"');
  expect(html).toMatch(
    /href="[^"]*#button-label"[^>]*>delivery \/ <span[^>]*>button\.<wbr\/>label/,
  );
});
