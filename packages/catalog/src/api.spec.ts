import { fetchEntityDetail } from "./api";
import { encodeCatalogIndex } from "./indexCodec";
import { entityTypeToPath } from "./entityTypes";
import type { CatalogIndex } from "./types";
import type { CatalogStorageDescriptor } from "./storage";

describe("catalog API", () => {
  it("loads slash-namespaced entity details from nested data paths", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ key: "checkout/redesign" }),
    } as Response);

    await fetchEntityDetail("feature", "checkout/redesign");

    expect(fetchMock).toHaveBeenCalledWith("/data/root/entities/feature/checkout/redesign.json");
  });
});

describe("Catalog browser cache", () => {
  let api: typeof import("./api");
  let fetchMock: jest.SpyInstance;
  const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;

  beforeEach(() => {
    jest.resetModules();
    api = require("./api");
    fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (url) => response({ key: url }));
  });

  describe.each(["browser", "hash"] as const)("subpath data in %s mode", (mode) => {
    beforeEach(() => {
      api.setCatalogRouterMode(mode);
      Object.assign(globalThis, {
        document: { querySelector: () => ({ getAttribute: () => "/internal/catalog/" }) },
      });
    });
    afterEach(() => {
      delete (globalThis as any).document;
    });

    it("prefixes manifests, encoded legacy entities and history", async () => {
      await api.fetchManifest();
      await api.fetchEntityDetail("feature", "checkout/100% β", "release β");
      await api.fetchHistoryPage("data/project/history", 1);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "/internal/catalog/data/manifest.json",
        "/internal/catalog/data/sets/release%20%CE%B2/entities/feature/checkout/100%25%20%CE%B2.json",
        "/internal/catalog/data/project/history/page-1.json",
      ]);
    });

    it("keeps manifest retries inside the configured mount", async () => {
      fetchMock.mockRejectedValueOnce(new Error("transient"));
      await api.fetchManifest();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "/internal/catalog/data/manifest.json",
        "/internal/catalog/data/manifest.json",
      ]);
    });

    it("prefixes content addressed blocks without changing their logical identities", async () => {
      const logical = "data/root/entities/feature/checkout/cart.json";
      const blockURL = `data/blocks/${"a".repeat(64)}.json`;
      api.setCatalogStorage({ version: 2, documents: { [logical]: blockURL }, groups: {} });
      fetchMock.mockResolvedValue(response({ key: "checkout/cart" }));
      expect(await api.fetchEntityDetail("feature", "checkout/cart")).toEqual({
        key: "checkout/cart",
      });
      expect(fetchMock).toHaveBeenCalledWith(`/internal/catalog/${blockURL}`);
    });
  });

  it("decodes a complete index in one request and preserves peek identity", async () => {
    const index = {
      set: "root",
      counts: Object.fromEntries(Object.keys(entityTypeToPath).map((type) => [type, 1])),
      entities: Object.fromEntries(
        Object.keys(entityTypeToPath).map((type) => [
          type,
          [{ key: "item", href: "/item", description: "search me", tags: ["tag"] }],
        ]),
      ),
    } as CatalogIndex;
    fetchMock.mockResolvedValue(response(encodeCatalogIndex(index)));
    expect(api.peekIndex()).toBeUndefined();
    const result = await api.fetchIndex();
    expect(result).toEqual(index);
    expect(api.peekIndex()).toBe(result);
    expect(await api.fetchIndex()).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response(index));
    expect(await api.fetchIndex("legacy")).toEqual(index);
  });

  it("deduplicates pending requests even after TTL expiry and under eviction pressure", async () => {
    let resolve!: (value: Response) => void;
    const deferred = new Promise<Response>((done) => {
      resolve = done;
    });
    fetchMock.mockImplementation((url) =>
      url.endsWith("/pending.json") ? deferred : Promise.resolve(response({})),
    );
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    api.setCatalogCacheTtl(10);
    const first = api.fetchEntityDetail("feature", "pending");
    now = 100;
    for (let i = 0; i < 130; i++) await api.fetchEntityDetail("feature", String(i));
    expect(api.fetchEntityDetail("feature", "pending")).toBe(first);
    expect(api.peekEntityDetail("feature", "pending")).toBeUndefined();
    resolve(response({ key: "pending" }));
    const value = await first;
    expect(api.peekEntityDetail("feature", "pending")).toBe(value);
    now = 110;
    expect(api.peekEntityDetail("feature", "pending")).toBeUndefined();
  });

  it("evicts the least recently used settled entry and promotes peeks", async () => {
    for (let i = 0; i < 128; i++) await api.fetchEntityDetail("feature", String(i));
    expect(api.peekEntityDetail("feature", "0")).toBeDefined();
    await api.fetchEntityDetail("feature", "128");
    expect(api.peekEntityDetail("feature", "0")).toBeDefined();
    expect(api.peekEntityDetail("feature", "1")).toBeUndefined();
    await api.fetchEntityDetail("feature", "1");
    expect(fetchMock).toHaveBeenCalledTimes(130);
  });

  it("applies a shared byte budget and does not retain oversized responses", async () => {
    fetchMock.mockResolvedValue(response({ text: "x".repeat(3 * 1024 * 1024) }));
    await api.fetchEntityDetail("feature", "a");
    await api.fetchHistoryPage("data/history", 1);
    await api.fetchEntityDetail("feature", "b");
    expect(api.peekEntityDetail("feature", "a")).toBeUndefined();
    expect(api.peekEntityDetail("feature", "b")).toBeDefined();
    fetchMock.mockResolvedValue(response({ text: "x".repeat(8 * 1024 * 1024) }));
    await api.fetchEntityDetail("feature", "large");
    expect(api.peekEntityDetail("feature", "large")).toBeUndefined();
    expect(api.peekEntityDetail("feature", "b")).toBeDefined();
  });

  it("retries failures without disturbing cached responses or a subsequent request", async () => {
    await api.fetchEntityDetail("feature", "stable");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const failed = api.fetchEntityDetail("feature", "retry");
    expect(api.fetchEntityDetail("feature", "retry")).toBe(failed);
    await expect(failed).rejects.toThrow("offline");
    const value = await api.fetchEntityDetail("feature", "retry");
    expect(api.peekEntityDetail("feature", "retry")).toBe(value);
    expect(api.peekEntityDetail("feature", "stable")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache decode failures", async () => {
    fetchMock.mockResolvedValue(response({ format: "unknown" }));
    await expect(api.fetchIndex()).rejects.toThrow("Invalid Catalog index");
    expect(api.peekIndex()).toBeUndefined();
    await expect(api.fetchIndex()).rejects.toThrow("Invalid Catalog index");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retain responses with zero TTL and isolates router and set URLs", async () => {
    api.setCatalogCacheTtl(0);
    const first = api.fetchEntityDetail("feature", "same");
    expect(api.fetchEntityDetail("feature", "same")).toBe(first);
    await first;
    expect(api.peekEntityDetail("feature", "same")).toBeUndefined();
    await api.fetchEntityDetail("feature", "same");
    api.setCatalogCacheTtl(Infinity);
    await api.fetchEntityDetail("feature", "same", "set");
    api.setCatalogRouterMode("hash");
    await api.fetchEntityDetail("feature", "same", "set");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/data/root/entities/feature/same.json",
      "/data/root/entities/feature/same.json",
      "/data/sets/set/entities/feature/same.json",
      "data/sets/set/entities/feature/same.json",
    ]);
  });

  describe("compact storage", () => {
    const firstPath = "data/root/entities/feature/checkout/redesign.json";
    const secondPath = "data/root/entities/feature/other.json";
    const physical = (id: number) => `data/blocks/${id.toString(16).padStart(64, "0")}.json`;
    const blockURL = physical(100);
    const descriptor = (): CatalogStorageDescriptor => ({
      version: 1,
      documents: {},
      groups: {
        "data/root/entities/feature/details": [{ start: 0, end: 0xffffffff, blockURL }],
      },
    });
    const index = (): CatalogIndex =>
      ({
        set: "root",
        counts: Object.fromEntries(Object.keys(entityTypeToPath).map((type) => [type, 0])),
        entities: Object.fromEntries(Object.keys(entityTypeToPath).map((type) => [type, []])),
      }) as CatalogIndex;

    it("keeps manifest fetching independent and rejects invalid descriptors", async () => {
      const storage = descriptor();
      fetchMock.mockResolvedValue(response({ storage }));
      const manifest = await api.fetchManifest();
      expect(manifest.storage).toEqual(storage);
      expect(fetchMock).toHaveBeenCalledWith("/data/manifest.json");
      api.setCatalogStorage(manifest.storage);
      expect(() =>
        api.setCatalogStorage({ ...storage, version: 3 } as unknown as CatalogStorageDescriptor),
      ).toThrow("Invalid Catalog storage descriptor");
      await expect(api.fetchIndex()).rejects.toBeInstanceOf(api.CatalogNotFoundError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("deduplicates a shared physical block and peeks neighbouring details", async () => {
      api.setCatalogStorage(descriptor());
      const first = { key: "checkout/redesign" };
      const second = { key: "other" };
      fetchMock.mockResolvedValue(response({ [firstPath]: first, [secondPath]: second }));
      const requests = [
        api.fetchEntityDetail("feature", "checkout/redesign"),
        api.fetchEntityDetail("feature", "other"),
      ];
      expect(await Promise.all(requests)).toEqual([first, second]);
      expect(api.peekEntityDetail("feature", "other")).toBe(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`/${blockURL}`);
      await expect(api.fetchEntityDetail("feature", "absent")).rejects.toBeInstanceOf(
        api.CatalogNotFoundError,
      );
      expect(api.peekEntityDetail("feature", "absent")).toBeUndefined();
      expect(await api.fetchEntityDetail("feature", "other")).toBe(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses encoded set and entity paths and relative physical URLs in hash mode", async () => {
      api.setCatalogRouterMode("hash");
      const storage = descriptor();
      storage.groups = {
        "data/sets/release%20%CE%B2/entities/feature/details": [
          { start: 0, end: 0xffffffff, blockURL },
        ],
      };
      const logical = "data/sets/release%20%CE%B2/entities/feature/checkout/100%25%20%CE%B2.json";
      const detail = { key: "checkout/100% β" };
      fetchMock.mockResolvedValue(response({ [logical]: detail }));
      api.setCatalogStorage(storage);
      expect(await api.fetchEntityDetail("feature", detail.key, "release β")).toBe(detail);
      expect(api.peekEntityDetail("feature", detail.key, "release β")).toBe(detail);
      expect(fetchMock).toHaveBeenCalledWith(blockURL);
    });

    it("caches standalone compact indexes by physical identity and bounds decoded retention", async () => {
      const storage = descriptor();
      for (let i = 0; i < 70; i++) {
        storage.documents[`data/sets/${i}/index.json`] = physical(i);
      }
      api.setCatalogStorage(storage);
      fetchMock.mockResolvedValue(response(encodeCatalogIndex(index())));
      for (let i = 0; i < 70; i++) {
        const pending = api.fetchIndex(String(i));
        expect(api.fetchIndex(String(i))).toBe(pending);
        const loaded = await pending;
        expect(loaded).toEqual(index());
        expect(api.peekIndex(String(i))).toBe(loaded);
      }
      expect(fetchMock).toHaveBeenCalledTimes(70);
      expect(api.peekIndex("0")).toBeUndefined();
      expect(api.peekIndex("69")).toBeDefined();
      const next = descriptor();
      next.documents["data/root/index.json"] = physical(69);
      api.setCatalogStorage(next);
      expect(await api.fetchIndex()).toBe(api.peekIndex());
      expect(fetchMock).toHaveBeenCalledTimes(70);
      expect(fetchMock).toHaveBeenLastCalledWith(`/${physical(69)}`);
    });

    it("keeps absent logical pages distinct from failed physical blocks", async () => {
      const storage = descriptor();
      storage.groups["data/project/history"] = [{ start: 0, end: 0xffffffff, blockURL }];
      api.setCatalogStorage(storage);
      fetchMock.mockResolvedValue(response({}));
      expect((await api.fetchHistoryPage("data/project/history", 1)).entries).toEqual([]);
      await expect(api.fetchHistoryPage("data/project/history", 2)).rejects.toBeInstanceOf(
        api.CatalogNotFoundError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await api.fetchHistoryPage("data/root/history", 1)).entries).toEqual([]);
      await expect(api.fetchIndex()).rejects.toBeInstanceOf(api.CatalogNotFoundError);
      await expect(api.fetchEntityDetail("segment", "missing")).rejects.toBeInstanceOf(
        api.CatalogNotFoundError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      api.setCatalogCacheTtl(0);
      fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
      await expect(api.fetchHistoryPage("data/project/history", 1)).rejects.toBeInstanceOf(
        api.CatalogNotFoundError,
      );
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
      } as Response);
      await expect(api.fetchEntityDetail("feature", "other")).rejects.toBeInstanceOf(
        api.CatalogNotFoundError,
      );
    });

    it("extracts history pages from the same block without extra requests", async () => {
      const storage = descriptor();
      storage.groups["data/root/entities/feature/history"] = [
        { start: 0, end: 0xffffffff, blockURL },
      ];
      const page = { page: 1, pageSize: 50, totalPages: 1, entries: [] };
      fetchMock.mockResolvedValue(
        response({
          [secondPath]: { key: "other" },
          "data/root/entities/feature/other/history/page-1.json": page,
        }),
      );
      api.setCatalogStorage(storage);
      await api.fetchEntityDetail("feature", "other");
      expect(await api.fetchHistoryPage("/data/root/entities/feature/other/history", 1)).toBe(page);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("expands history dictionaries from one cached block without retaining expanded pages", async () => {
      const storage = descriptor();
      storage.groups["data/root/entities/feature/history"] = [
        { start: 0, end: 0xffffffff, blockURL },
      ];
      const entryKey = "a".repeat(64);
      const entry = {
        commit: "shared",
        author: "author",
        timestamp: "2026-09-30T10:00:00Z",
        entities: Array.from({ length: 5000 }, (_, i) => ({ type: "feature", key: String(i) })),
      };
      const page = { page: 1, pageSize: 50, totalPages: 1, entries: [entryKey] };
      const path = "data/root/entities/feature/other/history";
      const neighbour = "data/root/entities/feature/checkout/redesign/history";
      const block = Object.freeze({
        $catalogHistory: 1,
        entries: Object.freeze({ [entryKey]: entry }),
        pages: Object.freeze({ [`${path}/page-1.json`]: page, [`${neighbour}/page-1.json`]: page }),
      });
      const before = JSON.stringify(block);
      api.setCatalogStorage(storage);
      fetchMock.mockResolvedValue(response(block));
      const [first, second] = await Promise.all([
        api.fetchHistoryPage(path, 1),
        api.fetchHistoryPage(neighbour, 1),
      ]);
      expect(first.entries).toEqual([entry]);
      expect(first.entries[0]).toBe(second.entries[0]);
      expect(first.entries).not.toBe(second.entries);
      const again = await api.fetchHistoryPage(path, 1);
      expect(again).not.toBe(first);
      expect(again.entries[0]).toBe(first.entries[0]);
      expect(JSON.stringify(block)).toBe(before);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`/${blockURL}`);
    });

    it("expires cached blocks and retries malformed indexes", async () => {
      const storage = descriptor();
      storage.documents["data/root/index.json"] = physical(0);
      api.setCatalogStorage(storage);
      let now = 0;
      jest.spyOn(Date, "now").mockImplementation(() => now);
      api.setCatalogCacheTtl(10);
      fetchMock.mockResolvedValue(response({ [secondPath]: { key: "other" } }));
      await api.fetchEntityDetail("feature", "other");
      now = 10;
      expect(api.peekEntityDetail("feature", "other")).toBeUndefined();
      await api.fetchEntityDetail("feature", "other");
      fetchMock.mockResolvedValueOnce(response({ format: "bad" }));
      await expect(api.fetchIndex()).rejects.toThrow("Invalid Catalog index");
      fetchMock.mockResolvedValue(response(encodeCatalogIndex(index())));
      expect(await api.fetchIndex()).toEqual(index());
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("does not let an old snapshot failure remove a newer block", async () => {
      let reject!: (reason: Error) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      api.setCatalogStorage(descriptor());
      const old = api.fetchEntityDetail("feature", "other");
      const failure = expect(old).rejects.toThrow("old snapshot failed");
      await Promise.resolve();
      const next = descriptor();
      next.groups["data/root/entities/feature/details"][0].blockURL = physical(101);
      api.setCatalogStorage(next);
      fetchMock.mockResolvedValue(response({ [secondPath]: { key: "new" } }));
      const current = await api.fetchEntityDetail("feature", "other");
      reject(new Error("old snapshot failed"));
      await failure;
      expect(api.peekEntityDetail("feature", "other")).toBe(current);
      expect(await api.fetchEntityDetail("feature", "other")).toBe(current);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      api.setCatalogStorage(undefined);
      await api.fetchEntityDetail("feature", "other");
      expect(fetchMock).toHaveBeenLastCalledWith(`/${secondPath}`);
    });
  });
});
