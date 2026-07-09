import { createFeaturevisor, type FeaturevisorDiagnostic } from "./index";
import { createComplexDatafile, deterministicBucketModule } from "./instance.test-fixtures";

function createComplexSdk(onDiagnostic?: (diagnostic: FeaturevisorDiagnostic) => void) {
  return createFeaturevisor({
    datafile: createComplexDatafile(),
    logLevel: onDiagnostic ? "debug" : "fatal",
    onDiagnostic,
    modules: [deterministicBucketModule()],
  });
}

describe("Featurevisor public API: complex evaluation", () => {
  it("honours nested AND/NOT segments and ordered rule precedence", () => {
    const sdk = createComplexSdk();

    const dutchAdult = { userId: "nl", country: "nl", age: 25, plan: "pro", bucket: 1000 };
    expect(sdk.getVariation("experiment", dutchAdult)).toBe("treatment");
    expect(sdk.getVariableString("experiment", "greeting", dutchAdult)).toBe("Welkom");
    expect(sdk.getVariableArray("experiment", "items", dutchAdult)).toEqual(["nl"]);
    expect(sdk.getVariableObject("experiment", "config", dutchAdult)).toEqual({ source: "rule" });

    const dutchBeta = { ...dutchAdult, plan: "beta" };
    expect(sdk.evaluateVariation("experiment", dutchBeta).ruleKey).toBe("everyone");
    expect(sdk.getVariation("experiment", dutchBeta)).toBe("control");
  });

  it("requires all members of nested segment groups", () => {
    const sdk = createComplexSdk();

    expect(
      sdk.evaluateVariation("experiment", {
        userId: "beta-mobile",
        plan: "beta",
        device: "mobile",
        bucket: 25000,
      }).ruleKey,
    ).toBe("beta-device");
    expect(
      sdk.evaluateVariation("experiment", {
        userId: "beta-tv",
        plan: "beta",
        device: "tv",
        bucket: 75000,
      }).ruleKey,
    ).toBe("everyone");
  });

  it("applies force entries before requirements, traffic, and allocations", () => {
    const sdk = createComplexSdk();

    expect(sdk.isEnabled("experiment", { userId: "blocked", role: "blocked", bucket: 75000 })).toBe(
      false,
    );
    expect(sdk.getVariation("experiment", { userId: "qa", role: "qa", bucket: 1000 })).toBe(
      "treatment",
    );
    expect(sdk.getVariableString("experiment", "greeting", { role: "qa", bucket: 1000 })).toBe(
      "QA",
    );
    expect(sdk.getVariableInteger("experiment", "count", { role: "qa", bucket: 1000 })).toBe(99);
  });

  it("handles exact allocation and percentage boundaries", () => {
    const sdk = createComplexSdk();

    expect(sdk.getVariation("experiment", { userId: "a", bucket: 0 })).toBe("control");
    expect(sdk.getVariation("experiment", { userId: "a", bucket: 49999 })).toBe("control");
    expect(sdk.getVariation("experiment", { userId: "a", bucket: 50000 })).toBe("control");
    expect(sdk.getVariation("experiment", { userId: "a", bucket: 50001 })).toBe("treatment");
    expect(sdk.getVariation("experiment", { userId: "a", bucket: 99999 })).toBe("treatment");

    const beta = { userId: "beta", plan: "beta", device: "desktop" };
    expect(sdk.isEnabled("experiment", { ...beta, bucket: 50000 })).toBe(true);
    expect(sdk.isEnabled("experiment", { ...beta, bucket: 50001 })).toBe(false);
  });

  it("enforces required flags and required variations recursively", () => {
    const sdk = createComplexSdk();

    expect(sdk.isEnabled("dependent", { userId: "control", bucket: 1000 })).toBe(false);
    expect(sdk.evaluateFlag("dependent", { userId: "control", bucket: 1000 }).reason).toBe(
      "required",
    );
    expect(sdk.isEnabled("dependent", { userId: "ready", bucket: 75000 })).toBe(true);
    expect(sdk.isEnabled("dependent", { userId: "blocked", role: "blocked", bucket: 75000 })).toBe(
      false,
    );
  });

  it("serves disabled variation and variable fallbacks precisely", () => {
    const sdk = createComplexSdk();

    expect(sdk.isEnabled("disabledFallbacks")).toBe(false);
    expect(sdk.getVariation("disabledFallbacks")).toBe("disabled");
    expect(sdk.getVariableString("disabledFallbacks", "explicit")).toBe("disabled-value");
    expect(sdk.getVariableString("disabledFallbacks", "optedIn")).toBe("default-value");
    expect(sdk.getVariableString("disabledFallbacks", "absent")).toBeNull();
  });

  it("enforces mutex ranges with inclusive start and exclusive end", () => {
    const sdk = createComplexSdk();

    expect(sdk.isEnabled("mutex", { userId: "a", bucket: 19999 })).toBe(false);
    expect(sdk.isEnabled("mutex", { userId: "a", bucket: 20000 })).toBe(true);
    expect(sdk.isEnabled("mutex", { userId: "a", bucket: 39999 })).toBe(true);
    expect(sdk.isEnabled("mutex", { userId: "a", bucket: 40000 })).toBe(false);
  });

  it("returns all typed variable defaults and rejects mismatched getter types", () => {
    const sdk = createComplexSdk();
    const context = { userId: "control", bucket: 1000 };

    expect(sdk.getVariableString("experiment", "greeting", context)).toBe("Hello");
    expect(sdk.getVariableInteger("experiment", "count", context)).toBe(1);
    expect(sdk.getVariableDouble("experiment", "ratio", context)).toBe(1.5);
    expect(sdk.getVariableBoolean("experiment", "enabledCopy", context)).toBe(false);
    expect(sdk.getVariableArray("experiment", "items", context)).toEqual(["default"]);
    expect(sdk.getVariableObject("experiment", "config", context)).toEqual({ source: "default" });
    expect(sdk.getVariableJSON("experiment", "jsonConfig", context)).toEqual({ source: "json" });

    expect(sdk.getVariableBoolean("experiment", "greeting", context)).toBeNull();
    expect(sdk.getVariableString("experiment", "count", context)).toBeNull();
    expect(sdk.getVariableInteger("experiment", "ratio", context)).toBeNull();
    expect(sdk.getVariableObject("experiment", "items", context)).toBeNull();
  });

  it("lets instance sticky values override force and rules for each evaluation type", () => {
    const sdk = createComplexSdk();
    const context = { userId: "blocked", role: "blocked", bucket: 1000 };
    const sticky = {
      experiment: {
        enabled: true,
        variation: "treatment",
        variables: { greeting: "Sticky" },
      },
    };

    sdk.setSticky(sticky);

    expect(sdk.isEnabled("experiment", context)).toBe(true);
    expect(sdk.getVariation("experiment", context)).toBe("treatment");
    expect(sdk.getVariableString("experiment", "greeting", context)).toBe("Sticky");
  });

  it("applies default variation and variable options only when evaluation has no value", () => {
    const sdk = createComplexSdk();

    expect(sdk.getVariation("missing", {}, { defaultVariationValue: "fallback" })).toBe("fallback");
    expect(sdk.getVariable("missing", "value", {}, { defaultVariableValue: "fallback" })).toBe(
      "fallback",
    );
    expect(
      sdk.getVariation(
        "experiment",
        { userId: "a", bucket: 75000 },
        {
          defaultVariationValue: "fallback",
        },
      ),
    ).toBe("treatment");
  });

  it("reports deprecations without changing returned values", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createComplexSdk((item) => diagnostics.push(item));

    expect(sdk.isEnabled("deprecatedFeature")).toBe(true);
    expect(sdk.getVariableString("experiment", "retired", { bucket: 1000 })).toBe("old");

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "deprecated_feature",
        details: expect.objectContaining({ featureKey: "deprecatedFeature" }),
      }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "deprecated_variable",
        details: expect.objectContaining({ featureKey: "experiment", variableKey: "retired" }),
      }),
    );
  });

  it("keeps diagnostics correlated with evaluation details", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createComplexSdk((item) => diagnostics.push(item));

    sdk.getVariation("experiment", { userId: "a", bucket: 75000 });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "allocated",
        details: expect.objectContaining({
          featureKey: "experiment",
          reason: "allocated",
          evaluation: expect.objectContaining({ bucketValue: 75000, ruleKey: "everyone" }),
        }),
      }),
    );
  });
});
