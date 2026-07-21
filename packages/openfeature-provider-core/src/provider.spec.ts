import { ErrorCode, StandardResolutionReasons } from "@openfeature/core";
import {
  createFeaturevisor,
  type DatafileContent,
  type Evaluation,
  type EvaluationReason,
  type Feature,
} from "@featurevisor/sdk";
import { FeaturevisorProvider } from "./provider";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [{ key: "everyone", segments: "*", percentage: 100000, variation: "on" }],
    ...overrides,
  };
}

function datafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "revision-1",
    featurevisorVersion: "3.0.1",
    segments: {},
    features: {
      checkout: feature({
        variations: [
          {
            value: "on",
            variables: {
              title: "Hello",
              count: 3,
              ratio: 1.5,
              visible: true,
              items: ["a", "b"],
              config: { color: "blue" },
              json: '{"nested":true}',
              invalidJson: "not-json",
            },
          },
        ],
        variablesSchema: {
          title: { type: "string", defaultValue: "Default" },
          count: { type: "integer", defaultValue: 0 },
          ratio: { type: "double", defaultValue: 0 },
          visible: { type: "boolean", defaultValue: false },
          items: { type: "array", defaultValue: [] },
          config: { type: "object", defaultValue: {} },
          json: { type: "json", defaultValue: "{}" },
          invalidJson: { type: "json", defaultValue: "{}" },
        },
      }),
      disabled: feature({
        disabledVariationValue: "off",
        variations: [{ value: "on" }],
        force: [
          { conditions: { attribute: "blocked", operator: "equals", value: true }, enabled: false },
        ],
      }),
      emptyVariation: feature({ variations: [] }),
    },
  };
}

