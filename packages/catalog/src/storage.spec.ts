import {
  catalogStorageHash,
  getCatalogStorageGroup,
  isCatalogStoragePath,
  isCatalogStorageDescriptor,
  readCatalogStorageEntry,
  resolveCatalogStorage,
  type CatalogStorageDescriptor,
} from "./storage";

describe("Catalog storage resolution", () => {
  const indexURL = `data/blocks/${"a".repeat(64)}.json`;
  const detailsURL = `data/blocks/${"b".repeat(64)}.json`;
  const key = "data/root/entities/feature/team/my%20flag.json";
  const storage: CatalogStorageDescriptor = {
    version: 1,
    documents: { "data/root/index.json": indexURL },
    groups: {
      "data/root/entities/feature/details": [{ start: 0, end: 0xffffffff, blockURL: detailsURL }],
    },
  };

  it("resolves legacy, direct and grouped documents without decoding keys", () => {
    expect(resolveCatalogStorage(undefined, key)).toEqual({ blockURL: key });
    expect(resolveCatalogStorage(storage, "data/root/index.json")).toEqual({
      blockURL: indexURL,
    });
    expect(resolveCatalogStorage(storage, key)).toEqual({
      blockURL: detailsURL,
      entryKey: key,
    });
    expect(catalogStorageHash("hello")).toBe(0x4f9f2cab);
    expect(
      getCatalogStorageGroup("data/sets/dev/entities/feature/team/foo/history/page-2.json", 1),
    ).toBe("data/sets/dev/entities/feature/history");
    expect(getCatalogStorageGroup("data/project/history/page-1.json")).toBe("data/project/history");
  });

  it.each([
    null,
    {},
    { version: 2 },
    { version: 1, documents: null, groups: {} },
    { version: 1, documents: [], groups: {} },
    { version: 1, documents: { "data/root/index.json": null }, groups: {} },
    { version: 1, documents: { "data/root/index.json": "https://evil.test/a" }, groups: {} },
  ])("rejects malformed descriptors without throwing: %j", (invalid) => {
    expect(isCatalogStorageDescriptor(invalid)).toBe(false);
    expect(
      resolveCatalogStorage(invalid as CatalogStorageDescriptor, "data/root/index.json"),
    ).toBeUndefined();
  });

  it.each([
    null,
    {},
    [null],
    [{ start: 0, end: 0xffffffff, blockURL: undefined }],
    [{ start: -1, end: 0xffffffff }],
    [{ start: NaN, end: 0xffffffff }],
    [{ start: "0", end: 0xffffffff }],
    [{ start: 0.5, end: 0xffffffff }],
    [{ start: 0, end: Infinity }],
    [{ start: 0, end: 0x100000000 }],
    [{ start: 10, end: 9 }],
    [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
    ],
    [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ],
  ])("rejects malformed hash ranges: %j", (ranges) => {
    const value = {
      version: 1,
      documents: {},
      groups: {
        "data/root/entities/feature/details": Array.isArray(ranges)
          ? ranges.map((range) => range && { blockURL: detailsURL, ...range })
          : ranges,
      },
    } as unknown as CatalogStorageDescriptor;
    expect(isCatalogStorageDescriptor(value)).toBe(false);
    expect(resolveCatalogStorage(value, key)).toBeUndefined();
  });

  it("handles inclusive bounds, sparse ranges and immutable range snapshots", () => {
    const hash = catalogStorageHash(key);
    const ranges = [{ start: hash, end: hash, blockURL: detailsURL }];
    const value: CatalogStorageDescriptor = {
      version: 1,
      documents: {},
      groups: {
        "data/root/entities/feature/details": ranges,
      },
    };
    expect(resolveCatalogStorage(value, key)?.blockURL).toBe(detailsURL);
    ranges[0].start = NaN;
    ranges[0].blockURL = "https://evil.test";
    expect(resolveCatalogStorage(value, key)?.blockURL).toBe(detailsURL);
    expect(resolveCatalogStorage(value, `${key}missing.json`)).toBeUndefined();
  });

  it("rejects malformed history dictionaries and missing references", () => {
    const resolution = { blockURL: detailsURL, entryKey: key };
    for (const ref of ["__proto__", "constructor", "a".repeat(64), null, 1]) {
      expect(
        readCatalogStorageEntry(
          {
            $catalogHistory: 1,
            entries: {},
            pages: {
              [key]: { page: 1, entries: [ref] },
            },
          },
          resolution,
        ),
      ).toBeUndefined();
    }
    expect(
      readCatalogStorageEntry({ $catalogHistory: 2, entries: {}, pages: {} }, resolution),
    ).toBeUndefined();
    expect(
      readCatalogStorageEntry({ $catalogHistory: 1, entries: null, pages: {} }, resolution),
    ).toBeUndefined();
  });

  it("returns missing entries without inheriting prototype keys", () => {
    expect(resolveCatalogStorage(storage, "data/root/missing.json")).toBeUndefined();
    const resolution = resolveCatalogStorage(storage, key)!;
    expect(readCatalogStorageEntry({}, resolution)).toBeUndefined();
    expect(
      readCatalogStorageEntry(Object.create({ [key]: "inherited" }), resolution),
    ).toBeUndefined();
    expect(readCatalogStorageEntry({ [key]: false }, resolution)).toBe(false);
    expect(readCatalogStorageEntry({}, { blockURL: "", entryKey: "__proto__" })).toBeUndefined();
    expect(
      readCatalogStorageEntry(JSON.parse('{"__proto__":42}'), {
        blockURL: "",
        entryKey: "__proto__",
      }),
    ).toBe(42);
  });

  it.each([
    "../data/root.json",
    "/data/root.json",
    "data/../outside.json",
    "data/%2e%2e/outside.json",
    "data/root\\outside.json",
    "data/root//foo.json",
    "data/%2Fetc/file.json",
    "data/root.json?x",
    "data/root.json#x",
    "data/%zz.json",
  ])("rejects unsafe path %s", (key) => {
    expect(isCatalogStoragePath(key)).toBe(false);
    expect(resolveCatalogStorage(storage, key)).toBeUndefined();
  });
});
