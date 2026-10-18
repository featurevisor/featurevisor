import { createFeaturevisor } from "./index";
import type { VariableKey, EvaluationOptions } from "./index";
import { createComplexDatafile, deterministicBucketModule } from "./instance.test-fixtures";

describe("typed variable getter forwarding", () => {
  it("uses VariableKey for both variable scopes", () => {
    const featurevisor = createFeaturevisor({ logLevel: "fatal" });
    const key: VariableKey = "missing";
    const options: EvaluationOptions = { type: "variable", variableKey: key, context: {} };
    const keys: VariableKey[] = featurevisor.getVariableKeys();
    expect(keys).toEqual([]);
    expect(featurevisor.getVariable(key)).toBeNull();
    expect(featurevisor.getVariable("feature", key)).toBeNull();
    expect(options.variableKey).toBe(key);
  });
  it("preserves parent feature and global overload arguments", () => {
    const featurevisor = createFeaturevisor({
      datafile: createComplexDatafile(),
      modules: [deterministicBucketModule()],
      logLevel: "fatal",
    });

    expect(
      featurevisor.getVariableString("experiment", "greeting", { country: "nl", age: 20 }),
    ).toBe("Welkom");
    expect(
      featurevisor.getVariableString(
        "missing",
        "value",
        {},
        {
          defaultVariableValue: "feature default",
        },
      ),
    ).toBe("feature default");
    expect(
      featurevisor.getVariableString(
        "missing",
        {},
        {
          defaultVariableValue: "global default",
        },
      ),
    ).toBe("global default");
  });

  it("checks child values without forwarding through parent typed wrappers", () => {
    const parent = createFeaturevisor({
      datafile: createComplexDatafile(),
      modules: [deterministicBucketModule()],
      logLevel: "fatal",
    });
    const child = parent.spawn({ country: "nl", age: 20, bucket: 75000 });
    const parentStringGetter = jest.spyOn(parent, "getVariableString");
    const parentIntegerGetter = jest.spyOn(parent, "getVariableInteger");

    expect(child.getVariableString("experiment", "greeting")).toBe("Welkom");
    expect(child.getVariableInteger("experiment", "count")).toBe(2);
    expect(parentStringGetter).not.toHaveBeenCalled();
    expect(parentIntegerGetter).not.toHaveBeenCalled();
  });

  it("retains child sticky values, runtime checks, and JSON error handling", () => {
    const diagnostics: string[] = [];
    const parent = createFeaturevisor({
      datafile: {
        schemaVersion: "2",
        revision: "typed-getters",
        segments: {},
        features: {},
        variables: {
          value: { type: "string", defaultValue: "default" },
          malformed: { type: "json", defaultValue: "{" },
        },
      },
      logLevel: "debug",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    const child = parent.spawn({}, { stickyVariables: { value: "sticky" } });

    expect(child.getVariableString("value")).toBe("sticky");
    expect(child.getVariableBoolean("value")).toBeNull();
    expect(child.getVariableJSON("malformed")).toBeNull();
    expect(diagnostics).toContain("evaluation_error");
  });
});
