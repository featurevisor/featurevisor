import { readRecentEntities, recordRecentEntity } from "./recentEntities";

describe("Catalog recent entities", () => {
  const store = new Map<string, string>();
  let base = "/";

  beforeEach(() => {
    store.clear();
    base = "/";
    Object.assign(globalThis, {
      window: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
        },
      },
      document: {
        querySelector: () => ({ getAttribute: () => base }),
      },
    });
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  it("keeps the newest eight without duplicates", () => {
    for (let index = 0; index < 10; index++)
      recordRecentEntity({ type: "feature", key: `f${index}` });
    recordRecentEntity({ type: "feature", key: "f5" });
    const keys = readRecentEntities().map((item) => item.key);
    expect(keys).toEqual(["f5", "f9", "f8", "f7", "f6", "f4", "f3", "f2"]);
  });

  it("drops stored entries with unknown types or malformed fields, and caps what it reads", () => {
    store.set(
      "featurevisor-catalog:recent:/",
      JSON.stringify([
        { type: "group", key: "removed" },
        { type: "toString", key: "inherited" },
        { type: "feature", key: "" },
        { type: "feature", key: "ok", set: 3 },
        null,
        ...Array.from({ length: 12 }, (_, index) => ({ type: "segment", key: `s${index}` })),
      ]),
    );
    const recent = readRecentEntities();
    expect(recent).toHaveLength(8);
    expect(recent.every((item) => item.type === "segment")).toBe(true);
  });

  it("keeps separate lists for Catalogs under different base paths", () => {
    recordRecentEntity({ type: "feature", key: "checkout" });
    base = "/other/";
    expect(readRecentEntities()).toEqual([]);
    recordRecentEntity({ type: "variable", key: "limit", set: "dev" });
    expect(readRecentEntities()).toEqual([{ type: "variable", key: "limit", set: "dev" }]);
    base = "/";
    expect(readRecentEntities()).toEqual([{ type: "feature", key: "checkout" }]);
  });

  it("survives unreadable storage", () => {
    store.set("featurevisor-catalog:recent:/", "{not json");
    expect(readRecentEntities()).toEqual([]);
  });
});
