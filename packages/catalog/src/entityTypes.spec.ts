import { decodeRouteSegment, encodeDataPath, encodeRouteSegment } from "./entityTypes";

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
