import type { ParsedVariableOverride } from "@featurevisor/types";

import { flattenVariableOverrides, visitVariableOverrides } from "./variableOverrides";

function override(key: string, overrides?: ParsedVariableOverride[]): ParsedVariableOverride {
  return {
    key,
    segments: "*",
    value: key,
    overrides,
  };
}

describe("global variable override traversal", () => {
  it("visits nested overrides in authored depth-first order", () => {
    const overrides = [
      override("country", [override("city", [override("device")]), override("region")]),
      override("fallback"),
    ];
    const keys: string[] = [];

    visitVariableOverrides(overrides, (entry) => keys.push(entry.key));

    expect(keys).toEqual(["country", "city", "device", "region", "fallback"]);
  });

  it("flattens environment and environmentless override trees", () => {
    expect(
      flattenVariableOverrides({
        staging: [override("staging", [override("staging-child")])],
        production: [override("production")],
      }).map((entry) => entry.key),
    ).toEqual(["staging", "staging-child", "production"]);

    expect(
      flattenVariableOverrides([override("root", [override("child")])]).map((entry) => entry.key),
    ).toEqual(["root", "child"]);
    expect(flattenVariableOverrides(undefined)).toEqual([]);
  });
});
