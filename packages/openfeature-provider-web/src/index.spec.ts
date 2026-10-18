import { OpenFeature, ProviderEvents, ProviderStatus } from "@openfeature/web-sdk";
import { createFeaturevisor } from "@featurevisor/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FeaturevisorOpenFeatureProvider } from "./index";

const providerCorpus = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/openfeature-provider.json"), "utf8"),
);

const datafile = {
  schemaVersion: "2" as const,
  revision: "web-test",
  segments: {},
  features: {
    enabled: {
      bucketBy: "userId",
      traffic: [{ key: "all", segments: "*" as const, percentage: 100000, allocation: [] }],
    },
  },
};

describe("browser OpenFeature provider", () => {
  afterEach(async () => OpenFeature.close());

  it.each(["error", "fatal"] as const)(
    "rejects invalid initialization and recovers at log level %s",
    async (logLevel) => {
      for (const invalid of [
        "{",
        { schemaVersion: "2", revision: "bad", features: null, segments: {} },
      ]) {
        const domain = `invalid-${logLevel}-${typeof invalid}`;
        const provider = new FeaturevisorOpenFeatureProvider({
          datafile: invalid as any,
          logLevel,
          onDiagnostic: () => {},
        });
        await expect(OpenFeature.setProviderAndWait(domain, provider)).rejects.toMatchObject({
          code: "PARSE_ERROR",
        });
        const client = OpenFeature.getClient(domain);
        expect(client.providerStatus).toBe(ProviderStatus.ERROR);
        expect(client.getBooleanDetails("enabled", false).errorCode).toBe("PARSE_ERROR");
        provider.featurevisor.setDatafile(datafile, true);
        expect(client.providerStatus).toBe(ProviderStatus.READY);
        expect(client.getBooleanValue("enabled", false)).toBe(true);
        provider.featurevisor.setDatafile("{");
        expect(client.providerStatus).toBe(ProviderStatus.ERROR);
        provider.featurevisor.setDatafile(datafile, true);
        expect(client.providerStatus).toBe(ProviderStatus.READY);
      }
    },
  );

  it.each([false, true])(
    "notifies context changes and cleans up with borrowed=%s",
    async (borrowed) => {
      const options = {
        datafile: {
          ...datafile,
          features: {
            enabled: {
              ...datafile.features.enabled,
              force: [
                {
                  conditions: { attribute: "country", operator: "equals" as const, value: "gb" },
                  enabled: false,
                },
              ],
            },
          },
        },
        context: { country: "gb" },
        logLevel: "fatal" as const,
      };
      const f = borrowed ? createFeaturevisor(options) : undefined;
      const provider = new FeaturevisorOpenFeatureProvider(f ? { featurevisor: f } : options);
      const domain = `context-${borrowed}`;
      await OpenFeature.setProviderAndWait(domain, provider);
      const client = OpenFeature.getClient(domain);
      const changed = jest.fn();
      client.addHandler(ProviderEvents.ConfigurationChanged, changed);
      expect(client.getBooleanValue("enabled", false)).toBe(false);
      provider.featurevisor.setContext({ country: "nl" });
      expect(client.getBooleanValue("enabled", false)).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1);
      await OpenFeature.setContext(domain, { country: "gb" });
      expect(client.getBooleanValue("enabled", false)).toBe(false);
      expect(changed).toHaveBeenCalledTimes(1);
      await provider.onClose();
      provider.featurevisor.setContext({ country: "de" });
      expect(changed).toHaveBeenCalledTimes(1);
      if (f) {
        expect(f.getContext()).toEqual({ country: "de" });
        await f.close();
      }
    },
  );

  it("resolves workspace dependencies from source", () => {
    expect(require.resolve("@featurevisor/sdk")).toBe(require.resolve("../../sdk/src"));
    expect(require.resolve("@featurevisor/openfeature-provider-core")).toBe(
      require.resolve("../../openfeature-provider-core/src"),
    );
  });

  it("runs the shared corpus through the OpenFeature web client", async () => {
    expect(providerCorpus.kind).toBe("featurevisor.openfeature-provider");
    expect(providerCorpus.schemaVersion).toBe(1);
    await OpenFeature.setProviderAndWait(
      "corpus",
      new FeaturevisorOpenFeatureProvider({ datafile: providerCorpus.datafile, logLevel: "fatal" }),
    );
    const client = OpenFeature.getClient("corpus");
    for (const testCase of providerCorpus.cases) {
      const before = JSON.parse(JSON.stringify(testCase.context));
      await OpenFeature.setContext("corpus", testCase.context);
      const result =
        testCase.type === "boolean"
          ? client.getBooleanDetails(testCase.flagKey, testCase.default)
          : testCase.type === "string"
            ? client.getStringDetails(testCase.flagKey, testCase.default)
            : client.getObjectDetails(testCase.flagKey, testCase.default);
      expect(result.value).toEqual(testCase.expected.value);
      if (testCase.expected.reason) expect(result.reason).toBe(testCase.expected.reason);
      if (testCase.expected.variant) expect(result.variant).toBe(testCase.expected.variant);
      expect(result.errorCode).toBe(testCase.expected.errorCode);
      expect(testCase.context).toEqual(before);
    }
    for (const testCase of providerCorpus.targetingCases) {
      const before = JSON.parse(JSON.stringify(testCase.context));
      await OpenFeature.setContext("corpus", testCase.context);
      expect(client.getBooleanDetails("targetOnly", false).value).toBe(testCase.expectedValue);
      expect(testCase.context).toEqual(before);
    }
    await OpenFeature.setProviderAndWait(
      "corpus-custom",
      new FeaturevisorOpenFeatureProvider({
        datafile: providerCorpus.datafile,
        logLevel: "fatal",
        targetingKeyField: "accountId",
      }),
    );
    const custom = providerCorpus.customTargetingCase;
    await OpenFeature.setContext("corpus-custom", custom.context);
    const customClient = OpenFeature.getClient("corpus-custom");
    expect(customClient.getBooleanDetails(custom.flagKey, false).value).toBe(custom.expectedValue);
  });

  it("passes finite numeric targeting keys through the web client", async () => {
    const captured: Record<string, unknown>[] = [];
    await OpenFeature.setProviderAndWait(
      "numeric-targeting",
      new FeaturevisorOpenFeatureProvider({
        datafile: providerCorpus.datafile,
        logLevel: "fatal",
        modules: [
          {
            name: "capture-numeric-targeting",
            beforeEvaluation: (options) => {
              captured.push(options.context);
              return options;
            },
          },
        ],
      }),
    );
    const client = OpenFeature.getClient("numeric-targeting");
    for (const [targetingKey, expectedUserId, expectedValue] of [
      [0, 0, false],
      [42, 42, false],
      [Number.NaN, "forced", true],
      [Number.POSITIVE_INFINITY, "forced", true],
      [Number.NEGATIVE_INFINITY, "forced", true],
    ] as const) {
      const context = { targetingKey, userId: "forced" };
      await OpenFeature.setContext("numeric-targeting", context as any);
      expect(client.getBooleanDetails("targetOnly", false).value).toBe(expectedValue);
      expect(captured[captured.length - 1]?.userId).toBe(expectedUserId);
      expect(context.userId).toBe("forced");
    }
  });

  it("reports parse failures and recovery even when restored data has not changed", async () => {
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    const provider = new FeaturevisorOpenFeatureProvider({ featurevisor: f });
    await OpenFeature.setProviderAndWait("parse-recovery", provider);
    const client = OpenFeature.getClient("parse-recovery");
    const errors = jest.fn();
    const ready = jest.fn();
    const changed = jest.fn();
    client.addHandler(ProviderEvents.Error, errors);
    client.addHandler(ProviderEvents.Ready, ready);
    client.addHandler(ProviderEvents.ConfigurationChanged, changed);
    f.setDatafile("{");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(client.getBooleanDetails("enabled", false).errorCode).toBe("PARSE_ERROR");
    f.setDatafile(datafile, true);
    expect(ready).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(client.getBooleanValue("enabled", false)).toBe(true);
    await provider.onClose();
    f.setDatafile("{");
    expect(errors).toHaveBeenCalledTimes(1);
    f.close();
  });

  it("works through the OpenFeature web SDK", async () => {
    const provider = new FeaturevisorOpenFeatureProvider({ datafile, logLevel: "fatal" });
    await OpenFeature.setProviderAndWait("featurevisor-test", provider);
    await OpenFeature.setContext("featurevisor-test", { targetingKey: "user" });
    const client = OpenFeature.getClient("featurevisor-test");

    expect(client.getBooleanValue("enabled", false)).toBe(true);
    expect(client.getBooleanValue("missing", true)).toBe(true);
    expect(client.getBooleanDetails("missing", true)).toEqual(
      expect.objectContaining({ value: true, errorCode: "FLAG_NOT_FOUND" }),
    );
    expect(provider.metadata.name).toBe("Featurevisor");
    expect(provider.runsOn).toBe("client");
  });

  it("accepts an existing Featurevisor instance", async () => {
    let closeCount = 0;
    const featurevisor = createFeaturevisor({
      datafile,
      logLevel: "fatal",
      modules: [
        {
          name: "close-counter",
          close: () => {
            closeCount++;
          },
        },
      ],
    });
    const provider = new FeaturevisorOpenFeatureProvider({ featurevisor });

    expect(provider.featurevisor).toBe(featurevisor);
    await OpenFeature.setProviderAndWait("featurevisor-existing", provider);
    await OpenFeature.setContext("featurevisor-existing", { targetingKey: "user" });
    const client = OpenFeature.getClient("featurevisor-existing");
    expect(client.getBooleanValue("enabled", false)).toBe(true);

    await OpenFeature.close();
    expect(closeCount).toBe(0);
    expect(featurevisor.evaluateFlag("enabled", { userId: "user" }).enabled).toBe(true);
    await featurevisor.close();
    expect(closeCount).toBe(1);
  });

  it("notifies clients conservatively when Featurevisor state can affect flags", async () => {
    const provider = new FeaturevisorOpenFeatureProvider({ datafile, logLevel: "fatal" });
    await OpenFeature.setProviderAndWait("featurevisor-events", provider);
    const client = OpenFeature.getClient("featurevisor-events");
    const changes: unknown[] = [];
    client.addHandler(ProviderEvents.ConfigurationChanged, (details) => changes.push(details));

    provider.featurevisor.setStickyVariables({ country: "nl" });
    provider.featurevisor.setStickyFeatures({ enabled: { enabled: false } });
    provider.featurevisor.setDatafile({
      schemaVersion: "2",
      revision: "web-test-2",
      segments: {},
      features: {
        enabled: {
          ...datafile.features.enabled,
          hash: "changed",
        },
      },
    });
    expect(changes).toHaveLength(3);
    expect(changes).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ flagsChanged: expect.anything() })]),
    );
  });
});
