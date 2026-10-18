import { getTestDatafileKey } from "./datafileKey";
import type { DatafileContent, TestFeature, TestVariable } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";

import { createCoverageCollector, type CoverageSelection } from "./coverage";
import { testFeature } from "./testFeature";
import { testVariable } from "./testVariable";

function sortKey(selection: CoverageSelection): string {
  return JSON.stringify([
    selection.set,
    selection.environment,
    selection.target,
    selection.featureKey,
    selection.variableKey,
    selection.ruleKey,
    selection.overridePath,
  ]);
}

function featureDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "coverage-feature",
    segments: {},
    features: {
      checkout: {
        key: "checkout",
        bucketBy: "userId",
        traffic: [
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
          },
        ],
      },
    },
  };
}

function accumulationDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "coverage-accumulation",
    segments: {},
    features: {},
    variables: {
      policy: {
        type: "array",
        defaultValue: ["default"],
        overrideProgram: [
          {
            key: "first",
            keyPath: ["first"],
            segments: "*",
            operations: [{ op: "append", path: [], value: "first" }],
            onMatch: 1,
            onMiss: 1,
          },
          {
            key: "second",
            keyPath: ["second"],
            segments: "*",
            operations: [{ op: "append", path: [], value: "second" }],
            onMatch: 2,
            onMiss: 2,
          },
        ],
      },
    },
  };
}

describe("core: observed selection coverage", () => {
  it("retains a variation and an unkeyed override index as observed selections", () => {
    const collector = createCoverageCollector(null);
    collector.onEvaluation(
      {
        type: "variation",
        reason: "allocated",
        featureKey: "checkout",
        ruleKey: "everyone",
        variation: { value: "treatment" },
      },
      {},
    );
    collector.onEvaluation(
      {
        type: "variable",
        reason: "variable_override_rule",
        featureKey: "checkout",
        variableKey: "limit",
        ruleKey: "everyone",
        variableOverrideIndex: 0,
      },
      {},
    );
    expect(collector.getSelections()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "checkout", variation: "treatment" }),
        expect.objectContaining({ featureKey: "checkout", variableKey: "limit", overrideIndex: 0 }),
      ]),
    );
  });

  it("records only observed rules and override paths, deduplicated and sorted", () => {
    const collector = createCoverageCollector("preview");
    const targetedAssertion = { environment: "production", target: "web" };

    collector.onEvaluation(
      {
        type: "flag",
        reason: "allocated",
        featureKey: "checkout",
        ruleKey: "everyone",
      },
      targetedAssertion,
    );
    collector.onEvaluation(
      {
        type: "variable",
        reason: "variable_override_rule",
        variableKey: "policy",
        variableOverrideKey: "last",
        variableOverridePath: ["ignored-last"],
        variableOverridePaths: [["region"], ["region", "country"]],
      },
      targetedAssertion,
    );
    collector.onEvaluation(
      {
        type: "variable",
        reason: "variable_override_rule",
        featureKey: "checkout",
        variableKey: "limit",
        ruleKey: "everyone",
        variableOverrideKey: "mobile",
        variableOverridePath: ["device", "mobile"],
      },
      { environment: "production" },
    );
    collector.onEvaluation(
      {
        type: "variable",
        reason: "variable_override_rule",
        variableKey: "theme",
        variableOverrideKey: "dark",
      },
      {},
    );

    const unobserved: Evaluation = {
      type: "variable",
      reason: "variable_default",
      variableKey: "unobserved",
    };
    collector.onEvaluation(unobserved, targetedAssertion);
    collector.onEvaluation(unobserved, targetedAssertion);
    collector.onEvaluation(
      {
        type: "flag",
        reason: "allocated",
        featureKey: "checkout",
        ruleKey: "everyone",
      },
      targetedAssertion,
    );

    const selections = collector.getSelections();
    expect(selections).toHaveLength(5);
    expect(selections).toEqual(
      expect.arrayContaining([
        {
          set: "preview",
          environment: "production",
          target: "web",
          featureKey: "checkout",
          ruleKey: "everyone",
        },
        {
          set: "preview",
          environment: "production",
          target: "web",
          variableKey: "policy",
          overridePath: ["region"],
        },
        {
          set: "preview",
          environment: "production",
          target: "web",
          variableKey: "policy",
          overridePath: ["region", "country"],
        },
        {
          set: "preview",
          environment: "production",
          target: null,
          featureKey: "checkout",
          variableKey: "limit",
          ruleKey: "everyone",
          overridePath: ["device", "mobile"],
        },
        {
          set: "preview",
          environment: null,
          target: null,
          variableKey: "theme",
          overridePath: ["dark"],
        },
      ]),
    );
    const keys = selections.map(sortKey);
    expect(keys).toEqual([...keys].sort());
    expect(selections.some((selection) => selection.variableKey === "unobserved")).toBe(false);
  });

  it("observes feature getter calls, including children, without changing results or duplicating calls", async () => {
    const assertion = {
      environment: "production",
      target: "web",
      context: { userId: "root" },
      expectedToBeEnabled: true,
      children: [{ context: { userId: "child" }, expectedToBeEnabled: true }],
      _case: { id: "feature-case" },
    };
    const test = {
      feature: "checkout",
      assertions: [assertion],
    } as unknown as TestFeature;
    const onEvaluation = jest.fn((_evaluation: Evaluation, receivedAssertion: any) => {
      expect(receivedAssertion).toBe(assertion);
      expect(receivedAssertion._case.id).toBe("feature-case");
    });

    const result = await testFeature(
      { readFeature: jest.fn(async () => ({ key: "checkout" })) } as any,
      {} as any,
      test,
      { quiet: true, onEvaluation },
      new Map([[getTestDatafileKey("production", "web"), featureDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
    expect(onEvaluation).toHaveBeenCalledTimes(2);
    expect(onEvaluation.mock.calls.map(([evaluation]) => evaluation.type)).toEqual([
      "flag",
      "flag",
    ]);
    expect(onEvaluation.mock.calls.map(([evaluation]) => evaluation.ruleKey)).toEqual([
      "everyone",
      "everyone",
    ]);
  });

  it("observes accumulated variable paths on actual root and child evaluations", async () => {
    const collector = createCoverageCollector(null);
    const assertion = {
      environment: "production",
      target: "web",
      expectedValue: ["default", "first", "second"],
      children: [{ expectedValue: ["default", "first", "second"] }],
      _case: { id: "variable-case" },
    };
    const test = { variable: "policy", assertions: [assertion] } as unknown as TestVariable;
    const onEvaluation = jest.fn((evaluation: Evaluation, receivedAssertion: any) => {
      expect(receivedAssertion).toBe(assertion);
      expect(receivedAssertion._case.id).toBe("variable-case");
      collector.onEvaluation(evaluation, receivedAssertion);
    });

    const result = await testVariable(
      test,
      { quiet: true, onEvaluation },
      new Map([[getTestDatafileKey("production", "web"), accumulationDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
    expect(onEvaluation).toHaveBeenCalledTimes(2);
    expect(collector.getSelections()).toEqual([
      {
        set: null,
        environment: "production",
        target: "web",
        variableKey: "policy",
        overridePath: ["first"],
      },
      {
        set: null,
        environment: "production",
        target: "web",
        variableKey: "policy",
        overridePath: ["second"],
      },
    ]);
  });
});
