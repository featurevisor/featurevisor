import type { Condition, Conditions, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "./instance";
import { normalizeDatafile } from "./normalize";
import { createDatafile, createFeature } from "./instance.test-fixtures";

const country: Condition = { attribute: "country", operator: "equals", value: "nl" };
const flag: Condition = { feature: "source" };
const value: Condition = { variable: "limit", operator: "greaterThan", value: 5 };

function datafile(conditions: Conditions): DatafileContent {
  return createDatafile({
    schemaVersion: "4",
    segments: {
      dutch: { conditions: country },
      eligible: { conditions: ["dutch", flag, value] },
      nested: { conditions: "eligible" },
    },
    features: {
      source: createFeature({
        variations: [{ value: "treatment" }],
        force: [{ conditions: "*", enabled: true, variation: "treatment" }],
      }),
      subject: createFeature({ conditions }),
      rule: createFeature({
        traffic: [
          { key: "mixed", conditions, percentage: 100000, variables: { copy: "selected" } },
          { key: "fallback", conditions: "*", percentage: 100000 },
        ],
        variablesSchema: { copy: { type: "string", defaultValue: "fallback" } },
      }),
    },
    variables: {
      limit: { type: "integer", defaultValue: 10 },
      subject: { type: "string", defaultValue: "selected", disabledValue: "disabled", conditions },
      alias: { type: "integer", compose: "limit", conditions },
      map: {
        type: "object",
        compose: [{ key: "limit", variable: "limit" }],
        conditions,
        disabledValue: { limit: 0 },
      },
    },
  });
}

describe("unified conditions", () => {
  test.each<[{ country?: string }, boolean]>([
    [{ country: "nl" }, true],
    [{ country: "de" }, false],
    [{}, false],
  ])("mixes every leaf through nested segments: %j", (context, matches) => {
    const f = createFeaturevisor({ datafile: datafile("nested"), logLevel: "fatal" });
    expect(f.isEnabled("subject", context)).toBe(matches);
    expect(f.getVariable("subject", context)).toBe(matches ? "selected" : "disabled");
    expect(f.getVariable("rule", "copy", context)).toBe(matches ? "selected" : "fallback");
    expect(f.getVariable("alias", context)).toBe(matches ? 10 : null);
    expect(f.getVariable("map", context)).toEqual({ limit: matches ? 10 : 0 });
  });

  test.each<[Conditions, boolean]>([
    ["*", true],
    [[country, flag, value], true],
    [{ and: [country, flag, value] }, true],
    [{ or: [{ feature: "missing" }, value] }, true],
    [{ not: [{ feature: "missing" }, value] }, true],
    [{ not: [{ or: [flag, value] }] }, false],
    [[], false],
    [{ and: [] }, false],
    [{ or: [] }, false],
    [{ not: [] }, false],
    ["missing", false],
    [{ feature: "missing", enabled: false }, true],
    [{ variable: "missing", operator: "isNull" }, true],
    [{ variable: "missing", path: ["nested"], operator: "notExists" }, true],
    [{ feature: "source", variation: "treatment" }, true],
    [{ feature: "source", enabled: false, variation: "treatment" }, false],
  ])("matches expression %j", (conditions, matches) => {
    const f = createFeaturevisor({ datafile: datafile(conditions), logLevel: "fatal" });
    expect(f.isEnabled("subject", { country: "nl" })).toBe(matches);
    if (!matches)
      expect(f.evaluateFlag("subject", { country: "nl" })).toMatchObject({
        reason: "conditions_unmet",
        conditions,
      });
  });

  test("force bypasses the root gate and sticky values bypass both", () => {
    const d = datafile({ feature: "missing" });
    d.features.subject.force = [{ conditions: flag, enabled: true }];
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.evaluateFlag("subject").reason).toBe("forced");
    f.setStickyFeatures({ subject: { enabled: false } });
    expect(f.evaluateFlag("subject")).toMatchObject({ reason: "sticky", enabled: false });
  });

  test("disabled variation checks use the normal getters", () => {
    const d = datafile({ feature: "source", enabled: false, variation: "off" });
    d.features.source = createFeature({ disabledVariationValue: "off", traffic: [] });
    expect(createFeaturevisor({ datafile: d, logLevel: "fatal" }).isEnabled("subject")).toBe(true);
  });

  test("keeps force only legacy features usable when traffic was omitted", () => {
    const d = datafile("*");
    Reflect.deleteProperty(d.features.source, "traffic");
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.isEnabled("source")).toBe(true);
    expect(f.getVariation("source")).toBe("treatment");
    expect(d.features.source).not.toHaveProperty("traffic");
  });

  test("orders callbacks, short circuits and memoizes condition reads within the root call", () => {
    const reads: string[] = [];
    const f = createFeaturevisor({
      datafile: datafile([
        flag,
        flag,
        value,
        { or: [country, { variable: "unused", operator: "isNull" }] },
      ]),
      logLevel: "fatal",
      modules: [
        {
          beforeEvaluation(o) {
            if (o.dependencyPurpose)
              reads.push(
                `${o.dependencyPurpose}:${"featureKey" in o ? o.featureKey : o.variableKey}`,
              );
            return o;
          },
        },
      ],
    });
    expect(f.isEnabled("subject", { country: "nl" })).toBe(true);
    expect(reads).toEqual(["condition:source", "condition:limit"]);
    expect(f.isEnabled("subject", { country: "nl" })).toBe(true);
    expect(reads).toEqual([
      "condition:source",
      "condition:limit",
      "condition:source",
      "condition:limit",
    ]);
  });

  test("a composed gate skips sources and overrides on failure", () => {
    const reads: string[] = [];
    const d = datafile({ feature: "missing" });
    d.variables!.map.overrideProgram = [
      {
        key: "override",
        conditions: "*",
        operations: [{ op: "set", path: [], value: { limit: 99 } }],
        onMatch: 1,
        onMiss: 1,
      },
    ];
    const f = createFeaturevisor({
      datafile: d,
      logLevel: "fatal",
      modules: [
        {
          beforeEvaluation(o) {
            reads.push(o.variableKey || ("featureKey" in o ? o.featureKey : "") || "");
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("map")).toEqual({ limit: 0 });
    expect(reads).toEqual(["map", "missing"]);
    expect(f.getVariable("map")).not.toBe(f.getVariable("map"));
    expect(f.getVariable("map")).not.toBe(d.variables!.map.disabledValue);
    expect(f.getVariable("alias")).toBeNull();
    f.setStickyVariables({ map: { limit: 20 } });
    reads.length = 0;
    expect(f.getVariable("map")).toEqual({ limit: 20 });
    expect(reads).toEqual(["map"]);
  });

  test("uses child context and both sticky maps for condition dependencies", () => {
    const f = createFeaturevisor({ datafile: datafile("eligible"), logLevel: "fatal" });
    const child = f.spawn(
      { country: "nl" },
      { stickyFeatures: { source: { enabled: true } }, stickyVariables: { limit: 12 } },
    );
    expect(child.isEnabled("subject")).toBe(true);
    child.setStickyVariables({ limit: 1 });
    expect(child.getVariable("subject")).toBe("disabled");
    expect(f.getVariable("subject", { country: "nl" })).toBe("selected");
  });

  test.each([[false], [0], [""], ["null"], [null], [[]], [{ nested: true }]])(
    "preserves alias disabledValue without coercion or a second JSON decode: %j",
    (disabledValue) => {
      const d = datafile({ feature: "missing" });
      d.variables!.limit = { type: "json", defaultValue: "1" };
      d.variables!.alias = {
        type: "json",
        compose: "limit",
        conditions: { feature: "missing" },
        disabledValue,
      };
      const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
      expect(f.getVariable("alias")).toBe(disabledValue);
      expect(f.evaluateVariable("alias")).toMatchObject({
        reason: "conditions_unmet",
        variableValue: disabledValue,
      });
    },
  );

  test.each(["self", "segments", "feature", "variable"])(
    "fails the whole evaluation for a %s segment cycle, including inside NOT",
    (kind) => {
      const d = datafile({ not: ["cycle"] });
      d.segments.cycle = {
        conditions:
          kind === "self"
            ? "cycle"
            : kind === "segments"
              ? "other"
              : kind === "feature"
                ? { feature: "subject" }
                : { variable: "subject", operator: "notNull" },
      };
      d.segments.other = { conditions: "cycle" };
      const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
      expect(f.evaluateFlag("subject").reason).toBe("error");
      expect(f.isEnabled("subject")).toBe(false);
      expect(f.evaluateVariable("subject").reason).toBe("error");
      f.setDatafile({ ...createDatafile(), segments: { cycle: { conditions: "*" } } });
      expect(f.evaluateFlag("subject").reason).toBe("conditions_unmet");
    },
  );

  test("bounds malformed segment chains and cleans the session afterwards", () => {
    const d = datafile("s0");
    for (let i = 0; i < 260; i++)
      d.segments[`s${i}`] = { conditions: i === 259 ? "*" : `s${i + 1}` };
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.evaluateFlag("subject").reason).toBe("error");
    expect(f.isEnabled("source")).toBe(true);
  });

  test.each([
    [120, true],
    [140, false],
  ] as const)(
    "shares the depth bound across %s alternating segment and feature handoffs",
    (depth, matches) => {
      const d = datafile("s0");
      for (let i = 0; i < depth; i++) {
        d.segments[`s${i}`] = { conditions: { feature: `f${i}` } };
        d.features[`f${i}`] = createFeature({ conditions: i === depth - 1 ? "*" : `s${i + 1}` });
      }
      const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
      expect(f.isEnabled("subject")).toBe(matches);
      if (!matches) expect(f.evaluateFlag("subject").reason).toBe("error");
      expect(f.isEnabled("source")).toBe(true);
    },
  );

  test("normalizes v3 selectors once without changing frozen caller data", () => {
    const d = datafile("*");
    d.features.subject = createFeature({
      requiredFeatures: ["source"],
      traffic: [{ key: "legacy", segments: JSON.stringify(["dutch"]), percentage: 100000 }],
    });
    d.variables!.subject = {
      type: "string",
      defaultValue: "default",
      overrides: [
        { key: "legacy", segments: "dutch", requiredFeatures: ["source"], value: "selected" },
      ],
    };
    const before = JSON.stringify(d);
    const freeze = (value: any): void => {
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
    };
    freeze(d);
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.isEnabled("subject", { country: "nl" })).toBe(true);
    expect(f.getVariable("subject", { country: "nl" })).toBe("selected");
    expect(f.getFeature("subject")).toEqual(normalizeDatafile(d).features.subject);
    expect(JSON.stringify(d)).toBe(before);
    f.setDatafile(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  test("ANDs new and legacy selectors and ignores unreleased requiredVariables and pre 3.7 required", () => {
    const d = datafile("*");
    d.features.subject = createFeature({
      conditions: country,
      requiredFeatures: ["source"],
      traffic: [{ key: "all", conditions: value, segments: "dutch", percentage: 100000 }],
    });
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.isEnabled("subject", { country: "de" })).toBe(false);
    expect(f.isEnabled("subject", { country: "nl" })).toBe(true);
    f.setStickyFeatures({ source: { enabled: false } });
    expect(f.isEnabled("subject", { country: "nl" })).toBe(false);
    const ignored = datafile("*");
    Object.assign(ignored.features.subject, {
      required: ["missing"],
      requiredVariables: [{ variable: "missing", operator: "notNull" }],
    });
    expect(createFeaturevisor({ datafile: ignored, logLevel: "fatal" }).isEnabled("subject")).toBe(
      true,
    );
  });

  test("propagates partial changes through feature to segment to feature and variable", () => {
    const d = datafile("eligible");
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    const events: Array<{ features: string[]; variables: string[] }> = [];
    f.on("datafile_set", (event) => events.push(event));
    f.setDatafile({ ...createDatafile(), features: { source: createFeature({ traffic: [] }) } });
    expect(events[0].features).toContain("subject");
    expect(events[0].variables).toEqual(expect.arrayContaining(["subject", "alias", "map"]));
    expect(f.isEnabled("subject", { country: "nl" })).toBe(false);
  });
});
