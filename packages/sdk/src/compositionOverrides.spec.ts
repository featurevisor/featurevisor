import type { DatafileContent, DatafileVariableOverrideStep } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";

const step = (
  key: string,
  onMatch: number,
  onMiss: number,
  extra: Partial<DatafileVariableOverrideStep> = {},
): DatafileVariableOverrideStep => ({
  key,
  keyPath: [key],
  operations: [{ op: "set", path: ["policy", "limit"], value: 80 }],
  conditions: { attribute: "country", operator: "equals", value: "nl" },
  onMatch,
  onMiss,
  ...extra,
});
function datafile(program?: DatafileVariableOverrideStep[]): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "trial",
    segments: {
      dutch: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
    },
    features: {
      checkout: {
        bucketBy: "userId",
        traffic: [{ key: "all", segments: "*", percentage: 100000 }],
      },
    },
    variables: {
      policy: {
        type: "object",
        defaultValue: { limit: 50, methods: ["card"], items: [{ id: "a", label: "A" }] },
      },
      gate: { type: "boolean", defaultValue: true },
      screen: {
        type: "object",
        compose: [
          { key: "policy", variable: "policy" },
          { key: "enabled", feature: "checkout" },
        ],
        ...(program ? { overrideProgram: program } : {}),
      },
      outer: { type: "object", compose: [{ key: "screen", variable: "screen" }] },
    },
  };
}
describe("composed variable overrides", () => {
  it.each(["append", "prepend", "appendUnique", "removeValue"] as const)(
    "retains nullable final member array semantics for %s",
    (op) => {
      const source = datafile([
        step("array", 1, 1, {
          operations: [{ op, path: ["policy"], value: "card" }],
        }),
      ]);
      source.variables!.policy = {
        type: "array",
        defaultValue: [],
        requiredFeatures: ["checkout"],
      };
      const f = createFeaturevisor({
        datafile: source,
        stickyFeatures: { checkout: { enabled: false } },
      });
      expect(f.getVariable("screen", { country: "nl" })).toEqual({
        policy: op === "removeValue" ? null : ["card"],
        enabled: false,
      });
      expect(f.getVariable("policy")).toBeNull();
      f.close();
    },
  );
  it("evaluates experimental members eagerly before a replacement without rewriting assignment", () => {
    const source = datafile([
      step("display", 1, 1, {
        operations: [{ op: "set", path: ["assignment"], value: "control" }],
      }),
    ]);
    source.features.checkout.variations = [{ value: "treatment" }];
    source.features.checkout.traffic[0].allocation = [
      { variation: "treatment", range: [0, 100000] },
    ];
    source.variables!.screen = {
      type: "object",
      compose: [{ key: "assignment", feature: "checkout", variation: true }],
      overrideProgram: (source.variables!.screen as any).overrideProgram,
    };
    const observations: string[] = [];
    const f = createFeaturevisor({
      datafile: source,
      modules: [
        {
          name: "exposure",
          afterEvaluation(evaluation, options) {
            if (options.dependencyPurpose === "composition" && evaluation.type === "variation")
              observations.push(evaluation.variation!.value);
            return evaluation;
          },
        },
      ],
    });
    expect(f.getVariable("screen", { country: "nl" })).toEqual({ assignment: "control" });
    expect(observations).toEqual(["treatment"]);
    expect(f.getVariation("checkout")).toBe("treatment");
    f.close();
  });
  it.each([false, true])(
    "keeps missing-path mutation semantics with a nullable source, guarded=%s",
    (guarded) => {
      const source = datafile([
        step(
          "available",
          1,
          1,
          guarded
            ? {
                conditions: [{ variable: "policy", operator: "notNull" }],
              }
            : {},
        ),
      ]);
      source.variables!.policy = {
        type: "object",
        defaultValue: { limit: 50 },
        requiredFeatures: ["checkout"],
      };
      const f = createFeaturevisor({
        datafile: source,
        stickyFeatures: { checkout: { enabled: false } },
      });
      const evaluation = f.evaluateVariable("screen", { country: "nl" });
      expect(evaluation.variableValue).toEqual({ policy: null, enabled: false });
      expect(evaluation.reason).toBe(guarded ? "variable_composed" : "variable_override_rule");
      expect(evaluation.variableOverridePaths).toEqual(guarded ? undefined : [["available"]]);
      f.close();
    },
  );
  it("preserves composed reason and borrowed sources when no override matches", () => {
    const f = createFeaturevisor({ datafile: datafile([step("regional", 1, 1)]) });
    const result = f.evaluateVariable("screen", { country: "us" });
    expect(result.reason).toBe("variable_composed");
    expect((result.variableValue as any).policy).toBe(f.getVariable("policy"));
    expect(result.variableOverridePaths).toBeUndefined();
  });
  it("uses the live evaluated base and never writes into borrowed source values", () => {
    const source = datafile([step("regional", 1, 1)]);
    const snapshot = JSON.stringify(source);
    const f = createFeaturevisor({ datafile: source });
    const result = f.evaluateVariable("screen", { country: "nl" });
    expect(result.reason).toBe("variable_override_rule");
    expect(result.variableOverridePaths).toEqual([["regional"]]);
    expect((result.variableValue as any).policy.limit).toBe(80);
    expect((f.getVariable("policy") as any).limit).toBe(50);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect((f.getVariable("screen", { country: "us" }) as any).policy.limit).toBe(50);
  });
  it("obeys first match, nested children and continuation return points", () => {
    const f = createFeaturevisor({
      datafile: datafile([
        step("parent", 1, 2),
        step("child", 2, 2, {
          keyPath: ["parent", "child"],
          operations: [{ op: "append", path: ["policy", "methods"], value: "ideal" }],
        }),
        step("last", 3, 3, { operations: [{ op: "set", path: ["policy", "limit"], value: 100 }] }),
      ]),
    });
    const result = f.evaluateVariable("screen", { country: "nl" });
    expect((result.variableValue as any).policy).toMatchObject({
      limit: 100,
      methods: ["card", "ideal"],
    });
    expect(result.variableOverridePaths).toEqual([["parent"], ["parent", "child"], ["last"]]);
    const first = createFeaturevisor({
      datafile: datafile([
        step("first", 2, 1),
        step("second", 2, 2, {
          operations: [{ op: "set", path: ["policy", "limit"], value: 100 }],
        }),
      ]),
    });
    expect((first.getVariable("screen", { country: "nl" }) as any).policy.limit).toBe(80);
  });
  it("supports segments, both prerequisites and ordered selector mutations", () => {
    const f = createFeaturevisor({
      datafile: datafile([
        step("qualified", 1, 1, {
          segments: JSON.stringify(["dutch"]),
          requiredFeatures: ["checkout"],
          conditions: [{ variable: "gate", operator: "equals", value: true }],
          operations: [
            { op: "appendUnique", path: ["policy", "methods"], value: "ideal" },
            { op: "removeValue", path: ["policy", "methods"], value: "card" },
            {
              op: "set",
              path: ["policy", "items", { select: { property: "id", values: ["a"] } }, "label"],
              value: "Updated",
            },
          ],
        }),
      ]),
    });
    expect((f.getVariable("screen", { country: "nl" }) as any).policy).toEqual({
      limit: 50,
      methods: ["ideal"],
      items: [{ id: "a", label: "Updated" }],
    });
    f.setStickyVariables({ gate: false });
    expect(f.evaluateVariable("screen", { country: "nl" }).reason).toBe("variable_composed");
  });
  it("supports whole replacement, modules, sticky sources and child context", () => {
    const f = createFeaturevisor({
      datafile: datafile([
        step("replace", 1, 1, {
          operations: [{ op: "set", path: [], value: { enabled: false, policy: { limit: 200 } } }],
        }),
      ]),
      modules: [
        {
          name: "after",
          afterEvaluation(result) {
            if (result.variableKey === "screen" && result.variableValue)
              (result.variableValue as any).module = true;
            return result;
          },
        },
      ],
    });
    const child = f.spawn({ country: "nl" });
    expect(child.getVariable("screen")).toEqual({
      enabled: false,
      policy: { limit: 200 },
      module: true,
    });
    expect(child.getVariable("outer")).toEqual({
      screen: { enabled: false, policy: { limit: 200 }, module: true },
    });
    f.setStickyVariables({ screen: { sticky: true } });
    expect(f.evaluateVariable("screen").reason).toBe("sticky");
    child.close();
    f.close();
  });
  it("uses sticky source values as mutation inputs and keeps them unchanged", () => {
    const sticky = { limit: 5, methods: ["cash"] };
    const f = createFeaturevisor({
      datafile: datafile([step("regional", 1, 1)]),
      stickyVariables: { policy: sticky },
    });
    expect((f.getVariable("screen", { country: "nl" }) as any).policy).toEqual({
      limit: 80,
      methods: ["cash"],
    });
    expect(sticky).toEqual({ limit: 5, methods: ["cash"] });
  });
  it("keeps a null evaluated source null when a nested mutation cannot reach it", () => {
    const f = createFeaturevisor({
      datafile: datafile([step("regional", 1, 1)]),
      stickyVariables: { policy: null },
    });
    expect(f.getVariable("screen", { country: "nl" })).toEqual({ policy: null, enabled: true });
  });
  it("copies only the modified property when two properties borrow the same source", () => {
    const payload = datafile([step("regional", 1, 1)]);
    const compose = payload.variables!.screen.compose;
    if (Array.isArray(compose)) compose.push({ key: "original", variable: "policy" });
    const f = createFeaturevisor({ datafile: payload });
    const result = f.getVariable("screen", { country: "nl" }) as any;
    expect(result.policy.limit).toBe(80);
    expect(result.original.limit).toBe(50);
    expect(result.original).toBe(f.getVariable("policy"));
    expect(result.policy).not.toBe(result.original);
  });
  it("preserves fresh composed roots for whole replacements without deep copying descendants", () => {
    const replacement = { policy: { limit: 80 }, enabled: false };
    const f = createFeaturevisor({
      datafile: datafile([
        step("literal", 1, 1, { operations: [{ op: "set", path: [], value: replacement }] }),
      ]),
    });
    const first = f.getVariable("screen", { country: "nl" }) as Record<string, any>;
    const second = f.getVariable("screen", { country: "nl" }) as Record<string, any>;
    expect(first).toEqual(replacement);
    expect(first).not.toBe(replacement);
    expect(second).not.toBe(first);
    expect(first.policy).toBe(replacement.policy);
    first.enabled = true;
    expect(replacement.enabled).toBe(false);
    expect(second.enabled).toBe(false);
  });
  it("fails an invalid program without leaking session state or partially modifying sources", () => {
    const f = createFeaturevisor({ logLevel: "fatal", datafile: datafile([step("bad", 0, 1)]) });
    expect(f.evaluateVariable("screen", { country: "nl" }).reason).toBe("error");
    expect(f.getVariable("screen", { country: "nl" })).toBeNull();
    expect((f.getVariable("policy") as any).limit).toBe(50);
    expect(f.evaluateVariable("screen", { country: "us" }).reason).toBe("variable_composed");
  });
});
