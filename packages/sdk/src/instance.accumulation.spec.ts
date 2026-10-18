import type {
  DatafileContent,
  DatafileVariableOverrideStep,
  VariableMutationOperation,
  VariableValue,
} from "@featurevisor/types";

import { createFeaturevisor } from "./instance";
import type { FeaturevisorDiagnostic } from "./diagnostics";
import type { FeaturevisorModule } from "./modules";

type StepSelector = Pick<
  DatafileVariableOverrideStep,
  "conditions" | "requiredFeatures" | "segments"
>;

function step(
  key: string,
  operations: VariableMutationOperation[],
  onMatch: number,
  onMiss: number,
  selector: StepSelector = {},
): DatafileVariableOverrideStep {
  return { key, keyPath: key.split("/"), operations, onMatch, onMiss, ...selector };
}

function accumulationDatafile(
  defaultValue: VariableValue = { trace: ["default"] },
): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "accumulation-1",
    segments: {
      europe: {
        conditions: [{ attribute: "region", operator: "equals", value: "eu" }],
      },
    },
    features: {},
    variables: {
      policy: {
        type: "json",
        defaultValue,
        overrideProgram: [
          step("parent", [{ op: "append", path: ["trace"], value: "parent" }], 1, 4, {
            segments: "europe",
          }),
          step("parent/child-nl", [{ op: "append", path: ["trace"], value: "child-nl" }], 2, 3, {
            conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
          }),
          step(
            "parent/child-nl/premium",
            [{ op: "append", path: ["trace"], value: "premium" }],
            3,
            3,
            { conditions: [{ attribute: "plan", operator: "equals", value: "premium" }] },
          ),
          step("parent/child-all", [{ op: "append", path: ["trace"], value: "child-all" }], 4, 4, {
            segments: "*",
          }),
          step("root-after", [{ op: "append", path: ["trace"], value: "root-after" }], 5, 5, {
            segments: "europe",
          }),
        ],
      },
    },
  };
}

function selectorDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "selector-state",
    segments: {},
    features: {},
    variables: {
      rows: {
        type: "json",
        defaultValue: [
          { id: "duplicate", flags: [] },
          { id: "duplicate", flags: [] },
        ],
        overrideProgram: [
          step("append", [{ op: "append", path: [], value: { id: "new", flags: [] } }], 1, 1, {
            segments: "*",
          }),
          step(
            "mark-new",
            [
              {
                op: "append",
                path: [{ select: { property: "id", values: ["new"] } }, "flags"],
                value: "new",
              },
            ],
            2,
            2,
            { segments: "*" },
          ),
          step(
            "remove-first-duplicate",
            [
              {
                op: "remove",
                path: [{ select: { property: "id", values: ["duplicate"] } }],
              },
            ],
            3,
            3,
            { segments: "*" },
          ),
          step(
            "mark-remaining-duplicate",
            [
              {
                op: "append",
                path: [{ select: { property: "id", values: ["duplicate"] } }, "flags"],
                value: "remaining",
              },
            ],
            4,
            4,
            { segments: "*" },
          ),
        ],
      },
    },
  };
}

