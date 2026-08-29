import type { ParsedFeature, ParsedVariable, Target } from "@featurevisor/types";

import {
  getTargetFeatureKeys,
  getTargetVariableKeys,
  resolveTargets,
  targetIncludesFeature,
  targetIncludesVariable,
} from "./targeting";

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

const variables: Record<string, ParsedVariable> = {
  checkoutMessage: {
    description: "Checkout message",
    tags: ["web", "checkout"],
    type: "string",
    defaultValue: "Checkout",
  },
  internalMessage: {
    description: "Internal message",
    tags: ["web", "internal"],
    type: "string",
    defaultValue: "Internal",
  },
  archivedMessage: {
    description: "Archived message",
    tags: ["web", "checkout"],
    archived: true,
    type: "string",
    defaultValue: "Archived",
  },
};

function createDatasource() {
  return {
    listTargets: async () => Object.keys(targets),
    readTarget: async (key: string) => targets[key],
    listFeatures: async () => Object.keys(features),
    readFeature: async (key: string) => features[key],
    listVariables: async () => Object.keys(variables),
    readVariable: async (key: string) => variables[key],
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

  it("applies variable tags, include patterns, exclude patterns, and archived state together", async () => {
    const target: Target = {
      description: "Web checkout variables",
      tags: { and: ["web", "checkout"] },
      includeVariables: ["*Message"],
      excludeVariables: ["internal*"],
    };

    expect(targetIncludesVariable(target, "checkoutMessage", variables.checkoutMessage)).toBe(true);
    expect(targetIncludesVariable(target, "internalMessage", variables.internalMessage)).toBe(
      false,
    );
    expect(targetIncludesVariable(target, "archivedMessage", variables.archivedMessage)).toBe(
      false,
    );
  });

  it("includes every active entity when a target has no selectors", async () => {
    const target: Target = { description: "Everything" };
    expect(targetIncludesFeature(target, "webCheckout", features.webCheckout)).toBe(true);
    expect(targetIncludesVariable(target, "checkoutMessage", variables.checkoutMessage)).toBe(true);

    const variableKeys = await getTargetVariableKeys(createDatasource(), [
      { ...target, key: "everything" },
    ]);
    expect(Array.from(variableKeys).sort()).toEqual(["checkoutMessage", "internalMessage"]);
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
