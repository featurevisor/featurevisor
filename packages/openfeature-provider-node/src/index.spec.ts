import { OpenFeature } from "@openfeature/server-sdk";
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorOpenFeatureProvider } from "./index";

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
    const featurevisor = createFeaturevisor({ datafile, logLevel: "fatal" });
    const provider = new FeaturevisorOpenFeatureProvider({ featurevisor });

    expect(provider.featurevisor).toBe(featurevisor);

    await provider.onClose();
    await featurevisor.close();
  });
});
