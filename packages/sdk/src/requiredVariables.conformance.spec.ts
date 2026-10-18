import type {
  DatafileContent,
  Condition,
  StickyFeatures,
  StickyVariables,
} from "@featurevisor/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";

const conformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v3.json"), "utf8"),
);
const contract = conformance.requiredVariables as {
  datafile: DatafileContent;
  stickyCases: Array<{
    name: string;
    stickyVariables: StickyVariables;
    stickyFeatures: StickyFeatures;
    matched: boolean;
    accumulated: Record<string, boolean>;
  }>;
  groupInputs: Array<{ a: boolean; b: boolean }>;
  groups: Array<{
    name: string;
    requirements: Array<string | { and?: unknown[]; or?: unknown[]; not?: unknown[] }>;
    results: boolean[];
  }>;
  expected: {
    matchedValue: string;
    defaultValue: string;
    unmetReason: string;
    nullGetterValue: null;
  };
};

function expandGroupRequirements(value: unknown): Condition[] {
  const expand = (item: any): Condition => {
    if (typeof item === "string") {
      return { variable: item, operator: "equals", value: true };
    }
    if (item.and) return { and: item.and.map(expand) };
    if (item.or) return { or: item.or.map(expand) };
    return { not: item.not.map(expand) };
  };
  return (value as unknown[]).map(expand);
}

function groupDatafile(requirements: Condition[]): DatafileContent {
  const override = { key: "required", conditions: requirements, value: "matched" };
  return createDatafile({
    features: {
      gated: createFeature({ conditions: requirements }),
      featureOverride: createFeature({
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        traffic: [
          {
            key: "all",
            segments: "*",
            percentage: 100000,
            allocation: [],
            variableOverrides: { message: [override] },
          },
        ],
      }),
    },
    variables: {
      a: { type: "boolean", defaultValue: false },
      b: { type: "boolean", defaultValue: false },
      root: {
        type: "string",
        defaultValue: "matched",
        disabledValue: "default",
        conditions: requirements,
      },
      override: { type: "string", defaultValue: "default", overrides: [override] },
      accumulated: {
        type: "object",
        defaultValue: {},
        overrideProgram: [
          {
            key: "required",
            keyPath: ["required"],
            conditions: requirements,
            operations: [{ op: "set", path: ["matched"], value: true }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  });
}

describe("required variable conformance", () => {
  test.each(contract.stickyCases)("portable mixed sources: $name", (testCase) => {
    expect(conformance.version).toBe(15);
    const sdk = createFeaturevisor({
      datafile: contract.datafile,
      stickyVariables: testCase.stickyVariables,
      stickyFeatures: testCase.stickyFeatures,
      logLevel: "fatal",
    });
    const expected = testCase.matched
      ? contract.expected.matchedValue
      : contract.expected.defaultValue;

    expect(sdk.isEnabled("gated")).toBe(testCase.matched);
    expect(sdk.evaluateFlag("gated").reason).toBe(
      testCase.matched ? "rule" : contract.expected.unmetReason,
    );
    expect(sdk.getVariable("featureOverride", "message")).toBe(expected);
    expect(sdk.getVariable("root")).toBe(expected);
    expect(sdk.getVariable("override")).toBe(expected);
    expect(sdk.getVariable("accumulated")).toEqual(testCase.accumulated);
  });

  test("portable null contract uses the ordinary malformed JSON getter result", () => {
    const sdk = createFeaturevisor({ datafile: contract.datafile, logLevel: "fatal" });

    expect(sdk.getVariableJSON("malformed")).toBe(contract.expected.nullGetterValue);
    expect(sdk.getVariable("nullGate")).toBe(contract.expected.matchedValue);
  });

  test.each(contract.groups)("portable group semantics: $name", (group) => {
    const requirements = expandGroupRequirements(group.requirements);
    let index = 0;

    for (const input of contract.groupInputs) {
      const matched = group.results[index++];
      const sdk = createFeaturevisor({
        datafile: groupDatafile(requirements),
        stickyVariables: input,
        logLevel: "fatal",
      });
      const expected = matched ? contract.expected.matchedValue : contract.expected.defaultValue;

      expect(sdk.isEnabled("gated")).toBe(matched);
      expect(sdk.getVariable("featureOverride", "message")).toBe(expected);
      expect(sdk.getVariable("root")).toBe(expected);
      expect(sdk.getVariable("override")).toBe(expected);
      expect(sdk.getVariable("accumulated")).toEqual(matched ? { matched: true } : {});
    }
  });
});
