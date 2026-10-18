import { getCatalogBasePath } from "./basePath";

/**
 * The last search and filters used on each list, for this browser tab only, so the
 * sidebar can take readers back to the list as they left it.
 */
const PREFIX = "featurevisor-catalog:list:";

// Scoped by base path, so Catalogs hosted side by side on one origin do not share lists.
function storageKey(setKey: string | undefined, entityPath: string) {
  return `${PREFIX}${getCatalogBasePath()}:${setKey || ""}:${entityPath}`;
}

export function rememberListSearch(setKey: string | undefined, entityPath: string, search: string) {
  try {
    if (search && search !== "?")
      window.sessionStorage.setItem(storageKey(setKey, entityPath), search);
    else window.sessionStorage.removeItem(storageKey(setKey, entityPath));
  } catch {
    // Storage can be unavailable, for example in private windows.
  }
}

export function recallListSearch(setKey: string | undefined, entityPath: string) {
  try {
    return window.sessionStorage.getItem(storageKey(setKey, entityPath)) || "";
  } catch {
    return "";
  }
}