describe("global variable accumulation programs", () => {
  it("accumulates continued siblings and nested scopes through compiled forward jumps", () => {
    const sdk = createFeaturevisor({ datafile: accumulationDatafile(), logLevel: "fatal" });

    const premium = sdk.evaluateVariable("policy", {
      region: "eu",
      country: "nl",
      plan: "premium",
    });
    expect(premium.variableValue).toEqual({
      trace: ["default", "parent", "child-nl", "premium", "child-all", "root-after"],
    });
    expect(premium).toEqual(
      expect.objectContaining({
        reason: "variable_override_rule",
        variableOverrideIndex: 4,
        variableOverrideKey: "root-after",
        variableOverridePath: ["root-after"],
        variableOverridePaths: [
          ["parent"],
          ["parent", "child-nl"],
          ["parent", "child-nl", "premium"],
          ["parent", "child-all"],
          ["root-after"],
        ],
      }),
    );

    expect(sdk.getVariable("policy", { region: "eu", country: "be" })).toEqual({
      trace: ["default", "parent", "child-all", "root-after"],
    });
    expect(sdk.evaluateVariable("policy", { region: "us" })).toEqual(
      expect.objectContaining({
        reason: "variable_default",
        variableValue: { trace: ["default"] },
      }),
    );
  });

  it("keeps sticky and default precedence while invoking each unified module phase once", () => {
    const beforeEvaluation = jest.fn((options) => options);
    const afterEvaluation = jest.fn((evaluation) => evaluation);
    const module: FeaturevisorModule = { beforeEvaluation, afterEvaluation };
    const sdk = createFeaturevisor({
      datafile: accumulationDatafile(),
      modules: [module],
      logLevel: "fatal",
    });

    expect(sdk.evaluateVariable("policy", { region: "us" })).toEqual(
      expect.objectContaining({
        reason: "variable_default",
        variableValue: { trace: ["default"] },
      }),
    );
    expect(beforeEvaluation).toHaveBeenCalledTimes(1);
    expect(afterEvaluation).toHaveBeenCalledTimes(1);

    sdk.setStickyVariables({ policy: { trace: ["sticky"] } });
    expect(sdk.evaluateVariable("policy", { region: "eu", country: "nl" })).toEqual(
      expect.objectContaining({ reason: "sticky", variableValue: { trace: ["sticky"] } }),
    );
    expect(beforeEvaluation).toHaveBeenCalledTimes(2);
    expect(afterEvaluation).toHaveBeenCalledTimes(2);
  });

  it("does not retain mutation state between evaluations or mutate frozen defaults", () => {
    const defaultValue = Object.freeze({ trace: Object.freeze(["default"]) });
    const sdk = createFeaturevisor({
      datafile: accumulationDatafile(defaultValue as unknown as VariableValue),
      logLevel: "fatal",
    });

    const first = sdk.getVariable<{ trace: string[] }>("policy", {
      region: "eu",
      country: "nl",
      plan: "premium",
    });
    first?.trace.push("caller-change");
    const second = sdk.getVariable("policy", { region: "eu", country: "nl", plan: "premium" });

    expect(defaultValue).toEqual({ trace: ["default"] });
    expect(second).toEqual({
      trace: ["default", "parent", "child-nl", "premium", "child-all", "root-after"],
    });
  });

  it("uses selector state produced by earlier operations in the same program", () => {
    const sdk = createFeaturevisor({ datafile: selectorDatafile(), logLevel: "fatal" });

    expect(sdk.getVariable("rows")).toEqual([
      { id: "duplicate", flags: ["remaining"] },
      { id: "new", flags: ["new"] },
    ]);
  });

  it("reports malformed program jumps as evaluation diagnostics", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const datafile = accumulationDatafile();
    datafile.variables!.policy!.overrideProgram = [
      step("bad", [{ op: "append", path: ["trace"], value: "bad" }], 0, 1, { segments: "*" }),
    ];
    const sdk = createFeaturevisor({
      datafile,
      logLevel: "error",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(sdk.evaluateVariable("policy")).toEqual(
      expect.objectContaining({ reason: "error", variableKey: "policy" }),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "evaluation_error",
          originalError: expect.objectContaining({
            message: "Invalid variable override program jump",
          }),
        }),
      ]),
    );
  });

  it("includes override-program segment and feature requirements in datafile change events", () => {
    const datafile = accumulationDatafile();
    datafile.features = {
      gate: {
        bucketBy: "userId",
        hash: "gate-1",
        force: [{ segments: "*", enabled: true }],
        traffic: [],
      },
    };
    datafile.variables!.policy!.hash = "policy-1";
    datafile.variables!.policy!.overrideProgram = [
      step("segment", [{ op: "append", path: ["trace"], value: "segment" }], 1, 1, {
        segments: "europe",
      }),
      step("feature", [{ op: "append", path: ["trace"], value: "feature" }], 2, 2, {
        requiredFeatures: ["gate"],
      }),
    ];
    const sdk = createFeaturevisor({ datafile, logLevel: "fatal" });
    const events: Array<{ variables: string[] }> = [];
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile({
      schemaVersion: "2",
      revision: "accumulation-2",
      segments: {},
      features: {
        gate: { bucketBy: "userId", hash: "gate-2", force: [], traffic: [] },
      },
      variables: {},
    });
    expect(events.pop()?.variables).toContain("policy");

    sdk.setDatafile({
      schemaVersion: "2",
      revision: "accumulation-3",
      segments: {
        europe: {
          conditions: [{ attribute: "region", operator: "equals", value: "north-america" }],
        },
      },
      features: {},
      variables: {},
    });
    expect(events.pop()?.variables).toContain("policy");
  });

  it("returns no partial accumulated value when a later operation is invalid", () => {
    const defaultValue = { trace: [] as string[] };
    const operand = { id: "valid" };
    Object.freeze(defaultValue.trace);
    Object.freeze(defaultValue);
    Object.freeze(operand);
    const datafile = accumulationDatafile(defaultValue);
    datafile.variables!.policy!.overrideProgram = [
      step("valid", [{ op: "append", path: ["trace"], value: operand }], 1, 1, {
        segments: "*",
      }),
      step("invalid", [{ op: "append", path: ["trace", 0], value: "never" }], 2, 2, {
        segments: "*",
      }),
    ];
    const sdk = createFeaturevisor({ datafile, logLevel: "fatal" });

    const evaluation = sdk.evaluateVariable("policy");
    expect(evaluation).toEqual(expect.objectContaining({ reason: "error", variableKey: "policy" }));
    expect(evaluation).not.toHaveProperty("variableValue");
    expect(evaluation).not.toHaveProperty("variableOverridePaths");
    expect(defaultValue).toEqual({ trace: [] });
    expect(operand).toEqual({ id: "valid" });
  });
});