describe("Featurevisor OpenFeature mapping", () => {
  it("resolves flags, variations, and every OpenFeature value type", () => {
    const provider = new FeaturevisorProvider({ datafile: datafile() });
    const context = { targetingKey: "user-1" };

    expect(provider.resolve("checkout", false, context, "boolean")).toEqual(
      expect.objectContaining({ value: true, reason: StandardResolutionReasons.TARGETING_MATCH }),
    );
    expect(provider.resolve("checkout:variation", "fallback", context, "string")).toEqual(
      expect.objectContaining({
        value: "on",
        variant: "on",
        reason: StandardResolutionReasons.TARGETING_MATCH,
      }),
    );
    expect(provider.resolve("checkout:title", "fallback", context, "string").value).toBe("Hello");
    expect(provider.resolve("checkout:count", 0, context, "number").value).toBe(3);
    expect(provider.resolve("checkout:ratio", 0, context, "number").value).toBe(1.5);
    expect(provider.resolve("checkout:visible", false, context, "boolean").value).toBe(true);
    expect(provider.resolve("checkout:items", [], context, "object").value).toEqual(["a", "b"]);
    expect(provider.resolve("checkout:config", {}, context, "object").value).toEqual({
      color: "blue",
    });
    expect(provider.resolve("checkout:json", {}, context, "object").value).toEqual({
      nested: true,
    });
  });

  it("maps targetingKey, custom fields, dates, arrays, and nested context without mutation", () => {
    const contexts: any[] = [];
    const input = {
      targetingKey: "subject",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      nested: { dates: [new Date("2026-01-01T00:00:00.000Z")] },
    };
    const provider = new FeaturevisorProvider({
      datafile: datafile(),
      targetingKeyField: "accountId",
      modules: [
        {
          name: "capture",
          before: (options) => {
            contexts.push(options.context);
            return options;
          },
        },
      ],
    });

    provider.resolve("checkout", false, input, "boolean");
    expect(contexts[0]).toEqual({
      targetingKey: "subject",
      accountId: "subject",
      createdAt: "2026-01-02T03:04:05.000Z",
      nested: { dates: ["2026-01-01T00:00:00.000Z"] },
    });
    expect(input.createdAt).toBeInstanceOf(Date);
  });

  it("supports custom key separators and variation selectors", () => {
    const provider = new FeaturevisorProvider({
      datafile: datafile(),
      keySeparator: "/",
      variationKey: "$variation",
    });
    expect(
      provider.resolve("checkout/$variation", "fallback", { targetingKey: "u" }, "string").value,
    ).toBe("on");
    expect(
      provider.resolve("checkout/title", "fallback", { targetingKey: "u" }, "string").value,
    ).toBe("Hello");
  });

  it("returns defaults with standard errors for missing flags, variables, variations, and malformed datafiles", () => {
    const provider = new FeaturevisorProvider({ datafile: datafile() });
    expect(provider.resolve("missing", true, {}, "boolean")).toEqual(
      expect.objectContaining({
        value: true,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
      }),
    );
    expect(provider.resolve("checkout:missing", "fallback", {}, "string")).toEqual(
      expect.objectContaining({ value: "fallback", errorCode: ErrorCode.FLAG_NOT_FOUND }),
    );
    expect(provider.resolve("emptyVariation:variation", "fallback", {}, "string")).toEqual(
      expect.objectContaining({ value: "fallback", errorCode: ErrorCode.FLAG_NOT_FOUND }),
    );
    expect(
      new FeaturevisorProvider({ datafile: "{" }).resolve("checkout", false, {}, "boolean"),
    ).toEqual(
      expect.objectContaining({
        value: false,
        errorCode: ErrorCode.PARSE_ERROR,
        errorMessage: "Could not parse datafile",
      }),
    );
  });

  it("recovers after a malformed datafile is replaced", () => {
    const provider = new FeaturevisorProvider({ datafile: "{" });
    expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBe(
      ErrorCode.PARSE_ERROR,
    );
    provider.featurevisor.setDatafile(datafile(), true);
    const result = provider.resolve("checkout", false, { targetingKey: "user" }, "boolean");
    expect(result.value).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it("rejects mismatched values, non-finite numbers, and invalid JSON", () => {
    const provider = new FeaturevisorProvider({ datafile: datafile() });
    expect(provider.resolve("checkout", "no", {}, "string").errorCode).toBe(
      ErrorCode.TYPE_MISMATCH,
    );
    expect(provider.resolve("checkout:title", false, {}, "boolean").errorCode).toBe(
      ErrorCode.TYPE_MISMATCH,
    );
    expect(provider.resolve("checkout:invalidJson", {}, {}, "object").errorCode).toBe(
      ErrorCode.TYPE_MISMATCH,
    );
    expect(provider.resolve("checkout:count", Number.NaN, {}, "number").value).toBe(3);
  });

  it("maps disabled evaluations", () => {
    const provider = new FeaturevisorProvider({ datafile: datafile() });
    expect(provider.resolve("disabled", true, { blocked: true }, "boolean")).toEqual(
      expect.objectContaining({ value: false, reason: StandardResolutionReasons.TARGETING_MATCH }),
    );
    expect(provider.resolve("disabled:variation", "fallback", { blocked: true }, "string")).toEqual(
      expect.objectContaining({ value: "off", reason: StandardResolutionReasons.DISABLED }),
    );
  });

  it.each([
    ["required", StandardResolutionReasons.TARGETING_MATCH],
    ["forced", StandardResolutionReasons.TARGETING_MATCH],
    ["sticky", StandardResolutionReasons.TARGETING_MATCH],
    ["rule", StandardResolutionReasons.TARGETING_MATCH],
    ["variable_override_variation", StandardResolutionReasons.TARGETING_MATCH],
    ["variable_override_rule", StandardResolutionReasons.TARGETING_MATCH],
    ["allocated", StandardResolutionReasons.SPLIT],
    ["disabled", StandardResolutionReasons.DISABLED],
    ["variation_disabled", StandardResolutionReasons.DISABLED],
    ["variable_disabled", StandardResolutionReasons.DISABLED],
    ["out_of_range", StandardResolutionReasons.DEFAULT],
    ["no_match", StandardResolutionReasons.DEFAULT],
    ["variable_default", StandardResolutionReasons.DEFAULT],
  ] satisfies Array<[EvaluationReason, string]>)(
    "maps the %s evaluation reason to %s",
    (reason, expectedReason) => {
      const featurevisor = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
      jest.spyOn(featurevisor, "evaluateFlag").mockReturnValue({
        type: "flag",
        featureKey: "checkout",
        reason,
        enabled: true,
      });

      const result = new FeaturevisorProvider({ featurevisor }).resolve(
        "checkout",
        false,
        {},
        "boolean",
      );
      expect(result.reason).toBe(expectedReason);
      expect(result.errorCode).toBeUndefined();
    },
  );

  it("maps general evaluation errors", () => {
    const featurevisor = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    jest.spyOn(featurevisor, "evaluateFlag").mockReturnValue({
      type: "flag",
      featureKey: "checkout",
      reason: "error",
      error: new Error("Evaluation failed"),
    });

    const result = new FeaturevisorProvider({ featurevisor }).resolve(
      "checkout",
      false,
      {},
      "boolean",
    );
    expect(result).toEqual(
      expect.objectContaining({
        value: false,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage: "Evaluation failed",
      }),
    );
  });

  it("returns stable Featurevisor metadata", () => {
    const result = new FeaturevisorProvider({ datafile: datafile() }).resolve(
      "checkout:title",
      "fallback",
      { targetingKey: "u" },
      "string",
    );
    expect(result.flagMetadata).toEqual(
      expect.objectContaining({
        featureKey: "checkout",
        variableKey: "title",
        featurevisorReason: "allocated",
        revision: "revision-1",
        schemaVersion: "2",
      }),
    );
  });

  it("includes all available Featurevisor metadata and the selected variant", () => {
    const featurevisor = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const evaluation: Evaluation = {
      type: "variation",
      featureKey: "checkout",
      variableKey: "title",
      reason: "allocated",
      ruleKey: "rule-1",
      bucketKey: "checkout.user-1",
      bucketValue: 0,
      forceIndex: 0,
      variableOverrideIndex: 0,
      variationValue: "on",
    };
    jest.spyOn(featurevisor, "evaluateVariation").mockReturnValue(evaluation);

    const result = new FeaturevisorProvider({ featurevisor }).resolve(
      "checkout:variation",
      "fallback",
      {},
      "string",
    );
    expect(result.variant).toBe("on");
    expect(result.flagMetadata).toEqual({
      featureKey: "checkout",
      variableKey: "title",
      featurevisorReason: "allocated",
      revision: "revision-1",
      schemaVersion: "2",
      ruleKey: "rule-1",
      bucketKey: "checkout.user-1",
      bucketValue: 0,
      forceIndex: 0,
      variableOverrideIndex: 0,
    });
  });

  it("forwards tracking and closes the Featurevisor instance", async () => {
    const events: any[] = [];
    let closed = false;
    const provider = new FeaturevisorProvider({
      datafile: datafile(),
      onTrack: (event) => events.push(event),
      modules: [
        {
          name: "close",
          close: () => {
            closed = true;
          },
        },
      ],
    });
    provider.track("checkout", { targetingKey: "u" }, { value: 10, orderId: "1" });
    expect(events).toEqual([
      { name: "checkout", context: { targetingKey: "u" }, details: { value: 10, orderId: "1" } },
    ]);
    await provider.close();
    expect(closed).toBe(true);
  });

  it("reuses but does not close a caller-owned Featurevisor instance", async () => {
    let closed = false;
    const featurevisor = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      modules: [
        {
          name: "owner",
          close: () => {
            closed = true;
          },
        },
      ],
    });
    const provider = new FeaturevisorProvider({ featurevisor });
    expect(provider.featurevisor).toBe(featurevisor);
    expect(provider.resolve("checkout", false, { targetingKey: "user" }, "boolean").value).toBe(
      true,
    );

    await provider.close();
    expect(closed).toBe(false);
    featurevisor.setDatafile({ ...datafile(), features: {} }, true);
    expect(featurevisor.evaluateFlag("checkout").reason).toBe("feature_not_found");
    await featurevisor.close();
    expect(closed).toBe(true);
  });
});
