import type { ParsedVariableOverride, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import {
  buildVariableOverrideProgram,
  compileVariableMutation,
  hasContinuingVariableOverrides,
  hasVariableOverrideMutations,
} from "./variableOverrideProgram";
import { applyContextToDatafile } from "./applyContextToDatafile";
import { refreshDatafileHashes } from "./hashes";

describe("variable override program compiler", () => {
  test("detects mutations at any depth without treating literal values as mutations", () => {
    expect(hasVariableOverrideMutations(undefined)).toBe(false);
    expect(hasVariableOverrideMutations([])).toBe(false);
    const tree: ParsedVariableOverride[] = [
      {
        key: "parent",
        conditions: "*",
        value: { mutate: true },
        overrides: [{ key: "child", conditions: "*", value: {} }],
      },
    ];
    expect(hasVariableOverrideMutations(tree)).toBe(false);
    tree[0].overrides = [{ key: "child", conditions: "*", mutate: { colour: "blue" } }];
    expect(hasVariableOverrideMutations(tree)).toBe(true);
  });
  test.each(["appendUnique", "removeValue"])("compiles %s for root and nested arrays", (op) => {
    expect(compileVariableMutation(`:${op}`, null)).toEqual({ op, path: [], value: null });
    expect(compileVariableMutation(`rows[id=a].tags:${op}`, "x")).toEqual({
      op,
      path: ["rows", { select: { property: "id", values: ["a"] } }, "tags"],
      value: "x",
    });
    for (const value of [{}, [], undefined, Infinity, NaN]) {
      expect(() => compileVariableMutation(`tags:${op}`, value)).toThrow(
        "requires a primitive value",
      );
    }
  });
  test.each(["set", "append", "prepend", "before", "after", "remove"])("compiles %s", (op) => {
    const notation = `rows[id=123]${op === "set" ? "" : `:${op}`}`;
    expect(compileVariableMutation(notation, { id: 4 })).toEqual({
      op,
      path: ["rows", { select: { property: "id", values: ["123", 123] } }],
      ...(op === "remove" ? {} : { value: { id: 4 } }),
    });
  });

  test.each([
    "",
    ".x",
    "x..y",
    "x.",
    "x.[0]",
    "x[-1]",
    "x[1.5]",
    "x[01]",
    "x[",
    "x[]",
    "x:unknown",
    "x:before",
    "__proto__.x",
    "x[constructor=a]",
    "x[0]trailing",
  ])("rejects %s", (notation) => {
    expect(() => compileVariableMutation(notation, 1)).toThrow("Invalid mutation notation");
  });

  test("compiles paths and selector candidates without runtime coercion", () => {
    expect(compileVariableMutation("rows[0].items[id='001'].value", 2).path).toEqual([
      "rows",
      0,
      "items",
      { select: { property: "id", values: ["001"] } },
      "value",
    ]);
    expect(compileVariableMutation("[enabled=true]", 2).path).toEqual([
      { select: { property: "enabled", values: ["true", true] } },
    ]);
    expect(compileVariableMutation(":append", [1])).toEqual({ op: "append", path: [], value: [1] });
  });

  function fixture(mask: number): ParsedVariableOverride[] {
    const node = (
      key: string,
      index: number,
      overrides?: ParsedVariableOverride[],
    ): ParsedVariableOverride => ({
      key,
      conditions: [{ attribute: key, operator: "equals", value: true }],
      continue: Boolean(mask & (1 << index)),
      mutate: { ":append": key },
      ...(overrides ? { overrides } : {}),
    });
    return [node("a", 0, [node("b", 1, [node("c", 2)]), node("d", 3)]), node("e", 4)];
  }

  test("all branch combinations agree with independent recursive sibling semantics", () => {
    // Exhaust all continuation and predicate choices, not just representative examples.
    for (let continuation = 0; continuation < 32; continuation++) {
      const overrides = fixture(continuation);
      const program = buildVariableOverrideProgram(overrides, true);
      for (let predicates = 0; predicates < 32; predicates++) {
        const context = Object.fromEntries(
          ["a", "b", "c", "d", "e"].map((key, index) => [key, Boolean(predicates & (1 << index))]),
        );
        const expected: string[] = [];
        const paths: string[][] = [];
        const visit = (siblings: ParsedVariableOverride[], parent: string[] = []) => {
          for (const node of siblings) {
            if (!context[node.key]) continue;
            expected.push(node.key);
            const path = [...parent, node.key];
            paths.push(path);
            visit(node.overrides || [], path);
            if (!node.continue) break;
          }
        };
        visit(overrides);
        const f = createFeaturevisor({
          logLevel: "fatal",
          datafile: {
            schemaVersion: "2",
            revision: "test",
            features: {},
            segments: {},
            variables: { policy: { type: "array", defaultValue: [], overrideProgram: program } },
          },
        });
        const evaluation = f.evaluateVariable("policy", context);
        expect(evaluation.variableValue).toEqual(expected);
        expect(evaluation.variableOverridePaths || []).toEqual(paths);
        f.close();
      }
      program.forEach((step, index) => {
        expect(step.onMatch).toBeGreaterThan(index);
        expect(step.onMiss).toBeGreaterThan(index);
        expect(step.onMatch).toBeLessThanOrEqual(program.length);
        expect(step.onMiss).toBeLessThanOrEqual(program.length);
      });
    }
  });

  test("only true opts a tree into the new format", () => {
    expect(hasContinuingVariableOverrides(undefined)).toBe(false);
    expect(
      hasContinuingVariableOverrides([{ key: "a", conditions: "*", value: 1, continue: false }]),
    ).toBe(false);
    expect(
      hasContinuingVariableOverrides([
        {
          key: "a",
          conditions: "*",
          value: 1,
          overrides: [{ key: "b", conditions: "*", value: 2, continue: true }],
        },
      ]),
    ).toBe(true);
  });

  test("target specialization keeps jumps and dependencies correct", () => {
    const original: DatafileContent = {
      schemaVersion: "2",
      revision: "test",
      features: {},
      segments: { nl: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] } },
      variables: {
        policy: {
          type: "array",
          defaultValue: [],
          overrideProgram: buildVariableOverrideProgram(
            [
              {
                key: "country",
                conditions: "nl",
                mutate: { ":append": "nl" },
                continue: true,
                overrides: [
                  {
                    key: "city",
                    conditions: [{ attribute: "city", operator: "equals", value: "amsterdam" }],
                    mutate: { ":append": "city" },
                  },
                ],
              },
              { key: "end", conditions: "*", mutate: { ":append": "end" } },
            ],
            true,
          ),
        },
      },
    };
    refreshDatafileHashes(original);
    const beforeHash = original.variables!.policy.hash;
    const targeted = applyContextToDatafile(original, { country: "nl" });
    expect(
      targeted.variables!.policy.overrideProgram!.map(({ onMatch, onMiss }) => [onMatch, onMiss]),
    ).toEqual(
      original.variables!.policy.overrideProgram!.map(({ onMatch, onMiss }) => [onMatch, onMiss]),
    );
    const full = createFeaturevisor({ datafile: original, logLevel: "fatal" });
    const target = createFeaturevisor({ datafile: targeted, logLevel: "fatal" });
    for (const city of ["amsterdam", "other"]) {
      expect(target.getVariable("policy", { city })).toEqual(
        full.getVariable("policy", { country: "nl", city }),
      );
    }
    original.segments.nl.conditions = "*";
    refreshDatafileHashes(original);
    expect(original.variables!.policy.hash).not.toBe(beforeHash);
  });
});
