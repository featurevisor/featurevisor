import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { CatalogStorageWriter } from "./storageWriter";
import {
  readCatalogStorageEntry,
  resolveCatalogStorage,
  type CatalogStorageDescriptor,
} from "../storage";

describe("CatalogStorageWriter", () => {
  let root: string;
  let data: string;
  let manifestPath: string;
  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "catalog-storage-"));
    data = path.join(root, "data");
    manifestPath = path.join(data, "manifest.json");
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const read = async (file: string) => JSON.parse(await fs.promises.readFile(file, "utf8"));
  const writer = (bytes = 256 * 1024) =>
    new CatalogStorageWriter(data, {
      compactStorage: true,
      targetBlockBytes: bytes,
    });
  async function load(storage: CatalogStorageDescriptor, key: string) {
    const resolution = resolveCatalogStorage(storage, key)!;
    return readCatalogStorageEntry(await read(path.join(root, resolution.blockURL)), resolution);
  }

  it("stages legacy output and publishes stable files by default", async () => {
    const instance = new CatalogStorageWriter(data);
    await instance.write(path.join(data, "root/index.json"), { count: 1 });
    expect(fs.existsSync(data)).toBe(false);
    const manifest = await instance.publish(manifestPath, { schemaVersion: 1 });
    expect(manifest.storage).toBeUndefined();
    expect(await read(path.join(data, "root/index.json"))).toEqual({ count: 1 });
  });

  it("creates deterministic bounded blocks, reuses files and retains old snapshots", async () => {
    const entries = Array.from(
      { length: 50 },
      (_, index) =>
        [`root/entities/feature/team/${index}.json`, { z: index, a: "🙂".repeat(8) }] as const,
    );
    async function publish(reverse: boolean) {
      const instance = writer(400);
      for (const [key, value] of reverse ? entries.slice().reverse() : entries) {
        await instance.write(path.join(data, key), value);
      }
      await instance.write(path.join(data, "root/index.json"), { count: 50 });
      return instance.publish(manifestPath, { generatedAt: "fixed" });
    }
    const first = await publish(false);
    const files = await fs.promises.readdir(path.join(data, "blocks"));
    const mtimes = await Promise.all(
      files.map(async (file) => (await fs.promises.stat(path.join(data, "blocks", file))).mtimeMs),
    );
    expect(await publish(true)).toEqual(first);
    expect(
      await Promise.all(
        files.map(
          async (file) => (await fs.promises.stat(path.join(data, "blocks", file))).mtimeMs,
        ),
      ),
    ).toEqual(mtimes);
    for (const file of files) {
      const bytes = await fs.promises.readFile(path.join(data, "blocks", file));
      expect(bytes.length).toBeLessThanOrEqual(400);
      expect(file).toBe(`${createHash("sha256").update(bytes).digest("hex")}.json`);
    }
    for (const [key, value] of entries)
      expect(await load(first.storage!, `data/${key}`)).toEqual(value);
    const next = writer();
    await next.write(path.join(data, entries[0][0]), { changed: true });
    await next.publish(manifestPath, {});
    expect(await load(first.storage!, `data/${entries[0][0]}`)).toEqual(entries[0][1]);
  });

  it("supports oversized entries, history pages, encoded namespaces and prototype fields", async () => {
    const instance = writer(120);
    const values = {
      "root/entities/feature/__proto__.json": JSON.parse(
        '{"__proto__":{"safe":true},"constructor":1}',
      ),
      "root/entities/feature/team/large.json": { text: "x".repeat(2000) },
      "root/entity-history/feature/team/large/page-1.json": { entries: [] },
      "project/history/page-1.json": { entries: [] },
      "sets/qa space/entities/feature/team/a%20b.json": { key: "team/a b" },
    };
    for (const [key, value] of Object.entries(values))
      await instance.write(path.join(data, key), value);
    const manifest = await instance.publish(manifestPath, {});
    for (const [key, value] of Object.entries(values)) {
      expect(
        await load(manifest.storage!, `data/${key.replace("qa space", "qa%20space")}`),
      ).toEqual(value);
    }
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(
      await load(manifest.storage!, "data/root/entities/feature/missing.json"),
    ).toBeUndefined();
  });

  it("retains untouched sets and removes omitted set references", async () => {
    const first = writer();
    for (const set of ["dev", "qa space", "old"]) {
      await first.write(path.join(data, "sets", set, "index.json"), { set });
      await first.write(path.join(data, "sets", set, "entities/feature/foo.json"), { set });
    }
    const previous = await first.publish(manifestPath, {});
    const second = writer();
    await second.retainPrefix("data/sets/qa%20space/");
    await second.write(path.join(data, "sets/dev/index.json"), { changed: true });
    const current = await second.publish(manifestPath, {});
    expect(current.storage!.documents["data/sets/qa%20space/index.json"]).toBe(
      previous.storage!.documents["data/sets/qa%20space/index.json"],
    );
    expect(await load(current.storage!, "data/sets/qa%20space/entities/feature/foo.json")).toEqual({
      set: "qa space",
    });
    expect(resolveCatalogStorage(current.storage, "data/sets/old/index.json")).toBeUndefined();
    expect(await load(previous.storage!, "data/sets/old/index.json")).toEqual({ set: "old" });
  });

  it("rejects unsafe paths, reserved paths, non JSON values and reuse after abort", async () => {
    for (const file of [
      path.join(root, "outside.json"),
      "relative.json",
      path.join(data, "manifest.json"),
      path.join(data, "blocks/a.json"),
    ]) {
      const instance = writer();
      await expect(instance.write(file, {})).rejects.toThrow();
      await expect(instance.publish(manifestPath, {})).rejects.toThrow();
    }
    const invalid = writer();
    await expect(invalid.write(path.join(data, "root/index.json"), undefined)).rejects.toThrow();
    const aborted = writer();
    await aborted.write(path.join(data, "root/index.json"), {});
    await aborted.abort();
    await expect(aborted.publish(manifestPath, {})).rejects.toThrow();
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it.each(["block", "manifest"])(
    "preserves the previous view on %s rename failure",
    async (failure) => {
      const previous = writer();
      await previous.write(path.join(data, "root/index.json"), { old: true });
      const old = await previous.publish(manifestPath, {});
      const original = fs.promises.rename;
      jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
        if (failure === "block" || to === manifestPath) throw new Error("Injected failure");
        return original(from, to);
      });
      const next = writer();
      await next.write(path.join(data, "root/index.json"), { new: true });
      await expect(next.publish(manifestPath, {})).rejects.toThrow("Injected failure");
      expect(await read(manifestPath)).toEqual(old);
      expect(await load(old.storage!, "data/root/index.json")).toEqual({ old: true });
      expect((await fs.promises.readdir(data)).some((file) => file.endsWith(".tmp"))).toBe(false);
      expect(
        (await fs.promises.readdir(path.join(data, "blocks"))).some((file) =>
          file.endsWith(".tmp"),
        ),
      ).toBe(false);
    },
  );

  it("rejects symlink directories without writing outside the data directory", async () => {
    await fs.promises.mkdir(data);
    const outside = path.join(root, "outside");
    await fs.promises.mkdir(outside);
    await fs.promises.symlink(outside, path.join(data, "blocks"));
    const instance = writer();
    await instance.write(path.join(data, "root/index.json"), {});
    await expect(instance.publish(manifestPath, {})).rejects.toThrow("Unsafe Catalog directory");
    expect(await fs.promises.readdir(outside)).toEqual([]);
  });

  it.each(["production blue", "équipe", "a%b"])(
    "normalizes only the raw set component %s",
    async (set) => {
      const instance = writer();
      await instance.write(path.join(data, "sets", set, "index.json"), { set });
      await instance.write(path.join(data, "sets", set, "entities/feature/team/a%25b.json"), {
        key: "team/a%b",
      });
      const previous = await instance.publish(manifestPath, { schemaVersion: 1 });
      const logical = `data/sets/${encodeURIComponent(set)}/entities/feature/team/a%25b.json`;
      expect(await load(previous.storage!, logical)).toEqual({ key: "team/a%b" });
      const next = writer();
      await next.retainPrefix(`data/sets/${encodeURIComponent(set)}/`);
      const current = await next.publish(manifestPath, { schemaVersion: 1 });
      expect(current.schemaVersion).toBe(1);
      expect(await load(current.storage!, logical)).toEqual({ key: "team/a%b" });
    },
  );

  it.each([false, true])(
    "preserves semantic property order with prettyOutput %s",
    async (prettyOutput) => {
      const instance = new CatalogStorageWriter(data, { compactStorage: true, prettyOutput });
      const value = { mutate: { z: { set: 1 }, a: { set: 2 } }, last: true };
      const detailKey = "data/root/entities/feature/ordered.json";
      await instance.write(path.join(data, "root/index.json"), value);
      await instance.write(path.join(root, detailKey), value);
      const manifest = await instance.publish(manifestPath, { schemaVersion: 1 });
      for (const key of ["data/root/index.json", detailKey]) {
        const resolution = resolveCatalogStorage(manifest.storage, key)!;
        const text = await fs.promises.readFile(path.join(root, resolution.blockURL), "utf8");
        const expected = resolution.entryKey ? { [detailKey]: value } : value;
        expect(text).toBe(JSON.stringify(expected, null, prettyOutput ? 2 : undefined));
        expect(resolution.blockURL).toBe(
          `data/blocks/${createHash("sha256").update(text).digest("hex")}.json`,
        );
        const loaded = (await load(manifest.storage!, key)) as typeof value;
        expect(Object.keys(loaded.mutate)).toEqual(["z", "a"]);
      }
    },
  );

  it("fails closed for unavailable or overlapping retained scopes", async () => {
    await expect(writer().retainPrefix("data/sets/missing/")).rejects.toThrow();
    const first = writer();
    await first.write(path.join(data, "sets/dev/index.json"), {});
    await first.publish(manifestPath, {});
    const overlap = writer();
    await overlap.retainPrefix("data/sets/dev/");
    await expect(overlap.write(path.join(data, "sets/dev/index.json"), {})).rejects.toThrow(
      "retained",
    );
    await expect(overlap.publish(manifestPath, {})).rejects.toThrow();
    const reverse = writer();
    await reverse.write(path.join(data, "sets/dev/index.json"), {});
    await expect(reverse.retainPrefix("data/sets/dev/")).rejects.toThrow("written");
    await expect(writer().retainPrefix("data/root/")).rejects.toThrow();
  });

  it.each([false, true])(
    "deduplicates history contents with round trip parity, pretty %s",
    async (prettyOutput) => {
      const commit = {
        commit: "same",
        subject: "Message",
        entities: [{ type: "feature", key: "a", set: "dev" }],
      };
      const otherSet = { ...commit, entities: [{ type: "feature", key: "a", set: "prod" }] };
      const pages = [
        { page: 1, pageSize: 50, totalPages: 2, entries: [commit, otherSet, commit] },
        { page: 2, pageSize: 50, totalPages: 2, entries: [JSON.parse(JSON.stringify(commit))] },
        { page: 1, pageSize: 50, totalPages: 1, entries: [] },
      ];
      async function publish(reverse: boolean) {
        const instance = new CatalogStorageWriter(data, { compactStorage: true, prettyOutput });
        const order = reverse ? [2, 1, 0] : [0, 1, 2];
        for (const index of order)
          await instance.write(
            path.join(data, `root/entity-history/feature/${index}/page-1.json`),
            pages[index],
          );
        return instance.publish(manifestPath, {});
      }
      const first = await publish(false);
      expect(await publish(true)).toEqual(first);
      const ranges = first.storage!.groups["data/root/entity-history/feature/history"];
      expect(ranges).toHaveLength(1);
      const file = path.join(root, ranges[0].blockURL);
      const text = await fs.promises.readFile(file, "utf8");
      const block = JSON.parse(text);
      expect(Object.keys(block.entries)).toHaveLength(2);
      expect(text).toBe(JSON.stringify(block, null, prettyOutput ? 2 : undefined));
      for (let index = 0; index < pages.length; index++) {
        expect(
          await load(first.storage!, `data/root/entity-history/feature/${index}/page-1.json`),
        ).toEqual(pages[index]);
      }
    },
  );

  it("stages 5500 shared history pages without retaining or serializing quadratic payloads", async () => {
    const commit = {
      commit: "one-large-commit",
      subject: "Initial import",
      author: "Test",
      timestamp: "2026-01-01",
      entities: Array.from({ length: 5500 }, (_, index) => ({
        type: index < 5000 ? "feature" : "segment",
        key: `team/${index}/${"name".repeat(16)}`,
      })),
    };
    const shared = { toJSON: jest.fn(() => commit) };
    const instance = writer();
    for (let index = 0; index < 5500; index++) {
      const type = index < 5000 ? "feature" : "segment";
      await instance.write(path.join(data, `root/entity-history/${type}/${index}/page-1.json`), {
        page: 1,
        pageSize: 50,
        totalPages: 1,
        entries: [shared],
      });
    }
    expect(shared.toJSON).toHaveBeenCalledTimes(1);
    const staged = (instance as unknown as { documents: Map<string, { json: string }> }).documents;
    expect(
      [...staged.values()].reduce((sum, entry) => sum + Buffer.byteLength(entry.json), 0),
    ).toBeLessThan(2 * 1024 * 1024);
    const published = await instance.publish(manifestPath, {});
    const files = await fs.promises.readdir(path.join(data, "blocks"));
    const bytes = await Promise.all(
      files.map(async (file) => (await fs.promises.stat(path.join(data, "blocks", file))).size),
    );
    expect(bytes.reduce((sum, value) => sum + value, 0)).toBeLessThan(20 * 1024 * 1024);
    expect(files.length).toBeLessThan(30);
    for (const index of [0, 4999, 5000, 5499]) {
      const type = index < 5000 ? "feature" : "segment";
      expect(
        await load(published.storage!, `data/root/entity-history/${type}/${index}/page-1.json`),
      ).toEqual({
        page: 1,
        pageSize: 50,
        totalPages: 1,
        entries: [commit],
      });
    }
  });

  it("bounds concurrent writes and publishes the manifest after all blocks", async () => {
    const original = fs.promises.writeFile;
    let active = 0;
    let peak = 0;
    jest
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return await original(...args);
        } finally {
          active--;
        }
      });
    const rename = fs.promises.rename;
    const destinations: string[] = [];
    jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      destinations.push(String(to));
      if (to === manifestPath) expect(active).toBe(0);
      return rename(from, to);
    });
    const instance = writer(100);
    for (let index = 0; index < 30; index++)
      await instance.write(path.join(data, `root/entities/feature/${index}.json`), {
        index,
        text: "x".repeat(80),
      });
    await instance.publish(manifestPath, {});
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(destinations[destinations.length - 1]).toBe(manifestPath);
  });

  it("drains active writes on failure before rejecting publication", async () => {
    const original = fs.promises.writeFile;
    let active = 0;
    let writes = 0;
    jest
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        const number = ++writes;
        active++;
        try {
          await new Promise((resolve) => setTimeout(resolve, number === 1 ? 1 : 10));
          if (number === 1) throw new Error("Pool failure");
          return await original(...args);
        } finally {
          active--;
        }
      });
    const instance = writer(100);
    for (let index = 0; index < 20; index++)
      await instance.write(path.join(data, `root/entities/feature/${index}.json`), { index });
    await expect(instance.publish(manifestPath, {})).rejects.toThrow("Pool failure");
    expect(active).toBe(0);
    expect(writes).toBeLessThanOrEqual(4);
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it("reads one prior manifest for concurrent retained sets and rejects corrupt references", async () => {
    const first = writer();
    for (const set of ["dev", "prod"])
      await first.write(path.join(data, `sets/${set}/index.json`), { set });
    await first.publish(manifestPath, {});
    const readFile = jest.spyOn(fs.promises, "readFile");
    const second = writer();
    const pending = [second.retainPrefix("data/sets/dev/"), second.retainPrefix("data/sets/prod/")];
    await expect(second.publish(manifestPath, {})).rejects.toThrow("Await retainPrefix");
    await Promise.all(pending);
    expect(readFile.mock.calls.filter(([file]) => file === manifestPath)).toHaveLength(1);
    await second.publish(manifestPath, {});
    readFile.mockRestore();
    const corrupt = await read(manifestPath);
    corrupt.storage.documents["data/sets/dev/index.json"] = "data/../outside.json";
    await fs.promises.writeFile(manifestPath, JSON.stringify(corrupt));
    await expect(writer().retainPrefix("data/sets/dev/")).rejects.toThrow("invalid");
  });
});
