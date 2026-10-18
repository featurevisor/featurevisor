import { OpenFeature, ProviderEvents, ProviderStatus } from "@openfeature/server-sdk";
import { createFeaturevisor } from "@featurevisor/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FeaturevisorOpenFeatureProvider } from "./index";

const providerCorpus = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/openfeature-provider.json"), "utf8"),
);

const datafile = {
  schemaVersion: "2" as const,
  revision: "node-test",
  segments: {},
  features: {
    enabled: {
      bucketBy: "userId",
      traffic: [{ key: "all", segments: "*" as const, percentage: 100000, allocation: [] }],
    },
  },
};

describe("Node.js OpenFeature provider", () => {
  afterEach(async () => OpenFeature.close());

  it.each(["error", "fatal"] as const)(
    "exposes initialization failures and recovery at log level %s",
    async (logLevel) => {
      const provider = new FeaturevisorOpenFeatureProvider({
        datafile: "{",
        logLevel,
        onDiagnostic: () => {},
      });
      const domain = `invalid-${logLevel}`;
      await expect(OpenFeature.setProviderAndWait(domain, provider)).rejects.toMatchObject({
        code: "PARSE_ERROR",
      });
      const client = OpenFeature.getClient(domain);
      expect(client.providerStatus).toBe(ProviderStatus.ERROR);
      expect((await client.getBooleanDetails("enabled", false)).errorCode).toBe("PARSE_ERROR");
      provider.featurevisor.setDatafile(datafile, true);
      expect(client.providerStatus).toBe(ProviderStatus.READY);
      expect(await client.getBooleanValue("enabled", false)).toBe(true);
      provider.featurevisor.setDatafile("{");
      expect(client.providerStatus).toBe(ProviderStatus.ERROR);
      provider.featurevisor.setDatafile(datafile, true);
      expect(client.providerStatus).toBe(ProviderStatus.READY);
    },
  );

  it("detaches health listeners without closing a borrowed instance", async () => {
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    const provider = new FeaturevisorOpenFeatureProvider({ featurevisor: f });
    const errors = jest.fn();
    provider.events.addHandler(ProviderEvents.Error, errors);
    f.setDatafile("{");
    expect(errors).toHaveBeenCalledTimes(1);
    await provider.onClose();
    f.setDatafile(datafile, true);
    f.setDatafile("{");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(f.isEnabled("enabled")).toBe(true);
    await f.close();
  });

  it("resolves workspace dependencies from source", () => {
    expect(require.resolve("@featurevisor/sdk")).toBe(require.resolve("../../sdk/src"));
    expect(require.resolve("@featurevisor/openfeature-provider-core")).toBe(
      require.resolve("../../openfeature-provider-core/src"),
    );
  });

  it("runs the shared corpus through the OpenFeature server client", async () => {
    expect(providerCorpus.kind).toBe("featurevisor.openfeature-provider");
    expect(providerCorpus.schemaVersion).toBe(1);
    await OpenFeature.setProviderAndWait(
      "corpus",
      new FeaturevisorOpenFeatureProvider({ datafile: providerCorpus.datafile, logLevel: "fatal" }),
    );
    const client = OpenFeature.getClient("corpus");
    for (const testCase of providerCorpus.cases) {
      const before = JSON.parse(JSON.stringify(testCase.context));
      const result =
        testCase.type === "boolean"
          ? await client.getBooleanDetails(testCase.flagKey, testCase.default, testCase.context)
          : testCase.type === "string"
            ? await client.getStringDetails(testCase.flagKey, testCase.default, testCase.context)
            : await client.getObjectDetails(testCase.flagKey, testCase.default, testCase.context);
      expect(result.value).toEqual(testCase.expected.value);
      if (testCase.expected.reason) expect(result.reason).toBe(testCase.expected.reason);
      if (testCase.expected.variant) expect(result.variant).toBe(testCase.expected.variant);
      expect(result.errorCode).toBe(testCase.expected.errorCode);
      expect(testCase.context).toEqual(before);
    }
    for (const testCase of providerCorpus.targetingCases) {
      const before = JSON.parse(JSON.stringify(testCase.context));
      expect({
        name: testCase.name,
        value: (await client.getBooleanDetails("targetOnly", false, testCase.context)).value,
      }).toEqual({ name: testCase.name, value: testCase.expectedValue });
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
    const customClient = OpenFeature.getClient("corpus-custom");
    expect(
      (await customClient.getBooleanDetails(custom.flagKey, false, custom.context)).value,
    ).toBe(custom.expectedValue);
  });

  it("passes finite numeric targeting keys through the server client", async () => {
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
      expect((await client.getBooleanDetails("targetOnly", false, context as any)).value).toBe(
        expectedValue,
      );
      expect(captured[captured.length - 1]?.userId).toBe(expectedUserId);
      expect(context.userId).toBe("forced");
    }
  });

  it("works through the OpenFeature server SDK", async () => {
    const provider = new FeaturevisorOpenFeatureProvider({ datafile, logLevel: "fatal" });
    await OpenFeature.setProviderAndWait("featurevisor-test", provider);
    const client = OpenFeature.getClient("featurevisor-test");

    await expect(client.getBooleanValue("enabled", false, { targetingKey: "user" })).resolves.toBe(
      true,
    );
    await expect(client.getBooleanValue("missing", true)).resolves.toBe(true);
    await expect(client.getBooleanDetails("missing", true)).resolves.toEqual(
      expect.objectContaining({ value: true, errorCode: "FLAG_NOT_FOUND" }),
    );
    expect(provider.metadata.name).toBe("Featurevisor");
    expect(provider.runsOn).toBe("server");
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
    const client = OpenFeature.getClient("featurevisor-existing");
    await expect(client.getBooleanValue("enabled", false, { targetingKey: "user" })).resolves.toBe(
      true,
    );

    await OpenFeature.close();
    expect(closeCount).toBe(0);
    expect(featurevisor.evaluateFlag("enabled", { userId: "user" }).enabled).toBe(true);
    await featurevisor.close();
    expect(closeCount).toBe(1);
  });
});
