import { createFeaturevisor, type FeaturevisorDiagnostic } from "./index";
import {
  createComplexDatafile,
  createDatafile,
  createFeature,
  deterministicBucketModule,
} from "./instance.test-fixtures";

describe("Featurevisor public API: lifecycle and state", () => {
  it("merges and replaces instance context and emits snapshots", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({ logLevel: "fatal", context: { country: "nl", plan: "free" } });
    sdk.on("context_set", (event) => events.push(event));

    sdk.setContext({ plan: "pro", locale: "nl-NL" });
    expect(sdk.getContext()).toEqual({ country: "nl", plan: "pro", locale: "nl-NL" });

    sdk.setContext({ country: "de" }, true);
    expect(sdk.getContext()).toEqual({ country: "de" });
    expect(events).toEqual([
      { context: { country: "nl", plan: "pro", locale: "nl-NL" }, replaced: false },
      { context: { country: "de" }, replaced: true },
    ]);
  });

  it("does not mutate stored context when applying per-call context", () => {
    const sdk = createFeaturevisor({ context: { country: "nl", nested: { source: "base" } } });

    expect(sdk.getContext({ country: "de", userId: "user" })).toEqual({
      country: "de",
      nested: { source: "base" },
      userId: "user",
    });
    expect(sdk.getContext()).toEqual({ country: "nl", nested: { source: "base" } });
  });

  it("merges and replaces sticky values and reports affected keys", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      sticky: { a: { enabled: true }, shared: { enabled: true, variation: "control" } },
    });
    sdk.on("sticky_set", (event) => events.push(event));

    sdk.setSticky({ b: { enabled: false }, shared: { enabled: true, variation: "treatment" } });
    sdk.setSticky({ c: { enabled: true } }, true);

    expect(events).toEqual([
      { features: ["a", "shared", "b"], replaced: false },
      { features: ["a", "shared", "b", "c"], replaced: true },
    ]);
  });

  it("ignores consumer-supplied per-call sticky values", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ features: { flag: createFeature() } }),
      sticky: { flag: { enabled: false } },
    });

    expect(sdk.isEnabled("flag")).toBe(false);
    expect(sdk.isEnabled("flag", {}, { sticky: { flag: { enabled: true } } } as any)).toBe(false);
  });

  it("returns raw evaluations with stable reasons and details", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createComplexDatafile(),
      modules: [deterministicBucketModule()],
    });

    expect(sdk.evaluateFlag("experiment", { userId: "a", bucket: 75000 })).toEqual(
      expect.objectContaining({
        type: "flag",
        featureKey: "experiment",
        reason: "rule",
        ruleKey: "everyone",
        bucketValue: 75000,
        enabled: true,
      }),
    );
    expect(sdk.evaluateVariation("experiment", { userId: "a", bucket: 75000 })).toEqual(
      expect.objectContaining({
        reason: "allocated",
        variation: expect.objectContaining({ value: "treatment" }),
      }),
    );
    expect(sdk.evaluateVariable("experiment", "greeting", { userId: "a", bucket: 75000 })).toEqual(
      expect.objectContaining({
        reason: "allocated",
        variableKey: "greeting",
        variableValue: "Welcome",
      }),
    );
  });

  it("returns only requested features from getAllEvaluations", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createComplexDatafile(),
      modules: [deterministicBucketModule()],
    });

    const result = sdk.getAllEvaluations({ userId: "a", bucket: 75000 }, [
      "experiment",
      "dependent",
    ]);

    expect(Object.keys(result)).toEqual(["experiment", "dependent"]);
    expect(result.experiment).toEqual(
      expect.objectContaining({ enabled: true, variation: "treatment" }),
    );
    expect(result.dependent.enabled).toBe(true);
  });

  it("preserves falsey variable values in getAllEvaluations", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        features: {
          falsey: createFeature({
            variablesSchema: {
              bool: { type: "boolean", defaultValue: false },
              count: { type: "integer", defaultValue: 0 },
              text: { type: "string", defaultValue: "" },
            },
          }),
        },
      }),
    });

    expect(sdk.getAllEvaluations().falsey.variables).toEqual({ bool: false, count: 0, text: "" });
  });

  it("preserves an explicit empty default variation in getAllEvaluations", () => {
    const sdk = createFeaturevisor({
      datafile: {
        schemaVersion: "2",
        revision: "1",
        segments: {},
        features: {
          experiment: {
            key: "experiment",
            bucketBy: "userId",
            variations: [{ value: "control" }],
            traffic: [],
          },
        },
      },
    });

    expect(
      sdk.getAllEvaluations({}, [], {
        defaultVariationValue: "",
      }).experiment,
    ).toEqual({
      enabled: false,
      variation: "",
    });
  });

  it("updates diagnostic filtering at runtime", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      datafile: createDatafile(),
    });

    sdk.isEnabled("missing");
    expect(diagnostics).toEqual([]);
    sdk.setLogLevel("warn");
    sdk.isEnabled("missing");
    expect(diagnostics.map((item) => item.code)).toEqual(["feature_not_found"]);
  });

  it("closes idempotently, clears listeners, and ignores later mutations", async () => {
    const calls: string[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ revision: "before" }),
      modules: [
        {
          name: "module",
          close: () => {
            calls.push("close");
          },
        },
      ],
    });
    sdk.on("context_set", () => calls.push("context"));

    await sdk.close();
    await sdk.close();
    sdk.setContext({ late: true });
    sdk.setSticky({ late: { enabled: true } });
    sdk.setDatafile(createDatafile({ revision: "after" }));
    sdk.addModule({ name: "late", setup: () => calls.push("setup") });
    await sdk.removeModule("module");
    const unsubscribe = sdk.on("context_set", () => calls.push("late-listener"));
    unsubscribe();

    expect(calls).toEqual(["close"]);
    expect(sdk.getRevision()).toBe("before");
  });
});
