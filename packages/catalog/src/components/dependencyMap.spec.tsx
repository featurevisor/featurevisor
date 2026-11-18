import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import type { DependencyMap } from "../dependencyMap";
import { DependencyMapView } from "./dependencyMap";

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

function render(revealed = { dependencies: 0, dependents: 0 }, more = map.more) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <DependencyMapView map={{ ...map, more }} revealed={revealed} />
    </MemoryRouter>,
  );
}

describe("dependency map view", () => {
  it("offers to show what a side leaves out, in the map itself", () => {
    const html = render();
    expect(html).toContain(">Show 2 more</button>");
    expect(html).not.toContain("Show fewer");
  });

  it("offers a way back once a side shows more", () => {
    const partly = render({ dependencies: 1, dependents: 0 });
    expect(partly).toContain(">Show 2 more</button>");
    expect(partly).toContain(">Show fewer</button>");

    const all = render({ dependencies: 1, dependents: 0 }, { dependencies: 0, dependents: 0 });
    expect(all).not.toContain(" more</button>");
    expect(all).toContain(">Show fewer</button>");
  });
});
