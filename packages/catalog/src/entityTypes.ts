import type { CatalogEntityType, EntityPath } from "./types";

export const entityPaths: EntityPath[] = [
  "features",
  "segments",
  "attributes",
  "targets",
  "groups",
  "schemas",
];

export const entityPathToType: Record<EntityPath, CatalogEntityType> = {
  features: "feature",
  segments: "segment",
  attributes: "attribute",
  targets: "target",
  groups: "group",
  schemas: "schema",
  tests: "test",
};

export const entityTypeToPath: Record<CatalogEntityType, EntityPath> = {
  feature: "features",
  segment: "segments",
  attribute: "attributes",
  target: "targets",
  group: "groups",
  schema: "schemas",
  test: "tests",
};

export const entityLabels: Record<CatalogEntityType, { singular: string; plural: string }> = {
  feature: { singular: "Feature", plural: "Features" },
  segment: { singular: "Segment", plural: "Segments" },
  attribute: { singular: "Attribute", plural: "Attributes" },
  target: { singular: "Target", plural: "Targets" },
  group: { singular: "Group", plural: "Groups" },
  schema: { singular: "Schema", plural: "Schemas" },
  test: { singular: "Test", plural: "Tests" },
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

export function getBasePath(setKey?: string) {
  return setKey ? `/sets/${encodeRouteSegment(setKey)}` : "";
}

export function getEntityRoute(type: CatalogEntityType, key: string, setKey?: string) {
  return `${getBasePath(setKey)}/${entityTypeToPath[type]}/${encodeRouteSegment(key)}`;
}

export function getDataBasePath(setKey?: string) {
  return setKey ? `/data/sets/${encodeDataSegment(setKey)}` : "/data/root";
}
