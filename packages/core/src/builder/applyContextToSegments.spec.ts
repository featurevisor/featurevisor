import type { Conditions, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import {
  applyContextToSegments,
  applyContextToGroupSegments,
  removeRedundantGroupSegments,
} from "./applyContextToSegments";
import { applyContextToDatafile } from "./applyContextToDatafile";

const datafile: DatafileContent = {
  schemaVersion: "4",
  revision: "segments",
  segments: {
    web: { conditions: { attribute: "platform", operator: "equals", value: "web" } },
    browser: { conditions: { attribute: "browser", operator: "equals", value: "chrome" } },
    nested: { conditions: ["web"] },
    flag: { conditions: ["nested", { feature: "dependency" }] },
    variable: { conditions: ["web", { variable: "policy", operator: "equals", value: true }] },
    outer: { conditions: ["flag", "browser"] },
    cycleA: { conditions: "cycleB" },
    cycleB: { conditions: "cycleA" },
  },
  features: {},
};
const featurevisor = createFeaturevisor({ datafile, logLevel: "fatal" });

describe("segment context specialization", () => {
  it.each([
    ["web", "*"],
    ["nested", "*"],
    ["flag", "flag"],
    ["variable", "variable"],
    ["outer", "outer"],
    ["missing", "missing"],
    ["cycleA", "cycleA"],
  ])("resolves only completely known segment %s", (input, expected) => {
    expect(applyContextToSegments(featurevisor, input, { platform: "web" })).toEqual(expected);
    expect(applyContextToGroupSegments(featurevisor, input, { platform: "web" })).toEqual(expected);
  });
  it("does not trust old removeSegments hints over a dynamic expression", () => {
    expect(applyContextToSegments(featurevisor, "flag", { platform: "web" }, ["flag"])).toBe(
      "flag",
    );
  });
  it.each([
    [{ not: ["web", "flag"] }, { not: ["flag"] }],
    [{ not: ["flag"] }, { not: ["flag"] }],
    [{ or: ["web", "flag"] }, "*"],
    [{ and: ["web", "flag"] }, { and: ["flag"] }],
    [{ not: ["web"] }, { or: [] }],
    [{ not: [{ not: ["web"] }] }, "*"],
  ])("specializes nested groups without broadening NOT: %j", (input, expected) => {
    expect(applyContextToSegments(featurevisor, input as Conditions, { platform: "web" })).toEqual(
      expected,
    );
  });
  it("uses the same constant rules for transitional group helpers", () => {
    expect(removeRedundantGroupSegments({ not: ["*", "dynamic"] })).toEqual({ not: ["dynamic"] });
    expect(removeRedundantGroupSegments({ not: ["*"] })).toEqual({ or: [] });
  });
  it("retains segments still referenced by dynamic segment expressions", () => {
    const input: DatafileContent = {
      ...datafile,
      features: {
        root: {
          bucketBy: "id",
          conditions: "outer",
          traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        },
        dependency: {
          bucketBy: "id",
          conditions: "web",
          traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        },
      },
      variables: { policy: { type: "boolean", defaultValue: true } },
    };
    const before = structuredClone(input);
    const result = applyContextToDatafile(input, { platform: "web" });
    expect(result.features.root.conditions).toBe("outer");
    expect(result.segments.flag.conditions).toEqual([{ feature: "dependency" }]);
    expect(result.segments.outer.conditions).toEqual(["flag", "browser"]);
    expect(result.segments.web).toBeUndefined();
    expect(result.segments.nested).toBeUndefined();
    expect(result.segments.flag).toBeDefined();
    expect(input).toEqual(before);
    const sdk = createFeaturevisor({ datafile: result, logLevel: "fatal" });
    expect(sdk.isEnabled("root", { browser: "chrome" })).toBe(true);
    expect(sdk.isEnabled("root", { browser: "safari" })).toBe(false);
  });
});
