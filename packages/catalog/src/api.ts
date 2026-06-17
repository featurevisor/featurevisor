import type {
  CatalogEntityType,
  CatalogIndex,
  CatalogManifest,
  EntityDetail,
  HistoryPage,
} from "./types";
import { encodeDataSegment, getDataBasePath } from "./entityTypes";

let routerMode: CatalogManifest["router"] = "browser";

function getDataUrl(path: string) {
  const normalizedPath = path.replace(/^\//, "");

  return routerMode === "browser" ? `/${normalizedPath}` : normalizedPath;
}

export function setCatalogRouterMode(mode: CatalogManifest["router"]) {
  routerMode = mode || "browser";
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  return response.json() as Promise<T>;
}

export function fetchManifest() {
  return fetchJson<CatalogManifest>(getDataUrl("data/manifest.json")).catch(() =>
    fetchJson<CatalogManifest>("/data/manifest.json"),
  );
}

export function fetchIndex(setKey?: string) {
  return fetchJson<CatalogIndex>(getDataUrl(`${getDataBasePath(setKey)}/index.json`));
}

export function fetchEntityDetail(type: CatalogEntityType, key: string, setKey?: string) {
  return fetchJson<EntityDetail>(
    getDataUrl(`${getDataBasePath(setKey)}/entities/${type}/${encodeDataSegment(key)}.json`),
  );
}

export function fetchHistoryPage(path: string, page: number) {
  const url = getDataUrl(`${path}/page-${page}.json`);
  const emptyHistoryPage: HistoryPage = {
    page: 1,
    pageSize: 50,
    totalPages: 1,
    entries: [],
  };

  return fetch(url).then((response) => {
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        return emptyHistoryPage;
      }

      return response.json() as Promise<HistoryPage>;
    }

    if (response.status === 404 && page === 1) {
      return emptyHistoryPage;
    }

    throw new Error(`Unable to load ${url}`);
  });
}
