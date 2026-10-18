import type { CatalogEntityType, CatalogIndex, EntitySummary } from "./types";
import { entityTypeToPath } from "./entityTypes";

type Kind = "string" | "strings" | "boolean" | "number" | "modified";

// Keep this exhaustive so adding a summary field requires a wire format decision.
const fields: Record<keyof EntitySummary, Kind> = {
  key: "string",
  href: "string",
  description: "string",
  archived: "boolean",
  deprecated: "boolean",
  promotable: "boolean",
  environmentStatus: "string",
  environmentStatusEnvironment: "string",
  tags: "strings",
  targets: "strings",
  usedInFeatureCount: "number",
  usedInVariableCount: "number",
  usedByCount: "number",
  references: "strings",
  dependsOnDeprecated: "boolean",
  environments: "strings",
  variationValues: "strings",
  variableKeys: "strings",
  hasVariations: "boolean",
  hasVariables: "boolean",
  variableType: "string",
  isComposed: "boolean",
  hasTests: "boolean",
  testKind: "string",
  testSubject: "string",
  assertionCount: "number",
  childCount: "number",
  testPassed: "boolean",
  testReportStatus: "string",
  attributeType: "string",
  attributeFormat: "string",
  environmentsDiffer: "boolean",
  searchTerms: "strings",
  lastModified: "modified",
};

const format = "featurevisor.catalog.index";
const entityTypes = Object.keys(entityTypeToPath) as CatalogEntityType[];
type Columns = Record<string, unknown[]>;

/**
 * Version 1 stores one column per present field and one shared string dictionary.
 * Null cells mean absent fields. Empty strings, arrays, false and zero remain values.
 * Commits use three references.
 * Every summary field is included, so consumers still need only one request.
 */
export function encodeCatalogIndex(index: CatalogIndex): unknown {
  const strings: string[] = [];
  const references = new Map<string, number>();
  const intern = (value: string): number => {
    if (typeof value !== "string") invalid();
    const existing = references.get(value);
    if (existing !== undefined) return existing;
    const reference = strings.length;
    strings.push(value);
    references.set(value, reference);
    return reference;
  };
  const encode = (kind: Kind, value: unknown): unknown => {
    if (value === undefined) return null;
    switch (kind) {
      case "string":
        return intern(value as string);
      case "strings":
        if (!Array.isArray(value)) invalid();
        return (value as string[]).map(intern);
      case "modified": {
        const modified = value as NonNullable<EntitySummary["lastModified"]>;
        return [modified.commit, modified.author, modified.timestamp].map(intern);
      }
      default:
        return value;
    }
  };
  const entities = Object.fromEntries(
    entityTypes.map((type) => {
      const rows = index.entities[type];
      const columns: Columns = {};
      for (const field of Object.keys(fields) as Array<keyof EntitySummary>) {
        if (rows.some((row) => row[field] !== undefined)) {
          columns[field] = rows.map((row) => encode(fields[field], row[field]));
        }
      }
      return [type, { length: rows.length, columns }];
    }),
  );
  return { format, version: 1, set: index.set, counts: index.counts, strings, entities };
}

function invalid(): never {
  throw new Error("Invalid Catalog index");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

/** Legacy plain indexes retain their identity; compact indexes are reconstructed. */
export function decodeCatalogIndex(raw: unknown): CatalogIndex {
  const root = record(raw);
  if (typeof root.set !== "string") invalid();
  const counts = record(root.counts);
  const entities = record(root.entities);
  for (const type of entityTypes) {
    if (!Number.isSafeInteger(counts[type]) || (counts[type] as number) < 0) invalid();
  }

  // Legacy compatibility checks the envelope, not every authored summary value.
  if (!Object.prototype.hasOwnProperty.call(root, "format")) {
    for (const type of entityTypes) array(entities[type]);
    return raw as CatalogIndex;
  }
  if (root.format !== format || root.version !== 1) invalid();
  const strings = array(root.strings);
  if (strings.some((value) => typeof value !== "string")) invalid();
  const resolve = (value: unknown): string => {
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 0 ||
      (value as number) >= strings.length
    ) {
      invalid();
    }
    return strings[value as number] as string;
  };
  const decode = (kind: Kind, value: unknown): unknown => {
    switch (kind) {
      case "string":
        return resolve(value);
      case "strings":
        return array(value).map(resolve);
      case "boolean":
        if (typeof value !== "boolean") invalid();
        return value;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) invalid();
        return value;
      case "modified": {
        const modified = array(value);
        if (modified.length !== 3) invalid();
        return {
          commit: resolve(modified[0]),
          author: resolve(modified[1]),
          timestamp: resolve(modified[2]),
        };
      }
    }
  };
  const decoded = Object.fromEntries(
    entityTypes.map((type) => {
      const table = record(entities[type]);
      if (!Number.isSafeInteger(table.length) || (table.length as number) < 0) invalid();
      const columns = record(table.columns);
      const length = table.length as number;
      for (const [field, values] of Object.entries(columns)) {
        if (!Object.prototype.hasOwnProperty.call(fields, field)) invalid();
        if (array(values).length !== length) invalid();
      }
      if (length && (!Array.isArray(columns.key) || !Array.isArray(columns.href))) invalid();
      const rows: Record<string, unknown>[] = Array.from({ length }, () => ({}));
      for (const [field, values] of Object.entries(columns)) {
        (values as unknown[]).forEach((value, position) => {
          if (value !== null)
            rows[position][field] = decode(fields[field as keyof EntitySummary], value);
        });
      }
      for (const row of rows) {
        if (typeof row.key !== "string" || typeof row.href !== "string") invalid();
      }
      return [type, rows];
    }),
  );
  return { set: root.set, counts, entities: decoded } as unknown as CatalogIndex;
}
