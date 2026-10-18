/** Browser safe storage contract. All URLs are relative to the Catalog root. */
export interface CatalogStorageRange {
  /** Inclusive unsigned FNV bounds. */
  start: number;
  end: number;
  blockURL: string;
}

export interface CatalogStorageDescriptor {
  version: 1 | 2;
  documents: Record<string, string>;
  groups: Record<string, CatalogStorageRange[]>;
}

export interface CatalogStorageResolution {
  blockURL: string;
  /** Absent for a standalone document. */
  entryKey?: string;
}

/** Paths are already URL encoded by the exporter. Never decode entity keys. */
export function isCatalogStoragePath(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith("data/") || /[\\\x00-\x20\x7f?#]/.test(value))
    return false;
  return value.split("/").every((part) => {
    if (!part || part === "." || part === "..") return false;
    try {
      const decoded = decodeURIComponent(part);
      return decoded !== "." && decoded !== ".." && !/[\\/\x00-\x1f\x7f]/.test(decoded);
    } catch {
      return false;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlockURL(value: unknown): value is string {
  return typeof value === "string" && /^data\/blocks\/[a-f0-9]{64}\.json$/.test(value);
}

// A manifest is a snapshot. Cache a validated copy so later mutations cannot
// invalidate binary search, while repeated lookups remain logarithmic.
const rangeSnapshots = new WeakMap<object, CatalogStorageRange[] | null>();

function validatedRanges(value: unknown): CatalogStorageRange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (rangeSnapshots.has(value)) return rangeSnapshots.get(value) || undefined;
  const result: CatalogStorageRange[] = [];
  let previousEnd = -1;
  for (const range of value) {
    if (
      !isRecord(range) ||
      !Object.prototype.hasOwnProperty.call(range, "start") ||
      !Object.prototype.hasOwnProperty.call(range, "end") ||
      !Object.prototype.hasOwnProperty.call(range, "blockURL") ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      (range.start as number) <= previousEnd ||
      (range.end as number) < (range.start as number) ||
      (range.end as number) > 0xffffffff ||
      !isBlockURL(range.blockURL)
    ) {
      rangeSnapshots.set(value, null);
      return undefined;
    }
    result.push({
      start: range.start as number,
      end: range.end as number,
      blockURL: range.blockURL,
    });
    previousEnd = range.end as number;
  }
  rangeSnapshots.set(value, result);
  return result;
}

function hasStorageShape(value: unknown): value is CatalogStorageDescriptor {
  return (
    isRecord(value) &&
    Object.prototype.hasOwnProperty.call(value, "version") &&
    (value.version === 1 || value.version === 2) &&
    Object.prototype.hasOwnProperty.call(value, "documents") &&
    isRecord(value.documents) &&
    Object.prototype.hasOwnProperty.call(value, "groups") &&
    isRecord(value.groups)
  );
}

/** Validate an entire imported descriptor before retaining any of its references. */
export function isCatalogStorageDescriptor(value: unknown): value is CatalogStorageDescriptor {
  if (!hasStorageShape(value)) return false;
  for (const [key, url] of Object.entries(value.documents)) {
    if (!isCatalogStoragePath(key) || !isBlockURL(url)) return false;
  }
  for (const [key, ranges] of Object.entries(value.groups)) {
    if (
      !isCatalogStoragePath(key) ||
      !/^(?:data\/(?:root|sets\/[^/]+)\/(?:entities\/[^/]+\/(?:details|history)|entity-history\/[^/]+\/history)|data\/(?:project|root|sets\/[^/]+)\/history)$/.test(
        key,
      ) ||
      !validatedRanges(ranges)
    )
      return false;
  }
  return true;
}

/** FNV 1a over UTF 16 code units, shared verbatim by producer and consumer. */
export function catalogStorageHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

export function getCatalogStorageGroup(logicalPath: string, version = 2): string | undefined {
  const entityHistory =
    /^(data\/(?:root|sets\/[^/]+)\/entity-history\/[^/]+)\/.+\/page-\d+\.json$/.exec(logicalPath);
  if (entityHistory) return `${entityHistory[1]}/history`;
  const entity = /^(data\/(?:root|sets\/[^/]+)\/entities\/[^/]+)\/.+\.json$/.exec(logicalPath);
  if (entity) {
    return `${entity[1]}/${version === 1 && /\/history\/page-\d+\.json$/.test(logicalPath) ? "history" : "details"}`;
  }
  const history = /^(data\/(?:project|root|sets\/[^/]+)\/history)\/page-\d+\.json$/.exec(
    logicalPath,
  );
  return history?.[1];
}

/** Undefined means missing or invalid. With no descriptor the legacy URL is used. */
export function resolveCatalogStorage(
  storage: CatalogStorageDescriptor | undefined,
  logicalPath: string,
): CatalogStorageResolution | undefined {
  if (!isCatalogStoragePath(logicalPath)) return undefined;
  if (storage === undefined) return { blockURL: logicalPath };
  if (!hasStorageShape(storage)) return undefined;
  if (Object.prototype.hasOwnProperty.call(storage.documents, logicalPath)) {
    const blockURL = storage.documents[logicalPath];
    return isBlockURL(blockURL) ? { blockURL } : undefined;
  }
  const group = getCatalogStorageGroup(logicalPath, storage.version);
  if (!group || !Object.prototype.hasOwnProperty.call(storage.groups, group)) return undefined;
  const hash = catalogStorageHash(logicalPath);
  const ranges = validatedRanges(storage.groups[group]);
  if (!ranges) return undefined;
  let low = 0;
  let high = ranges.length - 1;
  let range: CatalogStorageRange | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = ranges[middle];
    if (hash < candidate.start) high = middle - 1;
    else if (hash > candidate.end) low = middle + 1;
    else {
      range = candidate;
      break;
    }
  }
  return range ? { blockURL: range.blockURL, entryKey: logicalPath } : undefined;
}

/** A range can contain a hash for a missing key. Consumers must check ownership. */
export function readCatalogStorageEntry<T>(
  document: unknown,
  resolution: CatalogStorageResolution,
): T | undefined {
  if (resolution.entryKey === undefined) return document as T;
  if (!document || typeof document !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(document, "$catalogHistory")) {
    const block = document as Record<string, unknown>;
    if (block.$catalogHistory !== 1 || !isRecord(block.pages) || !isRecord(block.entries))
      return undefined;
    if (!Object.prototype.hasOwnProperty.call(block.pages, resolution.entryKey)) return undefined;
    const page = block.pages[resolution.entryKey];
    if (!isRecord(page) || !Array.isArray(page.entries)) return undefined;
    const entries: unknown[] = [];
    for (const key of page.entries) {
      if (
        typeof key !== "string" ||
        !/^[a-f0-9]{64}$/.test(key) ||
        !Object.prototype.hasOwnProperty.call(block.entries, key)
      )
        return undefined;
      entries.push(block.entries[key]);
    }
    return { ...page, entries } as T;
  }
  return Object.prototype.hasOwnProperty.call(document, resolution.entryKey)
    ? (document as Record<string, T>)[resolution.entryKey]
    : undefined;
}
