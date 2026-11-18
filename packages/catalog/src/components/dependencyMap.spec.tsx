import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import type { DependencyMap } from "../dependencyMap";
import { DependencyMapView, formatRevealed, parseRevealed } from "./dependencyMap";

const node = (id: string) => {
  const [type, key] = id.split(":");
  return { id, type, key } as DependencyMap["center"];
};

// checkout needs sidebar, and two more dependencies are left out
const map: DependencyMap = {
  center: node("feature:checkout"),
  dependencies: [[node("feature:sidebar")]],
  dependents: [[node("variable:banner")]],
  edges: [
    { from: "feature:sidebar", to: "feature:checkout" },
    { from: "feature:checkout", to: "variable:banner" },
  ],
  more: { dependencies: 2, dependents: 0 },
};

// Five columns of dependencies, one past the four a map shows at first
const deep: DependencyMap = {
  ...map,
  dependencies: [1, 2, 3, 4, 5].map((level) => [node(`feature:level${level}`)]),
  edges: [],
};

function render(shown: DependencyMap) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <DependencyMapView map={shown} />
    </MemoryRouter>,
  );
}

describe("dependency map view", () => {
  it("offers to show what a side leaves out, in the map itself", () => {
    const html = render(map);
    expect(html).toContain(">Show 2 more</button>");
    expect(html).not.toContain("Show fewer");
  });

  it("offers a way back once a side shows more than at first", () => {
    const partly = render(deep);
    expect(partly).toContain(">Show 2 more</button>");
    expect(partly).toContain(">Show fewer</button>");

    const all = render({ ...deep, more: { dependencies: 0, dependents: 0 } });
    expect(all).not.toContain(" more</button>");
    expect(all).toContain(">Show fewer</button>");
  });

  it("opens the full view from a click on the map, as its cursor says", () => {
    expect(render(map)).toContain("cursor-zoom-in");
  });

  it("offers no way back for a side the first limits show in full", () => {
    const html = render({ ...map, more: { dependencies: 0, dependents: 0 } });
    expect(html).not.toContain("</button>");
  });
});

describe("the map's ?more= parameter", () => {
  it("reads one value for both sides, or one for each", () => {
    expect(parseRevealed(null)).toEqual({ dependencies: 0, dependents: 0 });
    expect(parseRevealed("all")).toEqual({ dependencies: Infinity, dependents: Infinity });
    expect(parseRevealed("2")).toEqual({ dependencies: 2, dependents: 2 });
    expect(parseRevealed("1,all")).toEqual({ dependencies: 1, dependents: Infinity });
  });

  it("reads anything else as nothing asked for", () => {
    expect(parseRevealed("-1,1.5")).toEqual({ dependencies: 0, dependents: 0 });
    expect(parseRevealed("lots")).toEqual({ dependencies: 0, dependents: 0 });
  });

  it("writes as little as it can, and nothing for the map as it opens", () => {
    expect(formatRevealed({ dependencies: 0, dependents: 0 })).toBeUndefined();
    expect(formatRevealed({ dependencies: Infinity, dependents: Infinity })).toBe("all");
    expect(formatRevealed({ dependencies: 0, dependents: 1 })).toBe("0,1");
    expect(formatRevealed({ dependencies: Infinity, dependents: 0 })).toBe("all,0");
  });
});
