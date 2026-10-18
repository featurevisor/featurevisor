import type { RequiredFeature, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";
import { createDatafileDependencyIndex as indexStoredDatafile } from "./dependencies";
import { normalizeDatafile } from "./normalize";

function createDatafileDependencyIndex(datafile: DatafileContent) {
  return indexStoredDatafile(normalizeDatafile(datafile));
}
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const conformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v3.json"), "utf8"),
);

function datafile(requirements: RequiredFeature[]): DatafileContent {
  const override = { key: "matched", requiredFeatures: requirements, value: "matched" };
  return createDatafile({
    features: {
      a: createFeature({
        disabledVariationValue: "control",
        variations: [{ value: "control" }, { value: "other" }],
      }),
      b: createFeature(),
      gated: createFeature({ requiredFeatures: requirements }),
      rule: createFeature({
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        traffic: [
          {
            key: "all",
            segments: "*",
            percentage: 100000,
            allocation: [],
            variableOverrides: { message: [override] },
          },
        ],
      }),
      variation: createFeature({
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        variations: [{ value: "control", variableOverrides: { message: [override] } }],
        force: [{ segments: "*", enabled: true, variation: "control" }],
      }),
    },
    variables: {
      root: {
        type: "string",
        defaultValue: "matched",
        disabledValue: "default",
        requiredFeatures: requirements,
      },
      override: { type: "string", defaultValue: "default", overrides: [override] },
      program: {
        type: "string",
        defaultValue: "default",
        overrideProgram: [
          {
            key: "matched",
            keyPath: ["matched"],
            requiredFeatures: requirements,
            operations: [{ op: "set", path: [], value: "matched" }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  });
}

describe("required feature groups", () => {
  test.each(
    conformance.requiredFeatureGroups as {
      name: string;
      requirements: RequiredFeature[];
      results: boolean[];
    }[],
  )("portable contract: $name", ({ requirements, results }) => {
    expect(conformance.version).toBe(15);
    let index = 0;
    for (const { a, b } of conformance.requiredFeatureGroupInputs) {
      const f = createFeaturevisor({
        datafile: datafile(requirements),
        stickyFeatures: { a: { enabled: a }, b: { enabled: b } },
      });
      const expected = results[index++];
      expect(f.isEnabled("gated")).toBe(expected);
      for (const key of ["root", "override", "program"])
        expect(f.getVariable(key)).toBe(expected ? "matched" : "default");
    }
  });
  for (const a of [false, true])
    for (const b of [false, true]) {
      const cases: [string, RequiredFeature[], boolean][] = [
        ["implicit AND", ["a", "b"], a && b],
        ["AND", [{ and: ["a", "b"] }], a && b],
        ["OR", [{ or: ["a", "b"] }], a || b],
        ["NOT AND", [{ not: ["a", "b"] }], !(a && b)],
        ["NOT OR", [{ not: [{ or: ["a", "b"] }] }], !(a || b)],
        ["mixed", ["a", { or: ["b", { not: ["a"] }] }], a && b],
        ["double NOT", [{ not: [{ not: ["a"] }] }], a],
        ["disabled leaf", [{ or: [{ feature: "a", enabled: false }, "b"] }], !a || b],
        ["empty NOT fallback", [{ not: [] }], false],
      ];
      test.each(cases)(`%s with a=${a}, b=${b} in every placement`, (_, requirements, matched) => {
        const f = createFeaturevisor({
          datafile: datafile(requirements),
          stickyFeatures: { a: { enabled: a }, b: { enabled: b } },
        });
        const expected = matched ? "matched" : "default";
        expect(f.isEnabled("gated")).toBe(matched);
        expect(f.getVariable("rule", "message")).toBe(expected);
        expect(f.getVariable("variation", "message")).toBe(expected);
        for (const key of ["root", "override", "program"])
          expect(f.getVariable(key)).toBe(expected);
      });
    }

  test("negates the complete enabled and variation check", () => {
    const f = createFeaturevisor({
      datafile: datafile([{ not: [{ feature: "a", enabled: false, variation: "control" }] }]),
      stickyFeatures: { a: { enabled: false, variation: "control" } },
    });
    expect(f.isEnabled("gated")).toBe(false);
    f.setStickyFeatures({ a: { enabled: true, variation: "control" } }, true);
    expect(f.isEnabled("gated")).toBe(true);
  });

  test("preserves missing feature flag semantics under negation", () => {
    const f = createFeaturevisor({ datafile: datafile([{ not: ["missing"] }]) });
    expect(f.isEnabled("gated")).toBe(true);
  });

  test.each([
    [{ or: ["a", "b"] }, true, ["a"]],
    [{ and: ["a", "b"] }, false, ["a"]],
    [{ not: ["a", "b"] }, false, ["a"]],
    [{ or: ["a", "b"] }, false, ["a", "b"]],
  ] as [RequiredFeature, boolean, string[]][])("short circuits %j", (group, a, expected) => {
    const visited: string[] = [];
    const f = createFeaturevisor({
      datafile: datafile([group]),
      stickyFeatures: { a: { enabled: a } },
      modules: [
        {
          name: "observe",
          beforeEvaluation(options) {
            if (options.type === "flag" && options.featureKey !== "gated")
              visited.push(options.featureKey);
            return options;
          },
        },
      ],
    });
    f.isEnabled("gated");
    expect(visited).toEqual(expected);
  });

  test("child sticky state controls groups", () => {
    const f = createFeaturevisor({
      datafile: datafile([{ or: ["a", "b"] }]),
      stickyFeatures: { a: { enabled: false }, b: { enabled: false } },
    });
    const child = f.spawn({}, { stickyFeatures: { a: { enabled: true } } });
    expect(f.getVariable("root")).toBe("default");
    expect(child.getVariable("root")).toBe("matched");
  });

  test("indexes every branch, including negated and skipped requirements", () => {
    const index = createDatafileDependencyIndex(datafile([{ or: ["a", { not: ["b"] }] }]));
    for (const key of ["a", "b"]) {
      expect(index.featureDependents[key]).toEqual(
        expect.arrayContaining(["gated", "rule", "variation"]),
      );
      expect(index.featureVariables[key]).toEqual(
        expect.arrayContaining(["root", "override", "program"]),
      );
    }
  });

  test.each([false, true])("notifies dependents of a skipped branch when replace=%s", (replace) => {
    const initial = datafile([{ or: ["a", { not: ["b"] }] }]);
    const f = createFeaturevisor({ datafile: initial });
    expect(f.isEnabled("gated")).toBe(true);
    const changed = jest.fn();
    f.on("datafile_set", changed);
    const update = createFeature({ bucketBy: "accountId" });
    f.setDatafile(
      replace
        ? { ...initial, features: { ...initial.features, b: update } }
        : createDatafile({ features: { b: update } }),
      replace,
    );
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining(["b", "gated", "rule", "variation"]),
        variables: expect.arrayContaining(["root", "override", "program"]),
      }),
    );
  });
});
