import { checkForCircularDependencyInRequired } from "./checkCircularDependency";

function createDatasource(features: Record<string, { required?: string[] }>) {
  return {
    featureExists: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(features, key),
    ),
    readFeature: jest.fn(async (key: string) => features[key]),
  } as any;
}

describe("core: required feature dependency validation", () => {
  it("reports a missing directly required feature", async () => {
    const datasource = createDatasource({ checkout: { required: ["missing"] } });

    await expect(
      checkForCircularDependencyInRequired(datasource, "checkout", ["missing"]),
    ).rejects.toThrow('required feature "missing" not found');
    expect(datasource.featureExists).toHaveBeenCalledWith("missing");
  });

  it("reports a missing nested required feature", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing"] },
      pricing: { required: ["missing"] },
    });

    await expect(
      checkForCircularDependencyInRequired(datasource, "checkout", ["pricing"]),
    ).rejects.toThrow('required feature "missing" not found');
  });

  it("reports the exact circular dependency path without sibling branches", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing", "shipping"] },
      pricing: {},
      shipping: { required: ["checkout"] },
    });

    await expect(
      checkForCircularDependencyInRequired(datasource, "checkout", ["pricing", "shipping"]),
    ).rejects.toThrow("circular dependency found: checkout -> shipping -> checkout");
  });

  it("reports a nested cycle that does not return to the starting feature", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing"] },
      pricing: { required: ["shipping"] },
      shipping: { required: ["pricing"] },
    });

    await expect(
      checkForCircularDependencyInRequired(datasource, "checkout", ["pricing"]),
    ).rejects.toThrow("circular dependency found: pricing -> shipping -> pricing");
  });

  it("allows shared dependencies in separate branches", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing", "shipping"] },
      pricing: { required: ["currency"] },
      shipping: { required: ["currency"] },
      currency: {},
    });

    await expect(
      checkForCircularDependencyInRequired(datasource, "checkout", ["pricing", "shipping"]),
    ).resolves.toBeUndefined();
    expect(datasource.readFeature).toHaveBeenCalledWith("currency");
    expect(
      datasource.readFeature.mock.calls.filter(([key]: [string]) => key === "currency"),
    ).toHaveLength(1);
  });
});
