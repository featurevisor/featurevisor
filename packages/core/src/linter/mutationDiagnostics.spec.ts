import type { ParsedVariable, Schema } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema, superRefineVariableValue } from "./featureSchema";
import { z } from "zod";
import { getVariableZodSchema } from "./variableSchema";
import { validateMutationKey } from "./mutationNotation";

const config = {
  environments: false,
  tags: ["all"],
  namespaceCharacter: ".",
} as unknown as ProjectConfig;
const methods = {
  type: "array",
  items: { type: "string" },
  defaultValue: ["card"],
} as const;
const settings = {
  type: "object",
  properties: {
    currency: { type: "string", enum: ["EUR", "GBP"] },
    methods: { type: "array", items: { type: "string" } },
  },
  defaultValue: { currency: "EUR", methods: ["card"] },
} as Schema & { defaultValue: { currency: string; methods: string[] } };
const forms = [false, true].map((ordered) => ({ ordered }));
const mutations = (values: Record<string, unknown>, ordered: boolean) =>
  ordered ? Object.entries(values).map(([key, value]) => ({ [key]: value })) : values;
const entryPath = (ordered: boolean, index: number, key: string) =>
  ordered ? [index, key] : [key];

describe("authored mutation diagnostics", () => {
  it.each(forms)(
    "reports each feature path and enum error once (ordered=$ordered)",
    ({ ordered }) => {
      const schema = getFeatureZodSchema(
        config,
        getConditionsZodSchema(config, {}),
        ["userId"],
        ["netherlands"],
        ["checkout"],
      );
      const result = schema.safeParse({
        description: "Checkout",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: { methods, settings },
        rules: [
          {
            key: "all",
            conditions: "*",
            percentage: 100,
            variableOverrides: {
              methods: [
                {
                  key: "methods",
                  conditions: "*",
                  mutate: mutations({ ":append": "ideal", "nope.deep": 1 }, ordered),
                },
              ],
              settings: [
                {
                  key: "settings",
                  conditions: "*",
                  mutate: mutations({ currency: "USD" }, ordered),
                },
              ],
            },
          },
        ],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(2);
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Path "nope.deep" does not exist in the schema of variable "methods".',
            path: [
              "rules",
              0,
              "variableOverrides",
              "methods",
              0,
              "mutate",
              ...entryPath(ordered, 1, "nope.deep"),
            ],
          }),
          expect.objectContaining({
            message:
              'Value at "currency" in variable "settings" must be one of the allowed enum values (got "USD").',
            path: [
              "rules",
              0,
              "variableOverrides",
              "settings",
              0,
              "mutate",
              ...entryPath(ordered, 0, "currency"),
            ],
          }),
        ]),
      );
      expect(
        result.error.issues.some((issue) => issue.message.includes("expected an object")),
      ).toBe(false);
    },
  );

  const cases = ["ordinary", "composition", "alias"].flatMap((kind) =>
    [false, true].flatMap((ordered) =>
      [false, true].flatMap((nested) =>
        [false, true].flatMap((continuing) =>
          [false, true].map((precomputeMutations) => ({
            kind,
            ordered,
            nested,
            continuing,
            precomputeMutations,
          })),
        ),
      ),
    ),
  );
  it.each(cases)(
    "reports unique authored errors for $kind (ordered=$ordered, nested=$nested, continue=$continuing, precompute=$precomputeMutations)",
    ({ kind, ordered, nested, continuing, precomputeMutations }) => {
      const variableKey = "checkout.policy";
      const source = settings as ParsedVariable;
      const variable =
        kind === "ordinary"
          ? settings
          : { compose: kind === "alias" ? "source" : { policy: { variable: "source" } } };
      const prefix = kind === "composition" ? "policy." : "";
      const pathKey = `${prefix}methods.nope`;
      const currencyKey = `${prefix}currency`;
      const invalid = {
        key: "invalid",
        conditions: "*",
        continue: continuing,
        mutate: mutations(
          { [`${prefix}methods:append`]: "ideal", [pathKey]: 1, [currencyKey]: "USD" },
          ordered,
        ),
      };
      const overrides = nested
        ? [{ key: "parent", conditions: "*", mutate: {}, overrides: [invalid] }]
        : [invalid];
      const schema = getVariableZodSchema(
        { ...config, precomputeMutations },
        {},
        [],
        {},
        {},
        { source },
        () => variableKey,
      );
      const result = schema.safeParse({ description: "Checkout policy", ...variable, overrides });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(2);
      const base = nested ? ["overrides", 0, "overrides", 0, "mutate"] : ["overrides", 0, "mutate"];
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              kind === "ordinary"
                ? `Path "${pathKey}" does not exist in the schema of variable "${variableKey}".`
                : expect.stringContaining(`Mutation "${pathKey}" in variable "${variableKey}"`),
            path: [...base, ...entryPath(ordered, 1, pathKey)],
          }),
          expect.objectContaining({
            message: `Value at "${currencyKey}" in variable "${variableKey}" must be one of the allowed enum values (got "USD").`,
            path: [...base, ...entryPath(ordered, 2, currencyKey)],
          }),
        ]),
      );
      for (const issue of result.error.issues) {
        expect(issue.message).not.toContain('variable "value"');
        expect(issue.message).not.toContain('"value.methods');
        expect(issue.message).not.toContain('"variable.methods');
        expect(issue.message).not.toContain("expected an object");
      }
    },
  );

  it.each(["set", "append", "prepend", "appendUnique", "removeValue", "remove", "before", "after"])(
    "uses the authored path in %s diagnostics without changing the validation root",
    (operation) => {
      const target =
        operation === "before" || operation === "after" ? "methods.nope[0]" : "methods.nope";
      const path = operation === "set" ? target : `${target}:${operation}`;
      const result = validateMutationKey(
        `value.${path}`,
        { value: settings },
        {},
        { variableKey: "value.actual", path },
      );
      expect(result.valid).toBe(false);
      expect(result.rootKey).toBe("value");
      expect(result.error).toBe(
        `Path "${target}" does not exist in the schema of variable "value.actual"${operation === "set" ? "" : ` (operation :${operation})`}.`,
      );
    },
  );

  const valueCases: Array<{
    name: string;
    schema: Parameters<typeof superRefineVariableValue>[1];
    value: unknown;
    suffix: string;
    type?: string;
    limits?: Partial<ProjectConfig>;
  }> = [
    {
      name: "enum",
      schema: { type: "string", enum: ["EUR", "GBP"] },
      value: "USD",
      suffix: ' must be one of the allowed enum values (got "USD").',
    },
    {
      name: "constant",
      schema: { const: "EUR" },
      value: "USD",
      suffix: ' must equal the constant value defined in schema (got "USD").',
    },
    {
      name: "oneOf none",
      schema: { oneOf: [{ type: "string" }, { type: "boolean" }] },
      value: 1,
      suffix: " must match exactly one of the `oneOf` schemas (got 1; matched none).",
    },
    {
      name: "oneOf multiple",
      schema: { oneOf: [{ type: "integer" }, { type: "number" }] },
      value: 1,
      suffix: " must match exactly one of the `oneOf` schemas (matched 2).",
    },
    {
      name: "required value",
      schema: { type: "string" },
      value: undefined,
      suffix: " is required.",
    },
    {
      name: "string type",
      schema: { type: "string" },
      value: null,
      type: "string",
      suffix: " must be a string, but got null.",
    },
    {
      name: "timestamp",
      schema: { type: "string", format: "date-time" },
      value: "tomorrow",
      suffix:
        " is not a valid portable timestamp for format: date-time. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.",
    },
    {
      name: "minLength",
      schema: { type: "string", minLength: 2 },
      value: "a",
      type: "string",
      suffix: " must be at least 2 characters long (`minLength`), but has 1.",
    },
    {
      name: "maxLength",
      schema: { type: "string", maxLength: 1 },
      value: "ab",
      type: "string",
      suffix: " must be at most 1 characters long (`maxLength`), but has 2.",
    },
    {
      name: "pattern",
      schema: { type: "string", pattern: "^[A-Z]+$" },
      value: "lower",
      type: "string",
      suffix: " does not match `pattern`.",
    },
    {
      name: "project string limit",
      schema: { type: "string" },
      value: "ab",
      limits: { maxVariableStringLength: 1 },
      suffix: " is 2 characters long, but the project allows at most 1 (maxVariableStringLength).",
    },
    {
      name: "integer type",
      schema: { type: "integer" },
      value: "high",
      type: "integer",
      suffix: " must be a number, but got a string.",
    },
    {
      name: "integer finite",
      schema: { type: "integer" },
      value: Infinity,
      type: "integer",
      suffix: " must be a finite number, but got Infinity.",
    },
    {
      name: "integer fraction",
      schema: { type: "integer" },
      value: 1.5,
      type: "integer",
      suffix: " must be an integer, but got 1.5.",
    },
    {
      name: "integer minimum",
      schema: { type: "integer", minimum: 2 },
      value: 1,
      type: "integer",
      suffix: " must be >= minimum (2), but got 1.",
    },
    {
      name: "integer maximum",
      schema: { type: "integer", maximum: 1 },
      value: 2,
      type: "integer",
      suffix: " must be <= maximum (1), but got 2.",
    },
    {
      name: "double type",
      schema: { type: "number" },
      value: false,
      type: "number",
      suffix: " must be a number, but got a boolean.",
    },
    {
      name: "double finite",
      schema: { type: "number" },
      value: NaN,
      type: "number",
      suffix: " must be a finite number, but got NaN.",
    },
    {
      name: "double minimum",
      schema: { type: "number", minimum: 2 },
      value: 1.5,
      type: "number",
      suffix: " must be >= minimum (2), but got 1.5.",
    },
    {
      name: "double maximum",
      schema: { type: "number", maximum: 1 },
      value: 1.5,
      type: "number",
      suffix: " must be <= maximum (1), but got 1.5.",
    },
    {
      name: "boolean type",
      schema: { type: "boolean" },
      value: 1,
      type: "boolean",
      suffix: " must be a boolean, but got a number.",
    },
    {
      name: "array type",
      schema: { type: "array" },
      value: {},
      type: "array",
      suffix: " must be an array, but got an object.",
    },
    {
      name: "minItems",
      schema: { type: "array", minItems: 1 },
      value: [],
      type: "array",
      suffix: " must have at least 1 items (`minItems`), but has 0.",
    },
    {
      name: "maxItems",
      schema: { type: "array", maxItems: 1 },
      value: ["a", "b"],
      type: "array",
      suffix: " must have at most 1 items (`maxItems`), but has 2.",
    },
    {
      name: "uniqueItems",
      schema: { type: "array", uniqueItems: true },
      value: ["a", "a"],
      type: "array",
      suffix: " has duplicate items at indices 0 and 1 but `uniqueItems` is true.",
    },
    {
      name: "implicit string items",
      schema: { type: "array" },
      value: [1],
      type: "array",
      suffix:
        ": when `items` is not set, array must contain only strings; found non-string element.",
    },
    {
      name: "project array limit",
      schema: { type: "array" },
      value: ["a"],
      limits: { maxVariableArrayStringifiedLength: 1 },
      suffix: " array is too long (5 characters), max length is 1",
    },
    {
      name: "object type",
      schema: { type: "object" },
      value: [],
      type: "object",
      suffix: " must be a plain object, but got an array.",
    },
    {
      name: "flat object",
      schema: { type: "object" },
      value: { nested: {} },
      suffix:
        ' is a flat object (no `properties` in schema); property "nested" must be a primitive (string, number, boolean, or null), got: object',
    },
    {
      name: "project object limit",
      schema: { type: "object" },
      value: { a: 1 },
      limits: { maxVariableObjectStringifiedLength: 1 },
      suffix: " object is too long (7 characters), max length is 1",
    },
    {
      name: "json type",
      schema: { type: "json" },
      value: 1,
      type: "json",
      suffix: " must be a string (JSON string), but got a number.",
    },
    {
      name: "json parse",
      schema: { type: "json" },
      value: "invalid",
      type: "json",
      suffix: " must be a valid JSON string; parse failed.",
    },
    {
      name: "project json limit",
      schema: { type: "json" },
      value: '{"a":1}',
      limits: { maxVariableJSONStringifiedLength: 1 },
      suffix: " JSON is too long (7 characters), max length is 1",
    },
    {
      name: "unknown type",
      schema: {},
      value: 1,
      suffix: ' has unknown or unsupported type "undefined" in variablesSchema.',
    },
  ];
  it.each(valueCases)(
    "identifies mutation operands in every value check: $name",
    ({ name, schema, value, suffix, type, limits }) => {
      const sourcePath = ["overrides", 0, "mutate", 1, "tiers[0].limit:append"];
      const check = (mutation: boolean) =>
        z
          .any()
          .superRefine((_, ctx) => {
            superRefineVariableValue(
              { ...config, ...limits },
              schema,
              value,
              sourcePath,
              ctx,
              "settings",
              {},
              mutation ? { variableKey: "settings", path: "tiers[0].limit" } : undefined,
            );
          })
          .safeParse(null);
      for (const mutation of [false, true]) {
        const result = check(mutation);
        expect(result.success).toBe(false);
        if (result.success) continue;
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            message: `${mutation ? 'Value at "tiers[0].limit" in variable "settings"' : `Variable "settings"${type ? ` (type ${type})` : ""}`}${suffix}`,
            path: name === "flat object" ? [...sourcePath, "nested"] : sourcePath,
          }),
        ]);
      }
    },
  );

  const kinds = ["feature", "ordinary", "composition", "alias"];
  const entityCases = kinds.flatMap((kind) => forms.map(({ ordered }) => ({ kind, ordered })));
  const richSettings = {
    ...settings,
    properties: {
      ...settings.properties,
      tiers: {
        type: "array",
        items: { type: "object", properties: { limit: { type: "integer" } } },
      },
    },
    defaultValue: { ...settings.defaultValue, tiers: [{ limit: 1 }] },
  } as ParsedVariable;
  const parseMutation = (kind: string, mutate: ReturnType<typeof mutations>) => {
    if (kind === "feature") {
      return getFeatureZodSchema(
        config,
        getConditionsZodSchema(config, {}),
        ["userId"],
        ["netherlands"],
        ["checkout"],
      ).safeParse({
        description: "Checkout",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: { settings: richSettings },
        rules: [
          {
            key: "all",
            conditions: "*",
            percentage: 100,
            variableOverrides: { settings: [{ conditions: "*", mutate }] },
          },
        ],
      });
    }
    const definition =
      kind === "ordinary"
        ? richSettings
        : { compose: kind === "alias" ? "source" : { policy: { variable: "source" } } };
    return getVariableZodSchema(
      config,
      {},
      [],
      {},
      {},
      { source: richSettings },
      () => "composed",
    ).safeParse({
      description: "Policy",
      ...definition,
      overrides: [{ key: "override", conditions: "*", mutate }],
    });
  };
  it.each(entityCases)(
    "keeps the variable, operand path and source location for $kind (ordered=$ordered)",
    ({ kind, ordered }) => {
      const prefix = kind === "composition" ? "policy." : "";
      const variable = kind === "feature" ? "settings" : "composed";
      const base =
        kind === "feature"
          ? ["rules", 0, "variableOverrides", "settings", 0, "mutate"]
          : ["overrides", 0, "mutate"];
      const entries = [
        {
          key: `${prefix}currency`,
          path: `${prefix}currency`,
          subject: undefined as string | undefined,
          value: "USD",
          suffix: ' must be one of the allowed enum values (got "USD").',
        },
        {
          key: `${prefix}tiers[0].limit`,
          path: `${prefix}tiers[0].limit`,
          subject: undefined,
          value: "high",
          suffix: " must be a number, but got a string.",
        },
        {
          key: `${prefix}methods:append`,
          path: `${prefix}methods`,
          subject: `Item appended to "${prefix}methods"`,
          value: 7,
          suffix: " must be a string, but got a number.",
        },
      ];
      const result = parseMutation(
        kind,
        mutations(Object.fromEntries(entries.map((entry) => [entry.key, entry.value])), ordered),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toEqual(
        entries.map((entry, index) =>
          expect.objectContaining({
            message: `${entry.subject ?? `Value at "${entry.path}"`} in variable "${variable}"${entry.suffix}`,
            path: [...base, ...entryPath(ordered, index, entry.key)],
          }),
        ),
      );
    },
  );
  it.each(
    entityCases.flatMap((entry) =>
      ["append", "prepend", "appendUnique", "removeValue", "remove", "before", "after"].map(
        (operation) => ({ ...entry, operation }),
      ),
    ),
  )(
    "separates :$operation from the path for $kind (ordered=$ordered)",
    ({ kind, ordered, operation }) => {
      const target = `${kind === "composition" ? "policy." : ""}methods.nope${operation === "before" || operation === "after" ? "[0]" : ""}`;
      const key = `${target}:${operation}`;
      const result = parseMutation(
        kind,
        mutations({ [key]: operation === "remove" ? true : "value" }, ordered),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      const variable = kind === "feature" ? "settings" : "composed";
      const base =
        kind === "feature"
          ? ["rules", 0, "variableOverrides", "settings", 0, "mutate"]
          : ["overrides", 0, "mutate"];
      const message =
        kind === "feature" || kind === "ordinary"
          ? `Path "${target}" does not exist in the schema of variable "${variable}" (operation :${operation}).`
          : `Mutation "${target}" in variable "${variable}" (operation :${operation}): Mutation path requires an object property.`;
      expect(result.error.issues).toEqual([
        expect.objectContaining({ message, path: [...base, ...entryPath(ordered, 0, key)] }),
      ]);
    },
  );

  it.each([
    {
      name: "nested array property",
      schema: {
        type: "array",
        items: { type: "object", properties: { limit: { type: "integer" } } },
      },
      value: [{ limit: "high" }],
      relative: "tiers[0].limit",
      location: [0, "limit"],
      suffix: " must be a number, but got a string.",
    },
    {
      name: "additional property",
      schema: { type: "object", properties: {}, additionalProperties: { type: "integer" } },
      value: { limit: "high" },
      relative: "tiers.limit",
      location: ["limit"],
      suffix: " must be a number, but got a string.",
    },
    {
      name: "additional property without properties",
      schema: { type: "object", additionalProperties: { type: "integer" } },
      value: { limit: "high" },
      relative: "tiers.limit",
      location: ["limit"],
      suffix: " must be a number, but got a string.",
    },
    {
      name: "required property",
      schema: { type: "object", properties: { limit: { type: "integer" } }, required: ["limit"] },
      value: {},
      relative: "tiers",
      location: ["limit"],
      suffix: ' is missing required property "limit".',
    },
    {
      name: "unknown property",
      schema: { type: "object", properties: {} },
      value: { extra: 1 },
      relative: "tiers",
      location: ["extra"],
      suffix: ' has unknown property "extra" (not in schema).',
    },
  ])(
    "preserves identity through recursive $name validation",
    ({ schema, value, relative, location, suffix }) => {
      const sourcePath = ["overrides", 0, "mutate", "tiers"];
      const result = z
        .any()
        .superRefine((_, ctx) => {
          superRefineVariableValue(
            config,
            schema as Schema,
            value,
            sourcePath,
            ctx,
            "settings",
            {},
            { variableKey: "settings", path: "tiers" },
          );
        })
        .safeParse(null);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          message: `Value at "${relative}" in variable "settings"${suffix}`,
          path: [...sourcePath, ...location],
        }),
      ]);
    },
  );

  const itemSchema = {
    type: "array",
    items: {
      type: "object",
      properties: { id: { type: "string", maxLength: 3 } },
      required: ["id"],
    },
  } as Schema;
  const refineOperand = (path: string, operation: string, schema: Schema, value: unknown) =>
    z
      .any()
      .superRefine((_, ctx) => {
        superRefineVariableValue(
          config,
          schema,
          value,
          ["overrides", 0, "mutate"],
          ctx,
          "list",
          {},
          {
            variableKey: "list",
            path,
            operation,
          },
        );
      })
      .safeParse(null);
  it.each([
    ["append", "Item appended to"],
    ["appendUnique", "Item appended to"],
    ["prepend", "Item prepended to"],
    ["removeValue", "Item removed from"],
    ["before", "Item inserted before"],
    ["after", "Item inserted after"],
  ])("names the item for :%s operands", (operation, label) => {
    const path = operation === "before" || operation === "after" ? "items[0]" : "items";
    const messages = (value: unknown) => {
      const result = refineOperand(path, operation, itemSchema.items as Schema, value);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(messages(7)).toEqual([
      `${label} "${path}" in variable "list" must be a plain object, but got a number.`,
    ]);
    expect(messages({})).toEqual([
      `${label} "${path}" in variable "list" is missing required property "id".`,
    ]);
    expect(messages({ id: "long" })).toEqual([
      `Value at "id" in the ${label.toLowerCase()} "${path}" in variable "list" must be at most 3 characters long (\`maxLength\`), but has 4.`,
    ]);
  });

  it("names the variable itself for root mutations", () => {
    expect(refineOperand("", "set", { type: "string" } as Schema, 7)).toMatchObject({
      success: false,
      error: {
        issues: [
          expect.objectContaining({
            message: 'Value of variable "list" must be a string, but got a number.',
          }),
        ],
      },
    });
    expect(refineOperand("", "append", { type: "string" } as Schema, 7)).toMatchObject({
      success: false,
      error: {
        issues: [
          expect.objectContaining({
            message: 'Item appended to variable "list" must be a string, but got a number.',
          }),
        ],
      },
    });
  });
});
