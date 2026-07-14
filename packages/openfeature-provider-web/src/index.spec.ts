import { OpenFeature } from "@openfeature/web-sdk";
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorOpenFeatureProvider } from "./index";

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
    const featurevisor = createFeaturevisor({ datafile, logLevel: "fatal" });
    const provider = new FeaturevisorOpenFeatureProvider({ featurevisor });

    expect(provider.featurevisor).toBe(featurevisor);

    await provider.onClose();
    await featurevisor.close();
  });
});
