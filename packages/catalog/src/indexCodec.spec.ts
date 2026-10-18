import { decodeCatalogIndex, encodeCatalogIndex } from "./indexCodec";
import { entityTypeToPath } from "./entityTypes";
import type { CatalogIndex, EntitySummary } from "./types";

function index(rows: EntitySummary[] = []): CatalogIndex {
  return {
    set: "production/日本語",
    counts: Object.fromEntries(Object.keys(entityTypeToPath).map((type) => [type, rows.length])),
    entities: Object.fromEntries(Object.keys(entityTypeToPath).map((type) => [type, rows])),
  } as CatalogIndex;
}

const complete: Required<EntitySummary> = {
  key: "checkout/日本語",
  href: "/features/checkout%252F日本語",
  description: "Searchable description 🐈",
  archived: false,
  deprecated: true,
  promotable: false,
  environmentStatus: "production",
  environmentStatusEnvironment: "production",
  tags: ["shared", "shared", "__proto__"],
  targets: ["shared"],
  usedInFeatureCount: 0,
  usedInVariableCount: 17,
  usedByCount: 4,
  references: ["segment:shared", "feature:checkout/日本語", "attribute:shared"],
  dependsOnDeprecated: true,
  environments: ["production"],
  variationValues: ["", "shared"],
  variableKeys: ["shared"],
  hasVariations: true,
  hasVariables: false,
  variableType: "string",
  isComposed: false,
  hasTests: true,
  testKind: "scenario",
  testSubject: "checkout/日本語",
  assertionCount: 42,
  childCount: 0,
  testPassed: false,
  testReportStatus: "1 of 2 cases in report. 1 failed",
  attributeType: "string",
  attributeFormat: "date-time",
  environmentsDiffer: true,
  searchTerms: ["rule:shared", "value:shared", "assertion:日本語"],
  lastModified: { commit: "abc", author: "shared", timestamp: "2026-09-30T10:00:00Z" },
};

describe("Catalog index codec", () => {
  it("round trips every field and entity type through JSON without changing the input", () => {
    const original = index([
      complete,
      { key: "", href: "", description: "", tags: [], environments: [] },
      { key: "minimal", href: "/minimal" },
    ]);
    const before = JSON.stringify(original);
    const encoded = encodeCatalogIndex(original);
    expect(decodeCatalogIndex(JSON.parse(JSON.stringify(encoded)))).toEqual(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(encodeCatalogIndex(original)).toEqual(encoded);
  });

  it("shares strings across fields and types and reduces repeated summaries", () => {
    const original = index(Array.from({ length: 100 }, () => complete));
    const encoded = encodeCatalogIndex(original) as { strings: string[] };
    expect(encoded.strings.filter((value) => value === "shared")).toHaveLength(1);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(original).length / 2);
  });

  it("supports empty indexes and legacy plain indexes", () => {
    const original = index();
    expect(decodeCatalogIndex(encodeCatalogIndex(original))).toEqual(original);
    expect(decodeCatalogIndex(original)).toBe(original);
  });

  it.each([false, null, "production", [false], [42]])(
    "rejects invalid string collections without coercion (%j)",
    (environments) => {
      const row = { key: "invalid", href: "/invalid", environments } as unknown as EntitySummary;
      expect(() => encodeCatalogIndex(index([row]))).toThrow("Invalid Catalog index");
    },
  );

  it("rejects invalid scalar strings without coercion", () => {
    const row = { key: false, href: "/invalid" } as unknown as EntitySummary;
    expect(() => encodeCatalogIndex(index([row]))).toThrow("Invalid Catalog index");
  });

  it("requires producers to project tag expressions into summary string references", () => {
    const row = {
      key: "premiumWeb",
      href: "/targets/premiumWeb",
      tags: { and: ["web", "premium"] },
    } as unknown as EntitySummary;
    expect(() => encodeCatalogIndex(index([row]))).toThrow("Invalid Catalog index");
    const projected = index([{ ...row, tags: ["web", "premium"] }]);
    expect(decodeCatalogIndex(encodeCatalogIndex(projected))).toEqual(projected);
  });

  it.each([
    (wire: any) => {
      wire.version = 2;
    },
    (wire: any) => {
      wire.format = "other";
    },
    (wire: any) => {
      wire.strings[0] = 7;
    },
    (wire: any) => {
      wire.entities.feature.columns.key[0] = -1;
    },
    (wire: any) => {
      wire.entities.feature.columns.key[0] = 0.5;
    },
    (wire: any) => {
      wire.entities.feature.columns.key[0] = 10000;
    },
    (wire: any) => {
      wire.entities.feature.columns.key[0] = null;
    },
    (wire: any) => {
      wire.entities.feature.columns.tags[0] = [10000];
    },
    (wire: any) => {
      wire.entities.feature.columns.href = [];
    },
    (wire: any) => {
      wire.entities.feature.columns.archived[0] = 0;
    },
    (wire: any) => {
      wire.entities.feature.columns.usedInFeatureCount[0] = "zero";
    },
    (wire: any) => {
      wire.entities.feature.columns.lastModified[0] = [];
    },
    (wire: any) => {
      wire.entities.feature.columns.unknown = [0];
    },
    (wire: any) => {
      wire.counts.feature = -1;
    },
  ])("rejects malformed compact payloads (%#)", (corrupt) => {
    const wire = encodeCatalogIndex(index([complete]));
    corrupt(wire);
    expect(() => decodeCatalogIndex(wire)).toThrow("Invalid Catalog index");
  });
});
