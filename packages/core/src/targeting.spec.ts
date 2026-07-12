import type { ParsedFeature, Target } from "@featurevisor/types";

import { getTargetFeatureKeys, resolveTargets, targetIncludesFeature } from "./targeting";

const features: Record<string, ParsedFeature> = {
  webCheckout: {
    key: "webCheckout",
    description: "Web checkout",
    tags: ["web", "checkout"],
    bucketBy: "userId",
    rules: [],
  },
  webInternal: {
    key: "webInternal",
    description: "Internal web",
    tags: ["web", "internal"],
    bucketBy: "userId",
    rules: [],
  },
  mobileCheckout: {
    key: "mobileCheckout",
    description: "Mobile checkout",
    tags: ["mobile", "checkout"],
    bucketBy: "userId",
    rules: [],
  },
};

const targets: Record<string, Target> = {
  web: {
    description: "Web",
    tags: { and: ["web", "checkout"] },
    includeFeatures: ["web*"],
    excludeFeatures: ["webInternal*"],
  },
  mobile: { description: "Mobile", tag: "mobile" },
};

function createDatasource() {
  return {
    listTargets: async () => Object.keys(targets),
    readTarget: async (key: string) => targets[key],
    listFeatures: async () => Object.keys(features),
    readFeature: async (key: string) => features[key],
  } as any;
}

describe("targeting", () => {
  it("matches full target selectors", () => {
    expect(targetIncludesFeature(targets.web, "webCheckout", features.webCheckout)).toEqual(true);
    expect(targetIncludesFeature(targets.web, "webInternal", features.webInternal)).toEqual(false);
    expect(targetIncludesFeature(targets.web, "mobileCheckout", features.mobileCheckout)).toEqual(
      false,
    );
  });

  it("resolves repeated targets once and returns their feature union", async () => {
    const datasource = createDatasource();
    const resolved = await resolveTargets(datasource, ["web", "mobile", "web"]);
    const featureKeys = await getTargetFeatureKeys(datasource, resolved);

    expect(resolved.map((target) => target.key)).toEqual(["web", "mobile"]);
    expect(Array.from(featureKeys).sort()).toEqual(["mobileCheckout", "webCheckout"]);
  });

  it("validates unknown and missing targets", async () => {
    await expect(resolveTargets(createDatasource(), "missing")).rejects.toThrow(
      'Unknown target "missing"',
    );
    await expect(resolveTargets({ listTargets: async () => [] } as any, undefined)).rejects.toThrow(
      "No targets found",
    );
  });
});
