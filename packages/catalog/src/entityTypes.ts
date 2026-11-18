import type { CatalogEntityType, EntityPath } from "./types";

export const entityPaths: EntityPath[] = [
  "features",
  "variables",
  "attributes",
  "segments",
  "targets",
  "schemas",
  "tests",
];

export function isEntityPath(value: string | undefined): value is EntityPath {
  return entityPaths.includes(value as EntityPath);
}

/**
 * An entity page's pathname in parts: the set it is in, if any, and the tab and what follows it,
 * as in `/sets/:setKey/:entityPath/:entityKey/rules/production`. Undefined for other pages.
 */
export function parseEntityPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const start = segments[0] === "sets" ? 2 : 0;
  if (segments.length < start + 2 || !isEntityPath(segments[start])) return undefined;
  return { set: segments.slice(0, start), tab: segments.slice(start + 2) };
}

export const entityPathToType: Record<EntityPath, CatalogEntityType> = {
  features: "feature",
  segments: "segment",
  attributes: "attribute",
  targets: "target",
  schemas: "schema",
  tests: "test",
  variables: "variable",
};

export const entityTypeToPath: Record<CatalogEntityType, EntityPath> = {
  feature: "features",
  segment: "segments",
  attribute: "attributes",
  target: "targets",
  schema: "schemas",
  test: "tests",
  variable: "variables",
};

export const entityLabels: Record<CatalogEntityType, { singular: string; plural: string }> = {
  feature: { singular: "Feature", plural: "Features" },
  segment: { singular: "Segment", plural: "Segments" },
  attribute: { singular: "Attribute", plural: "Attributes" },
  target: { singular: "Target", plural: "Targets" },
  schema: { singular: "Schema", plural: "Schemas" },
  test: { singular: "Test", plural: "Tests" },
  variable: { singular: "Variable", plural: "Variables" },
};

export function encodeRouteSegment(value: string) {
  return encodeURIComponent(value).replace(/%2F/gi, "%252F");
}

export function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeDataSegment(value: string) {
  return encodeURIComponent(value);
}

export function encodeDataPath(value: string) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function getBasePath(setKey?: string) {
  return setKey ? `/sets/${encodeRouteSegment(setKey)}` : "";
}

export function getEntityRoute(type: CatalogEntityType, key: string, setKey?: string) {
  return `${getBasePath(setKey)}/${entityTypeToPath[type]}/${encodeRouteSegment(key)}`;
}

export function getEntityListRoute(type: CatalogEntityType, setKey?: string) {
  return `${getBasePath(setKey)}/${entityTypeToPath[type]}`;
}

export function getDataBasePath(setKey?: string) {
  return setKey ? `/data/sets/${encodeDataSegment(setKey)}` : "/data/root";
}

function getSetSortGroup(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.startsWith("dev")) {
    return 0;
  }

  if (normalized.startsWith("prod")) {
    return 2;
  }

  return 1;
}

export function sortSetKeys(setKeys: string[]) {
  return setKeys.slice().sort((left, right) => {
    const leftGroup = getSetSortGroup(left);
    const rightGroup = getSetSortGroup(right);

    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup;
    }

    return left.localeCompare(right);
  });
}
