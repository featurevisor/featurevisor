import {
  decodeRouteSegment,
  encodeDataPath,
  encodeRouteSegment,
  entityLabels,
  entityPaths,
  entityPathToType,
  entityTypeToPath,
  getEntityListRoute,
  getEntityRoute,
} from "./entityTypes";

describe("catalog entity navigation", () => {
  it("exposes only supported entity sections", () => {
    expect(entityPaths).toEqual([
      "features",
      "variables",
      "attributes",
      "segments",
      "targets",
      "schemas",
      "tests",
    ]);
    expect(Object.keys(entityPathToType).sort()).toEqual([...entityPaths].sort());
    const types = Object.values(entityPathToType).sort();
    expect(Object.keys(entityTypeToPath).sort()).toEqual(types);
    expect(Object.keys(entityLabels).sort()).toEqual(types);
  });

  it.each(entityPaths)("keeps root and Set routes consistent for %s", (entityPath) => {
    const type = entityPathToType[entityPath];
    expect(entityTypeToPath[type]).toBe(entityPath);
    expect(getEntityListRoute(type)).toBe(`/${entityPath}`);
    expect(getEntityRoute(type, "checkout/cart")).toBe(`/${entityPath}/checkout%252Fcart`);
    expect(getEntityListRoute(type, "release/team")).toBe(`/sets/release%252Fteam/${entityPath}`);
    expect(getEntityRoute(type, "checkout/cart", "release/team")).toBe(
      `/sets/release%252Fteam/${entityPath}/checkout%252Fcart`,
    );
  });
});

describe("catalog entity path encoding", () => {
  it("keeps slash-namespaced keys in one browser route segment", () => {
    expect(encodeRouteSegment("checkout/redesign")).toBe("checkout%252Fredesign");
    expect(decodeRouteSegment("checkout%2Fredesign")).toBe("checkout/redesign");
  });

  it("maps slash-namespaced keys to nested data paths", () => {
    expect(encodeDataPath("checkout/redesign")).toBe("checkout/redesign");
    expect(encodeDataPath("checkout/new design")).toBe("checkout/new%20design");
  });
});
