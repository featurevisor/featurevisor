import type { DatafileContent, Feature, Segment, Target } from "./index";

describe("sdk: Index", function () {
  it("should be a function", function () {
    expect(true).toBe(true);
  });

  it("should expose common Featurevisor public types", function () {
    const segment: Segment = {
      conditions: "*",
    };
    const feature: Feature = {
      bucketBy: "userId",
      traffic: [{ key: "everyone", segments: "*", percentage: 100000 }],
    };
    const datafile: DatafileContent = {
      schemaVersion: "2",
      revision: "types",
      segments: { everyone: segment },
      features: { typed: feature },
    };
    const target: Target = {
      description: "Typed target",
      includeFeatures: "*",
    };

    expect(datafile.features.typed).toEqual(feature);
    expect(target.includeFeatures).toEqual("*");
  });
});
