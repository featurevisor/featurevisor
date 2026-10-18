import { createFeaturevisor, type Featurevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";
import type { FeaturevisorModule } from "./modules";

describe("module membership at each callback phase", () => {
  describe.each([false, true])("phase snapshots, global=%s", (global) => {
    it.each(["add", "remove", "replace"] as const)(
      "keeps the before snapshot when a hook performs %s",
      (action) => {
        const trace: string[] = [];
        let f: Featurevisor;
        let changed = false;
        const hooks = (name: string): FeaturevisorModule => ({
          name,
          beforeEvaluation(options) {
            trace.push(`${name}:before`);
            if (name === "adder" && !changed) {
              changed = true;
              if (action !== "add") void f.removeModule("other");
              if (action !== "remove") f.addModule(hooks("late"));
            }
            return options;
          },
          afterEvaluation(result) {
            trace.push(`${name}:after`);
            return result;
          },
        });
        f = createFeaturevisor({
          logLevel: "fatal",
          datafile: createDatafile({
            schemaVersion: "4",
            features: { subject: createFeature() },
            variables: { subject: { type: "string", defaultValue: "matched" } },
          }),
          modules: [hooks("adder"), hooks("other")],
        });
        expect(global ? f.getVariable("subject") : f.isEnabled("subject")).toBe(
          global ? "matched" : true,
        );
        const next = [
          "adder",
          ...(action === "add" ? ["other"] : []),
          ...(action !== "remove" ? ["late"] : []),
        ];
        expect(trace).toEqual(["adder:before", "other:before", ...next.map((n) => `${n}:after`)]);
        trace.length = 0;
        if (global) f.getVariable("subject");
        else f.isEnabled("subject");
        expect(trace).toEqual([
          ...next.map((n) => `${n}:before`),
          ...next.map((n) => `${n}:after`),
        ]);
        void f.close();
      },
    );

    it.each(["add", "remove", "replace"] as const)(
      "keeps the after snapshot when a hook performs %s",
      (action) => {
        const trace: string[] = [];
        let f: Featurevisor;
        let changed = false;
        const hooks = (name: string): FeaturevisorModule => ({
          name,
          beforeEvaluation(options) {
            trace.push(`${name}:before`);
            return options;
          },
          afterEvaluation(result) {
            trace.push(`${name}:after`);
            if (name === "adder" && !changed) {
              changed = true;
              if (action !== "add") void f.removeModule("other");
              if (action !== "remove") f.addModule(hooks("late"));
            }
            return result;
          },
        });
        f = createFeaturevisor({
          logLevel: "fatal",
          datafile: createDatafile({
            schemaVersion: "4",
            features: { subject: createFeature() },
            variables: { subject: { type: "string", defaultValue: "matched" } },
          }),
          modules: [hooks("adder"), hooks("other")],
        });
        if (global) f.getVariable("subject");
        else f.isEnabled("subject");
        expect(trace).toEqual(["adder:before", "other:before", "adder:after", "other:after"]);
        trace.length = 0;
        const next = [
          "adder",
          ...(action === "add" ? ["other"] : []),
          ...(action !== "remove" ? ["late"] : []),
        ];
        if (global) f.getVariable("subject");
        else f.isEnabled("subject");
        expect(trace).toEqual([
          ...next.map((n) => `${n}:before`),
          ...next.map((n) => `${n}:after`),
        ]);
        void f.close();
      },
    );
  });

  describe.each(["bucketKey", "bucketValue"] as const)("%s phase snapshot", (phase) => {
    it.each(["add", "remove", "replace"] as const)("defers %s to the next phase", (action) => {
      const trace: string[] = [];
      let f: Featurevisor;
      let changed = false;
      const mutate = (name: string, current: string) => {
        trace.push(`${name}:${current}`);
        if (name === "adder" && current === phase && !changed) {
          changed = true;
          if (action !== "add") void f.removeModule("other");
          if (action !== "remove") f.addModule(hooks("late"));
        }
      };
      const hooks = (name: string): FeaturevisorModule => ({
        name,
        bucketKey(options) {
          mutate(name, "bucketKey");
          return options.bucketKey;
        },
        bucketValue(options) {
          mutate(name, "bucketValue");
          return options.bucketValue;
        },
        afterEvaluation(result) {
          mutate(name, "after");
          return result;
        },
      });
      f = createFeaturevisor({
        logLevel: "fatal",
        context: { userId: "test-user" },
        datafile: createDatafile({ schemaVersion: "4", features: { subject: createFeature() } }),
        modules: [hooks("adder"), hooks("other")],
      });
      expect(f.isEnabled("subject")).toBe(true);
      const next = [
        "adder",
        ...(action === "add" ? ["other"] : []),
        ...(action !== "remove" ? ["late"] : []),
      ];
      expect(trace).toEqual([
        "adder:bucketKey",
        "other:bucketKey",
        ...(phase === "bucketKey" ? next : ["adder", "other"]).map((n) => `${n}:bucketValue`),
        ...next.map((n) => `${n}:after`),
      ]);
      void f.close();
    });
  });

  it("refreshes bucket membership after the before phase", () => {
    const trace: string[] = [];
    let f: Featurevisor;
    f = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ schemaVersion: "4", features: { subject: createFeature() } }),
      modules: [
        {
          name: "adder",
          beforeEvaluation(options) {
            f.addModule({
              name: "late",
              bucketKey(options) {
                trace.push("key");
                return options.bucketKey;
              },
              bucketValue(options) {
                trace.push("value");
                return options.bucketValue;
              },
            });
            return options;
          },
        },
      ],
    });
    expect(f.isEnabled("subject")).toBe(true);
    expect(trace).toEqual(["key", "value"]);
    void f.close();
  });

  it.each([false, true])("does not run a removed module's after hooks, global=%s", (global) => {
    const trace: string[] = [];
    let f: Featurevisor;
    const key = (options: { featureKey?: string; variableKey?: string }) =>
      options.featureKey || options.variableKey;
    f = createFeaturevisor({
      logLevel: "error",
      modules: [
        {
          name: "removed",
          beforeEvaluation(options) {
            trace.push(`before:${key(options)}`);
            return options;
          },
          afterEvaluation(result, options) {
            trace.push(`after:${key(options)}`);
            return result;
          },
        },
      ],
      onDiagnostic(diagnostic) {
        if (diagnostic.code === "conditions_parse_error") void f.removeModule("removed");
      },
      datafile: createDatafile({
        schemaVersion: "4",
        features: {
          broken: createFeature({ conditions: "[broken" }),
          gate: createFeature(),
          subject: createFeature({
            conditions: { or: [{ feature: "broken" }, { feature: "gate" }] },
          }),
        },
        variables: {
          subject: {
            type: "string",
            defaultValue: "matched",
            conditions: { or: [{ feature: "broken" }, { feature: "gate" }] },
          },
        },
      }),
    });
    expect(global ? f.getVariable("subject") : f.isEnabled("subject")).toBe(
      global ? "matched" : true,
    );
    expect(trace).toEqual(["before:subject", "before:broken"]);
    void f.close();
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("uses late after hooks for global=%s and disabled gate=%s", (global, disableGate) => {
    const trace: string[] = [];
    let f: Featurevisor;
    const key = (options: { featureKey?: string; variableKey?: string }) =>
      options.featureKey || options.variableKey;
    const late: FeaturevisorModule = {
      name: "late",
      beforeEvaluation(options) {
        trace.push(`before:${key(options)}`);
        return options;
      },
      afterEvaluation(result, options) {
        trace.push(`after:${key(options)}`);
        return disableGate && "featureKey" in options && options.featureKey === "gate"
          ? { ...result, enabled: false }
          : result;
      },
    };
    f = createFeaturevisor({
      logLevel: "error",
      onDiagnostic(diagnostic) {
        if (diagnostic.code === "conditions_parse_error") f.addModule(late);
      },
      datafile: createDatafile({
        schemaVersion: "4",
        features: {
          broken: createFeature({ conditions: "[broken" }),
          gate: createFeature(),
          subject: createFeature({
            conditions: { or: [{ feature: "broken" }, { feature: "gate" }] },
          }),
        },
        variables: {
          subject: {
            type: "string",
            defaultValue: "matched",
            conditions: { or: [{ feature: "broken" }, { feature: "gate" }] },
          },
        },
      }),
    });
    const result = global ? f.evaluateVariable("subject") : f.evaluateFlag("subject");
    if (disableGate) expect(result.reason).toBe("conditions_unmet");
    else expect(global ? result.variableValue : result.enabled).toBe(global ? "matched" : true);
    expect(trace).toEqual(["after:broken", "before:gate", "after:gate", "after:subject"]);
    f.close();
  });
});
