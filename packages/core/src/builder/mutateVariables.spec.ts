import type { VariableSchema, VariableValue } from "@featurevisor/types";
import {
  resolveMutationsForMultipleVariables,
  resolveMutationsForSingleVariable,
} from "./mutateVariables";

describe("mutateVariables", function () {
  describe("resolveMutationsForMultipleVariables", function () {
    test("is a function", function () {
      expect(resolveMutationsForMultipleVariables).toBeInstanceOf(Function);
    });

    describe("returns undefined when", function () {
      test("overrides is undefined", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "default" },
        };
        expect(resolveMutationsForMultipleVariables(schema, undefined)).toBeUndefined();
      });

      test("overrides is null", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "default" },
        };
        expect(
          resolveMutationsForMultipleVariables(
            schema,
            null as unknown as Record<string, VariableValue>,
          ),
        ).toBeUndefined();
      });

      test("overrides is empty object", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "default" },
        };
        expect(resolveMutationsForMultipleVariables(schema, {})).toBeUndefined();
      });

      test("variablesSchema is undefined", function () {
        expect(resolveMutationsForMultipleVariables(undefined, { foo: "bar" })).toBeUndefined();
      });

      test("variablesSchema is empty object", function () {
        expect(resolveMutationsForMultipleVariables({}, { foo: "bar" })).toBeUndefined();
      });

      test("every override key refers to a variable not in schema", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "x" },
        };
        expect(
          resolveMutationsForMultipleVariables(schema, { bar: "y", baz: "z" }),
        ).toBeUndefined();
      });
    });

    describe("returns only overridden variables (not all from schema)", function () {
      test("single override includes only that variable", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "defaultFoo" },
          bar: { type: "string", defaultValue: "defaultBar" },
          baz: { type: "string", defaultValue: "defaultBaz" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          bar: "overriddenBar",
        });
        expect(result).toEqual({ bar: "overriddenBar" });
        expect(Object.keys(result!).sort()).toEqual(["bar"]);
      });

      test("multiple overrides include only those variables", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          a: { type: "string", defaultValue: "a" },
          b: { type: "string", defaultValue: "b" },
          c: { type: "string", defaultValue: "c" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          a: "A",
          c: "C",
        });
        expect(result).toEqual({ a: "A", c: "C" });
        expect(Object.keys(result!).sort()).toEqual(["a", "c"]);
      });
    });

    describe("exact key override (whole variable replacement)", function () {
      test("replaces entire value with override", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: { a: 1, b: 2 } },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          foo: { x: 10, y: 20 },
        });
        expect(result).toEqual({ foo: { x: 10, y: 20 } });
      });

      test("replaces string default", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          name: { type: "string", defaultValue: "default" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, { name: "custom" });
        expect(result).toEqual({ name: "custom" });
      });

      test("replaces number default", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          count: { type: "integer", defaultValue: 0 },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, { count: 42 });
        expect(result).toEqual({ count: 42 });
      });

      test("replaces array default", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          list: { type: "array", defaultValue: [1, 2, 3] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, { list: [10, 20] });
        expect(result).toEqual({ list: [10, 20] });
      });
    });

    describe("dot-notation override (mutates default)", function () {
      test("sets nested path on object default", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          config: {
            type: "object",
            defaultValue: { a: 1, b: 2, c: 3 },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "config.b": 20,
        });
        expect(result).toEqual({ config: { a: 1, b: 20, c: 3 } });
      });

      test("sets deep nested path", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: {
            type: "object",
            defaultValue: { level1: { level2: { value: "old" } } },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "foo.level1.level2.value": "new",
        });
        expect(result).toEqual({
          foo: { level1: { level2: { value: "new" } } },
        });
      });

      test("multiple dot-notation overrides for same variable merge", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          obj: {
            type: "object",
            defaultValue: { a: 1, b: 2, c: 3 },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "obj.a": 10,
          "obj.c": 30,
        });
        expect(result).toEqual({ obj: { a: 10, b: 2, c: 30 } });
      });
    });

    describe("order of application", function () {
      test("full key then nested: nested wins on that path", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: { a: 1, b: 2 } },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          foo: { a: 100, b: 200 },
          "foo.b": 999,
        });
        expect(result).toEqual({ foo: { a: 100, b: 999 } });
      });

      test("nested then full key: full key applied first (shorter), then nested", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: { a: 1, b: 2 } },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "foo.a": 10,
          foo: { x: 1 },
        });
        expect(result).toEqual({ foo: { x: 1, a: 10 } });
      });
    });

    describe("defaultValue handling", function () {
      test("uses clone of defaultValue (does not mutate schema)", function () {
        const defaultValue = { a: 1 };
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue },
        };
        resolveMutationsForMultipleVariables(variablesSchema, { "foo.a": 2 });
        expect(defaultValue).toEqual({ a: 1 });
      });

      test("variable with undefined defaultValue and nested override leaves value undefined", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: undefined },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "foo.a": 1,
        });
        expect(result).toEqual({ foo: undefined });
      });

      test("variable with null defaultValue and exact override", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: null },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, { foo: "set" });
        expect(result).toEqual({ foo: "set" });
      });
    });

    describe("override key not in schema", function () {
      test("ignores unknown variable key (no entry in result)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "x" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          foo: "ok",
          unknownVar: "ignored",
        });
        expect(result).toEqual({ foo: "ok" });
      });

      test("ignores dotted path whose first segment is not in schema", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "x" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "other.deep.path": 1,
        });
        expect(result).toBeUndefined();
      });
    });

    describe("does not mutate inputs", function () {
      test("overrides object is not mutated", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: {} },
        };
        const overrides = { foo: { key: "value" } };
        resolveMutationsForMultipleVariables(variablesSchema, overrides);
        expect(overrides.foo).toEqual({ key: "value" });
      });

      test("schema defaultValues are not mutated", function () {
        const defaultValue = { nested: { x: 1 } };
        const variablesSchema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue },
        };
        resolveMutationsForMultipleVariables(variablesSchema, { "foo.nested.x": 2 });
        expect(defaultValue).toEqual({ nested: { x: 1 } });
      });
    });

    describe("multiple variables with dot notation", function () {
      test("resolves each overridden variable independently", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          theme: {
            type: "object",
            defaultValue: { primary: "blue", secondary: "gray" },
          },
          count: { type: "integer", defaultValue: 0 },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "theme.primary": "red",
          count: 5,
        });
        expect(result).toEqual({
          theme: { primary: "red", secondary: "gray" },
          count: 5,
        });
      });
    });

    describe("edge cases", function () {
      test("override key with single segment (no dot)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          x: { type: "string", defaultValue: "default" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, { x: "y" });
        expect(result).toEqual({ x: "y" });
      });

      test("override key with multiple dots", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          a: { type: "object", defaultValue: { b: { c: 0 } } },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "a.b.c": 1,
        });
        expect(result).toEqual({ a: { b: { c: 1 } } });
      });

      test("same variable overridden by exact and dotted keys (shorter key applied first)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          v: { type: "object", defaultValue: { p: 1, q: 2 } },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "v.p": 10,
          v: { p: 100, q: 200 },
        });
        expect(result).toEqual({ v: { p: 10, q: 200 } });
      });

      test("returns undefined when result is empty (all override keys unknown)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          known: { type: "string", defaultValue: "v" },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          unknown: "x",
          "another.thing": 1,
        });
        expect(result).toBeUndefined();
      });
    });

    describe("complex: deeply nested objects", function () {
      test("object with multiple branches, override one leaf", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          root: {
            type: "object",
            defaultValue: {
              left: { a: 1, b: 2 },
              right: { x: 10, y: 20 },
              center: { p: 100, q: 200 },
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "root.right.y": 99,
        });
        expect(result).toEqual({
          root: {
            left: { a: 1, b: 2 },
            right: { x: 10, y: 99 },
            center: { p: 100, q: 200 },
          },
        });
      });

      test("override multiple leaves in different branches", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          tree: {
            type: "object",
            defaultValue: {
              l: { l: { v: 1 }, r: { v: 2 } },
              r: { l: { v: 3 }, r: { v: 4 } },
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "tree.l.l.v": 10,
          "tree.r.r.v": 40,
        });
        expect(result).toEqual({
          tree: {
            l: { l: { v: 10 }, r: { v: 2 } },
            r: { l: { v: 3 }, r: { v: 40 } },
          },
        });
      });

      test("four levels deep with override at each level", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          d: {
            type: "object",
            defaultValue: {
              l1: {
                l2: { l3: { l4: "deep" } },
              },
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "d.l1.l2.l3.l4": "updated",
        });
        expect(result).toEqual({
          d: {
            l1: {
              l2: { l3: { l4: "updated" } },
            },
          },
        });
      });

      test("replace whole branch with exact key then override nested under it", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          cfg: {
            type: "object",
            defaultValue: {
              api: { url: "old", timeout: 5 },
              ui: { theme: "light" },
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          cfg: { api: { url: "https://new", timeout: 10 }, ui: { theme: "dark" } },
          "cfg.api.timeout": 30,
        });
        expect(result).toEqual({
          cfg: {
            api: { url: "https://new", timeout: 30 },
            ui: { theme: "dark" },
          },
        });
      });
    });

    describe("complex: arrays", function () {
      test("override element at index", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          list: { type: "array", defaultValue: [10, 20, 30] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "list[1]": 99,
        });
        expect(result).toEqual({ list: [10, 99, 30] });
      });

      test("override first and last index", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          arr: { type: "array", defaultValue: ["a", "b", "c", "d"] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "arr[0]": "A",
          "arr[3]": "D",
        });
        expect(result).toEqual({ arr: ["A", "b", "c", "D"] });
      });

      test("array of primitives replaced entirely with exact key", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          ids: { type: "array", defaultValue: [1, 2, 3] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          ids: [100, 200, 300],
        });
        expect(result).toEqual({ ids: [100, 200, 300] });
      });
    });

    describe("complex: arrays of objects", function () {
      test("override property of object at index", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          items: {
            type: "array",
            defaultValue: [
              { id: 1, name: "first" },
              { id: 2, name: "second" },
              { id: 3, name: "third" },
            ],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "items[0].name": "First",
          "items[2].id": 30,
        });
        expect(result).toEqual({
          items: [
            { id: 1, name: "First" },
            { id: 2, name: "second" },
            { id: 30, name: "third" },
          ],
        });
      });

      test("override nested property inside object at index", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          users: {
            type: "array",
            defaultValue: [
              { id: 1, profile: { displayName: "Alice", role: "admin" } },
              { id: 2, profile: { displayName: "Bob", role: "user" } },
            ],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "users[0].profile.displayName": "Alicia",
          "users[1].profile.role": "editor",
        });
        expect(result).toEqual({
          users: [
            { id: 1, profile: { displayName: "Alicia", role: "admin" } },
            { id: 2, profile: { displayName: "Bob", role: "editor" } },
          ],
        });
      });

      test("override multiple properties of same object at index", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          rows: {
            type: "array",
            defaultValue: [
              { a: 1, b: 2, c: 3 },
              { a: 4, b: 5, c: 6 },
            ],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "rows[1].a": 40,
          "rows[1].c": 60,
        });
        expect(result).toEqual({
          rows: [
            { a: 1, b: 2, c: 3 },
            { a: 40, b: 5, c: 60 },
          ],
        });
      });

      test("replace whole array of objects with exact key", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          list: {
            type: "array",
            defaultValue: [{ id: 1 }, { id: 2 }],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          list: [
            { id: 10, name: "x" },
            { id: 20, name: "y" },
          ],
        });
        expect(result).toEqual({
          list: [
            { id: 10, name: "x" },
            { id: 20, name: "y" },
          ],
        });
      });
    });

    describe("complex: object containing arrays of objects", function () {
      test("config with sections and items", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          config: {
            type: "object",
            defaultValue: {
              title: "App",
              sections: [
                { id: "s1", label: "Section 1", items: [{ name: "a" }, { name: "b" }] },
                { id: "s2", label: "Section 2", items: [{ name: "c" }] },
              ],
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "config.title": "My App",
          "config.sections[0].label": "First",
          "config.sections[0].items[1].name": "B",
          "config.sections[1].items[0].name": "C",
        });
        expect(result).toEqual({
          config: {
            title: "My App",
            sections: [
              { id: "s1", label: "First", items: [{ name: "a" }, { name: "B" }] },
              { id: "s2", label: "Section 2", items: [{ name: "C" }] },
            ],
          },
        });
      });

      test("feature flags style: rules array with variables", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          payload: {
            type: "object",
            defaultValue: {
              enabled: true,
              rules: [
                { id: "r1", percentage: 50, config: { theme: "light", size: "md" } },
                { id: "r2", percentage: 50, config: { theme: "dark", size: "sm" } },
              ],
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "payload.rules[0].config.theme": "blue",
          "payload.rules[1].percentage": 100,
        });
        expect(result).toEqual({
          payload: {
            enabled: true,
            rules: [
              { id: "r1", percentage: 50, config: { theme: "blue", size: "md" } },
              { id: "r2", percentage: 100, config: { theme: "dark", size: "sm" } },
            ],
          },
        });
      });
    });

    describe("complex: multiple variables with mixed structures", function () {
      test("two variables: one nested object, one array of objects", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          settings: {
            type: "object",
            defaultValue: {
              theme: "light",
              layout: { sidebar: true, width: 240 },
            },
          },
          items: {
            type: "array",
            defaultValue: [
              { id: 1, label: "One" },
              { id: 2, label: "Two" },
            ],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "settings.layout.width": 320,
          "items[1].label": "Two Updated",
        });
        expect(result).toEqual({
          settings: {
            theme: "light",
            layout: { sidebar: true, width: 320 },
          },
          items: [
            { id: 1, label: "One" },
            { id: 2, label: "Two Updated" },
          ],
        });
      });

      test("three variables overridden with different depth", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          flat: { type: "string", defaultValue: "v1" },
          nested: {
            type: "object",
            defaultValue: { a: { b: "old" } },
          },
          list: { type: "array", defaultValue: [{ x: 1 }, { x: 2 }] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          flat: "V1",
          "nested.a.b": "new",
          "list[0].x": 10,
        });
        expect(result).toEqual({
          flat: "V1",
          nested: { a: { b: "new" } },
          list: [{ x: 10 }, { x: 2 }],
        });
      });
    });

    describe("complex: edge cases for arrays and nesting", function () {
      test("empty array default, override index (mutator creates/updates)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          arr: { type: "array", defaultValue: [] },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "arr[0]": "first",
        });
        expect(result).toEqual({ arr: ["first"] });
      });

      test("object with empty array property, override inside array", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          data: {
            type: "object",
            defaultValue: { tags: [] },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "data.tags[0]": "new-tag",
        });
        expect(result).toEqual({ data: { tags: ["new-tag"] } });
      });

      test("array of objects with nested array", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          groups: {
            type: "array",
            defaultValue: [
              { name: "G1", ids: [1, 2, 3] },
              { name: "G2", ids: [4, 5] },
            ],
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "groups[0].ids[1]": 20,
          "groups[1].name": "Group 2",
        });
        expect(result).toEqual({
          groups: [
            { name: "G1", ids: [1, 20, 3] },
            { name: "Group 2", ids: [4, 5] },
          ],
        });
      });

      test("deep chain: object with array of objects with nested object", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          root: {
            type: "object",
            defaultValue: {
              items: [
                { id: 1, meta: { count: 0, label: "a" } },
                { id: 2, meta: { count: 0, label: "b" } },
              ],
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "root.items[0].meta.count": 5,
          "root.items[1].meta.label": "B",
        });
        expect(result).toEqual({
          root: {
            items: [
              { id: 1, meta: { count: 5, label: "a" } },
              { id: 2, meta: { count: 0, label: "B" } },
            ],
          },
        });
      });
    });

    describe("complex: many overrides on single variable", function () {
      test("single variable with 5+ dotted overrides", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          state: {
            type: "object",
            defaultValue: {
              a: 1,
              b: 2,
              c: 3,
              d: 4,
              e: 5,
              f: 6,
            },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "state.a": 10,
          "state.c": 30,
          "state.e": 50,
        });
        expect(result).toEqual({
          state: { a: 10, b: 2, c: 30, d: 4, e: 50, f: 6 },
        });
      });

      test("single variable: mix of exact key and dotted overrides (order by length)", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          v: {
            type: "object",
            defaultValue: { x: 0, y: 0 },
          },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "v.x": 1,
          v: { x: 100, y: 200, z: 300 },
          "v.y": 2,
        });
        expect(result).toEqual({ v: { x: 1, y: 2, z: 300 } });
      });
    });

    describe("complex: schema with multiple variables, only some overridden", function () {
      test("six variables in schema, override two with complex paths", function () {
        const variablesSchema: Record<string, VariableSchema> = {
          a: { type: "string", defaultValue: "a" },
          b: { type: "object", defaultValue: { b1: 1, b2: 2 } },
          c: { type: "array", defaultValue: [1, 2, 3] },
          d: {
            type: "object",
            defaultValue: { nested: { value: "d" } },
          },
          e: {
            type: "array",
            defaultValue: [
              { id: 1, name: "e1" },
              { id: 2, name: "e2" },
            ],
          },
          f: { type: "integer", defaultValue: 0 },
        };
        const result = resolveMutationsForMultipleVariables(variablesSchema, {
          "b.b2": 20,
          "d.nested.value": "D",
          "e[0].name": "E1",
        });
        expect(result).toEqual({
          b: { b1: 1, b2: 20 },
          d: { nested: { value: "D" } },
          e: [
            { id: 1, name: "E1" },
            { id: 2, name: "e2" },
          ],
        });
        expect(Object.keys(result!).sort()).toEqual(["b", "d", "e"]);
      });
    });
  });

  describe("resolveMutationsForSingleVariable", function () {
    test("is a function", function () {
      expect(resolveMutationsForSingleVariable).toBeInstanceOf(Function);
    });

    describe("returns overrideValue unchanged when", function () {
      test("variablesSchema is undefined", function () {
        expect(resolveMutationsForSingleVariable(undefined, "foo", "bar")).toBe("bar");
        expect(resolveMutationsForSingleVariable(undefined, "foo", { a: 1 })).toEqual({ a: 1 });
      });

      test("variablesSchema is empty (no variableKey)", function () {
        expect(resolveMutationsForSingleVariable({}, "foo", "bar")).toBe("bar");
      });

      test("variableKey is not in variablesSchema", function () {
        const schema: Record<string, VariableSchema> = {
          bar: { type: "string", defaultValue: "x" },
        };
        expect(resolveMutationsForSingleVariable(schema, "foo", "value")).toBe("value");
        expect(resolveMutationsForSingleVariable(schema, "foo", { nested: 1 })).toEqual({
          nested: 1,
        });
      });

      test("overrideValue is null", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "default" },
        };
        expect(resolveMutationsForSingleVariable(schema, "foo", null)).toBeNull();
      });

      test("overrideValue is undefined", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "string", defaultValue: "default" },
        };
        expect(resolveMutationsForSingleVariable(schema, "foo", undefined)).toBeUndefined();
      });

      test("overrideValue is a string (full replacement)", function () {
        const schema: Record<string, VariableSchema> = {
          name: { type: "string", defaultValue: "default" },
        };
        expect(resolveMutationsForSingleVariable(schema, "name", "custom")).toBe("custom");
      });

      test("overrideValue is a number (full replacement)", function () {
        const schema: Record<string, VariableSchema> = {
          count: { type: "integer", defaultValue: 0 },
        };
        expect(resolveMutationsForSingleVariable(schema, "count", 42)).toBe(42);
      });

      test("overrideValue is a boolean (full replacement)", function () {
        const schema: Record<string, VariableSchema> = {
          flag: { type: "boolean", defaultValue: false },
        };
        expect(resolveMutationsForSingleVariable(schema, "flag", true)).toBe(true);
      });

      test("overrideValue is an array (full replacement, not path map)", function () {
        const schema: Record<string, VariableSchema> = {
          list: { type: "array", defaultValue: [1, 2, 3] },
        };
        const arr = [10, 20];
        expect(resolveMutationsForSingleVariable(schema, "list", arr)).toEqual([10, 20]);
        expect(resolveMutationsForSingleVariable(schema, "list", [])).toEqual([]);
      });
    });

    describe("plain object as path map (merge with default)", function () {
      test("single path key merges with default", function () {
        const schema: Record<string, VariableSchema> = {
          theme: {
            type: "object",
            defaultValue: { primary: "blue", secondary: "gray" },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "theme", {
          primary: "red",
        });
        expect(result).toEqual({ primary: "red", secondary: "gray" });
      });

      test("multiple path keys merge with default", function () {
        const schema: Record<string, VariableSchema> = {
          config: {
            type: "object",
            defaultValue: { a: 1, b: 2, c: 3 },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "config", {
          a: 10,
          c: 30,
        });
        expect(result).toEqual({ a: 10, b: 2, c: 30 });
      });

      test("nested path in path map", function () {
        const schema: Record<string, VariableSchema> = {
          obj: {
            type: "object",
            defaultValue: { level1: { level2: { v: "old" } } },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "obj", {
          "level1.level2.v": "new",
        });
        expect(result).toEqual({ level1: { level2: { v: "new" } } });
      });

      test("exact variableKey key in path map replaces entire value", function () {
        const schema: Record<string, VariableSchema> = {
          theme: {
            type: "object",
            defaultValue: { primary: "blue", secondary: "gray" },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "theme", {
          theme: { primary: "red", accent: "yellow" },
        });
        expect(result).toEqual({ primary: "red", accent: "yellow" });
      });

      test("variableKey key and path keys: full value applied first then paths (order)", function () {
        const schema: Record<string, VariableSchema> = {
          v: {
            type: "object",
            defaultValue: { a: 1, b: 2 },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "v", {
          v: { a: 100, b: 200 },
          b: 999,
        });
        expect(result).toEqual({ a: 100, b: 999 });
      });

      test("array index in path map", function () {
        const schema: Record<string, VariableSchema> = {
          items: {
            type: "array",
            defaultValue: [
              { id: 1, name: "a" },
              { id: 2, name: "b" },
            ],
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "items", {
          "[0].name": "A",
          "[1].id": 20,
        });
        expect(result).toEqual([
          { id: 1, name: "A" },
          { id: 20, name: "b" },
        ]);
      });

      test("deep path and array index", function () {
        const schema: Record<string, VariableSchema> = {
          data: {
            type: "object",
            defaultValue: {
              list: [{ x: 1 }, { x: 2 }],
            },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "data", {
          "list[0].x": 10,
        });
        expect(result).toEqual({
          list: [{ x: 10 }, { x: 2 }],
        });
      });

      test("empty path map returns default merged (no overrides)", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: { a: 1 } },
        };
        const result = resolveMutationsForSingleVariable(schema, "foo", {});
        expect(result).toEqual({});
      });
    });

    describe("does not mutate input", function () {
      test("overrideValue object is not mutated", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: {} },
        };
        const pathMap = { a: 1, b: 2 };
        resolveMutationsForSingleVariable(schema, "foo", pathMap);
        expect(pathMap).toEqual({ a: 1, b: 2 });
      });
    });

    describe("edge cases", function () {
      test("variableKey with same name as path segment", function () {
        const schema: Record<string, VariableSchema> = {
          theme: {
            type: "object",
            defaultValue: { theme: "light", color: "white" },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "theme", {
          color: "black",
        });
        expect(result).toEqual({ theme: "light", color: "black" });
      });

      test("multiple variables in schema, only one resolved", function () {
        const schema: Record<string, VariableSchema> = {
          a: { type: "object", defaultValue: { x: 1 } },
          b: { type: "object", defaultValue: { y: 2 } },
        };
        const result = resolveMutationsForSingleVariable(schema, "a", {
          x: 10,
        });
        expect(result).toEqual({ x: 10 });
      });

      test("path map with only variableKey key (full replacement)", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: { a: 1, b: 2 } },
        };
        const result = resolveMutationsForSingleVariable(schema, "foo", {
          foo: { x: 1 },
        });
        expect(result).toEqual({ x: 1 });
      });

      test("primitive default with path map (path overwrites)", function () {
        const schema: Record<string, VariableSchema> = {
          value: { type: "string", defaultValue: "default" },
        };
        const result = resolveMutationsForSingleVariable(schema, "value", {
          value: "overridden",
        });
        expect(result).toEqual("overridden");
      });
    });

    describe("complex: object path maps", function () {
      test("path map with three-level nested path", function () {
        const schema: Record<string, VariableSchema> = {
          cfg: {
            type: "object",
            defaultValue: { a: { b: { c: 0 } } },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "cfg", {
          "a.b.c": 1,
        });
        expect(result).toEqual({ a: { b: { c: 1 } } });
      });

      test("path map with array index then property", function () {
        const schema: Record<string, VariableSchema> = {
          rows: {
            type: "array",
            defaultValue: [
              { id: 1, label: "a" },
              { id: 2, label: "b" },
            ],
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "rows", {
          "[0].label": "A",
          "[1].id": 20,
        });
        expect(result).toEqual([
          { id: 1, label: "A" },
          { id: 20, label: "b" },
        ]);
      });

      test("path map full replacement then path (order: full first)", function () {
        const schema: Record<string, VariableSchema> = {
          v: {
            type: "object",
            defaultValue: { x: 0, y: 0 },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "v", {
          v: { x: 1, y: 2, z: 3 },
          y: 20,
        });
        expect(result).toEqual({ x: 1, y: 20, z: 3 });
      });

      test("path map with mixed path styles", function () {
        const schema: Record<string, VariableSchema> = {
          data: {
            type: "object",
            defaultValue: { count: 0, nested: { value: "old" } },
          },
        };
        const result = resolveMutationsForSingleVariable(schema, "data", {
          count: 5,
          "nested.value": "new",
        });
        expect(result).toEqual({ count: 5, nested: { value: "new" } });
      });
    });

    describe("schema default handling", function () {
      test("defaultValue null with path map leaves value undefined (mutator cannot mutate null)", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: null },
        };
        const result = resolveMutationsForSingleVariable(schema, "foo", {
          a: 1,
        });
        expect(result).toBeUndefined();
      });

      test("defaultValue undefined with path map leaves value undefined (mutator cannot mutate undefined)", function () {
        const schema: Record<string, VariableSchema> = {
          foo: { type: "object", defaultValue: undefined },
        };
        const result = resolveMutationsForSingleVariable(schema, "foo", {
          a: 1,
        });
        expect(result).toBeUndefined();
      });
    });
  });
});
