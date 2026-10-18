import type { VariableMutationOperation, VariableValue } from "@featurevisor/types";

import { applyVariableOperations } from "./mutations";

function apply(value: unknown, operations: VariableMutationOperation[]): VariableValue {
  return applyVariableOperations(value as VariableValue, operations);
}

describe("sdk: variable mutations", function () {
  describe.each(["appendUnique", "removeValue"] as const)("%s", (op) => {
    test.each(["x", 1, true, false, null, 0])("uses strict primitive equality for %p", (item) => {
      const input = ["1", 1, true, false, null, 0, "x", item];
      const operation = { op, path: [], value: item };
      const result = apply(input, [operation]);
      expect(result).toEqual(op === "appendUnique" ? input : input.filter((v) => v !== item));
      expect(apply(result, [operation])).toEqual(result);
      expect(input[input.length - 1]).toBe(item);
    });

    test("handles root arrays, properties, indices and selectors", () => {
      const operation = { op, value: "x" };
      const expected = op === "appendUnique" ? ["a", "x"] : ["a"];
      const base = op === "appendUnique" ? ["a"] : ["a", "x", "x"];
      expect(apply(base, [{ ...operation, path: [] }])).toEqual(expected);
      expect(apply({ tags: base }, [{ ...operation, path: ["tags"] }])).toEqual({ tags: expected });
      expect(apply([base], [{ ...operation, path: [0] }])).toEqual([expected]);
      expect(
        apply(
          [{ id: "a", tags: base }],
          [
            {
              ...operation,
              path: [{ select: { property: "id", values: ["a"] } }, "tags"],
            },
          ],
        ),
      ).toEqual([{ id: "a", tags: expected }]);
    });

    test("preserves identity when nothing changes and never creates intermediate paths", () => {
      const base = { tags: ["x"], other: { unchanged: true } };
      const operand = op === "appendUnique" ? "x" : "absent";
      expect(apply(base, [{ op, path: ["tags"], value: operand }])).toBe(base);
      for (const path of [
        ["missing", "tags"],
        ["tags", 10],
        ["tags", { select: { property: "id", values: ["absent"] } }],
      ]) {
        expect(apply(base, [{ op, path, value: operand }])).toBe(base);
      }
      expect(apply(null, [{ op, path: [], value: operand }])).toBeNull();
      const next = apply(base, [
        { op, path: ["tags"], value: op === "appendUnique" ? "new" : "x" },
      ]) as typeof base;
      expect(next.other).toBe(base.other);
      expect(base.tags).toEqual(["x"]);
    });

    test.each([{}, [], ["x"], undefined, NaN, Infinity, -Infinity])(
      "rejects nonprimitive operands even on a missing path: %p",
      (value) => {
        expect(() =>
          apply({}, [{ op, path: ["absent", "tags"], value } as VariableMutationOperation]),
        ).toThrow(/requires a (primitive )?value/);
      },
    );

    test.each(["not an array", 3, true, {}])("rejects a nonarray target %p", (value) => {
      expect(() => apply(value, [{ op, path: [], value: "x" }])).toThrow("expected an array");
      expect(() => apply({ tags: value }, [{ op, path: ["tags"], value: "x" }])).toThrow(
        "expected an array",
      );
    });
  });

  test("unique append does not deduplicate existing items or coerce values", () => {
    expect(apply(["1", "1"], [{ op: "appendUnique", path: [], value: 1 }])).toEqual(["1", "1", 1]);
    expect(
      apply(["false", false, 0, null], [{ op: "removeValue", path: [], value: false }]),
    ).toEqual(["false", 0, null]);
    expect(apply([-0], [{ op: "appendUnique", path: [], value: 0 }])).toEqual([-0]);
  });

  test("unique append creates missing final arrays but removal does not", () => {
    expect(apply({}, [{ op: "appendUnique", path: ["tags"], value: null }])).toEqual({
      tags: [null],
    });
    expect(apply({ tags: null }, [{ op: "appendUnique", path: ["tags"], value: true }])).toEqual({
      tags: [true],
    });
    expect(apply({}, [{ op: "removeValue", path: ["tags"], value: null }])).toEqual({});
    expect(apply({ tags: null }, [{ op: "removeValue", path: ["tags"], value: null }])).toEqual({
      tags: null,
    });
    expect(apply([null], [{ op: "appendUnique", path: [0], value: true }])).toEqual([null]);
  });

  test("unique append and value removal compose in authored order", () => {
    const base = Object.freeze(["a", "b", "b"]);
    expect(
      apply(base, [
        { op: "removeValue", path: [], value: "b" },
        { op: "appendUnique", path: [], value: "b" },
        { op: "appendUnique", path: [], value: "b" },
        { op: "removeValue", path: [], value: "a" },
      ]),
    ).toEqual(["b"]);
    expect(base).toEqual(["a", "b", "b"]);
  });

  it("sets roots, object properties, array items, and selected elements", function () {
    const object = { enabled: false, items: [{ id: 1 }, { id: 2 }] };

    expect(apply(object, [{ op: "set", path: ["enabled"], value: true }])).toEqual({
      enabled: true,
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(apply(["a"], [{ op: "set", path: [1], value: "b" }])).toEqual(["a", "b"]);
    expect(apply(["a"], [{ op: "set", path: [2], value: "b" }])).toBeInstanceOf(Array);
    expect(apply(["a"], [{ op: "set", path: [2], value: "b" }])).toEqual(["a"]);
    expect(
      apply(object.items, [
        { op: "set", path: [{ select: { property: "id", values: [2] } }], value: { id: 20 } },
      ]),
    ).toEqual([{ id: 1 }, { id: 20 }]);
    expect(apply("old", [{ op: "set", path: [], value: "new" }])).toBe("new");
  });

  it("appends and prepends exactly one value, including nested arrays", function () {
    const arrayOperand = ["one", "two"];
    const input = { values: ["middle"], nested: { values: [2] } };
    const result = apply(input, [
      { op: "append", path: ["values"], value: arrayOperand },
      { op: "prepend", path: ["nested", "values"], value: 1 },
      { op: "append", path: ["created"], value: false },
    ]);

    expect(result).toEqual({
      values: ["middle", ["one", "two"]],
      nested: { values: [1, 2] },
      created: [false],
    });
    expect(apply([1], [{ op: "prepend", path: [], value: 0 }])).toEqual([0, 1]);
    expect(apply([1], [{ op: "append", path: [], value: [2, 3] }])).toEqual([1, [2, 3]]);
    expect(apply({ values: null }, [{ op: "append", path: ["values"], value: 1 }])).toEqual({
      values: [1],
    });
  });

  it("inserts before and after indexed or selected array items", function () {
    const value = [
      { id: "first", tags: ["a"] },
      { id: "second", tags: ["b"] },
      { id: "second", tags: ["c"] },
    ];

    const result = apply(value, [
      {
        op: "before",
        path: [{ select: { property: "id", values: ["second"] } }],
        value: { id: "new" },
      },
      { op: "after", path: [0], value: { id: "after-first" } },
      {
        op: "append",
        path: [{ select: { property: "id", values: ["second"] } }, "tags"],
        value: "x",
      },
    ]);

    expect(result).toEqual([
      { id: "first", tags: ["a"] },
      { id: "after-first" },
      { id: "new" },
      { id: "second", tags: ["b", "x"] },
      { id: "second", tags: ["c"] },
    ]);
  });

  it("removes object properties and array elements, with selectors resolving the first duplicate", function () {
    const value = {
      removeMe: true,
      rows: [
        { kind: "duplicate", values: [1] },
        { kind: "duplicate", values: [2] },
        { kind: "last", values: [3] },
      ],
    };

    const result = apply(value, [
      { op: "remove", path: ["removeMe"] },
      {
        op: "append",
        path: ["rows", { select: { property: "kind", values: ["duplicate"] } }, "values"],
        value: 9,
      },
      { op: "remove", path: ["rows", { select: { property: "kind", values: ["duplicate"] } }] },
    ]);

    expect(result).toEqual({
      rows: [
        { kind: "duplicate", values: [2] },
        { kind: "last", values: [3] },
      ],
    });
  });

  it("matches direct own primitive selector fields without coercion", function () {
    const inherited = Object.create({ id: 1 }) as { id?: number };
    const value = [{ id: "1" }, { id: 1 }, { id: null }, { id: false }, inherited] as VariableValue;

    expect(
      apply(value, [{ op: "remove", path: [{ select: { property: "id", values: [1] } }] }]),
    ).toEqual([{ id: "1" }, { id: null }, { id: false }, inherited]);
    expect(
      apply(value, [
        { op: "remove", path: [{ select: { property: "id", values: [null, false] } }] },
      ]),
    ).toEqual([{ id: "1" }, { id: 1 }, { id: false }, inherited]);
  });

  it("leaves missing, null, unmatched, and out-of-bounds paths unchanged", function () {
    const value = { absent: null, rows: [{ id: 1 }], values: [1] };
    const cases: VariableMutationOperation[][] = [
      [{ op: "set", path: ["missing", "child"], value: true }],
      [{ op: "set", path: ["absent", "child"], value: true }],
      [{ op: "remove", path: ["missing"] }],
      [{ op: "remove", path: ["values", 2] }],
      [{ op: "before", path: ["values", 4], value: 0 }],
      [{ op: "set", path: ["rows", { select: { property: "id", values: [2] } }], value: null }],
      [{ op: "append", path: ["rows", 4], value: null }],
    ];

    cases.forEach((operations) => {
      expect(apply(value, operations)).toBe(value);
    });
    expect(apply(null, [{ op: "append", path: [], value: false }])).toBeNull();
    expect(apply(null, [{ op: "set", path: ["child"], value: false }])).toBeNull();
  });

  it("keeps equivalent, absent, and null-targeted operations referentially stable", function () {
    const value = { item: "same", child: {}, rows: [{ id: "present" }], values: [1] };

    expect(apply(value, [{ op: "set", path: [], value }])).toBe(value);
    expect(apply(value, [{ op: "set", path: ["item"], value: "same" }])).toBe(value);
    expect(apply(value.values, [{ op: "set", path: [0], value: 1 }])).toBe(value.values);
    expect(apply(value, [{ op: "remove", path: ["child", "missing"] }])).toBe(value);
    expect(apply(value.rows, [{ op: "remove", path: [0, "missing"] }])).toBe(value.rows);
    expect(
      apply(value.rows, [
        {
          op: "set",
          path: [{ select: { property: "id", values: ["missing"] } }, "value"],
          value: 1,
        },
      ]),
    ).toBe(value.rows);
    expect(
      apply(
        [1, { id: "present" }],
        [
          {
            op: "set",
            path: [{ select: { property: "id", values: ["missing"] } }, "value"],
            value: 1,
          },
        ],
      ),
    ).toEqual([1, { id: "present" }]);
    expect(apply(null, [{ op: "remove", path: ["value"] }])).toBeNull();
    expect(apply(null, [{ op: "append", path: ["value"], value: 1 }])).toBeNull();
    expect(apply(null, [{ op: "after", path: [0], value: 1 }])).toBeNull();
    expect(apply(null, [{ op: "prepend", path: [], value: 1 }])).toBeNull();
  });

  it("copies only changed ancestors and treats NaN as a replacement", function () {
    const untouched = { stable: true };
    const changed = { value: 1 };
    const value = { untouched, nested: { changed } };
    const result = apply(value, [{ op: "set", path: ["nested", "changed", "value"], value: 2 }]);

    expect(result).not.toBe(value);
    expect((result as typeof value).untouched).toBe(untouched);
    expect((result as typeof value).nested).not.toBe(value.nested);
    expect((result as typeof value).nested.changed).not.toBe(changed);

    const numbers = [NaN] as unknown as VariableValue;
    const nanResult = apply(numbers, [
      { op: "set", path: [0], value: NaN as unknown as VariableValue },
    ]);
    expect(nanResult).not.toBe(numbers);
    expect((nanResult as unknown[])[0]).toBeNaN();
  });

  it("rejects malformed paths and all wrong non-null container shapes", function () {
    const invalid = (operations: unknown) =>
      applyVariableOperations({} as VariableValue, operations as VariableMutationOperation[]);

    expect(() => invalid(null)).toThrow("operations");
    expect(() => invalid([{}])).toThrow("operation");
    expect(() => invalid([{ op: "set", path: "not-an-array", value: 1 }])).toThrow("path");
    expect(() =>
      invalid([{ op: "set", path: [{ select: { property: "id", values: [{}] } }], value: 1 }]),
    ).toThrow("path");

    expect(() => apply({}, [{ op: "set", path: [0], value: 1 }])).toThrow("expected an array");
    expect(() =>
      apply({}, [{ op: "set", path: [{ select: { property: "id", values: [1] } }], value: 1 }]),
    ).toThrow("expected an array");
    expect(() => apply([1], [{ op: "set", path: [0], value: 2 }])).not.toThrow();
    expect(apply([1], [{ op: "set", path: [0], value: 2 }])).toEqual([2]);
    expect(() => apply(false, [{ op: "remove", path: ["value"] }])).toThrow("expected an object");
    expect(() => apply(false, [{ op: "remove", path: [0] }])).toThrow("expected an array");
    expect(() => apply(false, [{ op: "append", path: ["value"], value: 1 }])).toThrow(
      "expected an object",
    );
    expect(() => apply(false, [{ op: "append", path: [0], value: 1 }])).toThrow(
      "expected an array",
    );
    expect(() => apply([false], [{ op: "append", path: [0], value: 1 }])).toThrow(
      "expected an array",
    );
    expect(apply([[1]], [{ op: "append", path: [0], value: 2 }])).toEqual([[1, 2]]);
    expect(apply([[1]], [{ op: "prepend", path: [0], value: 0 }])).toEqual([[0, 1]]);
    expect(() =>
      apply(
        [{ id: "row" }],
        [{ op: "append", path: [{ select: { property: "id", values: ["row"] } }], value: 1 }],
      ),
    ).toThrow("expected an array");
    expect(() => apply({}, [{ op: "before", path: ["value"], value: 1 }])).toThrow(
      "array element path",
    );
    expect(() => apply({}, [{ op: "after", path: [0], value: 1 }])).toThrow("expected an array");
    expect(() => apply(false, [{ op: "append", path: [], value: 1 }])).toThrow("expected an array");
    expect(apply(null, [{ op: "set", path: ["value", "child"], value: 1 }])).toBeNull();
    expect(() => apply(false, [{ op: "set", path: ["value", "child"], value: 1 }])).toThrow(
      "expected an object",
    );
    expect(() => apply({}, [{ op: "set", path: [0, "child"], value: 1 }])).toThrow(
      "expected an array",
    );
  });

  it("does not mutate frozen inputs or operation literals across repeated calls", function () {
    const literal = Object.freeze({ id: "literal", details: Object.freeze({ active: false }) });
    const input = Object.freeze({
      rows: Object.freeze([
        Object.freeze({ id: "old", details: Object.freeze({ active: false }) }),
      ]),
    });
    const operations: VariableMutationOperation[] = [
      { op: "append", path: ["rows"], value: literal },
      {
        op: "set",
        path: ["rows", { select: { property: "id", values: ["literal"] } }, "details", "active"],
        value: true,
      },
    ];

    const first = apply(input, operations);
    const second = apply(input, operations);
    expect(first).toEqual({
      rows: [
        { id: "old", details: { active: false } },
        { id: "literal", details: { active: true } },
      ],
    });
    expect(second).toEqual(first);
    expect(input).toEqual({ rows: [{ id: "old", details: { active: false } }] });
    expect(literal).toEqual({ id: "literal", details: { active: false } });
  });

  it("rejects invalid operations and unsafe keys, while non-null wrong containers fail evaluation", function () {
    expect(() => apply({ value: 1 }, [{ op: "append", path: ["value"], value: 2 }])).toThrow(
      "expected an array",
    );
    expect(() => apply([1], [{ op: "set", path: ["value"], value: 2 }])).toThrow(
      "expected an object",
    );
    expect(() => apply([1], [{ op: "before", path: [], value: 0 }])).toThrow("array element path");
    expect(() => apply(null, [{ op: "after", path: [], value: 0 }])).toThrow("array element path");
    expect(() => apply([1], [{ op: "remove", path: [] }])).toThrow("root");
    expect(() =>
      apply({}, [{ op: "wat" as "set", path: ["missing", "child"], value: null }]),
    ).toThrow("Invalid");
    expect(() => apply({}, [{ op: "append", path: [], value: undefined as never }])).toThrow(
      "requires a value",
    );
    expect(() => apply({}, [{ op: "set", path: [-1], value: null }])).toThrow("Invalid");
    expect(() => apply({}, [{ op: "set", path: [1.5], value: null }])).toThrow("Invalid");
    expect(() => apply({}, [{ op: "set", path: ["__proto__"], value: null }])).toThrow("Unsafe");
    expect(() => apply({}, [{ op: "set", path: ["prototype"], value: null }])).toThrow("Unsafe");
    expect(() =>
      apply(
        [],
        [{ op: "set", path: [{ select: { property: "constructor", values: [1] } }], value: null }],
      ),
    ).toThrow("Unsafe");
  });
});
