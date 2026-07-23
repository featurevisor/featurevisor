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
    ).rejects.toThrow("circular dependency found: shipping -> checkout");
  });
});
