import { getPageKey } from "./errorBoundary";

describe("page keys", () => {
  it("counts every entity's page on one tab as one page", () => {
    expect(getPageKey("/features/checkout/usage")).toBe("/:entity/usage");
    expect(getPageKey("/segments/countries.nl/usage")).toBe("/:entity/usage");
    expect(getPageKey("/sets/web/features/checkout")).toBe("/sets/web/:entity");
    expect(getPageKey("/features/checkout/rules/production")).toBe("/:entity/rules/production");
  });

  it("keeps every other page apart", () => {
    expect(getPageKey("/features")).toBe("/features");
    expect(getPageKey("/sets/web/segments")).toBe("/sets/web/segments");
    expect(getPageKey("/history")).toBe("/history");
  });
});
