import type { ParsedVariable, Schema } from "@featurevisor/types";
import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectConfig } from "../config";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "./lintProject";
import { getVariableZodSchema } from "./variableSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { createCompositionWarningInspector } from "./compositionWarnings";

const config = { tags: [], disallowOperators: [] } as unknown as ProjectConfig;
const schemas: Record<string, Schema> = {
  count: { type: "integer", minimum: 1 },
  policy: {
    type: "object",
    required: ["limit", "methods"],
    properties: {
      limit: { schema: "count" },
      methods: { type: "array", items: { type: "string" } },
      optional: { type: "string" },
    },
  },
};
const variables: Record<string, ParsedVariable> = {
  "config/policy.literal": { schema: "policy", defaultValue: { limit: 5, methods: [] } },
  count: { type: "integer", defaultValue: 1 },
  text: { type: "string", defaultValue: "text" },
  flag: { type: "boolean", defaultValue: false },
  list: { type: "array", items: { type: "integer" }, defaultValue: [1] },
  raw: { type: "json", defaultValue: "{}" },
  union: { oneOf: [{ type: "string" }, { type: "boolean" }], defaultValue: "text" },
  archived: { type: "boolean", defaultValue: true, archived: true },
  alias: { compose: "config/policy.literal" },
  chain: { compose: "alias" },
  map: { compose: { "literal.alias": { variable: "chain" } } },
  mapAlias: { compose: "map" },
};
const schema = () => getVariableZodSchema(config, {}, [], {}, schemas, variables);
const check = (source: string, override?: unknown) =>
  schema().safeParse({
    description: "Alias",
    compose: source,
    ...(override ? { overrides: [override] } : {}),
  });
const value = (source: string, value: unknown) =>
  check(source, { key: "replace", conditions: "*", value });
const mutate = (source: string, mutate: unknown) =>
  check(source, { key: "change", conditions: "*", mutate });
