import { getCatalogBasePath } from "./basePath";

describe("Catalog browser base", () => {
  afterEach(() => {
    delete (globalThis as any).document;
  });

  it("defaults to root outside the browser and without a marker", () => {
    expect(getCatalogBasePath()).toBe("/");
    Object.assign(globalThis, { document: { querySelector: () => null } });
    expect(getCatalogBasePath()).toBe("/");
  });

  it("reads the meta content rather than a base element", () => {
    const getAttribute = jest.fn(() => "/internal/catalog/");
    const querySelector = jest.fn(() => ({ getAttribute }));
    Object.assign(globalThis, { document: { querySelector } });
    expect(getCatalogBasePath()).toBe("/internal/catalog/");
    expect(querySelector).toHaveBeenCalledWith('meta[name="featurevisor-catalog-base"]');
    expect(getAttribute).toHaveBeenCalledWith("content");
  });
});
