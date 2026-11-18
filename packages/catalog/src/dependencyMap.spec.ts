import {
  DEPENDENCY_MAP_LIMITS,
  getDependencyMap,
  getRevealedLimits,
  showsMoreThanAtFirst,
} from "./dependencyMap";
import type { CatalogIndex, EntityDetail } from "./types";

// discount needs sidebar and buckets by userId. sidebar needs two segments, which both read
// country, so the map has a diamond. checkout and banner need discount.
const index = {
  entities: {
    attribute: [
      { key: "country", href: "" },
      { key: "userId", href: "" },
    ],
    segment: [
      { key: "germany", href: "", references: ["attribute:country"] },
      { key: "netherlands", href: "", references: ["attribute:country"] },
    ],
    feature: [
      { key: "sidebar", href: "", references: ["segment:germany", "segment:netherlands"] },
      { key: "discount", href: "", references: ["feature:sidebar", "attribute:userId"] },
      { key: "checkout", href: "", references: ["feature:discount"] },
    ],
    variable: [{ key: "banner", href: "", references: ["feature:discount"] }],
  },
} as unknown as CatalogIndex;

const discount: EntityDetail = {
  type: "feature",
  key: "discount",
  entity: {
    bucketBy: "userId",
    conditions: [{ feature: "sidebar", enabled: true }],
    rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
  },
  usedBy: [
    { type: "feature", key: "checkout", locations: ["conditions"] },
    { type: "variable", key: "banner", locations: ["conditions"] },
  ],
};

const ids = (columns: Array<Array<{ id: string }>>) =>
  columns.map((column) => column.map(({ id }) => id));

describe("dependency map", () => {
  it("puts what an entity depends on to its left and what depends on it to its right", () => {
    const map = getDependencyMap(discount, index)!;
    expect(map.center).toEqual({ id: "feature:discount", type: "feature", key: "discount" });
    expect(ids(map.dependencies)).toEqual([
      ["feature:sidebar", "attribute:userId"],
      ["segment:germany", "segment:netherlands"],
      ["attribute:country"],
    ]);
    expect(ids(map.dependents)).toEqual([["feature:checkout", "variable:banner"]]);
    expect(map.more).toEqual({ dependencies: 0, dependents: 0 });
  });

  it("draws every line from what is depended on to what depends on it", () => {
    const edges = getDependencyMap(discount, index)!.edges.map(({ from, to }) => `${from} > ${to}`);
    expect(edges.sort()).toEqual(
      [
        "feature:sidebar > feature:discount",
        "attribute:userId > feature:discount",
        // the diamond meets once, with a line from each side
        "segment:germany > feature:sidebar",
        "segment:netherlands > feature:sidebar",
        "attribute:country > segment:germany",
        "attribute:country > segment:netherlands",
        "feature:discount > feature:checkout",
        "feature:discount > variable:banner",
      ].sort(),
    );
  });

  it("keeps each column short and says how many it leaves out", () => {
    const narrow = getDependencyMap(discount, index, { levels: 4, perColumn: 1 })!;
    expect(ids(narrow.dependencies)).toEqual([
      ["feature:sidebar"],
      ["segment:germany"],
      ["attribute:country"],
    ]);
    // userId and netherlands
    expect(narrow.more).toEqual({ dependencies: 2, dependents: 1 });

    const shallow = getDependencyMap(discount, index, { levels: 1, perColumn: 24 })!;
    expect(ids(shallow.dependencies)).toEqual([["feature:sidebar", "attribute:userId"]]);
    expect(shallow.more.dependencies).toBe(3);
  });

  it("limits each side apart, so one side can show more than the other", () => {
    const map = getDependencyMap(discount, index, {
      dependencies: { levels: 1, perColumn: 24 },
      dependents: { levels: 4, perColumn: 1 },
    })!;
    expect(ids(map.dependencies)).toEqual([["feature:sidebar", "attribute:userId"]]);
    expect(ids(map.dependents)).toEqual([["feature:checkout"]]);
    expect(map.more).toEqual({ dependencies: 3, dependents: 1 });
  });

  it("shows four more columns and four times the entities each time a reader asks for more", () => {
    expect(getRevealedLimits(0)).toEqual(DEPENDENCY_MAP_LIMITS);
    expect(getRevealedLimits(1)).toEqual({ levels: 8, perColumn: 96 });
    expect(getRevealedLimits(2)).toEqual({ levels: 12, perColumn: 384 });
  });

  it("shows everything when a reader asks for all of it", () => {
    expect(getRevealedLimits(Infinity)).toEqual({ levels: Infinity, perColumn: Infinity });
    const all = getDependencyMap(discount, index, getRevealedLimits(Infinity))!;
    expect(all.more).toEqual({ dependencies: 0, dependents: 0 });
    expect(all.dependencies.flat()).toHaveLength(5);
  });

  it("knows when a side shows more than the first limits allow", () => {
    const column = (size: number) =>
      Array.from({ length: size }, (_, index) => ({
        id: `feature:f${index}`,
        type: "feature" as const,
        key: `f${index}`,
      }));
    expect(showsMoreThanAtFirst([column(24), column(1), column(1), column(1)])).toBe(false);
    expect(showsMoreThanAtFirst([column(25)])).toBe(true);
    expect(showsMoreThanAtFirst([1, 2, 3, 4, 5].map(() => column(1)))).toBe(true);
  });

  it("walks dependents outwards as far as they go", () => {
    const country: EntityDetail = {
      type: "attribute",
      key: "country",
      entity: {},
      usedBy: [
        { type: "segment", key: "germany", locations: ["conditions"] },
        { type: "segment", key: "netherlands", locations: ["conditions"] },
      ],
    };
    const map = getDependencyMap(country, index)!;
    expect(map.dependencies).toEqual([]);
    expect(ids(map.dependents)).toEqual([
      ["segment:germany", "segment:netherlands"],
      ["feature:sidebar"],
      ["feature:discount"],
      ["feature:checkout", "variable:banner"],
    ]);
  });

  it("knows only direct neighbours before the index loads, and nothing without any", () => {
    const map = getDependencyMap(discount, null)!;
    expect(ids(map.dependencies)).toEqual([["feature:sidebar", "attribute:userId"]]);
    expect(ids(map.dependents)).toEqual([["feature:checkout", "variable:banner"]]);

    expect(
      getDependencyMap({ type: "attribute", key: "plan", entity: {}, usedBy: [] }, index),
    ).toBeUndefined();
  });
});
