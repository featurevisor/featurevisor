import type { DatafileContent } from "@featurevisor/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFeaturevisor } from "./instance";
import type { FeaturevisorModule } from "./modules";

function datafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "1",
    segments: {
      europe: {
        conditions: [{ attribute: "continent", operator: "equals", value: "eu" }],
      },
    },
    features: {
      access: {
        bucketBy: "userId",
        variations: [{ value: "control" }, { value: "treatment" }],
        force: [
          {
            conditions: [{ attribute: "access", operator: "equals", value: true }],
            enabled: true,
            variation: "treatment",
          },
        ],
        traffic: [],
      },
      same: {
        bucketBy: "userId",
        variablesSchema: { nested: { type: "string", defaultValue: "feature value" } },
        force: [{ segments: "*", enabled: true }],
        traffic: [],
      },
    },
    variables: {
      supportEmail: {
        type: "string",
        defaultValue: "help@example.com",
        overrides: [
          {
            key: "eu-nl",
            segments: "europe",
            conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
            value: "help-nl@example.com",
          },
          {
            key: "eu",
            segments: "europe",
            value: "help-eu@example.com",
          },
        ],
      },
      gated: {
        type: "string",
        defaultValue: "enabled",
        disabledValue: "disabled",
        requiredFeatures: [{ key: "access", variation: "treatment" }],
      },
      gatedDefault: {
        type: "integer",
        defaultValue: 5,
        disabledValue: 0,
        useDefaultWhenDisabled: true,
        requiredFeatures: ["access"],
      },
      config: {
        type: "json",
        defaultValue: '{"colour":"blue"}',
      },
      same: {
        type: "string",
        defaultValue: "top-level value",
      },
      enabled: { type: "boolean", defaultValue: true },
      count: { type: "integer", defaultValue: 3 },
      ratio: { type: "double", defaultValue: 1.5 },
      items: { type: "array", defaultValue: ["one"] },
      object: { type: "object", defaultValue: { colour: "blue" } },
    },
  };
}

const conformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v3.json"), "utf8"),
);

