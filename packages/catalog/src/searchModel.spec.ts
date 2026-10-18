import { getSearchMatchLabel, matchStrength, searchCatalog, tokenize } from "./searchModel";
import type { CatalogIndex, EntitySummary } from "./types";

function index(entities: Partial<Record<string, Array<Partial<EntitySummary>>>>) {
  return {
    set: "",
    counts: {},
    entities: Object.fromEntries(
      Object.entries(entities).map(([type, items]) => [
        type,
        (items || []).map((item) => ({ href: "", key: "", ...item })),
      ]),
    ),
  } as unknown as CatalogIndex;
}

describe("Catalog search", () => {
  it("labels map property and source matches without changing stored search kinds", () => {
    expect(getSearchMatchLabel("alias")).toBe("Property");
    expect(getSearchMatchLabel("source")).toBe("Source");
  });
  it("splits keys on separators, camelCase and digits", () => {
    expect(tokenize("variablePolicySource.config")).toEqual([
      "variable",
      "policy",
      "source",
      "config",
    ]);
    expect(tokenize("HTTPServer2")).toEqual(["http", "server2"]);
  });

  it("never matches short terms in the middle of a word", () => {
    expect(matchStrength("connectionLimit", "nl")).toBeUndefined();
    expect(matchStrength("countries.nl", "nl")).toBe("word");
    expect(matchStrength("connectionLimit", "limit")).toBe("word");
    expect(matchStrength("unlimited", "limit")).toBe("substring");
  });

  it("ranks exact and prefix key matches above authored values and descriptions", () => {
    const results = searchCatalog(
      index({
        feature: [
          { key: "cache", searchTerms: ["rule:netherlands"] },
          { key: "netherlandsBanner" },
          { key: "other", description: "Shown in the Netherlands" },
        ],
        segment: [{ key: "netherlands" }],
      }),
      "netherlands",
    );
    expect(results.map((result) => result.key)).toEqual([
      "netherlands",
      "netherlandsBanner",
      "cache",
      "other",
    ]);
    expect(results.find((result) => result.key === "cache")?.match).toEqual({
      kind: "rule",
      value: "netherlands",
    });
    expect(results.find((result) => result.key === "netherlands")?.match).toBeUndefined();
  });

  it("requires every term to match somewhere", () => {
    const catalog = index({ feature: [{ key: "checkout", description: "Cart flow" }] });
    expect(searchCatalog(catalog, "checkout cart")).toHaveLength(1);
    expect(searchCatalog(catalog, "checkout banner")).toHaveLength(0);
    expect(searchCatalog(catalog, "   ")).toHaveLength(0);
  });

  it("finds variation values and variable keys from their own index columns", () => {
    const catalog = index({
      feature: [{ key: "checkout", variationValues: ["treatment"], variableKeys: ["buttonColor"] }],
    });
    expect(searchCatalog(catalog, "treatment")[0]).toMatchObject({
      key: "checkout",
      match: { kind: "variation", value: "treatment" },
    });
    expect(searchCatalog(catalog, "button")[0]).toMatchObject({
      match: { kind: "variable", value: "buttonColor" },
    });
  });

  it("returns the best thirty of many matches in rank order", () => {
    const features = Array.from({ length: 500 }, (_, i) => ({
      key: `flag${String(i).padStart(3, "0")}`,
    }));
    const results = searchCatalog(index({ feature: [...features, { key: "flag" }] }), "flag");
    expect(results).toHaveLength(30);
    expect(results[0].key).toBe("flag");
    expect(results.slice(1).map((result) => result.key)).toEqual(
      features.slice(0, 29).map((feature) => feature.key),
    );
  });
});
