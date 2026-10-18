import { createFeaturevisor } from "./instance";
import type { DatafileContent, DatafileComposeEntry } from "@featurevisor/types";

function fixture(
  compose: DatafileComposeEntry[] = [
    { key: "flag", feature: "checkout" },
    { key: "variation", feature: "checkout", variation: true },
    { key: "label", feature: "checkout", variable: "label" },
    { key: "config", variable: "policy" },
    { key: "json", variable: "raw" },
  ],
): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "composition",
    segments: {},
    features: {
      checkout: {
        bucketBy: "userId",
        variations: [{ value: "express", variables: { label: "Buy now" } }],
        disabledVariationValue: "closed",
        variablesSchema: {
          label: { type: "string", defaultValue: "Buy", disabledValue: "Unavailable" },
        },
        traffic: [
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
            allocation: [{ variation: "express", range: [0, 100000] }],
          },
        ],
      },
    },
    variables: {
      policy: { type: "object", defaultValue: { limit: 50 } },
      raw: { type: "json", defaultValue: '{"enabled":true}' },
      screen: { type: "object", compose },
    },
  };
}
const context = { userId: "example-user" };

describe("composed variables", () => {
  it("assembles all four getter forms, decoding JSON sources without transforming the result", () => {
    const f = createFeaturevisor({ datafile: fixture() });
    expect(f.getVariable("screen", context)).toEqual({
      flag: true,
      variation: "express",
      label: "Buy now",
      config: { limit: 50 },
      json: { enabled: true },
    });
    expect(f.evaluateVariable("screen", context).reason).toBe("variable_composed");
    expect(f.getVariableObject("screen", context)).toEqual(f.getVariable("screen", context));
    expect(f.getVariableString("screen", context)).toBeNull();
  });
  it("uses disabled variation and variable fallbacks independently of the flag", () => {
    const datafile = fixture();
    datafile.features.checkout.traffic[0].percentage = 0;
    const f = createFeaturevisor({ datafile });
    const result = f.getVariable("screen", context);
    expect(result).toEqual({
      flag: false,
      variation: "closed",
      label: "Unavailable",
      config: { limit: 50 },
      json: { enabled: true },
    });
    expect((result as Record<string, unknown>).variation).toBe(f.getVariation("checkout", context));
  });
  it("retains missing reference fallbacks without gating siblings or propagating caller defaults", () => {
    const f = createFeaturevisor({
      datafile: fixture([
        { key: "flag", feature: "missing" },
        { key: "variation", feature: "missing", variation: true },
        { key: "value", variable: "missing" },
        { key: "ok", variable: "policy" },
      ]),
      logLevel: "fatal",
    });
    expect(f.getVariable("screen", context, { defaultVariableValue: { fallback: true } })).toEqual({
      flag: false,
      variation: null,
      value: null,
      ok: { limit: 50 },
    });
  });
  it("evaluates nested compositions and returns a fresh outer object", () => {
    const datafile = fixture();
    datafile.variables!.nested = {
      type: "object",
      compose: [{ key: "screen", variable: "screen" }],
    };
    const f = createFeaturevisor({ datafile });
    const first = f.getVariable<{ screen: unknown }>("nested", context)!;
    expect(first).toEqual({
      screen: {
        flag: true,
        variation: "express",
        label: "Buy now",
        config: { limit: 50 },
        json: { enabled: true },
      },
    });
    expect(f.getVariable("nested", context)).not.toBe(first);
    expect(datafile.variables!.policy.defaultValue).toEqual({ limit: 50 });
  });
  it("uses whole variable sticky state without evaluating members", () => {
    const seen: string[] = [];
    const f = createFeaturevisor({
      datafile: fixture(),
      stickyVariables: { screen: { sticky: true } },
      modules: [
        {
          name: "counter",
          beforeEvaluation: (o) => {
            seen.push(o.variableKey || ("featureKey" in o ? o.featureKey : "") || "");
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("screen", context)).toEqual({ sticky: true });
    expect(seen).toEqual(["screen"]);
  });
  it("tags dependencies, honours module rewrites and memoizes repeated references only within each read", () => {
    const seen: unknown[] = [];
    const f = createFeaturevisor({
      datafile: fixture([
        { key: "a", variable: "policy" },
        { key: "b", variable: "policy" },
      ]),
      modules: [
        {
          name: "tracking",
          beforeEvaluation: (o) => {
            if (o.variableKey === "policy") seen.push(o.dependencyOf);
            return o;
          },
          afterEvaluation: (e) =>
            e.variableKey === "policy" ? { ...e, variableValue: { limit: 60 } } : e,
        },
      ],
    });
    expect(f.getVariable("screen", context)).toEqual({ a: { limit: 60 }, b: { limit: 60 } });
    expect(seen).toEqual([{ type: "variable", variableKey: "screen" }]);
    f.getVariable("screen", context);
    expect(seen).toHaveLength(2);
  });
  it("preserves child context and sticky overrides", () => {
    const f = createFeaturevisor({ datafile: fixture() });
    const child = f.spawn(context);
    child.setStickyFeatures({
      checkout: { enabled: false, variation: "closed", variables: { label: "Child" } },
    });
    child.setStickyVariables({ policy: { limit: 80 } });
    expect(child.getVariable("screen")).toEqual({
      flag: false,
      variation: "closed",
      label: "Unavailable",
      config: { limit: 80 },
      json: { enabled: true },
    });
    expect(f.getVariable<{ flag: boolean }>("screen", context)!.flag).toBe(true);
  });
  it("keeps a module supplied null variation consistent with the public getter", () => {
    const f = createFeaturevisor({
      datafile: fixture(),
      modules: [
        {
          name: "null-variation",
          afterEvaluation: (e) =>
            e.type === "variation" ? { ...e, variationValue: null as unknown as string } : e,
        },
      ],
    });
    expect(f.getVariation("checkout", context)).toBeNull();
    expect(f.getVariable<{ variation: unknown }>("screen", context)!.variation).toBeNull();
  });
  it.each(["direct", "indirect", "feature"])(
    "fails the complete evaluation for a %s cycle",
    (kind) => {
      const datafile = fixture([
        { key: "good", variable: "policy" },
        { key: "cycle", variable: kind === "direct" ? "screen" : "other" },
      ]);
      datafile.variables!.other =
        kind === "feature"
          ? { type: "object", compose: [{ key: "flag", feature: "checkout" }] }
          : { type: "object", compose: [{ key: "back", variable: "screen" }] };
      if (kind === "feature")
        datafile.features.checkout.conditions = [{ variable: "screen", operator: "notNull" }];
      const f = createFeaturevisor({ datafile, logLevel: "fatal" });
      expect(f.evaluateVariable("screen", context).reason).toBe("error");
      expect(f.getVariable("screen", context)).toBeNull();
    },
  );
  it.each(["__proto__", "prototype", "constructor"])(
    "rejects unsafe external property %s",
    (key) => {
      const f = createFeaturevisor({
        datafile: fixture([{ key, variable: "policy" }]),
        logLevel: "fatal",
      });
      expect(f.evaluateVariable("screen", context).reason).toBe("error");
      expect(f.getVariable("screen", context)).toBeNull();
      expect(({} as Record<string, unknown>).limit).toBeUndefined();
    },
  );
  it("returns a normal object with literal properties and borrowed source values", () => {
    const f = createFeaturevisor({
      datafile: fixture([{ key: "literal.dot/slash", variable: "policy" }]),
    });
    const result = f.getVariable<Record<string, unknown>>("screen", context)!;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["literal.dot/slash"]);
    expect(result["literal.dot/slash"]).toBe(f.getVariable("policy", context));
    delete result["literal.dot/slash"];
    expect(f.getVariable("screen", context)).toEqual({ "literal.dot/slash": { limit: 50 } });
  });
  it("never traverses borrowed result fields to create a composition memo", () => {
    let traversals = 0;
    const value = {
      get field() {
        traversals++;
        return { large: true };
      },
    };
    const datafile = fixture([
      { key: "a", variable: "policy" },
      { key: "b", variable: "policy" },
    ]);
    datafile.variables!.policy = { type: "object", defaultValue: value };
    const f = createFeaturevisor({ datafile });
    const result = f.getVariable<{ a: unknown; b: unknown }>("screen", context)!;
    expect(result.a).toBe(f.getVariable("policy", context));
    expect(result.b).toBe(result.a);
    expect(traversals).toBe(0);
  });
  it("exposes composition purpose to both module callbacks", () => {
    const seen: unknown[][] = [];
    const f = createFeaturevisor({
      datafile: fixture(),
      modules: [
        {
          name: "exposure",
          beforeEvaluation(o) {
            seen.push(["before", o.dependencyPurpose]);
            return o;
          },
          afterEvaluation(e, o) {
            seen.push(["after", o.dependencyPurpose]);
            return e;
          },
        },
      ],
    });
    f.getVariable("screen", context);
    expect(seen.filter(([, purpose]) => purpose === "composition")).toHaveLength(10);
    expect(seen[0]).toEqual(["before", undefined]);
    expect(seen[seen.length - 1]).toEqual(["after", undefined]);
  });
  it("fails the entire result when a defensive dependency depth bound is exceeded", () => {
    const datafile = fixture([{ key: "next", variable: "chain0" }]);
    for (let index = 0; index < 260; index++) {
      datafile.variables![`chain${index}`] = {
        type: "object",
        compose: [{ key: "next", variable: index === 259 ? "policy" : `chain${index + 1}` }],
      };
    }
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    expect(f.evaluateVariable("screen", context).reason).toBe("error");
    expect(f.getVariable("screen", context)).toBeNull();
    expect(f.getVariable("policy", context)).toEqual({ limit: 50 });
  });
  it.each([1, 32, 255, 256, 257])("handles exactly %i internal dependency handoffs", (reads) => {
    const datafile = fixture([{ key: "next", variable: reads === 1 ? "policy" : "chain0" }]);
    for (let index = 0; index < reads - 1; index++)
      datafile.variables![`chain${index}`] = {
        type: "object",
        compose: [{ key: "next", variable: index === reads - 2 ? "policy" : `chain${index + 1}` }],
      };
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    const result = f.evaluateVariable("screen", context);
    expect(result.reason).toBe(reads > 256 ? "error" : "variable_composed");
    if (reads <= 256) {
      let value: unknown = result.variableValue;
      for (let index = 0; index < reads; index++) value = (value as { next: unknown }).next;
      expect(value).toEqual({ limit: 50 });
    }
    f.close();
  });
  it("propagates source updates and removals through composition chains", () => {
    const datafile = fixture();
    datafile.variables!.nested = {
      type: "object",
      compose: [{ key: "screen", variable: "screen" }],
    };
    const f = createFeaturevisor({ datafile });
    const changes: string[][] = [];
    f.on("datafile_set", (details) => changes.push(details.variables || []));
    f.setDatafile({
      schemaVersion: "2",
      revision: "partial",
      segments: {},
      features: {},
      variables: { policy: { type: "object", defaultValue: { limit: 80 } } },
    });
    expect(changes[0]).toEqual(expect.arrayContaining(["policy", "screen", "nested"]));
    expect(f.getVariable<{ config: unknown }>("screen", context)!.config).toEqual({ limit: 80 });
    const replacement = fixture();
    delete replacement.variables!.policy;
    f.setDatafile(replacement, true);
    expect(f.getVariable<{ config: unknown }>("screen", context)!.config).toBeNull();
  });
  it("does not memoize a source across a callback state change", () => {
    let reads = 0;
    const f = createFeaturevisor({
      datafile: fixture([
        { key: "a", variable: "policy" },
        { key: "b", variable: "policy" },
      ]),
      modules: [
        {
          name: "state",
          afterEvaluation: (e) => {
            if (e.variableKey === "policy" && ++reads === 1)
              f.setStickyVariables({ policy: { limit: 90 } });
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("screen", context)).toEqual({ a: { limit: 50 }, b: { limit: 90 } });
  });
  it("uses the root module's effective context for every member without remerging stored context", () => {
    const seen: unknown[] = [];
    const f = createFeaturevisor({
      datafile: fixture(),
      context: { country: "stored" },
      modules: [
        {
          name: "context",
          beforeEvaluation(o) {
            if (!o.dependencyOf) return { ...o, context: { country: "effective" } };
            seen.push(o.context);
            return o;
          },
        },
      ],
    });
    f.getVariable("screen", context);
    expect(seen).toHaveLength(5);
    for (const effective of seen) expect(effective).toEqual({ country: "effective" });
  });
  it("invalidates borrowed memo entries when a later source mutates context", () => {
    let reads = 0;
    const datafile = fixture([
      { key: "a", variable: "policy" },
      { key: "b", variable: "raw" },
      { key: "c", variable: "policy" },
    ]);
    const f = createFeaturevisor({
      datafile,
      modules: [
        {
          name: "changes",
          beforeEvaluation(o) {
            if (o.variableKey === "raw") o.context.changed = true;
            return o;
          },
          afterEvaluation(e, o) {
            if (e.variableKey === "policy") {
              reads++;
              return { ...e, variableValue: o.context.changed ? 2 : 1 };
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("screen", context)).toEqual({ a: 1, b: { enabled: true }, c: 2 });
    expect(reads).toBe(2);
  });
  it("keeps requirement snapshots owned when a composed source is later mutated", () => {
    const datafile = fixture([
      { key: "first", variable: "policy" },
      { key: "flag", feature: "checkout" },
      { key: "last", variable: "policy" },
    ]);
    datafile.features.checkout.conditions = [
      {
        and: [
          { variable: "policy", path: ["limit"], operator: "equals", value: 50 },
          { variable: "raw", operator: "notNull" },
          { variable: "policy", path: ["limit"], operator: "equals", value: 50 },
        ],
      },
    ];
    const purposes: unknown[] = [];
    const f = createFeaturevisor({
      datafile,
      modules: [
        {
          name: "ownership",
          beforeEvaluation(o) {
            if (o.variableKey === "policy") purposes.push(o.dependencyPurpose);
            if (o.variableKey === "raw" && o.dependencyPurpose === "condition")
              (datafile.variables!.policy.defaultValue as { limit: number }).limit = 80;
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("screen", context)).toEqual({
      first: { limit: 80 },
      flag: true,
      last: { limit: 80 },
    });
    expect(purposes).toEqual(["composition", "condition"]);
    expect(f.getVariable("policy", context)).toEqual({ limit: 80 });
  });
});
