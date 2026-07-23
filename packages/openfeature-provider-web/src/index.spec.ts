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
});
