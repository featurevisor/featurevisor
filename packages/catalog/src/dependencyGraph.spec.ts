import { DependencyGraph, fromNodeId, toNodeId } from "./dependencyGraph";

// banner -> readsBeta -> beta -> backend -> region <- regionalMobile <- notRegional <- beta
const edges: Array<[string, string]> = [
  ["feature:banner", "segment:readsBeta"],
  ["segment:readsBeta", "feature:beta"],
  ["feature:beta", "feature:backend"],
  ["feature:beta", "segment:notRegional"],
  ["segment:notRegional", "segment:regionalMobile"],
  ["segment:regionalMobile", "segment:region"],
  ["feature:backend", "segment:region"],
  ["segment:region", "attribute:country"],
  ["variable:copy", "feature:beta"],
];
const exists = () => true;

describe("Catalog dependency graph", () => {
  it("parses and formats node identities, keeping colons in keys", () => {
    expect(toNodeId("segment", "a:b")).toBe("segment:a:b");
    expect(fromNodeId("segment:a:b")).toEqual({ type: "segment", key: "a:b" });
  });

  it("reports dependencies with the shortest chain, read from the dependent", () => {
    const graph = new DependencyGraph(edges);
    const indirect = graph.indirect("feature:banner", "dependencies", exists);
    const chainOf = (id: string) =>
      indirect.find((entry) => toNodeId(entry.type, entry.key) === id)?.via.map((step) => step.key);

    expect(chainOf("feature:beta")).toEqual(["readsBeta"]);
    expect(chainOf("feature:backend")).toEqual(["readsBeta", "beta"]);
    // Through backend is shorter than through notRegional and regionalMobile.
    expect(chainOf("segment:region")).toEqual(["readsBeta", "beta", "backend"]);
    expect(chainOf("attribute:country")).toEqual(["readsBeta", "beta", "backend", "region"]);
    // Direct references are never repeated as indirect ones.
    expect(chainOf("segment:readsBeta")).toBeUndefined();
  });

  it("reports dependents with the shortest chain, read from the dependent", () => {
    const graph = new DependencyGraph(edges);
    const indirect = graph.indirect("segment:region", "dependents", exists);
    const chainOf = (id: string) =>
      indirect.find((entry) => toNodeId(entry.type, entry.key) === id)?.via.map((step) => step.key);

    expect(chainOf("feature:beta")).toEqual(["backend"]);
    expect(chainOf("segment:notRegional")).toEqual(["regionalMobile"]);
    expect(chainOf("variable:copy")).toEqual(["beta", "backend"]);
    expect(chainOf("feature:banner")).toEqual(["readsBeta", "beta", "backend"]);
    expect(chainOf("feature:backend")).toBeUndefined();
  });

  it("leaves out entities that do not exist", () => {
    const graph = new DependencyGraph(edges);
    const indirect = graph.indirect(
      "feature:banner",
      "dependencies",
      (node) => node !== "segment:region",
    );
    expect(indirect.map((entry) => entry.key)).not.toContain("region");
    // The chain through a missing entity still explains what lies beyond it.
    expect(indirect.find((entry) => entry.key === "country")?.via.map((step) => step.key)).toEqual([
      "readsBeta",
      "beta",
      "backend",
      "region",
    ]);
  });

  it("finds the nearest owners through segments only", () => {
    const graph = new DependencyGraph(edges);
    expect(graph.nearestOwners("segment:region")).toEqual(["feature:backend", "feature:beta"]);
    expect(graph.nearestOwners("feature:beta")).toEqual(["feature:banner", "variable:copy"]);
    expect(graph.nearestOwners("feature:banner")).toEqual([]);
  });

  it("terminates on cycles and ignores self references", () => {
    const graph = new DependencyGraph([
      ["segment:a", "segment:b"],
      ["segment:b", "segment:a"],
      ["segment:a", "segment:a"],
    ]);
    expect([...graph.reach("segment:a", "dependencies").keys()]).toEqual(["segment:b"]);
    expect([...graph.reach("segment:a", "dependents").keys()]).toEqual(["segment:b"]);
  });
});
