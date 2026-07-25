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
