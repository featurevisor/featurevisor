/**
 * Exhaustive unit tests for mutation notation parsing and validation:
 * isMutationKey, parseMutationKey, resolveSchemaAtPath, parsePathMapKey, validateMutationKey.
 */
import type { Schema } from "@featurevisor/types";

import {
  isMutationKey,
  parseMutationKey,
  parsePathMapKey,
  resolveSchemaAtPath,
  validateMutationKey,
} from "./mutationNotation";

describe("mutationNotation.ts", () => {
  describe("isMutationKey", () => {
    it("returns false for empty string", () => {
      expect(isMutationKey("")).toBe(false);
    });

    it("returns false for whitespace-only", () => {
      expect(isMutationKey("   ")).toBe(false);
    });

    it("returns false for plain variable name (no path, no operation)", () => {
      expect(isMutationKey("foo")).toBe(false);
      expect(isMutationKey("title")).toBe(false);
      expect(isMutationKey("config")).toBe(false);
    });

    it("returns true when key contains dot (path)", () => {
      expect(isMutationKey("foo.bar")).toBe(true);
      expect(isMutationKey("config.width")).toBe(true);
      expect(isMutationKey("a.b.c")).toBe(true);
    });

    it("returns true when key contains bracket (array index or selector)", () => {
      expect(isMutationKey("items[0]")).toBe(true);
      expect(isMutationKey("tags[1]")).toBe(true);
      expect(isMutationKey("items[id=1]")).toBe(true);
    });

    it("returns true when key ends with :append", () => {
      expect(isMutationKey("tags:append")).toBe(true);
      expect(isMutationKey("items:append")).toBe(true);
    });

    it("returns true when key ends with :prepend", () => {
      expect(isMutationKey("tags:prepend")).toBe(true);
    });

    it("returns true when key ends with :after", () => {
      expect(isMutationKey("items[id=1]:after")).toBe(true);
    });

    it("returns true when key ends with :before", () => {
      expect(isMutationKey("items[id=1]:before")).toBe(true);
    });

    it("returns true when key ends with :remove", () => {
      expect(isMutationKey("config.compact:remove")).toBe(true);
      expect(isMutationKey("items[0]:remove")).toBe(true);
    });

    it("trims input before checking", () => {
      expect(isMutationKey("  config.width  ")).toBe(true);
      expect(isMutationKey("  tags:append  ")).toBe(true);
    });
  });

  describe("parseMutationKey", () => {
    it("returns null for empty string", () => {
      expect(parseMutationKey("")).toBeNull();
    });

    it("returns null for whitespace-only", () => {
      expect(parseMutationKey("   ")).toBeNull();
    });

    it("parses plain variable name as rootKey only, operation set", () => {
      const r = parseMutationKey("foo");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("foo");
      expect(r!.pathSegments).toEqual([]);
      expect(r!.allSegments).toEqual([{ key: "foo" }]);
      expect(r!.operation).toBe("set");
    });

    it("parses dot path: rootKey and single path segment", () => {
      const r = parseMutationKey("config.width");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("config");
      expect(r!.pathSegments).toEqual([{ key: "width" }]);
      expect(r!.allSegments).toEqual([{ key: "config" }, { key: "width" }]);
      expect(r!.operation).toBe("set");
    });

    it("parses deep dot path", () => {
      const r = parseMutationKey("settings.display.fontSize");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("settings");
      expect(r!.pathSegments).toEqual([{ key: "display" }, { key: "fontSize" }]);
      expect(r!.allSegments).toEqual([
        { key: "settings" },
        { key: "display" },
        { key: "fontSize" },
      ]);
    });

    it("parses array index notation", () => {
      const r = parseMutationKey("items[0]");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("items");
      expect(r!.pathSegments).toEqual([{ key: "", index: 0 }]);
      expect(r!.allSegments).toEqual([{ key: "items", index: 0 }]);
      expect(r!.operation).toBe("set");
    });

    it("parses array index then property", () => {
      const r = parseMutationKey("items[0].name");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("items");
      expect(r!.pathSegments).toEqual([{ key: "", index: 0 }, { key: "name" }]);
      expect(r!.allSegments).toEqual([{ key: "items", index: 0 }, { key: "name" }]);
    });

    it("parses selector notation", () => {
      const r = parseMutationKey("items[id=1]");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("items");
      expect(r!.pathSegments).toEqual([{ key: "", selector: { prop: "id", value: "1" } }]);
      expect(r!.allSegments).toEqual([{ key: "items", selector: { prop: "id", value: "1" } }]);
    });

    it("parses key starting with bracket (root-level array segment)", () => {
      const r = parseMutationKey("[0].name");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("");
      expect(r!.pathSegments).toEqual([{ key: "", index: 0 }, { key: "name" }]);
      expect(r!.allSegments).toEqual([{ key: "", index: 0 }, { key: "name" }]);
    });

    it("parses :append operation", () => {
      const r = parseMutationKey("tags:append");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("tags");
      expect(r!.pathSegments).toEqual([]);
      expect(r!.operation).toBe("append");
    });

    it("parses :prepend operation", () => {
      const r = parseMutationKey("tags:prepend");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("tags");
      expect(r!.operation).toBe("prepend");
    });

    it("parses :remove on property", () => {
      const r = parseMutationKey("config.compact:remove");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("config");
      expect(r!.pathSegments).toEqual([{ key: "compact" }]);
      expect(r!.operation).toBe("remove");
    });

    it("parses :remove on array index", () => {
      const r = parseMutationKey("items[2]:remove");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("items");
      expect(r!.pathSegments).toEqual([{ key: "", index: 2 }]);
      expect(r!.operation).toBe("remove");
    });

    it("parses :after with selector", () => {
      const r = parseMutationKey("items[id=2]:after");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("items");
      expect(r!.pathSegments).toEqual([{ key: "", selector: { prop: "id", value: "2" } }]);
      expect(r!.operation).toBe("after");
    });

    it("parses :before with selector", () => {
      const r = parseMutationKey("items[id=2]:before");
      expect(r).not.toBeNull();
      expect(r!.operation).toBe("before");
    });

    it("trims input", () => {
      const r = parseMutationKey("  config.width  ");
      expect(r).not.toBeNull();
      expect(r!.rootKey).toBe("config");
      expect(r!.pathSegments).toEqual([{ key: "width" }]);
    });
  });

  describe("resolveSchemaAtPath", () => {
    const objectSchema: Schema = {
      type: "object",
      properties: {
        width: { type: "integer" },
        theme: { type: "string" },
        nested: {
          type: "object",
          properties: {
            deep: { type: "string" },
          },
        },
      },
    };

    const arraySchema: Schema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
    };

    it("returns null when variableSchema is null", () => {
      expect(resolveSchemaAtPath(null, [])).toBeNull();
      expect(resolveSchemaAtPath(null, [{ key: "width" }])).toBeNull();
    });

    it("returns resolved schema for empty path (root)", () => {
      const result = resolveSchemaAtPath(objectSchema, []);
      expect(result).toEqual(objectSchema);
    });

    it("resolves schema ref when variableSchema has schema key and schemasByKey provided", () => {
      const refSchema: Schema = { type: "object", properties: { x: { type: "string" } } };
      const variableSchema = { schema: "MyRef" as const };
      const result = resolveSchemaAtPath(variableSchema, [], { MyRef: refSchema });
      expect(result).toEqual(refSchema);
    });

    it("returns unresolved ref object when schema ref is missing in schemasByKey (no resolution)", () => {
      const variableSchema = { schema: "Missing" as const };
      const result = resolveSchemaAtPath(variableSchema, [], {});
      expect(result).toEqual(variableSchema);
    });

    it("resolves one level of path (object property)", () => {
      const result = resolveSchemaAtPath(objectSchema, [{ key: "width" }]);
      expect(result).toEqual({ type: "integer" });
    });

    it("resolves nested path", () => {
      const result = resolveSchemaAtPath(objectSchema, [{ key: "nested" }, { key: "deep" }]);
      expect(result).toEqual({ type: "string" });
    });

    it("returns null when path property does not exist", () => {
      const result = resolveSchemaAtPath(objectSchema, [{ key: "unknown" }]);
      expect(result).toBeNull();
    });

    it("resolves unknown object key via additionalProperties", () => {
      const result = resolveSchemaAtPath(
        {
          type: "object",
          additionalProperties: { type: "string" },
        },
        [{ key: "dynamicKey" }],
      );
      expect(result).toEqual({ type: "string" });
    });

    it("returns null when stepping into non-object", () => {
      const result = resolveSchemaAtPath(objectSchema, [{ key: "width" }, { key: "foo" }]);
      expect(result).toBeNull();
    });

    it("resolves array items schema for index segment", () => {
      const result = resolveSchemaAtPath(arraySchema, [{ key: "", index: 0 }]);
      expect(result).toEqual({
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
      });
    });

    it("resolves array item then property", () => {
      const result = resolveSchemaAtPath(arraySchema, [{ key: "", index: 0 }, { key: "name" }]);
      expect(result).toEqual({ type: "string" });
    });

    it("returns null when stepping into non-array with index segment", () => {
      const result = resolveSchemaAtPath(objectSchema, [{ key: "", index: 0 }]);
      expect(result).toBeNull();
    });

    it("returns null when schema has oneOf (path through oneOf invalid)", () => {
      const oneOfSchema: Schema = {
        oneOf: [{ type: "string" }, { type: "integer" }],
      };
      const result = resolveSchemaAtPath(oneOfSchema, [{ key: "any" }]);
      expect(result).toBeNull();
    });

    it("resolves nested ref in properties when schemasByKey provided", () => {
      const linkSchema: Schema = { type: "object", properties: { url: { type: "string" } } };
      const root: Schema = {
        type: "object",
        properties: {
          mainLink: { schema: "Link" },
        },
      };
      const result = resolveSchemaAtPath(root, [{ key: "mainLink" }], { Link: linkSchema });
      expect(result).toEqual(linkSchema);
    });
  });

  describe("parsePathMapKey", () => {
    it("returns null for empty string", () => {
      expect(parsePathMapKey("")).toBeNull();
    });

    it("returns null when parseMutationKey returns null", () => {
      expect(parsePathMapKey("   ")).toBeNull();
    });

    it("parses dot path into segments", () => {
      expect(parsePathMapKey("display.fontSize")).toEqual([
        { key: "display" },
        { key: "fontSize" },
      ]);
    });

    it("parses bracket-first path", () => {
      expect(parsePathMapKey("[0].name")).toEqual([{ key: "", index: 0 }, { key: "name" }]);
    });

    it("parses single key", () => {
      expect(parsePathMapKey("label")).toEqual([{ key: "label" }]);
    });

    it("parses deep path", () => {
      expect(parsePathMapKey("config.nested.deep")).toEqual([
        { key: "config" },
        { key: "nested" },
        { key: "deep" },
      ]);
    });

    it("parses path with array index in middle", () => {
      expect(parsePathMapKey("rows[1].label")).toEqual([
        { key: "rows", index: 1 },
        { key: "label" },
      ]);
    });
  });

  describe("validateMutationKey", () => {
    const objectSchema: Schema = {
      type: "object",
      properties: {
        theme: { type: "string" },
        compact: { type: "boolean" },
        width: { type: "integer" },
      },
      required: ["compact"],
    };

    const arraySchema: Schema = {
      type: "array",
      items: { type: "string" },
    };

    const arrayOfObjectsSchema: Schema = {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    };

    const nestedObjectSchema: Schema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            width: { type: "integer" },
            optionalKey: { type: "string" },
          },
          required: ["width"],
        },
      },
    };

    const variableSchemaByKey: Record<string, Schema> = {
      config: objectSchema,
      tags: arraySchema,
      items: arrayOfObjectsSchema,
      settings: nestedObjectSchema,
      partialMutationShowcase: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                label: { type: "string" },
              },
            },
          },
        },
      },
    };

    it("returns invalid when key is empty (parseMutationKey null)", () => {
      const r = validateMutationKey("", variableSchemaByKey);
      expect(r.valid).toBe(false);
      expect(r.error).toContain("Invalid mutation notation");
      expect(r.operation).toBe("set");
    });

    it("returns invalid when key has no root (e.g. [0] only)", () => {
      const r = validateMutationKey("[0]", variableSchemaByKey);
      expect(r.valid).toBe(false);
      expect(r.error).toContain("must start with a variable name");
    });

    it("returns invalid when root variable is not in variablesSchema", () => {
      const r = validateMutationKey("unknownVar.foo", variableSchemaByKey);
      expect(r.valid).toBe(false);
      expect(r.error).toContain("not defined in");
      expect(r.rootKey).toBe("unknownVar");
    });

    it("returns invalid when variable has schema ref but path fails (unresolved ref has no properties)", () => {
      const schemas: Record<string, Schema> = {
        myVar: { schema: "MissingRef" },
      };
      const r = validateMutationKey("myVar.foo", schemas, {});
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/path does not exist|could not be loaded/);
      expect(r.error).toContain("myVar");
    });

    it("returns invalid when root schema is oneOf and path has segments", () => {
      const schemas: Record<string, Schema> = {
        oneOfVar: { oneOf: [{ type: "string" }, { type: "integer" }] },
      };
      const r = validateMutationKey("oneOfVar.foo", schemas);
      expect(r.valid).toBe(false);
      expect(r.error).toContain("oneOf");
      expect(r.error).toContain("path resolution not defined");
    });

    describe("operation: set", () => {
      it("valid when setting whole variable (no path)", () => {
        const r = validateMutationKey("config", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("set");
        expect(r.valueSchema).toEqual(objectSchema);
      });

      it("valid when path exists in schema", () => {
        const r = validateMutationKey("config.width", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual({ type: "integer" });
      });

      it("invalid when path does not exist", () => {
        const r = validateMutationKey("config.nonexistent", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("path does not exist");
      });

      it("valid when path uses additionalProperties", () => {
        const schemas: Record<string, Schema> = {
          labels: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        };
        const r = validateMutationKey("labels.headline", schemas);
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual({ type: "string" });
      });

      it("invalid when target schema is oneOf", () => {
        const schemas: Record<string, Schema> = {
          x: {
            type: "object",
            properties: {
              choice: { oneOf: [{ type: "string" }, { type: "integer" }] },
            },
          },
        };
        const r = validateMutationKey("x.choice", schemas);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("oneOf");
        expect(r.error).toContain("mutation target must be a single schema");
      });
    });

    describe("operation: append / prepend", () => {
      it("valid on root array variable", () => {
        const rAppend = validateMutationKey("tags:append", variableSchemaByKey);
        expect(rAppend.valid).toBe(true);
        expect(rAppend.operation).toBe("append");
        expect(rAppend.valueSchema).toEqual({ type: "string" });

        const rPrepend = validateMutationKey("tags:prepend", variableSchemaByKey);
        expect(rPrepend.valid).toBe(true);
        expect(rPrepend.operation).toBe("prepend");
        expect(rPrepend.valueSchema).toEqual({ type: "string" });
      });

      it("invalid when path does not exist", () => {
        const r = validateMutationKey("config.nested:append", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("path does not exist");
      });

      it("invalid when path points to non-array", () => {
        const r = validateMutationKey("config.width:append", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("only allowed on array");
        expect(r.error).toContain("does not point to an array");
      });

      it("valid when array items is oneOf (valueSchema is the oneOf schema)", () => {
        const oneOfItems: Schema = {
          oneOf: [{ type: "string" }, { type: "integer" }],
        };
        const schemas: Record<string, Schema> = {
          arr: {
            type: "array",
            items: oneOfItems,
          },
        };
        const r = validateMutationKey("arr:append", schemas);
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual(oneOfItems);
      });

      it("valid on nested array path when schema has array at that path", () => {
        const schemas: Record<string, Schema> = {
          root: {
            type: "object",
            properties: {
              list: { type: "array", items: { type: "string" } },
            },
          },
        };
        const r = validateMutationKey("root.list:append", schemas);
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual({ type: "string" });
      });
    });

    describe("operation: after / before", () => {
      it("valid on array with index segment", () => {
        const r = validateMutationKey("items[1]:after", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("after");
        expect(r.valueSchema).toEqual({
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
        });
      });

      it("valid on array with selector segment", () => {
        const r = validateMutationKey("items[id=2]:before", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("before");
      });

      it("valid on nested array selector segment in object variable", () => {
        const r = validateMutationKey(
          "partialMutationShowcase.rows[id=1]:after",
          variableSchemaByKey,
        );
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("after");
        expect(r.valueSchema).toEqual({
          type: "object",
          properties: {
            id: { type: "integer" },
            label: { type: "string" },
          },
        });
      });

      it("invalid when path does not exist or does not point to array element", () => {
        const r = validateMutationKey("config.fake[0]:after", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/path does not exist|does not point to an array/);
      });

      it("invalid when array items is oneOf", () => {
        const schemas: Record<string, Schema> = {
          arr: {
            type: "array",
            items: { oneOf: [{ type: "string" }] },
          },
        };
        const r = validateMutationKey("arr[0]:after", schemas);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("oneOf");
      });
    });

    describe("operation: remove", () => {
      it("valid when removing optional object property", () => {
        const r = validateMutationKey("settings.config.optionalKey:remove", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("remove");
        expect(r.valueSchema).toBeNull();
      });

      it("invalid when removing required object property", () => {
        const r = validateMutationKey("config.compact:remove", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("Cannot remove required property");
        expect(r.error).toContain("compact");
        expect(r.error).toContain("required");
      });

      it("invalid when removing required nested property", () => {
        const r = validateMutationKey("settings.config.width:remove", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("Cannot remove required property");
        expect(r.error).toContain("width");
      });

      it("valid when removing array element by index", () => {
        const r = validateMutationKey("items[0]:remove", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.operation).toBe("remove");
        expect(r.valueSchema).toBeNull();
      });

      it("valid when removing array element by selector", () => {
        const r = validateMutationKey("items[id=1]:remove", variableSchemaByKey);
        expect(r.valid).toBe(true);
      });

      it("valid when removing nested array element by selector", () => {
        const r = validateMutationKey(
          "partialMutationShowcase.rows[id=2]:remove",
          variableSchemaByKey,
        );
        expect(r.valid).toBe(true);
      });

      it("invalid when path does not exist", () => {
        const r = validateMutationKey("config.bad:remove", variableSchemaByKey);
        expect(r.valid).toBe(false);
        expect(r.error).toContain("path does not exist");
      });
    });

    describe("with schema ref resolution", () => {
      it("valid when variable schema is ref and schemasByKey resolves it", () => {
        const resolvedSchema: Schema = {
          type: "object",
          properties: { title: { type: "string" }, url: { type: "string" } },
        };
        const schemas: Record<string, Schema> = {
          link: { schema: "Link" },
        };
        const r = validateMutationKey("link.title", schemas, { Link: resolvedSchema });
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual({ type: "string" });
      });

      it("valid set on resolved ref root", () => {
        const resolvedSchema: Schema = { type: "object", properties: { x: { type: "string" } } };
        const schemas: Record<string, Schema> = { v: { schema: "R" } };
        const r = validateMutationKey("v", schemas, { R: resolvedSchema });
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual(resolvedSchema);
      });
    });

    describe("edge cases", () => {
      it("valid for nested path set when all steps exist", () => {
        const r = validateMutationKey("settings.config.width", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.valueSchema).toEqual({ type: "integer" });
      });

      it("invalid for path into primitive (no properties)", () => {
        const r = validateMutationKey("config.theme.foo", variableSchemaByKey);
        expect(r.valid).toBe(false);
      });

      it("returns correct pathSegments and rootKey in result", () => {
        const r = validateMutationKey("config.theme", variableSchemaByKey);
        expect(r.valid).toBe(true);
        expect(r.rootKey).toBe("config");
        expect(r.pathSegments).toEqual([{ key: "theme" }]);
      });
    });
  });
});
