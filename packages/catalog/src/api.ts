import type {
  CatalogEntityType,
  CatalogIndex,
  CatalogManifest,
  EntityDetail,
  HistoryPage,
} from "./types";
import { encodeDataPath, getDataBasePath } from "./entityTypes";
import { decodeCatalogIndex } from "./indexCodec";
import { getCatalogBasePath } from "./basePath";
import {
  resolveCatalogStorage,
  readCatalogStorageEntry,
  isCatalogStorageDescriptor,
  type CatalogStorageDescriptor,
  type CatalogStorageResolution,
} from "./storage";

let routerMode: CatalogManifest["router"] = "browser";
let storage: CatalogStorageDescriptor | undefined;

/** Install the manifest snapshot before rendering consumers. Undefined restores legacy URLs. */
export function setCatalogStorage(descriptor: CatalogStorageDescriptor | undefined) {
  if (descriptor !== undefined && !isCatalogStorageDescriptor(descriptor)) {
    throw new Error("Invalid Catalog storage descriptor");
  }
  storage = descriptor;
}

function getDataUrl(path: string) {
  const normalizedPath = path.replace(/^\//, "");
  const base = getCatalogBasePath();
  if (base !== "/") return `${base}${normalizedPath}`;

  return routerMode === "browser" ? `/${normalizedPath}` : normalizedPath;
}

export function setCatalogRouterMode(mode: CatalogManifest["router"]) {
  routerMode = mode || "browser";
}

/** Raised when a Catalog data file does not exist, rather than failing to load. */
export class CatalogNotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${url}`);
    this.name = "CatalogNotFoundError";
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const contentType = response.headers?.get?.("content-type") || "";

  // Static hosts and the dev server answer unknown paths with the app shell.
  if (response.status === 404 || (response.ok && contentType.includes("text/html"))) {
    throw new CatalogNotFoundError(url);
  }

  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  return response.json() as Promise<T>;
}

interface CacheEntry {
  at: number;
  promise: Promise<unknown>;
  value: unknown;
  bytes: number;
}

const responseCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<unknown>>();
const maxCacheEntries = 128;
const maxCacheBytes = 16 * 1024 * 1024;
let cacheBytes = 0;
let cacheTtl = Number.POSITIVE_INFINITY;

/**
 * TTL starts when a response settles. Blocks and decoded indexes share an LRU budget
 * of 128 entries and 16 MiB estimated as UTF16 JSON plus URL bytes.
 * Active requests are deduplicated independently of TTL and the settled budget.
 */
export function setCatalogCacheTtl(milliseconds: number) {
  cacheTtl = milliseconds;
}

function getFreshEntry(url: string) {
  const entry = responseCache.get(url);

  if (!entry) return undefined;
  if (Date.now() - entry.at >= cacheTtl) {
    removeEntry(url);
    return undefined;
  }
  responseCache.delete(url);
  responseCache.set(url, entry);
  return entry;
}

function removeEntry(url: string) {
  const entry = responseCache.get(url);
  if (entry) cacheBytes -= entry.bytes;
  responseCache.delete(url);
}

function retain(url: string, value: unknown, promise: Promise<unknown>) {
  // This is a retention estimate, not a measurement of the JavaScript heap.
  const bytes = (JSON.stringify(value).length + url.length) * 2;
  if (bytes > maxCacheBytes || cacheTtl <= 0) return;
  removeEntry(url);
  while (responseCache.size >= maxCacheEntries || cacheBytes + bytes > maxCacheBytes) {
    removeEntry(responseCache.keys().next().value!);
  }
  responseCache.set(url, { at: Date.now(), promise, value, bytes });
  cacheBytes += bytes;
}

function cachedJson<T>(url: string, load: (url: string) => Promise<T> = fetchJson): Promise<T> {
  const pending = pendingRequests.get(url);
  if (pending) return pending as Promise<T>;
  const existing = getFreshEntry(url);

  if (existing) return existing.promise as Promise<T>;

  const promise = Promise.resolve()
    .then(() => load(url))
    .then(
      (value) => {
        if (pendingRequests.get(url) === promise) {
          pendingRequests.delete(url);
          retain(url, value, promise);
        }
        return value;
      },
      (error) => {
        if (pendingRequests.get(url) === promise) pendingRequests.delete(url);
        throw error;
      },
    );
  pendingRequests.set(url, promise);

  return promise;
}

/** An already loaded response, so a page can render at once instead of flashing a loader. */
function peekJson<T>(url: string): T | undefined {
  return getFreshEntry(url)?.value as T | undefined;
}

export function fetchManifest() {
  return fetchJson<CatalogManifest>(getDataUrl("data/manifest.json")).catch(() =>
    fetchJson<CatalogManifest>(`${getCatalogBasePath()}data/manifest.json`),
  );
}

function getIndexUrl(setKey?: string) {
  return getDataUrl(`${getDataBasePath(setKey)}/index.json`);
}

function getEntityDetailUrl(type: CatalogEntityType, key: string, setKey?: string) {
  return getDataUrl(`${getDataBasePath(setKey)}/entities/${type}/${encodeDataPath(key)}.json`);
}

export function fetchIndex(setKey?: string) {
  if (storage) {
    const url = getIndexUrl(setKey);
    const resolution = resolveData(url);
    if (!resolution) return Promise.reject(new CatalogNotFoundError(url));
    return cachedJson(decodedIndexKey(resolution), async () => {
      const block = await cachedJson<unknown>(resolution.blockURL);
      const raw = readCatalogStorageEntry<unknown>(block, resolution);
      if (raw === undefined) throw new CatalogNotFoundError(url);
      try {
        return decodeCatalogIndex(raw);
      } catch (error) {
        // Permit a retry without allowing an old decode failure to evict a newer block.
        if (responseCache.get(resolution.blockURL)?.value === block)
          removeEntry(resolution.blockURL);
        throw error;
      }
    });
  }
  return cachedJson(getIndexUrl(setKey), async (url) =>
    decodeCatalogIndex(await fetchJson<unknown>(url)),
  );
}

export function peekIndex(setKey?: string) {
  if (storage) {
    const resolution = resolveData(getIndexUrl(setKey));
    return resolution ? peekJson<CatalogIndex>(decodedIndexKey(resolution)) : undefined;
  }
  return peekJson<CatalogIndex>(getIndexUrl(setKey));
}

function resolveData(url: string): CatalogStorageResolution | undefined {
  const base = getCatalogBasePath();
  const logicalPath = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
  const resolution = resolveCatalogStorage(storage, logicalPath);
  return resolution && { ...resolution, blockURL: getDataUrl(resolution.blockURL) };
}

function decodedIndexKey(resolution: CatalogStorageResolution): string {
  return `decoded-index:${JSON.stringify([resolution.blockURL, resolution.entryKey])}`;
}

export function fetchEntityDetail(type: CatalogEntityType, key: string, setKey?: string) {
  if (storage) {
    const url = getEntityDetailUrl(type, key, setKey);
    const resolution = resolveData(url);
    if (!resolution) return Promise.reject(new CatalogNotFoundError(url));
    return cachedJson<unknown>(resolution.blockURL).then((block) => {
      const detail = readCatalogStorageEntry<EntityDetail>(block, resolution);
      if (detail === undefined) throw new CatalogNotFoundError(url);
      return detail;
    });
  }
  return cachedJson<EntityDetail>(getEntityDetailUrl(type, key, setKey));
}

export function peekEntityDetail(type: CatalogEntityType, key: string, setKey?: string) {
  if (storage) {
    const resolution = resolveData(getEntityDetailUrl(type, key, setKey));
    return resolution
      ? readCatalogStorageEntry<EntityDetail>(peekJson(resolution.blockURL), resolution)
      : undefined;
  }
  return peekJson<EntityDetail>(getEntityDetailUrl(type, key, setKey));
}

/** Warm the cache, for example when a link is hovered, ignoring failures. */
export function prefetchEntityDetail(type: CatalogEntityType, key: string, setKey?: string) {
  fetchEntityDetail(type, key, setKey).catch(() => undefined);
}

export function fetchHistoryPage(path: string, page: number) {
  const url = getDataUrl(`${path}/page-${page}.json`);
  const emptyHistoryPage: HistoryPage = {
    page: 1,
    pageSize: 50,
    totalPages: 1,
    entries: [],
  };

  if (storage) {
    const missing = () => {
      if (page === 1) return emptyHistoryPage;
      throw new CatalogNotFoundError(url);
    };
    const resolution = resolveData(url);
    if (!resolution) return Promise.resolve().then(missing);
    return cachedJson<unknown>(resolution.blockURL).then((block) => {
      // Expand history dictionaries synchronously from the block. Do not retain
      // a second copy of every expanded page in the browser cache.
      const history = readCatalogStorageEntry<HistoryPage>(block, resolution);
      return history === undefined ? missing() : history;
    });
  }

  return cachedJson(url, () =>
    fetch(url).then((response) => {
      if (response.ok) {
        const contentType = response.headers?.get?.("content-type") || "";

        if (contentType.includes("text/html")) {
          return emptyHistoryPage;
        }

        return response.json() as Promise<HistoryPage>;
      }

      if (response.status === 404 && page === 1) {
        return emptyHistoryPage;
      }

      throw new Error(`Unable to load ${url}`);
    }),
  );
}