describe("string composition authoring and inferred shapes", () => {
  it.each([5, true, false, null, undefined, [], ["count"], new Date(0), new Map()])(
    "explains the supported compose shapes for %j",
    (compose) => {
      const result = schema().safeParse({ description: "Unsupported compose", compose });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            path: ["compose"],
            message: "compose must be a global variable key or a nonempty map of references.",
          }),
        ]);
    },
  );
  it("suggests map composition when a string source is a feature", () => {
    const features = {
      exp: { key: "exp", description: "Experiment", bucketBy: "userId", rules: [] },
    };
    const validate = getVariableZodSchema(config, {}, [], features, schemas, variables);
    const result = validate.safeParse({ description: "Mistaken feature source", compose: "exp" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["compose"],
          message:
            'Unknown global variable "exp". "exp" is a feature. Use { enabled: { feature: "exp" } } in compose to read its flag.',
        }),
      ]);
    expect(
      getVariableZodSchema(config, {}, [], features, schemas, {
        ...variables,
        exp: { type: "boolean", defaultValue: true },
      }).safeParse({ description: "Existing global source wins", compose: "exp" }).success,
    ).toBe(true);
    expect(
      validate.safeParse({ description: "Feature flag", compose: { enabled: { feature: "exp" } } })
        .success,
    ).toBe(true);
  });
  it.each([
    ["count", { key: "replace", conditions: "*", value: "lots" }, ["overrides", 0, "value"]],
    ["count", { key: "replace", conditions: "*", value: 0 }, ["overrides", 0, "value"]],
    ["union", { key: "replace", conditions: "*", value: 4 }, ["overrides", 0, "value"]],
    [
      "alias",
      { key: "mutate", conditions: "*", mutate: { limit: 0 } },
      ["overrides", 0, "mutate", "limit"],
    ],
    [
      { total: { variable: "count" } },
      { key: "replace", conditions: "*", value: { total: "lots" } },
      ["overrides", 0, "value", "total"],
    ],
  ])("names the composed variable in override diagnostics for %j", (compose, override, path) => {
    let currentKey = "regional/first";
    const validate = getVariableZodSchema(
      config,
      {},
      [],
      {},
      schemas,
      {
        ...variables,
        count: { schema: "count", defaultValue: 1 },
      },
      () => currentKey,
    );
    for (const key of ["regional/first", "regional/next"]) {
      currentKey = key;
      const result = validate.safeParse({
        description: "Invalid replacement",
        compose,
        overrides: [override],
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            path,
            message:
              "mutate" in override
                ? `Value at "limit" in variable "${key}" must be >= minimum (1), but got 0.`
                : expect.stringContaining(`Variable "${key}"`),
          }),
        ]);
    }
  });
  it("infers long alias chains without recursive stack growth", () => {
    const definitions: Record<string, ParsedVariable> = {
      source: {
        type: "object",
        properties: { count: { type: "integer" } },
        defaultValue: { count: 1 },
        conditions: { feature: "gate" },
      },
    };
    let key = "source";
    for (let index = 0; index < 5000; index++) {
      definitions[`alias${index}`] = { compose: key };
      key = `alias${index}`;
    }
    const root: ParsedVariable = {
      description: "Root",
      compose: key,
      overrides: [{ key: "change", conditions: "*", mutate: { count: 2 } }],
    };
    expect(getVariableZodSchema(config, {}, [], {}, {}, definitions).safeParse(root).success).toBe(
      true,
    );
    expect(
      getConditionsZodSchema({} as any, {}, {}, {}, definitions).safeParse({
        variable: key,
        path: ["count"],
        operator: "equals",
        value: 2,
      }).success,
    ).toBe(true);
    expect(createCompositionWarningInspector({}, definitions, {})(root)).toEqual([
      expect.objectContaining({
        code: "composition_nullable_mutation",
        path: ["overrides", 0, "mutate", "count"],
      }),
    ]);
  });
  it.each([
    "config/policy.literal",
    "alias",
    "chain",
    "mapAlias",
    "raw",
    "count",
    "text",
    "flag",
    "list",
    "union",
  ])("accepts exact global source %s", (source) => {
    expect(check(source).success).toBe(true);
  });
  it.each(["", "missing", "config/policy.literal:limit", "config.policy.literal"])(
    "rejects invalid source %j at compose",
    (source) => {
      const result = check(source);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["compose"]);
    },
  );
  it.each(["type", "schema", "defaultValue", "disabledValue", "conditions", "conditions"])(
    "rejects authored %s on an alias",
    (field) => {
      const result = schema().safeParse({
        description: "Alias",
        compose: "alias",
        [field]: "forbidden",
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual([field]);
    },
  );
  it("exposes string and map authoring in the editor schema", () => {
    const json = z.toJSONSchema(schema().editorSchema, { io: "input", unrepresentable: "any" });
    const compose = json.anyOf![1].properties!.compose as z.core.JSONSchema.JSONSchema;
    expect(compose.anyOf!.map((branch) => branch.type)).toEqual(["string", "object"]);
  });
  it.each([
    ["count", 4],
    ["count", null],
    ["text", "changed"],
    ["text", null],
    ["flag", false],
    ["list", [2]],
    ["list", null],
    ["chain", { limit: 2, methods: ["card"] }],
    ["chain", null],
    ["mapAlias", { "literal.alias": null }],
    ["mapAlias", null],
    ["union", true],
    ["raw", { decoded: true }],
    ["raw", [1, null]],
    ["raw", "plain decoded string"],
    ["raw", null],
  ])("validates evaluated replacement for %s: %j", (source, replacement) => {
    expect(value(source as string, replacement).success).toBe(true);
  });
  it.each([
    ["count", "4"],
    ["count", 1.5],
    ["flag", "false"],
    ["list", ["2"]],
    ["chain", { limit: 2 }],
    ["chain", { limit: 0, methods: [] }],
    ["chain", []],
    ["mapAlias", {}],
    ["mapAlias", { invented: null }],
    ["union", 2],
  ])("rejects incompatible replacement for %s: %j", (source, replacement) => {
    expect(value(source as string, replacement).success).toBe(false);
  });
  it.each([
    ["chain", { limit: 2 }],
    ["chain", { "methods:append": "card" }],
    ["chain", { "optional:remove": true }],
    ["list", { "[0]": 2 }],
    ["raw", { "unknown.nested": { arbitrary: true } }],
  ])("validates evaluated mutations for %s: %j", (source, mutation) => {
    expect(mutate(source as string, mutation).success).toBe(true);
  });
  it.each([
    ["chain", { limit: "2" }],
    ["chain", { "limit:remove": true }],
    ["chain", { "methods:append": 2 }],
    ["chain", { "missing.child": 2 }],
    ["list", { "[0]": "2" }],
    ["count", { nested: 2 }],
    ["mapAlias", { "invented.limit": 2 }],
  ])("rejects incompatible mutations for %s: %j", (source, mutation) => {
    expect(mutate(source as string, mutation).success).toBe(false);
  });
  it("uses source schemas for requirement paths through aliases and maps, never JSON", () => {
    const required = getConditionsZodSchema(
      {} as any,
      {},
      schemas,
      {},
      { ...variables, jsonAlias: { compose: "raw" } },
    );
    for (const [variable, path] of [
      ["chain", ["limit"]],
      ["mapAlias", ["literal.alias", "limit"]],
    ] as const) {
      expect(required.safeParse({ variable, path, operator: "equals", value: 2 }).success).toBe(
        true,
      );
      expect(required.safeParse({ variable, path, operator: "equals", value: "2" }).success).toBe(
        false,
      );
      expect(required.safeParse({ variable, path: ["missing"], operator: "exists" }).success).toBe(
        false,
      );
    }
    expect(
      required.safeParse({ variable: "count", operator: "greaterThan", value: 1 }).success,
    ).toBe(true);
    for (const path of [undefined, ["anything"]]) {
      const result = required.safeParse({ variable: "jsonAlias", path, operator: "exists" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'this condition reads one through global variable "jsonAlias". Give global variable "raw" a declared shape',
        );
        expect(result.error.issues[0].path).toEqual([path ? "path" : "variable"]);
      }
    }
  });
  it("terminates inference through mixed alias and map cycles", () => {
    const cyclic: Record<string, ParsedVariable> = {
      alias: { compose: "map" },
      map: { compose: { self: { variable: "alias" } } },
    };
    expect(
      getConditionsZodSchema({} as any, {}, {}, {}, cyclic).safeParse({
        variable: "alias",
        path: ["self"],
        operator: "exists",
      }).success,
    ).toBe(true);
    expect(
      getVariableZodSchema(config, {}, [], {}, {}, cyclic).safeParse({
        description: "Alias",
        compose: "alias",
        overrides: [{ key: "replace", conditions: "*", value: null }],
      }).success,
    ).toBe(true);
  });
});