describe("global variables", () => {
  it("preserves feature-scoped calls and disambiguates by argument shape", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });

    expect(f.getVariable("same", "nested")).toBe("feature value");
    expect(f.getVariable("same")).toBe("top-level value");
  });

  it("evaluates overrides in order and combines segments with conditions using AND", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });

    const nl = f.evaluateVariable("supportEmail", { continent: "eu", country: "nl" });
    expect(nl.variableValue).toBe("help-nl@example.com");
    expect(nl.reason).toBe("variable_override_rule");
    expect(nl.overrideIndex).toBe(0);
    expect(nl.overrideKey).toBe("eu-nl");
    expect(f.getVariable("supportEmail", { continent: "eu", country: "be" })).toBe(
      "help-eu@example.com",
    );
    expect(f.getVariable("supportEmail", { country: "nl" })).toBe("help@example.com");
  });

  it("handles required features, disabled values, defaults, and variation requirements", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });

    expect(f.evaluateVariable("gated").reason).toBe("required_features_unmet");
    expect(f.getVariable("gated")).toBe("disabled");
    expect(f.getVariable("gatedDefault")).toBe(5);
    expect(f.getVariable("gated", { access: true })).toBe("enabled");
  });

  it("gives sticky values highest precedence, including explicit null", () => {
    const f = createFeaturevisor({
      datafile: datafile(),
      stickyVariables: { supportEmail: "sticky@example.com", gated: null },
      logLevel: "fatal",
    });

    expect(f.evaluateVariable("supportEmail", { continent: "eu" }).reason).toBe("sticky");
    expect(f.getVariable("supportEmail", { continent: "eu" })).toBe("sticky@example.com");
    expect(f.getVariable("gated", { access: true })).toBeNull();
  });

  it("uses sticky variables before a datafile is available", () => {
    const f = createFeaturevisor({
      stickyVariables: { supportEmail: "sticky@example.com", config: { colour: "blue" } },
      logLevel: "fatal",
    });

    expect(f.getVariable("supportEmail")).toBe("sticky@example.com");
    expect(f.getVariable<{ colour: string }>("config")).toEqual({ colour: "blue" });
    expect(f.evaluateVariable("supportEmail")).toEqual(
      expect.objectContaining({
        type: "variable",
        reason: "sticky",
        variableKey: "supportEmail",
        variableValue: "sticky@example.com",
      }),
    );
  });

  it("updates parent sticky variables", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const listener = jest.fn();
    f.on("sticky_variables_set", listener);

    f.setStickyVariables({ supportEmail: "first@example.com" });
    f.setStickyVariables({ gated: "replacement" }, true);

    expect(f.getVariable("supportEmail")).toBe("help@example.com");
    expect(f.getVariable("gated")).toBe("replacement");
    expect(listener).toHaveBeenLastCalledWith({
      variables: ["supportEmail", "gated"],
      replaced: true,
    });
  });

  it("parses json values and supports optional generic result types", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const config = f.getVariable<{ colour: string }>("config");
    expect(config).toEqual({ colour: "blue" });
  });

  it("supports every typed convenience method for global variables", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });

    expect(f.getVariableBoolean("enabled")).toBe(true);
    expect(f.getVariableString("supportEmail")).toBe("help@example.com");
    expect(f.getVariableInteger("count")).toBe(3);
    expect(f.getVariableDouble("ratio")).toBe(1.5);
    expect(f.getVariableArray("items")).toEqual(["one"]);
    expect(f.getVariableObject<{ colour: string }>("object")).toEqual({ colour: "blue" });
    expect(f.getVariableJSON<{ colour: string }>("config")).toEqual({ colour: "blue" });
    expect(f.getVariableBoolean("supportEmail")).toBeNull();
  });

  it("uses unified module callbacks and keeps deprecated feature callbacks feature-only", () => {
    const before = jest.fn((options) => options);
    const after = jest.fn((evaluation) => evaluation);
    const module: FeaturevisorModule = {
      before,
      after,
      beforeEvaluation: (options) =>
        !("featureKey" in options)
          ? { ...options, context: { ...options.context, continent: "eu" } }
          : options,
      afterEvaluation: (evaluation) =>
        !evaluation.featureKey
          ? { ...evaluation, variableValue: `${evaluation.variableValue}!` }
          : evaluation,
    };
    const f = createFeaturevisor({ datafile: datafile(), modules: [module], logLevel: "fatal" });

    expect(f.getVariable("supportEmail")).toBe("help-eu@example.com!");
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    f.isEnabled("access", { access: true });
    expect(before).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
  });

  it("returns a safe evaluation when a unified module callback throws", () => {
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      modules: [
        {
          beforeEvaluation: () => {
            throw new Error("broken module");
          },
        },
      ],
    });

    expect(f.evaluateVariable("supportEmail")).toEqual(
      expect.objectContaining({ type: "variable", reason: "error", variableKey: "supportEmail" }),
    );
    expect(
      createFeaturevisor({ logLevel: "fatal" }).getVariable(
        "missing",
        {},
        {
          defaultVariableValue: "fallback",
        },
      ),
    ).toBe("fallback");
  });

  it("uses the variable overload for global evaluations", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    expect(f.getVariable<string>("supportEmail")).toBe("help@example.com");
    const evaluation = f.evaluateVariable("supportEmail");
    expect(evaluation).toEqual(
      expect.objectContaining({
        type: "variable",
        variableKey: "supportEmail",
        reason: "variable_default",
      }),
    );
    expect(evaluation).not.toHaveProperty("featureKey");
  });

  it("executes the global variable conformance contract", () => {
    expect(conformance.version).toBe(3);
    for (const testCase of conformance.globalVariables.cases) {
      const f = createFeaturevisor({
        datafile: conformance.globalVariables.datafile,
        stickyVariables: testCase.stickyVariables,
        logLevel: "fatal",
      });
      const evaluation = f.evaluateVariable(testCase.key, testCase.context || {}, {
        defaultVariableValue: testCase.defaultVariableValue,
      });
      expect(evaluation.variableValue).toEqual(testCase.expectedValue);
      expect(evaluation.reason).toBe(testCase.expectedReason);
      expect(evaluation.overrideKey).toBe(testCase.expectedOverrideKey);
    }
  });

  it("supports child sticky values and change events for variables", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const child = f.spawn({}, { stickyVariables: { supportEmail: "child@example.com" } });
    const listener = jest.fn();
    child.on("sticky_variables_set", listener);

    expect(child.getVariable("supportEmail")).toBe("child@example.com");
    child.setStickyVariables({ supportEmail: "changed@example.com" });
    expect(child.getVariable("supportEmail")).toBe("changed@example.com");
    expect(child.getVariableString("supportEmail")).toBe("changed@example.com");
    expect(child.getVariableBoolean("enabled")).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      variables: ["supportEmail"],
      replaced: false,
    });
  });

  it("merges and replaces variables with accurate datafile change details", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const listener = jest.fn();
    f.on("datafile_set", listener);
    f.setDatafile({
      schemaVersion: "2",
      revision: "2",
      segments: {},
      features: {},
      variables: { added: { type: "boolean", defaultValue: true, hash: "a" } },
    });

    expect(f.getVariable("supportEmail")).toBe("help@example.com");
    expect(f.getVariable("added")).toBe(true);
    expect(listener.mock.calls[0][0].variables).toEqual(["added"]);
  });
});
