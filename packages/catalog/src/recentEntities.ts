import { getCatalogBasePath } from "./basePath";
import { entityTypeToPath } from "./entityTypes";
import type { CatalogEntityType } from "./types";

const STORAGE_PREFIX = "featurevisor-catalog:recent:";
const LIMIT = 8;

export interface RecentEntity {
  type: CatalogEntityType;
  key: string;
  set?: string;
}

/** Catalogs hosted under different paths on one origin keep separate lists. */
function storageKey() {
  return STORAGE_PREFIX + getCatalogBasePath();
}

function sameEntity(left: RecentEntity, right: RecentEntity) {
  return left.type === right.type && left.key === right.key && left.set === right.set;
}

/** Stored values come from earlier versions, other tabs or hand edits, so each is checked. */
function isRecentEntity(value: unknown): value is RecentEntity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.type === "string" &&
    Object.prototype.hasOwnProperty.call(entityTypeToPath, item.type) &&
    typeof item.key === "string" &&
    item.key.length > 0 &&
    (item.set === undefined || typeof item.set === "string")
  );
}

/** Recently opened entities for this viewer. Storage can be unavailable, so failures are ignored. */
export function readRecentEntities(): RecentEntity[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey()) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentEntity)
      .slice(0, LIMIT)
      .map(({ type, key, set }) => (set === undefined ? { type, key } : { type, key, set }));
  } catch {
    return [];
  }
}

export function recordRecentEntity(entity: RecentEntity) {
  if (!isRecentEntity(entity)) return;
  try {
    const next = [entity, ...readRecentEntities().filter((item) => !sameEntity(item, entity))];
    window.localStorage.setItem(storageKey(), JSON.stringify(next.slice(0, LIMIT)));
  } catch {
    // Private windows and blocked storage simply skip the recent list.
  }
}
