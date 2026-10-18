import type { Conditions } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";
import { normalizeDatafile } from "./normalize";

describe("datafile condition normalization", () => {
  test.each<[Conditions]>([[[]], [{ and: [] }], [{ or: [] }], [{ not: [] }]])(
    "preserves a false v4 expression alongside legacy selectors: %j",
    (conditions) => {
      const input = createDatafile({
        schemaVersion: "4",
        features: {
          subject: createFeature({ conditions, requiredFeatures: ["source"] }),
          source: createFeature(),
        },
        variables: {
          subject: {
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "mixed", conditions, segments: "*", value: "override" }],
          },
        },
      });
      const f = createFeaturevisor({ datafile: input, logLevel: "fatal" });
      expect(f.isEnabled("subject")).toBe(false);
      expect(f.getVariable("subject")).toBe("default");
      expect(input.features.subject.conditions).toEqual(conditions);
    },
  );

  test.each<[Conditions]>([[[]], [{ and: [] }], [{ and: [{ and: [] }] }], ["[]"], ['{"and":[]}']])(
    "preserves v3 empty attribute AND semantics in historical locations: %j",
    (conditions) => {
      const input = createDatafile({
        schemaVersion: "2",
        segments: { empty: { conditions } },
        features: {
          subject: createFeature({
            force: [{ conditions, enabled: true }],
            traffic: [],
          }),
          segment: createFeature({
            traffic: [{ key: "all", segments: "empty", percentage: 100000 }],
          }),
          variable: createFeature({
            variablesSchema: { copy: { type: "string", defaultValue: "default" } },
            traffic: [
              {
                key: "all",
                segments: "*",
                percentage: 100000,
                variableOverrides: { copy: [{ conditions, value: "override" }] },
              },
            ],
          }),
          variation: createFeature({
            variablesSchema: { copy: { type: "string", defaultValue: "default" } },
            force: [{ conditions: "*", enabled: true, variation: "a" }],
            variations: [
              {
                value: "a",
                variableOverrides: { copy: [{ conditions, value: "override" }] },
              },
            ],
          }),
        },
        variables: {
          subject: {
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "empty", conditions, value: "override" }],
          },
        },
      });
      const before = JSON.stringify(input);
      const f = createFeaturevisor({ datafile: input, logLevel: "fatal" });
      expect(f.isEnabled("subject")).toBe(true);
      expect(f.isEnabled("segment")).toBe(true);
      expect(f.getVariable("variable", "copy")).toBe("override");
      expect(f.getVariable("subject")).toBe("override");
      expect(f.getVariable("variation", "copy")).toBe("override");
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  test("keeps empty v4 conditions false in all old locations", () => {
    const input = createDatafile({
      schemaVersion: "4",
      segments: { empty: { conditions: [] } },
      features: {
        subject: createFeature({ force: [{ conditions: [], enabled: true }], traffic: [] }),
      },
      variables: {
        subject: {
          type: "string",
          defaultValue: "default",
          overrides: [{ key: "empty", conditions: [], value: "override" }],
        },
      },
    });
    const f = createFeaturevisor({ datafile: input, logLevel: "fatal" });
    expect(f.isEnabled("subject")).toBe(false);
    expect(f.getVariable("subject")).toBe("default");
    expect(normalizeDatafile(input).segments.empty.conditions).toEqual([]);
  });

  test("does not reinterpret new root gates or traffic conditions in schema 2 inputs", () => {
    const input = createDatafile({
      schemaVersion: "2",
      features: {
        subject: createFeature({ conditions: [] }),
        rule: createFeature({
          traffic: [{ key: "empty", conditions: [], segments: "*", percentage: 100000 }],
        }),
      },
      variables: {
        subject: {
          type: "string",
          defaultValue: "default",
          disabledValue: "disabled",
          conditions: [],
        },
      },
    });
    const f = createFeaturevisor({ datafile: input, logLevel: "fatal" });
    expect(f.isEnabled("subject")).toBe(false);
    expect(f.isEnabled("rule")).toBe(false);
    expect(f.getVariable("subject")).toBe("disabled");
  });
});
