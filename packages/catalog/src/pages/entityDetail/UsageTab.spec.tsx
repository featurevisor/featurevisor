import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

import { getEntityRoute } from "../../entityTypes";
import type { CatalogEntityType, EntityDetail } from "../../types";
import { UsageTab, formatUsageLocation } from "./UsageTab";

const cases: Array<{
  name: string;
  type: CatalogEntityType;
  location: string;
  suffix: string;
  environments?: string[];
}> = [
  {
    name: "flat rule key",
    type: "feature",
    location: "rules › conditions",
    suffix: "/rules#rules-conditions",
  },
  {
    name: "rule key with an environment and a logical group",
    type: "feature",
    location: "rules › production › conditions (inside OR)",
    suffix: "/rules/production#rules-production-conditions",
    environments: ["production"],
  },
  {
    name: "rule environment key",
    type: "feature",
    location: "rules › conditions › everyone",
    suffix: "/rules/conditions#rules-conditions-everyone",
    environments: ["conditions"],
  },
  {
    name: "flat override key",
    type: "variable",
    location: "overrides › conditions",
    suffix: "/overrides#overrides-conditions",
  },
  {
    name: "nested override key",
    type: "variable",
    location: "overrides › production › regional › conditions (inside NOT)",
    suffix: "/overrides/production#overrides-production-regional-conditions",
    environments: ["production"],
  },
  {
    name: "force environment key",
    type: "feature",
    location: "force › conditions › #1",
    suffix: "/force/conditions#force-conditions-1",
    environments: ["conditions"],
  },
  {
    name: "rule variable override under a rule key",
    type: "feature",
    location: "rules › production › conditions › variable overrides › variable colour › #1",
    suffix: "/rules/production#rules-production-conditions",
    environments: ["production"],
  },
  {
    name: "variation key",
    type: "feature",
    location: "variation conditions › variable overrides › variable colour › #1",
    suffix: "/variations#conditions-overrides-colour",
  },
  {
    name: "feature root conditions",
    type: "feature",
    location: "conditions › variable limit (inside AND)",
    suffix: "",
  },
  {
    name: "variable root conditions",
    type: "variable",
    location: "conditions",
    suffix: "",
  },
  {
    name: "segment root conditions",
    type: "segment",
    location: "conditions (inside OR)",
    suffix: "",
  },
];

describe.each([undefined, "release/eu"])("condition usage targets in Set %s", (setKey) => {
  it.each(cases)("preserves conditions as a $name", ({ type, location, suffix, environments }) => {
    const detail: EntityDetail = {
      type: "variable",
      key: "source",
      entity: {},
      environments,
      usedBy: [{ type, key: "owner/key", locations: [location] }],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ detail, setKey }} />}>
            <Route path="*" element={<UsageTab />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // Location links have plain text, unlike the owner's separate entity key link.
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(
      ([, href, label]) => [href, label],
    );
    const path = location.split(" (inside ")[0];
    if (type === "segment" && path === "conditions") {
      // Everything in a segment is its conditions, so only the grouping is shown.
      // The owner's own key link wraps its text, so no plain location link remains.
      expect(links).toEqual([]);
      expect(html).toContain(`href="${getEntityRoute(type, "owner/key", setKey)}"`);
      expect(html).toContain("inside OR");
      return;
    }
    expect(links).toContainEqual([
      getEntityRoute(type, "owner/key", setKey) + suffix,
      formatUsageLocation(path),
    ]);
  });
});

describe("usage location labels", () => {
  it.each([
    ["force › production › #2", "force › production › entry 2"],
    [
      "variation treatment › variable overrides › variable label › #1",
      "variation treatment › variable label › override 1",
    ],
    [
      "rules › production › eu › variable overrides › variable label › #3",
      "rules › production › eu › variable label › override 3",
    ],
    ["overrides › production › #2", "overrides › production › override 2"],
    ["rules › #1", "rules › rule 1"],
    ["alias of policy", "alias"],
    ["compose label", "property label"],
    ["conditions", "conditions"],
  ])("reads %s as %s", (location, label) => {
    expect(formatUsageLocation(location)).toBe(label);
  });
});

describe("dependencies on the Usage tab", () => {
  const render = (detail: EntityDetail) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ detail }} />}>
            <Route path="*" element={<UsageTab />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it("reads what an entity depends on from its own definition, with what each check reads", () => {
    const html = render({
      type: "feature",
      key: "banner",
      entity: {
        bucketBy: "userId",
        conditions: { or: [{ feature: "checkout", variation: "treatment" }, "premium"] },
        rules: {
          production: [
            {
              key: "limits",
              conditions: [
                {
                  feature: "payments",
                  variable: "limits",
                  path: ["daily"],
                  operator: "greaterThan",
                  value: 50,
                },
              ],
              percentage: 100,
            },
          ],
        },
      },
    });

    expect(html).toContain("Depends on");
    expect(html).toContain("has variation");
    expect(html).toContain("treatment");
    expect(html).toContain("inside OR");
    expect(html).toContain("rules › production › limits › variable limits");
    expect(html).toContain(".daily");
    expect(html).toContain(`href="${getEntityRoute("segment", "premium")}"`);
    expect(html).toContain(`href="${getEntityRoute("attribute", "userId")}"`);
    expect(html).not.toContain("Used by");
  });

  it("says what each direct user reads from this entity", () => {
    const html = render({
      type: "feature",
      key: "checkout",
      entity: {},
      usedBy: [
        {
          type: "variable",
          key: "copy",
          locations: ["compose label"],
          checks: [{ location: "compose label", compose: { variable: "buttonLabel" } }],
        },
        {
          type: "segment",
          key: "ready",
          locations: ["conditions (inside NOT)"],
          checks: [
            {
              location: "conditions (inside NOT)",
              condition: { feature: "checkout", enabled: false },
            },
          ],
        },
      ],
    });

    expect(html).toContain("composes variable");
    expect(html).toContain("buttonLabel");
    expect(html).toContain("is disabled");
    expect(html).toContain("inside NOT");
    expect(html).not.toContain("Depends on");
  });
});