describe("string composition project lint", () => {
  it.each(["valid", "self", "mixed", "archived", "missing"])(
    "lints %s alias sources with authored provenance",
    async (kind) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-alias-lint-"));
      try {
        fs.writeFileSync(
          path.join(root, "featurevisor.config.js"),
          'module.exports={parser:"json"};',
        );
        fs.mkdirSync(path.join(root, "variables"));
        fs.writeFileSync(
          path.join(root, "variables", "alias.json"),
          JSON.stringify({ description: "Alias", compose: kind === "self" ? "alias" : "source" }),
        );
        if (kind !== "missing")
          fs.writeFileSync(
            path.join(root, "variables", "source.json"),
            JSON.stringify({
              description: "Source",
              ...(kind === "mixed"
                ? { compose: { back: { variable: "alias" } } }
                : {
                    type: "integer",
                    defaultValue: 1,
                    ...(kind === "archived" ? { archived: true } : {}),
                  }),
            }),
          );
        const projectConfig = getProjectConfig(root);
        const result = await lintProject(
          {
            rootDirectoryPath: root,
            projectConfig,
            datasource: new Datasource(projectConfig, root),
            options: {},
          } as any,
          { json: true },
        );
        expect(result.hasError).toBe(kind !== "valid");
        if (kind === "self" || kind === "mixed") {
          expect(result.errors).toEqual([
            expect.objectContaining({
              key: "alias",
              path: ["compose"],
              code: "circular_dependency",
              message: expect.stringContaining('variable "alias" compose ->'),
            }),
          ]);
        } else if (kind !== "valid")
          expect(result.errors).toEqual([
            expect.objectContaining({
              key: "alias",
              path: ["compose"],
              message: expect.stringContaining(
                kind === "archived" ? "Archived variable" : "Unknown global variable",
              ),
            }),
          ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("alias composition advisory warnings", () => {
  const sources: Record<string, ParsedVariable> = {
    source: { type: "object", defaultValue: {}, conditions: { feature: "gate" } },
    alias: { compose: "source" },
    nullableAlias: { compose: "safe", overrides: [{ key: "null", conditions: "*", value: null }] },
    safe: { type: "object", defaultValue: {} },
    experiment: {
      compose: {
        assignment: { feature: "experiment", variation: true as const },
        payload: { feature: "experiment", variable: "payload" },
        safe: { variable: "safe" },
      },
    },
    experimentAlias: { compose: "experiment" },
  };
  const inspect = createCompositionWarningInspector(
    {
      experiment: {
        key: "experiment",
        description: "Experiment",
        bucketBy: "userId",
        variations: [{ value: "control", weight: 100 }],
        variablesSchema: { payload: { type: "object", defaultValue: {} } },
      },
    },
    sources,
    {},
  );
  it.each(["append", "prepend", "appendUnique", "removeValue"])(
    "warns when root %s skips a null array alias",
    (operation) => {
      const definitions: Record<string, ParsedVariable> = {
        list: {
          type: "array",
          items: { type: "string" },
          defaultValue: [],
          conditions: { feature: "gate" },
        },
        alias: { compose: "list" },
      };
      const inspect = createCompositionWarningInspector({}, definitions, {});
      const mutate = { [`:${operation}`]: "item" };
      expect(
        inspect({ compose: "alias", overrides: [{ key: "change", conditions: "*", mutate }] }),
      ).toEqual([
        expect.objectContaining({
          code: "composition_nullable_mutation",
          path: ["overrides", 0, "mutate", `:${operation}`],
        }),
      ]);
      expect(
        inspect({
          compose: "alias",
          overrides: [
            {
              key: "change",
              conditions: [{ variable: "alias", operator: "notNull" }],
              mutate,
            },
          ],
        }),
      ).toEqual([]);
    },
  );
  it.each(["source", "alias", "nullableAlias"])(
    "warns for traversing nullable alias source %s without a synthetic member",
    (compose) => {
      expect(
        inspect({
          compose,
          overrides: [{ key: "change", conditions: "*", mutate: { child: true } }],
        }),
      ).toEqual([
        expect.objectContaining({
          code: "composition_nullable_mutation",
          path: ["overrides", 0, "mutate", "child"],
        }),
      ]);
    },
  );
  it("suppresses nullable traversal warnings with a whole source guard", () => {
    expect(
      inspect({
        compose: "alias",
        overrides: [
          {
            key: "change",
            conditions: [{ variable: "alias", operator: "notNull" }],
            mutate: { child: true },
          },
        ],
      }),
    ).toEqual([]);
  });
  it("does not warn for full replacements or nonnull sources", () => {
    expect(
      inspect({ compose: "alias", overrides: [{ key: "replace", conditions: "*", value: {} }] }),
    ).toEqual([]);
    expect(
      inspect({
        compose: "safe",
        overrides: [{ key: "change", conditions: "*", mutate: { child: true } }],
      }),
    ).toEqual([]);
  });
  it.each(["experiment", "experimentAlias"])(
    "retains experiment provenance through alias %s",
    (compose) => {
      expect(
        inspect({ compose, overrides: [{ key: "replace", conditions: "*", value: {} }] }),
      ).toEqual([
        expect.objectContaining({
          code: "composition_experiment_override",
          path: ["overrides", 0, "value"],
        }),
      ]);
      expect(
        inspect({ compose, overrides: [{ key: "change", conditions: "*", mutate: { safe: {} } }] }),
      ).toEqual([]);
      expect(
        inspect({
          compose,
          overrides: [{ key: "change", conditions: "*", mutate: { assignment: "control" } }],
        }),
      ).toEqual([
        expect.objectContaining({
          code: "composition_experiment_override",
          path: ["overrides", 0, "mutate", "assignment"],
        }),
      ]);
    },
  );
});
