import type { Context, DatafileContent, Condition } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import { probeConditions } from "./probeConditions";

const datafile: DatafileContent = {
  schemaVersion: "2",
  revision: "probe",
  segments: {},
  features: {
    source: {
      bucketBy: "userId",
      traffic: [],
      variablesSchema: {
        config: {
          type: "json",
          defaultValue: '{"limits.v2":[null,false]}',
          useDefaultWhenDisabled: true,
        },
      },
    },
  },
  variables: {
    nullValue: { type: "json", defaultValue: null },
    config: { type: "json", defaultValue: '{"items":[0,false]}' },
    text: { type: "string", defaultValue: "abc" },
  },
};

const probe = (requirements: Condition[], context: Context = {}) =>
  probeConditions(datafile, context, requirements);

describe("supplementary required variable probes", () => {
  test("records attribute, segment, feature and variable evidence for mixed groups", () => {
    const mixed: DatafileContent = {
      ...datafile,
      segments: {
        audience: {
          conditions: [
            { attribute: "user.country", operator: "equals", value: "nl" },
            { feature: "source", enabled: false },
          ],
        },
      },
    };
    const result = probeConditions(mixed, { user: { country: "nl" } }, [
      "audience",
      { feature: "source", enabled: false },
      { variable: "config", path: ["items", 0], operator: "equals", value: 0 },
    ]);
    expect(result).toMatchObject({ passed: true, reliable: true });
    const leaves = result.expression.children!;
    expect(leaves.map((leaf) => leaf.leafKind)).toEqual(["segment", "feature", "variable"]);
    expect(leaves[0].children![0].children![0]).toMatchObject({
      leafKind: "attribute",
      attribute: "user.country",
      operand: "nl",
      passed: true,
    });
    expect(leaves[1]).toMatchObject({ operand: { enabled: false }, expected: { enabled: false } });
    expect(leaves[2]).toMatchObject({ operand: 0, operandPresent: true });
  });

  test("wildcards, missing segments and empty groups retain SDK meanings", () => {
    expect(probeConditions(datafile, {}, "*")).toMatchObject({ passed: true, reliable: true });
    expect(probeConditions(datafile, {}, "missing")).toMatchObject({
      passed: false,
      reliable: true,
    });
    for (const conditions of [[], { and: [] }, { or: [] }, { not: [] }])
      expect(probeConditions(datafile, {}, conditions)).toMatchObject({
        passed: false,
        reliable: true,
      });
  });

  test("a malformed segment cycle is inconclusive rather than an infinite probe", () => {
    const cyclic = { ...datafile, segments: { a: { conditions: "b" }, b: { conditions: "a" } } };
    expect(probeConditions(cyclic, {}, "a")).toMatchObject({ reliable: false });
  });
  test("uses SDK getter semantics for global and feature JSON values", () => {
    const result = probe([
      { variable: "config", path: ["items", 1], operator: "equals", value: false },
      { feature: "source", variable: "config", path: ["limits.v2", 0], operator: "isNull" },
    ]);
    expect(result.passed).toBe(true);
    expect(result.expression.children?.map((leaf) => leaf.operand)).toEqual([false, null]);
    expect(result.expression.children?.map((leaf) => leaf.operandPresent)).toEqual([true, true]);
  });

  test("distinguishes a null getter result from a missing own path", () => {
    const result = probe([
      { variable: "missing", operator: "isNull" },
      { variable: "nullValue", operator: "isNull" },
      { variable: "config", path: ["absent"], operator: "notExists" },
      { variable: "config", path: ["__proto__"], operator: "exists" },
    ]);
    expect(
      result.expression.children?.slice(0, 3).map((leaf) => [leaf.passed, leaf.operandPresent]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, false],
    ]);
    expect(result.reliable).toBe(false);
    expect(result.expression.children?.[3].error).toContain("Unsafe");
  });

  test("reports and/or/not outcomes including leaves not reached by SDK short circuiting", () => {
    const result = probe([
      {
        or: [
          { variable: "nullValue", operator: "isNull" },
          { variable: "config", path: ["absent"], operator: "exists" },
        ],
      },
      { not: [{ variable: "config", path: ["items", 1], operator: "equals", value: true }] },
    ]);
    expect(result.passed).toBe(true);
    expect(result.expression.children?.[0]).toMatchObject({ kind: "or", passed: true });
    expect(result.expression.children?.[0].children?.map((leaf) => leaf.passed)).toEqual([
      true,
      false,
    ]);
    expect(result.expression.children?.[1]).toMatchObject({ kind: "not", passed: true });
  });

  test("uses SDK matcher for an unknown operator and isolates malformed regex diagnostics", () => {
    const unknown = probe([{ variable: "config", operator: "notAnOperator" as never }]);
    expect(unknown).toMatchObject({ passed: false, reliable: true });
    const originalDiagnostics: string[] = [];
    const original = createFeaturevisor({
      datafile,
      onDiagnostic: (entry) => originalDiagnostics.push(entry.code),
    });
    expect(original.getVariable("nullValue")).toBeNull();
    const before = [...originalDiagnostics];
    const malformed = probe([{ variable: "text", operator: "matches", value: "[" }]);
    expect(malformed.reliable).toBe(false);
    expect(malformed.expression.children?.[0].error).toBeDefined();
    expect(originalDiagnostics).toEqual(before);
  });

  test("rejects an uncompiled string path without treating it as character components", () => {
    const malformed = probe([{ variable: "config", path: "items.0" as never, operator: "exists" }]);
    expect(malformed.reliable).toBe(false);
    expect(malformed.expression.children?.[0]).toMatchObject({
      reliable: false,
      error: "Variable requirement path must be compiled",
    });
  });
});
