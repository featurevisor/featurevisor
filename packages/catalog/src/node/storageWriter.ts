import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  catalogStorageHash,
  getCatalogStorageGroup,
  isCatalogStorageDescriptor,
  isCatalogStoragePath,
  type CatalogStorageDescriptor,
  type CatalogStorageRange,
} from "../storage";

export interface CatalogStorageWriterOptions {
  compactStorage?: boolean;
  targetBlockBytes?: number;
  prettyOutput?: boolean;
}

interface Entry {
  key: string;
  json: string;
  hash: number;
  bytes: number;
  lines: number;
  history?: SharedHistory[];
}

interface SharedHistory {
  key: string;
  json: string;
  bytes: number;
  lines: number;
}

interface Block {
  entries: Entry[];
  start: number;
  end: number;
}

const WRITE_CONCURRENCY = 4;

function setPrefix(key: string): string | undefined {
  return /^data\/sets\/[^/]+\//.exec(key)?.[0];
}

/** Lazily start bounded jobs and drain all active IO before surfacing a failure. */
async function runWrites(jobs: Iterable<() => Promise<void>>): Promise<void> {
  const iterator = jobs[Symbol.iterator]();
  let failed = false;
  let failure: unknown;
  async function worker() {
    try {
      while (!failed) {
        const next = iterator.next();
        if (next.done) return;
        await next.value();
      }
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
  }
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
  if (failed) throw failure;
}

function serialize(value: unknown, pretty = false): string {
  const json = JSON.stringify(value, null, pretty ? 2 : undefined);
  if (json === undefined) throw new Error("Catalog documents must be JSON values");
  return json;
}

function jsonLines(json: string): number {
  let count = 0;
  for (let offset = json.indexOf("\n"); offset !== -1; offset = json.indexOf("\n", offset + 1))
    count++;
  return count;
}

function storedValue(key: string, json: string, pretty: boolean): SharedHistory {
  const lines = jsonLines(json);
  return {
    key,
    json,
    lines,
    bytes:
      Buffer.byteLength(JSON.stringify(key)) +
      1 +
      Buffer.byteLength(json) +
      (pretty ? 3 + 2 * lines : 0),
  };
}

function objectJSON(entries: SharedHistory[], pretty: boolean): string {
  if (!entries.length) return "{}";
  const parts = entries.map((entry) =>
    pretty
      ? `  ${JSON.stringify(entry.key)}: ${entry.json.replace(/\n/g, "\n  ")}`
      : `${JSON.stringify(entry.key)}:${entry.json}`,
  );
  return pretty ? `{\n${parts.join(",\n")}\n}` : `{${parts.join(",")}}`;
}

function objectSize(entries: SharedHistory[], pretty: boolean): { bytes: number; lines: number } {
  if (!entries.length) return { bytes: 2, lines: 0 };
  return {
    bytes:
      (pretty ? 4 : 2) +
      entries.reduce(
        (total, entry) => total + entry.bytes,
        (entries.length - 1) * (pretty ? 2 : 1),
      ),
    lines: pretty
      ? entries.length + 1 + entries.reduce((total, entry) => total + entry.lines, 0)
      : 0,
  };
}

function sharedHistory(entries: Entry[]): SharedHistory[] {
  const values = new Set<SharedHistory>();
  for (const entry of entries) for (const value of entry.history || []) values.add(value);
  return [...values];
}

/** One writer per export. Compact exports become visible only at publish. */
export class CatalogStorageWriter {
  private readonly documents = new Map<string, Entry>();
  // Intern complete serialized entries, not commit IDs: set context can differ.
  private readonly historyValues = new Map<string, SharedHistory>();
  // History index entries are immutable for one export and shared by byEntity.
  private historyByObject = new WeakMap<object, SharedHistory>();
  private readonly retained = new Set<string>();
  private readonly writtenSets = new Set<string>();
  private previousStorage?: CatalogStorageDescriptor;
  private previousStoragePromise?: Promise<CatalogStorageDescriptor>;
  private pendingRetains = 0;
  private state: "collecting" | "publishing" | "finished" | "failed" = "collecting";
  private readonly targetBytes: number;

  constructor(
    private readonly dataDirectory: string,
    private readonly options: CatalogStorageWriterOptions = {},
  ) {
    if (!path.isAbsolute(dataDirectory)) throw new Error("Expected absolute dataDirectory");
    this.dataDirectory = path.resolve(dataDirectory);
    this.options = { ...options };
    this.targetBytes = options.targetBlockBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(this.targetBytes) || this.targetBytes < 2) {
      throw new Error("Invalid targetBlockBytes");
    }
  }

  private logicalPath(filePath: string): string {
    if (!path.isAbsolute(filePath)) throw new Error("Expected absolute Catalog path");
    const segments = path.relative(this.dataDirectory, filePath).split(path.sep);
    // Set directories use authored names; entity segments are already URL encoded.
    if (segments[0] === "sets" && segments.length > 1)
      segments[1] = encodeURIComponent(segments[1]);
    const relative = segments.join("/");
    const logical = `data/${relative}`;
    if (!isCatalogStoragePath(logical)) throw new Error("Unsafe Catalog path");
    return logical;
  }

  async write(filePath: string, value: unknown): Promise<void> {
    if (this.state !== "collecting") throw new Error("Catalog writer is not collecting");
    try {
      const logical = this.logicalPath(filePath);
      const prefix = setPrefix(logical);
      if (prefix && this.retained.has(prefix)) {
        throw new Error("Cannot write a retained Catalog prefix");
      }
      if (logical === "data/manifest.json" || logical.startsWith("data/blocks/")) {
        throw new Error("Reserved Catalog path");
      }
      let history: SharedHistory[] | undefined;
      const pretty = Boolean(this.options.prettyOutput);
      if (this.options.compactStorage && getCatalogStorageGroup(logical)?.endsWith("/history")) {
        const page = value as { entries?: unknown[] };
        if (!page || typeof page !== "object" || !Array.isArray(page.entries))
          throw new Error("Invalid Catalog history page");
        history = page.entries.map((item) => {
          const object = item !== null && typeof item === "object" ? item : undefined;
          const cached = object && this.historyByObject.get(object);
          if (cached) return cached;
          const json = serialize(item, pretty);
          let shared = this.historyValues.get(json);
          if (!shared) {
            shared = storedValue(createHash("sha256").update(json).digest("hex"), json, pretty);
            this.historyValues.set(json, shared);
          }
          if (object) this.historyByObject.set(object, shared);
          return shared;
        });
        // Replace only entries, retaining all page metadata and property order.
        value = { ...page, entries: history.map((entry) => entry.key) };
      }
      const json = serialize(value, pretty);
      this.documents.set(logical, {
        ...storedValue(logical, json, pretty),
        hash: catalogStorageHash(logical),
        history,
      });
      if (prefix) this.writtenSets.add(prefix);
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  /** Retain only whole set scopes, so no hash range can straddle retained data. */
  async retainPrefix(prefix: string): Promise<void> {
    if (this.state !== "collecting") throw new Error("Catalog writer is not collecting");
    this.pendingRetains++;
    try {
      if (
        !this.options.compactStorage ||
        !/^data\/sets\/[^/]+\/$/.test(prefix) ||
        !isCatalogStoragePath(`${prefix}index.json`)
      ) {
        throw new Error("Expected a compact Catalog set prefix");
      }
      if (this.writtenSets.has(prefix)) {
        throw new Error("Cannot retain a written Catalog prefix");
      }
      // Reserve the scope before awaiting IO, including for concurrent callers.
      this.retained.add(prefix);
      if (!this.previousStoragePromise) {
        this.previousStoragePromise = fs.promises
          .readFile(path.join(this.dataDirectory, "manifest.json"), "utf8")
          .then((json) => {
            const previous = JSON.parse(json);
            if (!isCatalogStorageDescriptor(previous?.storage) || previous.storage.version !== 2)
              throw new Error("Previous compact storage is invalid or missing");
            return previous.storage;
          });
      }
      this.previousStorage = await this.previousStoragePromise;
      if (this.state !== "collecting") throw new Error("Catalog writer is not collecting");
      if (
        !Object.prototype.hasOwnProperty.call(this.previousStorage.documents, `${prefix}index.json`)
      ) {
        throw new Error("Previous Catalog set is missing");
      }
    } catch (error) {
      this.state = "failed";
      throw error;
    } finally {
      this.pendingRetains--;
    }
  }

  /** Refuse symlinks below the export root, including the root itself. */
  private async prepareDirectory(directory: string): Promise<void> {
    await fs.promises.mkdir(this.dataDirectory, { recursive: true });
    const relative = path.relative(this.dataDirectory, directory);
    let current = this.dataDirectory;
    for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
      current = path.join(current, segment);
      try {
        await fs.promises.mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = await fs.promises.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe Catalog directory");
    }
  }

  private async atomicWrite(filePath: string, json: string): Promise<void> {
    await this.prepareDirectory(path.dirname(filePath));
    try {
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe Catalog file");
      if ((await fs.promises.readFile(filePath, "utf8")) === json) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(path.dirname(filePath), `.catalog-${randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, json, { flag: "wx" });
      await fs.promises.rename(temporary, filePath);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }

  private async writeImmutable(json: string): Promise<string> {
    const digest = createHash("sha256").update(json).digest("hex");
    const relative = `blocks/${digest}.json`;
    await this.atomicWrite(path.join(this.dataDirectory, relative), json);
    return `data/${relative}`;
  }

  private *splitRanges(entries: Entry[], start = 0, end = 0xffffffff): Generator<Block> {
    if (!entries.length) return;
    const pretty = this.options.prettyOutput;
    const pages = objectSize(entries, Boolean(pretty));
    let bytes = pages.bytes;
    let limit = this.targetBytes;
    if (entries[0].history) {
      const shared = sharedHistory(entries);
      const dictionary = objectSize(shared, Boolean(pretty));
      bytes +=
        dictionary.bytes +
        Buffer.byteLength(serialize({ $catalogHistory: 1, entries: {}, pages: {} }, pretty)) -
        4;
      if (pretty) bytes += 2 * (pages.lines + dictionary.lines);
      // An indivisible oversized shared entry must not force one copy per page.
      const largest = shared.reduce((max, entry) => Math.max(max, entry.bytes), 0);
      if (largest > limit) limit += largest;
    }
    if (bytes > limit && entries.length > 1 && start < end) {
      const middle = Math.floor((start + end) / 2);
      const left = entries.filter((entry) => entry.hash <= middle);
      const right = entries.filter((entry) => entry.hash > middle);
      yield* this.splitRanges(left, start, middle);
      yield* this.splitRanges(right, middle + 1, end);
      return;
    }
    // Single oversized documents and exact hash collisions cannot split further.
    yield { entries, start, end };
  }

  private async writeBlock(entries: Entry[]): Promise<string> {
    const pretty = Boolean(this.options.prettyOutput);
    let json = objectJSON(entries, pretty);
    if (entries[0].history) {
      const shared = sharedHistory(entries).sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
      const dictionary = objectJSON(shared, pretty);
      json = pretty
        ? `{\n  "$catalogHistory": 1,\n  "entries": ${dictionary.replace(/\n/g, "\n  ")},\n  "pages": ${json.replace(/\n/g, "\n  ")}\n}`
        : `{"$catalogHistory":1,"entries":${dictionary},"pages":${json}}`;
    }
    // Once assembled, release the staged strings even if this block is oversized.
    for (const entry of entries) entry.json = "";
    return this.writeImmutable(json);
  }

  private *compactWrites(storage: CatalogStorageDescriptor): Generator<() => Promise<void>> {
    const groups = new Map<string, Entry[]>();
    const direct: Entry[] = [];
    for (const key of [...this.documents.keys()].sort()) {
      const entry = this.documents.get(key)!;
      const group = getCatalogStorageGroup(key);
      if (group) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(entry);
      } else {
        // Reserve insertion order before parallel IO can finish out of order.
        storage.documents[key] = "";
        direct.push(entry);
      }
    }
    this.documents.clear();
    this.historyValues.clear();
    this.historyByObject = new WeakMap();
    for (const entry of direct) {
      yield async () => {
        storage.documents[entry.key] = await this.writeImmutable(entry.json);
        entry.json = "";
      };
    }
    for (const [group, entries] of groups) {
      const ranges: CatalogStorageRange[] = [];
      storage.groups[group] = ranges;
      for (const block of this.splitRanges(entries)) {
        const range = { start: block.start, end: block.end, blockURL: "" };
        ranges.push(range);
        yield async () => {
          range.blockURL = await this.writeBlock(block.entries);
        };
      }
      groups.delete(group);
    }
  }

  private *legacyWrites(): Generator<() => Promise<void>> {
    for (const [key, entry] of this.documents) {
      yield async () => {
        const segments = key.slice(5).split("/");
        if (segments[0] === "sets") segments[1] = decodeURIComponent(segments[1]);
        await this.atomicWrite(path.join(this.dataDirectory, ...segments), entry.json);
        this.documents.delete(key);
      };
    }
  }

  async publish<T extends object>(
    manifestPath: string,
    manifest: T,
  ): Promise<T & { storage?: CatalogStorageDescriptor }> {
    if (this.state !== "collecting") throw new Error("Catalog writer is not collecting");
    if (this.pendingRetains) throw new Error("Await retainPrefix before publishing");
    this.state = "publishing";
    try {
      if (this.logicalPath(manifestPath) !== "data/manifest.json") {
        throw new Error("Expected data/manifest.json");
      }
      // Validate the manifest before writing any files.
      const published = JSON.parse(serialize(manifest));
      delete published.storage;
      if (this.options.compactStorage) {
        const storage: CatalogStorageDescriptor = {
          version: 2,
          documents: Object.create(null),
          groups: Object.create(null),
        };
        if (this.previousStorage) {
          for (const [key, url] of Object.entries(this.previousStorage.documents)) {
            const prefix = setPrefix(key);
            if (prefix && this.retained.has(prefix)) storage.documents[key] = url;
          }
          for (const [key, ranges] of Object.entries(this.previousStorage.groups)) {
            const prefix = setPrefix(key);
            if (prefix && this.retained.has(prefix)) storage.groups[key] = ranges;
          }
        }
        await runWrites(this.compactWrites(storage));
        published.storage = storage;
      } else {
        // Legacy URLs remain available. Multi document snapshot isolation requires compact storage.
        await runWrites(this.legacyWrites());
      }
      await this.atomicWrite(manifestPath, serialize(published, this.options.prettyOutput));
      this.state = "finished";
      return published;
    } catch (error) {
      this.state = "failed";
      throw error;
    } finally {
      this.documents.clear();
      this.historyValues.clear();
      this.historyByObject = new WeakMap();
      this.previousStorage = undefined;
      this.previousStoragePromise = undefined;
      this.writtenSets.clear();
      this.retained.clear();
    }
  }

  async abort(): Promise<void> {
    if (this.state === "publishing") throw new Error("Cannot abort an active publication");
    this.documents.clear();
    this.historyValues.clear();
    this.historyByObject = new WeakMap();
    this.previousStorage = undefined;
    this.previousStoragePromise = undefined;
    this.writtenSets.clear();
    this.retained.clear();
    this.state = "finished";
  }
}
