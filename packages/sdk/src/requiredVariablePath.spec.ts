import { getRequiredVariableValueAtPath as read } from "./instance";

describe("compiled required variable paths", () => {
  const value = { "limits.v2": [null, false, 0], "0": "object key" };
  test("preserves the root and false, zero and null values", () => {
    expect(read(value, [])).toBe(value);
    expect(read(value, ["limits.v2", 0])).toBeNull();
    expect(read(value, ["limits.v2", 1])).toBe(false);
    expect(read(value, ["limits.v2", 2])).toBe(0);
  });
  test("distinguishes array indexes from object keys and permits own length", () => {
    expect(read(value, ["0"])).toBe("object key");
    expect(read(value, [0])).toBeUndefined();
    expect(read(value, ["limits.v2", "1"])).toBe(false);
    expect(read(value, ["limits.v2", "length"])).toBe(3);
    for (const index of [-1, 0.5, NaN, Infinity, 3]) {
      expect(read(value, ["limits.v2", index])).toBeUndefined();
    }
  });
  test("does not traverse primitives, inherited values or array holes", () => {
    expect(read(Object.create({ inherited: true }), ["inherited"])).toBeUndefined();
    expect(read(new Array(1), [0])).toBeUndefined();
    for (const root of [null, undefined, "abc", 0, false]) {
      expect(read(root, ["length"])).toBeUndefined();
    }
  });
  test("rejects unsafe components even after a missing component", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      expect(() => read(value, ["missing", key])).toThrow("Unsafe variable requirement path");
    }
    expect(() => read(value, "limits.v2" as never)).toThrow("must be compiled");
  });
});
