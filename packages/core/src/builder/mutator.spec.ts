import type { VariableSchema, VariableValue } from "@featurevisor/types";
import { mutate } from "./mutator";

const schema: VariableSchema = {
  type: "object",
  defaultValue: {},
};

describe("mutator", function () {
  describe("mutate", function () {
    test("is a function", function () {
      expect(mutate).toBeInstanceOf(Function);
    });

    test("returns a deep clone and does not mutate original value", function () {
      const value = { a: 1, b: { c: 2 } };
      const result = mutate(schema, value, "a", 99);
      expect(result).toEqual({ a: 99, b: { c: 2 } });
      expect(value).toEqual({ a: 1, b: { c: 2 } });
    });

    test("returns value unchanged when notation is empty or only whitespace", function () {
      const value = { a: 1 };
      expect(mutate(schema, value, "", undefined)).toEqual({ a: 1 });
      expect(mutate(schema, value, "   ", undefined)).toEqual({ a: 1 });
    });

    test("returns null when value is null", function () {
      expect(mutate(schema, null, "key", 1)).toBeNull();
    });

    test("returns undefined when value is undefined", function () {
      expect(mutate(schema, undefined, "key", 1)).toBeUndefined();
    });
  });

  describe("notation: key (set value at key)", function () {
    test("sets top-level key", function () {
      const value = { a: 1, b: 2 };
      expect(mutate(schema, value, "a", 10)).toEqual({ a: 10, b: 2 });
      expect(mutate(schema, value, "c", 3)).toEqual({ a: 1, b: 2, c: 3 });
    });

    test("sets key to undefined (allows clearing)", function () {
      const value = { a: 1, b: 2 };
      expect(mutate(schema, value, "a", undefined)).toEqual({ a: undefined, b: 2 });
    });

    test("sets key with string, number, boolean, object, array", function () {
      const value = {};
      expect(mutate(schema, value, "s", "hello")).toEqual({ s: "hello" });
      expect(mutate(schema, value, "n", 42)).toEqual({ n: 42 });
      expect(mutate(schema, value, "b", true)).toEqual({ b: true });
      expect(mutate(schema, value, "o", { x: 1 })).toEqual({ o: { x: 1 } });
      expect(mutate(schema, value, "arr", [1, 2])).toEqual({ arr: [1, 2] });
    });
  });

  describe("notation: nested.key (set value at nested path)", function () {
    test("sets nested key one level deep", function () {
      const value = { a: { b: 1 } };
      expect(mutate(schema, value, "a.b", 2)).toEqual({ a: { b: 2 } });
    });

    test("sets nested key multiple levels deep", function () {
      const value = { a: { b: { c: 1 } } };
      expect(mutate(schema, value, "a.b.c", 99)).toEqual({ a: { b: { c: 99 } } });
    });

    test("creates intermediate objects when path does not exist (no-op per current spec: returns result)", function () {
      const value = { a: 1 };
      const result = mutate(schema, value, "x.y.z", 10);
      expect(result).toEqual({ a: 1 });
    });

    test("sets when intermediate path exists", function () {
      const value = { level1: { level2: { level3: "old" } } };
      expect(mutate(schema, value, "level1.level2.level3", "new")).toEqual({
        level1: { level2: { level3: "new" } },
      });
    });
  });

  describe("notation: key:append", function () {
    test("appends element to array", function () {
      const value = { items: [1, 2, 3] };
      expect(mutate(schema, value, "items:append", 4)).toEqual({
        items: [1, 2, 3, 4],
      });
    });

    test("appends to empty array", function () {
      const value = { items: [] };
      expect(mutate(schema, value, "items:append", "a")).toEqual({ items: ["a"] });
    });

    test("creates array when key is missing and appends", function () {
      const value: VariableValue = {};
      expect(mutate(schema, value, "items:append", 1)).toEqual({ items: [1] });
    });

    test("root-level array: notation :append appends to array value", function () {
      const arraySchema: VariableSchema = { type: "array", defaultValue: [] };
      expect(mutate(arraySchema, ["a", "b"], ":append", "c")).toEqual(["a", "b", "c"]);
    });

    test("appends object to array", function () {
      const value = { list: [{ id: 1 }] };
      expect(mutate(schema, value, "list:append", { id: 2, name: "b" })).toEqual({
        list: [{ id: 1 }, { id: 2, name: "b" }],
      });
    });
  });

  describe("notation: key:prepend", function () {
    test("prepends element to array", function () {
      const value = { items: [1, 2, 3] };
      expect(mutate(schema, value, "items:prepend", 0)).toEqual({
        items: [0, 1, 2, 3],
      });
    });

    test("prepends to empty array", function () {
      const value = { items: [] };
      expect(mutate(schema, value, "items:prepend", "first")).toEqual({
        items: ["first"],
      });
    });

    test("creates array when key is missing and prepends", function () {
      const value: VariableValue = {};
      expect(mutate(schema, value, "items:prepend", "x")).toEqual({ items: ["x"] });
    });

    test("root-level array: notation :prepend prepends to array value", function () {
      const arraySchema: VariableSchema = { type: "array", defaultValue: [] };
      expect(mutate(arraySchema, ["b", "c"], ":prepend", "a")).toEqual(["a", "b", "c"]);
    });
  });

  describe("notation: key[id=123]:after", function () {
    test("inserts element after matching item by selector", function () {
      const value = {
        items: [
          { id: "1", name: "a" },
          { id: "123", name: "b" },
          { id: "3", name: "c" },
        ],
      };
      const result = mutate(schema, value, "items[id=123]:after", {
        id: "2",
        name: "inserted",
      });
      expect(result).toEqual({
        items: [
          { id: "1", name: "a" },
          { id: "123", name: "b" },
          { id: "2", name: "inserted" },
          { id: "3", name: "c" },
        ],
      });
    });

    test("inserts after when id is numeric in data", function () {
      const value = {
        list: [
          { id: 123, name: "a" },
          { id: 456, name: "b" },
        ],
      };
      const result = mutate(schema, value, "list[id=123]:after", {
        id: 124,
        name: "after 123",
      });
      expect(result).toEqual({
        list: [
          { id: 123, name: "a" },
          { id: 124, name: "after 123" },
          { id: 456, name: "b" },
        ],
      });
    });

    test("no-op when no element matches selector", function () {
      const value = { items: [{ id: "1" }] };
      const result = mutate(schema, value, "items[id=999]:after", { id: "new" });
      expect(result).toEqual({ items: [{ id: "1" }] });
    });
  });

  describe("notation: key[id=123]:before", function () {
    test("inserts element before matching item by selector", function () {
      const value = {
        items: [
          { id: "1", name: "a" },
          { id: "123", name: "b" },
          { id: "3", name: "c" },
        ],
      };
      const result = mutate(schema, value, "items[id=123]:before", {
        id: "0",
        name: "inserted",
      });
      expect(result).toEqual({
        items: [
          { id: "1", name: "a" },
          { id: "0", name: "inserted" },
          { id: "123", name: "b" },
          { id: "3", name: "c" },
        ],
      });
    });

    test("inserts before first element when first matches", function () {
      const value = { list: [{ id: 1 }, { id: 2 }] };
      const result = mutate(schema, value, "list[id=1]:before", { id: 0 });
      expect(result).toEqual({
        list: [{ id: 0 }, { id: 1 }, { id: 2 }],
      });
    });
  });

  describe("notation: key[n] (set value at index)", function () {
    test("sets element at array index", function () {
      const value = { items: [10, 20, 30] };
      expect(mutate(schema, value, "items[0]", 1)).toEqual({
        items: [1, 20, 30],
      });
      expect(mutate(schema, value, "items[1]", 200)).toEqual({
        items: [10, 200, 30],
      });
      expect(mutate(schema, value, "items[2]", 300)).toEqual({
        items: [10, 20, 300],
      });
    });

    test("sets object at index", function () {
      const value = { list: [{ id: 1 }, { id: 2 }] };
      expect(mutate(schema, value, "list[0]", { id: 10 })).toEqual({
        list: [{ id: 10 }, { id: 2 }],
      });
    });

    test("root-level array: notation [n] sets element at index", function () {
      const arraySchema: VariableSchema = { type: "array", defaultValue: [] };
      const value = [10, 20, 30];
      expect(mutate(arraySchema, value, "[0]", 1)).toEqual([1, 20, 30]);
      expect(mutate(arraySchema, value, "[1]", 99)).toEqual([10, 99, 30]);
      expect(mutate(arraySchema, [100], "[0]", 200)).toEqual([200]);
    });
  });

  describe("notation: key[n].key (set property of item at index)", function () {
    test("sets property of element at index", function () {
      const value = {
        items: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
        ],
      };
      expect(mutate(schema, value, "items[0].name", "A")).toEqual({
        items: [
          { id: 1, name: "A" },
          { id: 2, name: "b" },
        ],
      });
      expect(mutate(schema, value, "items[1].id", 20)).toEqual({
        items: [
          { id: 1, name: "a" },
          { id: 20, name: "b" },
        ],
      });
    });

    test("sets nested property of element at index", function () {
      const value = {
        list: [{ meta: { count: 1 } }],
      };
      expect(mutate(schema, value, "list[0].meta.count", 5)).toEqual({
        list: [{ meta: { count: 5 } }],
      });
    });
  });

  describe("notation: key[n]:remove", function () {
    test("removes element at index", function () {
      const value = { items: [1, 2, 3] };
      expect(mutate(schema, value, "items[1]:remove", undefined)).toEqual({
        items: [1, 3],
      });
    });

    test("removes first element", function () {
      const value = { items: ["a", "b", "c"] };
      expect(mutate(schema, value, "items[0]:remove", undefined)).toEqual({
        items: ["b", "c"],
      });
    });

    test("removes last element", function () {
      const value = { items: ["a", "b", "c"] };
      expect(mutate(schema, value, "items[2]:remove", undefined)).toEqual({
        items: ["a", "b"],
      });
    });

    test("removes only element", function () {
      const value = { items: [1] };
      expect(mutate(schema, value, "items[0]:remove", undefined)).toEqual({
        items: [],
      });
    });
  });

  describe("notation: key[id=123]:remove", function () {
    test("removes element matching selector", function () {
      const value = {
        items: [
          { id: "1", name: "a" },
          { id: "123", name: "b" },
          { id: "3", name: "c" },
        ],
      };
      expect(mutate(schema, value, "items[id=123]:remove", undefined)).toEqual({
        items: [
          { id: "1", name: "a" },
          { id: "3", name: "c" },
        ],
      });
    });

    test("removes by numeric id", function () {
      const value = { list: [{ id: 123 }, { id: 456 }] };
      expect(mutate(schema, value, "list[id=123]:remove", undefined)).toEqual({
        list: [{ id: 456 }],
      });
    });

    test("no-op when no element matches", function () {
      const value = { items: [{ id: "1" }] };
      expect(mutate(schema, value, "items[id=999]:remove", undefined)).toEqual({
        items: [{ id: "1" }],
      });
    });
  });

  describe("notation: key:remove", function () {
    test("removes top-level property", function () {
      const value = { a: 1, b: 2, c: 3 };
      expect(mutate(schema, value, "b:remove", undefined)).toEqual({
        a: 1,
        c: 3,
      });
    });

    test("removes nested property", function () {
      const value = { a: { b: 1, c: 2 } };
      expect(mutate(schema, value, "a.c:remove", undefined)).toEqual({
        a: { b: 1 },
      });
    });

    test("removes when value is undefined (key no longer present)", function () {
      const value = { x: "present" };
      const result = mutate(schema, value, "x:remove", undefined);
      expect(result).toEqual({});
      expect(Object.prototype.hasOwnProperty.call(result, "x")).toBe(false);
    });
  });

  describe("edge cases and combined paths", function () {
    test("key with brackets in selector (prop=value)", function () {
      const value = { list: [{ id: "a=1", name: "first" }] };
      const result = mutate(schema, value, "list[id=a=1].name", "updated");
      expect(result).toEqual({ list: [{ id: "a=1", name: "updated" }] });
    });

    test("array of primitives: set and remove by index", function () {
      const value = { nums: [1, 2, 3] };
      expect(mutate(schema, value, "nums[1]", 20)).toEqual({ nums: [1, 20, 3] });
      expect(mutate(schema, value, "nums[2]:remove", undefined)).toEqual({
        nums: [1, 2],
      });
    });

    test("deep path: a.b.c.d", function () {
      const value = { a: { b: { c: { d: "old" } } } };
      expect(mutate(schema, value, "a.b.c.d", "new")).toEqual({
        a: { b: { c: { d: "new" } } },
      });
    });

    test("selector with different property name", function () {
      const value = {
        users: [
          { userId: "u1", name: "Alice" },
          { userId: "u2", name: "Bob" },
        ],
      };
      expect(mutate(schema, value, "users[userId=u2]:remove", undefined)).toEqual({
        users: [{ userId: "u1", name: "Alice" }],
      });
    });

    test("append and prepend in sequence (each from fresh clone)", function () {
      const value = { arr: [2] };
      const afterAppend = mutate(schema, value, "arr:append", 3);
      expect(afterAppend).toEqual({ arr: [2, 3] });
      const afterPrepend = mutate(schema, value, "arr:prepend", 1);
      expect(afterPrepend).toEqual({ arr: [1, 2] });
    });
  });
});
