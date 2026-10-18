import { ErrorCode, StandardResolutionReasons } from "@openfeature/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createFeaturevisor,
  type DatafileContent,
  type Evaluation,
  type EvaluationReason,
  type Feature,
} from "@featurevisor/sdk";
import { FeaturevisorProvider } from "./provider";

const conformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v3.json"), "utf8"),
);
const providerConformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/openfeature-provider.json"), "utf8"),
);

describe("shared OpenFeature provider conformance", () => {
  it("resolves the SDK from sibling source", () => {
    expect(require.resolve("@featurevisor/sdk")).toBe(require.resolve("../../sdk/src"));
  });

  it("runs every versioned resolution case", () => {
    expect(providerConformance.kind).toBe("featurevisor.openfeature-provider");
    expect(providerConformance.schemaVersion).toBe(1);
    const provider = new FeaturevisorProvider({ datafile: providerConformance.datafile });
    for (const testCase of providerConformance.cases) {
      const result = provider.resolve(
        testCase.flagKey,
        testCase.default,
        testCase.context,
        testCase.type,
      );
      expect(result.value).toEqual(testCase.expected.value);
      if (testCase.expected.reason) expect(result.reason).toBe(testCase.expected.reason);
      if (testCase.expected.variant) expect(result.variant).toBe(testCase.expected.variant);
      if (testCase.expected.errorCode) expect(result.errorCode).toBe(testCase.expected.errorCode);
      else expect(result.errorCode).toBeUndefined();
    }
    provider.close();
  });

  it("maps targeting keys by presence without mutating input", () => {
    const captured: Record<string, unknown>[] = [];
    const provider = new FeaturevisorProvider({
      datafile: providerConformance.datafile,
      modules: [
        {
          name: "capture-targeting",
          beforeEvaluation: (options) => {
            captured.push(options.context);
            return options;
          },
        },
      ],
    });
    for (const testCase of providerConformance.targetingCases) {
      const before = structuredClone(testCase.context);
      const result = provider.resolve("targetOnly", false, testCase.context, "boolean");
      expect(captured[captured.length - 1]?.userId).toBe(testCase.expectedUserId);
      expect(result.value).toBe(testCase.expectedValue);
      expect(testCase.context).toEqual(before);
    }
    provider.close();
    const custom: Record<string, unknown>[] = [];
    const customProvider = new FeaturevisorProvider({
      datafile: providerConformance.datafile,
      targetingKeyField: "accountId",
      modules: [
        {
          name: "capture-custom",
          beforeEvaluation: (options) => {
            custom.push(options.context);
            return options;
          },
        },
      ],
    });
    const customCase = providerConformance.customTargetingCase;
    const result = customProvider.resolve(customCase.flagKey, false, customCase.context, "boolean");
    expect(custom[custom.length - 1]?.accountId).toBe("");
    expect(result.value).toBe(customCase.expectedValue);
    expect(result.reason).toBe(customCase.expectedReason);
    customProvider.close();
  });

  it("maps finite numeric targeting keys from untyped JavaScript contexts", () => {
    const captured: Record<string, unknown>[] = [];
    const provider = new FeaturevisorProvider({
      datafile: providerConformance.datafile,
      modules: [
        {
          name: "capture-numeric-targeting",
          beforeEvaluation: (options) => {
            captured.push(options.context);
            return options;
          },
        },
      ],
    });
    for (const [targetingKey, expectedUserId, expectedValue] of [
      [0, 0, false],
      [42, 42, false],
      [Number.NaN, "forced", true],
      [Number.POSITIVE_INFINITY, "forced", true],
      [Number.NEGATIVE_INFINITY, "forced", true],
      [true, "forced", true],
    ] as const) {
      const context = { targetingKey, userId: "forced" };
      expect(provider.resolve("targetOnly", false, context as any, "boolean").value).toBe(
        expectedValue,
      );
      expect(captured[captured.length - 1]?.userId).toBe(expectedUserId);
      expect(context.userId).toBe("forced");
    }
    provider.close();
  });
});

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
    variables: {
      supportEmail: {
        type: "string",
        defaultValue: "support@example.com",
        overrides: [
          {
            key: "netherlands",
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            value: "support-nl@example.com",
          },
        ],
      },
      limits: {
        type: "object",
        defaultValue: { requests: 10 },
      },
    },
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
              variable: "Feature variable",
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
          variable: { type: "string", defaultValue: "Default variable" },
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
  describe.each([false, true])("composed override replacement=%s", (replacement) => {
    it.each([false, true])(
      "resolves projections and TARGETING_MATCH with borrowed SDK=%s",
      async (borrowed) => {
        const payload = datafile();
        payload.segments.regional = {
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        };
        payload.features.overrideGate = feature();
        payload.variables!.overridePolicy = { type: "boolean", defaultValue: true };
        payload.variables!.screen = {
          type: "object",
          hash: "unchanged-composition",
          compose: [
            { key: "enabled", feature: "checkout" },
            { key: "title", feature: "checkout", variable: "title" },
            { key: "config", feature: "checkout", variable: "config" },
          ],
          overrideProgram: [
            {
              key: "regional",
              keyPath: ["regional"],
              segments: JSON.stringify(["regional"]),
              requiredFeatures: ["overrideGate"],
              conditions: [{ variable: "overridePolicy", operator: "equals", value: true }],
              operations: replacement
                ? [
                    {
                      op: "set",
                      path: [],
                      value: {
                        enabled: false,
                        title: "replaced",
                        config: { color: "replacement" },
                      },
                    },
                  ]
                : [
                    { op: "set", path: ["enabled"], value: false },
                    { op: "set", path: ["title"], value: "mutated" },
                    { op: "set", path: ["config", "color"], value: "green" },
                  ],
              onMatch: 1,
              onMiss: 2,
            },
            {
              key: "final",
              keyPath: ["regional", "final"],
              segments: "*",
              operations: [{ op: "set", path: ["config", "final"], value: true }],
              onMatch: 2,
              onMiss: 2,
            },
          ],
        };
        const sdk = borrowed
          ? createFeaturevisor({ datafile: payload, logLevel: "fatal" })
          : undefined;
        const provider = new FeaturevisorProvider(
          sdk ? { featurevisor: sdk } : { datafile: payload, logLevel: "fatal" },
        );
        if (sdk) expect(provider.featurevisor).toBe(sdk);
        const close = jest.spyOn(provider.featurevisor, "close");
        const context = { targetingKey: "user", country: "nl" };
        expect(provider.resolve("checkout", false, context, "boolean").value).toBe(true);
        expect(provider.resolve("checkout:title", "fallback", context, "string").value).toBe(
          "Hello",
        );
        expect(provider.resolve("checkout:config", {}, context, "object").value).toEqual({
          color: "blue",
        });
        const result = provider.resolve("variable:screen", {}, context, "object");
        expect(result).toMatchObject({
          value: {
            enabled: false,
            title: replacement ? "replaced" : "mutated",
            config: { color: replacement ? "replacement" : "green", final: true },
          },
          reason: StandardResolutionReasons.TARGETING_MATCH,
          flagMetadata: { variableKey: "screen", featurevisorReason: "variable_override_rule" },
        });
        expect(result.errorCode).toBeUndefined();
        expect(
          provider.resolve("variable:screen", {}, { ...context, country: "us" }, "object"),
        ).toMatchObject({
          value: { enabled: true, title: "Hello", config: { color: "blue" } },
          reason: StandardResolutionReasons.TARGETING_MATCH,
          flagMetadata: { featurevisorReason: "variable_composed" },
        });
        // Composed mutations must not alter the ordinary boolean, string or object projections.
        expect(provider.resolve("checkout", false, context, "boolean").value).toBe(true);
        expect(provider.resolve("checkout:title", "fallback", context, "string").value).toBe(
          "Hello",
        );
        expect(provider.resolve("checkout:config", {}, context, "object").value).toEqual({
          color: "blue",
        });
        await provider.close();
        if (sdk) {
          expect(close).not.toHaveBeenCalled();
          expect(sdk.getVariable("screen", { userId: "user", country: "nl" })).toEqual(
            result.value,
          );
          await sdk.close();
        } else {
          expect(close).toHaveBeenCalledTimes(1);
        }
      },
    );
  });

  it("resolves a composed object through the normal variable key with consumed-source tracking", () => {
    const payload = datafile();
    payload.variables!.screen = {
      type: "object",
      compose: [
        { key: "enabled", feature: "checkout" },
        { key: "variation", feature: "checkout", variation: true },
        { key: "title", feature: "checkout", variable: "title" },
        { key: "email", variable: "supportEmail" },
        { key: "missing", variable: "absent" },
      ],
    };
    const consumed: unknown[] = [];
    const f = createFeaturevisor({
      datafile: payload,
      logLevel: "fatal",
      modules: [
        {
          name: "tracking",
          afterEvaluation(e, options) {
            if (options.dependencyPurpose === "composition") consumed.push(options.dependencyOf);
            return e;
          },
        },
      ],
    });
    const provider = new FeaturevisorProvider({ featurevisor: f });
    const result = provider.resolve("variable:screen", {}, { country: "nl" }, "object");
    expect(result.value).toEqual({
      enabled: true,
      variation: "on",
      title: "Hello",
      email: "support-nl@example.com",
      missing: null,
    });
    expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    expect(result.flagMetadata?.featurevisorReason).toBe("variable_composed");
    expect(consumed).toEqual(Array(5).fill({ type: "variable", variableKey: "screen" }));
    provider.close();
    f.close();
  });
  it.each([
    ["boolean", false, true],
    ["number", 0, 1],
    ["string", "", "fallback"],
    ["object", { limit: 10 }, {}],
    ["object", ["card"], []],
  ])("resolves a string composition as an OpenFeature %s value", (type, value, fallback) => {
    const payload = datafile();
    payload.variables!.source = { type: "object", defaultValue: value } as any;
    payload.variables!.alias = { type: "object", compose: "source" };
    const provider = new FeaturevisorProvider({ datafile: payload });
    const result = provider.resolve("variable:alias", fallback, {}, type as any);
    expect(result.value).toEqual(value);
    expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    expect(result.flagMetadata?.featurevisorReason).toBe("variable_composed");
    expect(result.errorCode).toBeUndefined();
    provider.close();
  });
  it.each(["plain text", "null", "true", "123", '{"enabled":true}'])(
    "does not decode a JSON alias result again in the provider: %s",
    (value) => {
      const payload = datafile();
      payload.variables!.source = { type: "json", defaultValue: JSON.stringify(value) };
      payload.variables!.alias = { type: "json", compose: "source" };
      payload.variables!.chain = { type: "json", compose: "alias" };
      const provider = new FeaturevisorProvider({ datafile: payload });
      const result = provider.resolve("variable:chain", "fallback", {}, "string");
      expect(result.value).toBe(value);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.errorCode).toBeUndefined();
      provider.close();
    },
  );
  it("uses the ordinary provider fallback policy for a null alias", () => {
    const payload = datafile();
    payload.variables!.source = { type: "json", defaultValue: "null" };
    payload.variables!.alias = { type: "json", compose: "source" };
    const provider = new FeaturevisorProvider({ datafile: payload });
    const result = provider.resolve("variable:alias", { fallback: true }, {}, "object");
    expect(result.value).toEqual({ fallback: true });
    expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    expect(result.errorCode).toBeUndefined();
    provider.close();
  });
  it("preserves prototype-shaped JSON keys without introducing inherited targeting data", () => {
    const contexts: any[] = [];
    const input = JSON.parse(
      '{"__proto__":{"injected":true},"targetingKey":"user","profile":{"__proto__":{"role":"admin"},"constructor":"literal"},"items":[{"__proto__":{"extra":true}}]}',
    );
    const before = JSON.stringify(input);
    const provider = new FeaturevisorProvider({
      datafile: {
        schemaVersion: "2",
        revision: "prototype-keys",
        features: {
          gate: {
            bucketBy: "userId",
            traffic: [{ key: "admin", segments: ["admin"], percentage: 100000 }],
          },
        },
        segments: {
          admin: {
            conditions: [{ attribute: "profile.role", operator: "equals", value: "admin" }],
          },
        },
      },
      modules: [
        {
          name: "capture",
          beforeEvaluation: (options) => {
            contexts.push(options.context);
            return options;
          },
        },
      ],
    });
    expect(provider.resolve("gate", true, input, "boolean").value).toBe(false);
    const normalized = contexts[0];
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(normalized, "__proto__")).toBe(true);
    expect(normalized.injected).toBeUndefined();
    expect(Object.getPrototypeOf(normalized.profile)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(normalized.items[0])).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(normalized.profile, "__proto__")).toBe(true);
    expect(normalized.profile.__proto__).toEqual({ role: "admin" });
    expect(normalized.profile.constructor).toBe("literal");
    expect(normalized.profile.role).toBeUndefined();
    expect(normalized.items[0].extra).toBeUndefined();
    expect(JSON.stringify(input)).toBe(before);
    expect(normalized.profile).not.toBe(input.profile);
    expect(normalized.items).not.toBe(input.items);
    provider.close();
  });

  it("forwards targeting keys safely even with a prototype-shaped field name", () => {
    let captured: any;
    const provider = new FeaturevisorProvider({
      datafile: datafile(),
      targetingKeyField: "__proto__",
      modules: [
        {
          name: "capture",
          beforeEvaluation: (options) => {
            captured = options.context;
            return options;
          },
        },
      ],
    });
    provider.resolve("checkout", false, { targetingKey: "user" }, "boolean");
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(captured, "__proto__")).toBe(true);
    expect(captured.__proto__).toBe("user");
    provider.close();
  });

  it.each(["error", "fatal"] as const)(
    "tracks initial failures and recovery at log level %s",
    (logLevel) => {
      for (const invalid of [
        "{",
        "",
        { schemaVersion: "2", revision: "bad", features: null, segments: {} },
      ]) {
        const onDiagnostic = jest.fn();
        const provider = new FeaturevisorProvider({
          datafile: invalid as any,
          logLevel,
          onDiagnostic,
        });
        expect(provider.getDatafileError()).toBe("Could not parse datafile");
        expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBe(
          ErrorCode.PARSE_ERROR,
        );
        expect(onDiagnostic).toHaveBeenCalledTimes(logLevel === "fatal" ? 0 : 1);
        provider.featurevisor.setDatafile(datafile(), true);
        expect(provider.getDatafileError()).toBeUndefined();
        expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBeUndefined();
        provider.featurevisor.setDatafile("{");
        expect(provider.getDatafileError()).toBe("Could not parse datafile");
        provider.close();
      }
    },
  );

  it("preserves module setup and diagnostic delivery during owned initialization", async () => {
    const revisions: string[] = [];
    const moduleDiagnostics: string[] = [];
    const onDiagnostic = jest.fn();
    const close = jest.fn();
    const provider = new FeaturevisorProvider({
      datafile: datafile(),
      onDiagnostic,
      modules: [
        {
          name: "observer",
          setup: (api) => {
            revisions.push(api.getRevision());
            api.onDiagnostic((diagnostic) => moduleDiagnostics.push(diagnostic.code));
          },
          close,
        },
      ],
    });
    expect(revisions).toEqual(["unknown"]);
    expect(provider.featurevisor.getRevision()).toBe("revision-1");
    expect(moduleDiagnostics.filter((code) => code === "datafile_set")).toHaveLength(1);
    expect(
      onDiagnostic.mock.calls.filter(([diagnostic]) => diagnostic.code === "datafile_set"),
    ).toHaveLength(1);
    await provider.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("observes malformed updates and recovery on a caller-owned instance", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const provider = new FeaturevisorProvider({ featurevisor: f });
    f.setDatafile("{");
    expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBe(
      ErrorCode.PARSE_ERROR,
    );
    f.setDatafile(datafile(), true);
    expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBeUndefined();
    provider.close();
    f.setDatafile("{");
    expect(provider.resolve("checkout", false, {}, "boolean").errorCode).toBeUndefined();
    f.close();
  });

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
    expect(provider.resolve("checkout:variable", "fallback", context, "string").value).toBe(
      "Feature variable",
    );
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
          beforeEvaluation: (options) => {
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

  it("resolves global variables with default and custom prefixes", () => {
    const provider = new FeaturevisorProvider({ datafile: datafile() });
    expect(
      provider.resolve("variable:supportEmail", "fallback", { country: "nl" }, "string"),
    ).toEqual(
      expect.objectContaining({
        value: "support-nl@example.com",
        reason: StandardResolutionReasons.TARGETING_MATCH,
        flagMetadata: expect.objectContaining({
          variableKey: "supportEmail",
          variableOverrideKey: "netherlands",
        }),
      }),
    );
    expect(provider.resolve("variable:limits", {}, {}, "object").value).toEqual({
      requests: 10,
    });

    const custom = new FeaturevisorProvider({
      datafile: datafile(),
      keySeparator: "/",
      globalVariablePrefix: "$variable",
    });
    expect(custom.resolve("$variable/supportEmail", "fallback", {}, "string").value).toBe(
      "support@example.com",
    );
  });

  it("rejects a global variable prefix containing the key separator", () => {
    expect(
      () =>
        new FeaturevisorProvider({
          datafile: datafile(),
          globalVariablePrefix: "global:variable",
        }),
    ).toThrow("globalVariablePrefix cannot contain keySeparator");
  });

  it("returns a standard not found error for missing global variables", () => {
    const result = new FeaturevisorProvider({ datafile: datafile() }).resolve(
      "variable:missing",
      "fallback",
      {},
      "string",
    );
    expect(result).toEqual(
      expect.objectContaining({
        value: "fallback",
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
      }),
    );
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

  it("maps unmet feature prerequisites to DISABLED while retaining the SDK reason", () => {
    const content = datafile();
    content.features.prerequisite = feature({ traffic: [] });
    content.features.checkout.requiredFeatures = ["prerequisite"];
    const sdk = createFeaturevisor({ datafile: content, logLevel: "fatal" });
    expect(sdk.evaluateFlag("checkout").reason).toBe("conditions_unmet");
    const result = new FeaturevisorProvider({ featurevisor: sdk }).resolve(
      "checkout",
      true,
      {},
      "boolean",
    );
    expect(result.value).toBe(false);
    expect(result.reason).toBe(StandardResolutionReasons.DISABLED);
    expect(result.flagMetadata?.featurevisorReason).toBe("conditions_unmet");
  });

  it.each([
    ["conditions_unmet", conformance.openFeature.reasonMappings.conditions_unmet],
    ["conditions_unmet", StandardResolutionReasons.DISABLED],
    ["forced", StandardResolutionReasons.TARGETING_MATCH],
    ["sticky", StandardResolutionReasons.TARGETING_MATCH],
    ["rule", StandardResolutionReasons.TARGETING_MATCH],
    ["variable_override_variation", StandardResolutionReasons.TARGETING_MATCH],
    ["variable_override_rule", StandardResolutionReasons.TARGETING_MATCH],
    ["allocated", StandardResolutionReasons.SPLIT],
    ["disabled", StandardResolutionReasons.DISABLED],
    ["variation_disabled", StandardResolutionReasons.DISABLED],
    ["variable_disabled", StandardResolutionReasons.DISABLED],
    ["no_match", StandardResolutionReasons.DEFAULT],
    ["variable_default", StandardResolutionReasons.DEFAULT],
    ["variable_composed", StandardResolutionReasons.TARGETING_MATCH],
  ] satisfies Array<[EvaluationReason | "conditions_unmet", string]>)(
    "maps the %s evaluation reason to %s",
    (reason, expectedReason) => {
      const featurevisor = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
      jest.spyOn(featurevisor, "evaluateFlag").mockReturnValue({
        type: "flag",
        featureKey: "checkout",
        reason: reason as EvaluationReason,
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
