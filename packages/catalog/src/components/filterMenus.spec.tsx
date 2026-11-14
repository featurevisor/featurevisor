import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FilterMenus,
  getFilterFacets,
  removeTokens,
  toggleToken,
  type FilterChip,
} from "./filterMenus";

const chips: FilterChip[] = [
  { label: "production", token: "in:production", group: "Environment" },
  { label: "staging", token: "in:staging", group: "Environment" },
  { label: "With variations", token: "with:variations", group: "Contains" },
  { label: "Without tests", token: "without:tests", group: "Status" },
  { label: "Required by others", token: "with:dependents", group: "Dependencies" },
  { label: "Deprecated", token: "deprecated:true", group: "Status" },
  { label: "web", token: "tag:web", group: "Tags" },
  { label: "ios", token: "tag:ios", group: "Tags" },
  { label: "android", token: "tag:android", group: "Tags" },
];

describe("filter menus", () => {
  it("gives each kind of filter a menu, and small kinds share Properties under headings", () => {
    const facets = getFilterFacets(chips);
    expect(facets.map(({ name }) => name)).toEqual(["Environment", "Properties", "Tags"]);
    expect(facets[0].sections).toEqual([{ heading: undefined, chips: chips.slice(0, 2) }]);
    // Sections keep the order their first filter appears in, gathering the rest of each kind
    expect(
      facets[1].sections.map(({ heading, chips }) => [heading, chips.map(({ label }) => label)]),
    ).toEqual([
      ["Contains", ["With variations"]],
      ["Status", ["Without tests", "Deprecated"]],
      ["Dependencies", ["Required by others"]],
    ]);
    expect(facets[1].chips.map(({ token }) => token)).toEqual([
      "with:variations",
      "without:tests",
      "deprecated:true",
      "with:dependents",
    ]);
  });

  it("names a shared menu after its only kind", () => {
    const facets = getFilterFacets([
      { label: "Used", token: "with:usage", group: "Usage" },
      { label: "Unused", token: "without:usage", group: "Usage" },
      { label: "string", token: "type:string", group: "Type" },
      { label: "date-time", token: "format:date-time", group: "Format" },
    ]);
    expect(facets.map(({ name }) => name)).toEqual(["Usage", "Type"]);
    expect(facets[1].sections.map(({ heading }) => heading)).toEqual(["Type", "Format"]);
  });

  it("toggles one token and resets only the filters' own", () => {
    expect(toggleToken("checkout", "in:production")).toBe("checkout in:production");
    expect(toggleToken("checkout IN:production", "in:production")).toBe("checkout");
    expect(removeTokens("tag:web checkout in:staging owner:me", ["tag:web", "in:staging"])).toBe(
      "checkout owner:me",
    );
  });

  function render(query: string) {
    return renderToStaticMarkup(<FilterMenus query={query} chips={chips} onChange={() => {}} />);
  }

  it("shows a closed button per menu, naming what it has on", () => {
    const idle = render("checkout");
    expect(idle).toContain('role="group" aria-label="Filters"');
    expect(idle.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    expect(idle).toContain('aria-expanded="false"');
    expect(idle).not.toContain('role="dialog"');
    expect(idle).toContain("border-dashed");
    expect(idle).not.toContain(">Reset");

    const two = render("in:production tag:web tag:ios");
    expect(two).toMatch(/>Environment<\/span>.*>production<\/span>/);
    expect(two).toMatch(/>Tags<\/span>.*>web<\/span>.*>ios<\/span>/);
    expect(two).toContain(">Reset");

    // More than two on read as a count, so a button stays short
    expect(render("tag:web tag:ios tag:android")).toContain(">3 selected</span>");
  });

  it("offers nothing when a list has no filters", () => {
    expect(renderToStaticMarkup(<FilterMenus query="" chips={[]} onChange={() => {}} />)).toBe("");
  });
});
