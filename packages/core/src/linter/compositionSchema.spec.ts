import type { ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { z } from "zod";
import { getVariableZodSchema } from "./variableSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { getChecksZodSchema } from "./testSchema";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { lintProject } from "./lintProject";
import { getCustomDatafile } from "../builder/buildDatafile";
import { createFeaturevisor } from "@featurevisor/sdk";

const config = { tags: ["web"] } as ProjectConfig;
const features = {
  "shop.checkout": {
    description: "Checkout",
    variations: [{ value: "enabled" }, { value: "disabled" }],
    disabledVariationValue: "disabled",
    variablesSchema: { "button.label": { type: "string", defaultValue: "Buy" } },
  },
  "shop/checkout": { description: "Slash feature" },
  archived: { description: "Archived", archived: true },
} as unknown as Record<string, ParsedFeature>;
const schemas: Record<string, Schema> = {
  delivery: { type: "object", properties: { threshold: { type: "integer" } } },
};
const variables: Record<string, ParsedVariable> = {
  "delivery.policy": { schema: "delivery", defaultValue: { threshold: 5 } },
  "json/policy": { type: "json", defaultValue: "{}" },
  archived: { type: "boolean", defaultValue: false, archived: true },
  nested: { description: "Nested", compose: { delivery: { variable: "delivery.policy" } } },
};
const definition = {
  description: "Checkout configuration",
  tags: ["web"],
  deprecated: false,
  archived: false,
  promotable: true,
  compose: {
    "flag.literal": { feature: "shop.checkout" },
    "layout/literal": { feature: "shop.checkout", variation: true },
    label: { feature: "shop.checkout", variable: "button.label" },
    delivery: { variable: "delivery.policy" },
    nested: { variable: "nested" },
    json: { variable: "json/policy" },
    slash: { feature: "shop/checkout" },
  },
};
function schema(project = config) {
  return getVariableZodSchema(project, {}, [], features, schemas, variables);
}
function issues(value: unknown, project = config) {
  const result = schema(project).safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected validation failure");
  return result.error.issues;
}

describe("composed variable authoring", () => {
  it("rejects null only variation references at the authored member", () => {
    expect(
      issues({
        description: "Bad variation",
        compose: { layout: { feature: "shop/checkout", variation: true } },
      }),
    ).toEqual([
      expect.objectContaining({
        path: ["compose", "layout", "variation"],
        message:
          'Feature "shop/checkout" has no variations, so this member is always null. Reference its flag instead.',
      }),
    ]);
  });
  it("allows a variation reference with only a disabled variation fallback", () => {
    const schema = getVariableZodSchema(
      config,
      {},
      [],
      {
        source: { description: "Disabled variation", disabledVariationValue: "off" },
      } as unknown as Record<string, ParsedFeature>,
      {},
      {},
    );
    expect(
      schema.safeParse({
        description: "View",
        compose: { layout: { feature: "source", variation: true } },
      }).success,
    ).toBe(true);
  });
  it.each([false, true])("reports one missing operation error with nesting=%s", (nested) => {
    const child = { key: "child", conditions: "*" };
    const overrides = nested
      ? [{ key: "parent", conditions: "*", mutate: {}, overrides: [child] }]
      : [child];
    expect(issues({ ...definition, overrides })).toEqual([
      expect.objectContaining({
        path: ["overrides", 0, ...(nested ? ["overrides", 0] : []), "value"],
        message: "An override must define exactly one of `value` or `mutate`.",
      }),
    ]);
  });
  it("reports large composition cost on compose rather than inventing requirements", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-cost-"));
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports = { parser: "json" };',
      );
      fs.mkdirSync(path.join(root, "variables"));
      const compose: Record<
        string,
        {
          variable: string;
        }
      > = {};
      for (let index = 0; index < 1001; index++) {
        const key = `source${index}`;
        compose[`alias${index}`] = { variable: key };
        fs.writeFileSync(
          path.join(root, "variables", `${key}.json`),
          JSON.stringify({ description: "Source", type: "boolean", defaultValue: true }),
        );
      }
      fs.writeFileSync(
        path.join(root, "variables", "composed.json"),
        JSON.stringify({ description: "Composition", compose }),
      );
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const result = await lintProject(
        { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
        { json: true, entityType: "variable" },
      );
      expect(result.errors).toEqual([]);
      expect(result.warnings?.filter((item) => item.code === "dependency_expansion_cost")).toEqual([
        expect.objectContaining({
          key: "composed",
          path: ["compose"],
          message: expect.stringContaining("dependency edges"),
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("reports a composition cycle at the responsible property, not at requiredVariables", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-cycle-"));
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports = { parser: "json" };',
      );
      fs.mkdirSync(path.join(root, "variables"));
      fs.writeFileSync(
        path.join(root, "variables", "composed.json"),
        JSON.stringify({
          description: "Cycle",
          compose: { self: { variable: "composed" } },
        }),
      );
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const result = await lintProject(
        { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
        { json: true },
      );
      expect(result.errors).toEqual([
        expect.objectContaining({
          entityType: "variable",
          key: "composed",
          path: ["compose", "self"],
          code: "circular_dependency",
          message: expect.stringContaining('compose property "self"'),
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("accepts all four reference forms, nested names and metadata without a default or type", () => {
    expect(schema().parse(definition)).toEqual(definition);
  });
  it.each([
    "type",
    "schema",
    "items",
    "properties",
    "additionalProperties",
    "required",
    "enum",
    "const",
    "oneOf",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "defaultValue",
    "useDefaultWhenDisabled",
    "mutate",
    "continue",
    "value",
  ])("reports unsupported %s at its own path even when explicitly undefined", (field) => {
    for (const value of [undefined, null, false, {}]) {
      expect(issues({ ...definition, [field]: value })).toEqual([
        expect.objectContaining({
          path: [field],
          message: `\`${field}\` is not supported on a composed variable.`,
        }),
      ]);
    }
  });
  it("reports every unsupported field independently", () => {
    expect(
      issues({ ...definition, type: "object", defaultValue: {} }).map((issue) => issue.path),
    ).toEqual([["type"], ["defaultValue"]]);
  });
  it("accepts nested, continuing overrides against the inferred object", () => {
    expect(
      schema().safeParse({
        ...definition,
        overrides: [
          {
            key: "regional",
            conditions: "*",
            continue: true,
            mutate: { "delivery.threshold": 10 },
            overrides: [{ key: "city", conditions: "*", mutate: { "delivery.threshold": 12 } }],
          },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    [{ "delivery.threshold": "bad" }, "mutate"],
    [{ unknown: true }, "mutate"],
    [{ "delivery:remove": true }, "mutate"],
    [{ "delivery.threshold:append": true }, "mutate"],
    [{ "__proto__.polluted": true }, "mutate"],
  ])("rejects invalid inferred mutation %j", (mutate, field) => {
    expect(
      issues({ ...definition, overrides: [{ key: "bad", conditions: "*", mutate }] }).some(
        (issue) => issue.path.includes(field),
      ),
    ).toBe(true);
  });
  it("rejects nonobject whole replacements and missing selectors", () => {
    expect(
      issues({ ...definition, overrides: [{ key: "bad", conditions: "*", value: "bad" }] })[0].path,
    ).toEqual(["overrides", 0, "value"]);
    expect(
      issues({ ...definition, overrides: [{ key: "bad", mutate: { "delivery.threshold": 1 } }] })[0]
        .path,
    ).toEqual(["overrides", 0, "conditions"]);
  });
  it.each([undefined, null, [], "value", 4, {}])(
    "rejects malformed or empty compose %j",
    (compose) => {
      expect(
        issues({ description: "Bad", compose }).some((issue) => issue.path[0] === "compose"),
      ).toBe(true);
    },
  );
  it.each(["", "__proto__", "constructor", "prototype"])("rejects unsafe property %s", (alias) => {
    expect(
      issues({
        description: "Bad alias",
        compose: JSON.parse(`{${JSON.stringify(alias)}:{"feature":"shop.checkout"}}`),
      }).some((issue) => issue.path[0] === "compose"),
    ).toBe(true);
  });
  it.each(["__proto__", "constructor", "prototype"])(
    "identifies unsafe property %s before record parsing",
    (alias) => {
      expect(
        issues({
          description: "Bad alias",
          compose: JSON.parse(`{${JSON.stringify(alias)}:{"feature":"shop.checkout"}}`),
        }),
      ).toEqual([
        expect.objectContaining({
          path: ["compose", alias],
          message: `Composition property ${JSON.stringify(alias)} is not allowed.`,
        }),
      ]);
    },
  );
  it.each([
    {},
    null,
    true,
    [],
    "literal",
    { feature: 1 },
    { variable: false },
    { variation: true },
    { feature: "shop.checkout", variation: false },
    { feature: "shop.checkout", variation: "true" },
    { feature: "shop.checkout", variation: true, variable: "button.label" },
    { variable: "delivery.policy", variation: true },
    { feature: "shop.checkout", path: "anything" },
    { variable: "delivery.policy", unknown: true },
    { nested: { feature: "shop.checkout" } },
  ])("rejects invalid reference %j", (reference) => {
    expect(issues({ description: "Bad reference", compose: { member: reference } })).toEqual([
      expect.objectContaining({
        path: ["compose", "member"],
        message: expect.stringContaining("Composition members must be exactly"),
      }),
    ]);
  });
  it.each([{ feature: "" }, { variable: "" }])(
    "rejects empty reference keys precisely %j",
    (reference) => {
      expect(issues({ description: "Empty key", compose: { member: reference } })).toEqual([
        expect.objectContaining({
          path: ["compose", "member", Object.keys(reference)[0]],
          message: "Reference keys must be nonempty strings.",
        }),
      ]);
    },
  );
  it.each([
    [{ feature: "missing" }, "feature", 'Unknown feature "missing"'],
    [
      { feature: "shop.checkout", variable: "missing" },
      "variable",
      'Unknown feature variable "missing"',
    ],
    [{ variable: "missing" }, "variable", 'Unknown global variable "missing"'],
    [{ feature: "constructor" }, "feature", 'Unknown feature "constructor"'],
    [{ variable: "constructor" }, "variable", 'Unknown global variable "constructor"'],
  ])("checks reference existence %j", (reference, field, message) => {
    expect(issues({ description: "Reference", compose: { member: reference } })).toEqual([
      expect.objectContaining({
        path: ["compose", "member", field],
        message: expect.stringContaining(message),
      }),
    ]);
  });
  it("rejects unknown composition fields and preserves metadata validation", () => {
    expect(issues({ ...definition, extra: true })[0].code).toBe("unrecognized_keys");
    expect(issues({ ...definition, tags: ["unknown"] })[0].path).toEqual(["tags", 0]);
  });
  it("suggests a feature variable using its literal source key", () => {
    expect(
      issues({
        description: "Label",
        compose: { label: { feature: "shop.checkout", variable: "button.labe" } },
      }),
    ).toEqual([
      expect.objectContaining({
        path: ["compose", "label", "variable"],
        message: expect.stringContaining("button.label"),
      }),
    ]);
  });
  it("still requires an ordinary default and validates its type", () => {
    expect(issues({ description: "Ordinary", type: "boolean" })[0].path).toEqual(["defaultValue"]);
    expect(
      issues({ description: "Ordinary", type: "boolean", defaultValue: "no" })[0].path,
    ).toEqual(["defaultValue"]);
    expect(
      schema().safeParse({ description: "Ordinary", type: "boolean", defaultValue: false }).success,
    ).toBe(true);
  });
  it("exposes a representable editor union with required defaults only on ordinary variables", () => {
    const json = z.toJSONSchema(schema().editorSchema, { io: "input", unrepresentable: "any" });
    const branches = json.anyOf!;
    expect(branches[0].required).toContain("defaultValue");
    expect(branches[1].required).toContain("compose");
    expect(branches[1].required).not.toContain("defaultValue");
    expect(branches[1].additionalProperties).toBe(false);
  });
});

describe("composed variable requirement paths", () => {
  it("validates nested reusable feature source schemas rather than treating properties as untyped objects", () => {
    const sourceSchemas: Record<string, Schema> = {
      count: { type: "integer", minimum: 1 },
      payload: {
        type: "object",
        properties: { counts: { type: "array", items: { schema: "count" } } },
      },
    };
    const sourceFeatures = {
      source: {
        variablesSchema: { payload: { schema: "payload", defaultValue: { counts: [1] } } },
      },
    } as unknown as Record<string, ParsedFeature>;
    const sourceVariables: Record<string, ParsedVariable> = {
      inner: { compose: { "payload.alias": { feature: "source", variable: "payload" } } },
      outer: { compose: { nested: { variable: "inner" } } },
    };
    const required = getConditionsZodSchema(
      {} as any,
      {},
      sourceSchemas,
      sourceFeatures,
      sourceVariables,
    );
    const requirement = {
      variable: "outer",
      path: ["nested", "payload.alias", "counts", 0],
      operator: "equals",
    };
    expect(required.safeParse({ ...requirement, value: 2 }).success).toBe(true);
    expect(required.safeParse({ ...requirement, value: "two" }).success).toBe(false);
    expect(required.safeParse({ ...requirement, value: 1.5 }).success).toBe(false);
    expect(
      required.safeParse({ ...requirement, path: ["nested", "payload.alias", "unknown"], value: 2 })
        .success,
    ).toBe(false);
  });
  const allVariables = { ...variables, checkoutConfig: definition as ParsedVariable };
  const requirements = () => getConditionsZodSchema({} as any, {}, schemas, features, allVariables);
  it.each([
    [["flag.literal"], "equals", true],
    [["layout/literal"], "equals", "disabled"],
    [["label"], "contains", "Buy"],
    [["delivery", "threshold"], "greaterThan", 4],
    [["nested", "delivery", "threshold"], "equals", 5],
    [["json", "anything"], "exists", undefined],
  ])("derives the source schema for %j", (path, operator, value) => {
    expect(
      requirements().safeParse({
        variable: "checkoutConfig",
        path,
        operator,
        ...(value !== undefined ? { value } : {}),
      }).success,
    ).toBe(true);
  });
  it.each([
    [["missing"], "equals", true],
    [["delivery", "missing"], "equals", 4],
    [["flag.literal"], "contains", "true"],
    [["layout/literal"], "equals", 4],
    [["nested", "delivery", "threshold"], "equals", "five"],
  ])("rejects invalid derived operand or path %j", (path, operator, value) => {
    expect(
      requirements().safeParse({ variable: "checkoutConfig", path, operator, value }).success,
    ).toBe(false);
  });
  it("supports structural checks with literal property paths", () => {
    expect(
      getChecksZodSchema().safeParse([
        { variable: "checkoutConfig", path: ["flag.literal"], operator: "equals", value: true },
      ]).success,
    ).toBe(true);
  });
  it("does not recurse indefinitely while schema inference sees a cycle", () => {
    const cyclic: Record<string, ParsedVariable> = {
      cycle: { compose: { self: { variable: "cycle" } } },
    };
    expect(
      getConditionsZodSchema({} as any, {}, {}, {}, cyclic).safeParse({
        variable: "cycle",
        path: ["self"],
        operator: "exists",
      }).success,
    ).toBe(true);
  });
});

describe("composition project lint", () => {
  it.each([{ variations: undefined }, { variations: [] }])(
    "lints and evaluates fallback only sources, requirements and tests with $variations",
    async ({ variations }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-fallback-"));
      try {
        fs.writeFileSync(
          path.join(root, "featurevisor.config.js"),
          'module.exports = { parser: "json" };',
        );
        const definitions = {
          "attributes/userId": { description: "User", type: "string" },
          "features/source": {
            description: "Source",
            bucketBy: "userId",
            disabledVariationValue: "off",
            variations,
            rules: [{ key: "all", conditions: "*", percentage: 0 }],
          },
          "variables/view": {
            description: "View",
            compose: { layout: { feature: "source", variation: true } },
          },
          "variables/dependent": {
            description: "Dependent",
            type: "boolean",
            defaultValue: true,
            conditions: { feature: "source", enabled: false, variation: "off" },
          },
          "tests/source.spec": {
            feature: "source",
            assertions: [{ at: 50, expectedToBeEnabled: false, expectedVariation: "off" }],
          },
        };
        for (const [key, value] of Object.entries(definitions)) {
          const file = path.join(root, `${key}.json`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(value));
        }
        const projectConfig = getProjectConfig(root);
        const datasource = new Datasource(projectConfig, root);
        const result = await lintProject(
          { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
          { json: true },
        );
        expect(result.errors).toEqual([]);
        expect(result.warnings || []).toEqual([]);
        const datafile = await getCustomDatafile({ projectConfig, datasource, environment: false });
        const f = createFeaturevisor({ datafile });
        expect(f.getVariable("view")).toEqual({ layout: "off" });
        expect(f.getVariable("dependent")).toBe(true);
        f.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it.each(["yml", "json"])("names rejected properties from real %s files", async (parser) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-alias-"));
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        `module.exports = { parser: "${parser}" };`,
      );
      fs.mkdirSync(path.join(root, "features"));
      fs.mkdirSync(path.join(root, "variables"));
      fs.writeFileSync(
        path.join(root, "features", `source.${parser}`),
        JSON.stringify({ description: "Source", rules: [] }),
      );
      for (const alias of ["__proto__", "prototype", "constructor"]) {
        const definition = `{"description":"Bad alias","compose":{${JSON.stringify(alias)}:{"feature":"source"}}}`;
        fs.writeFileSync(path.join(root, "variables", `bad.${parser}`), definition);
        const projectConfig = getProjectConfig(root);
        const result = await lintProject(
          {
            rootDirectoryPath: root,
            projectConfig,
            datasource: new Datasource(projectConfig, root),
            options: {},
          } as any,
          { json: true, entityType: "variable" },
        );
        expect(result.errors).toEqual([
          expect.objectContaining({
            entityType: "variable",
            key: "bad",
            path: ["compose", alias],
            message: `Composition property ${JSON.stringify(alias)} is not allowed.`,
          }),
        ]);
      }
      expect(({} as any).polluted).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("reports independent dependency cycles in one lint pass with their authored paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-cycles-"));
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports = { parser: "json" };',
      );
      fs.mkdirSync(path.join(root, "attributes"));
      fs.writeFileSync(
        path.join(root, "attributes", "userId.json"),
        JSON.stringify({ description: "User", type: "string" }),
      );
      fs.mkdirSync(path.join(root, "features"));
      for (const [key, requiredFeatures] of [
        ["cycleOne", "cycleTwo"],
        ["cycleTwo", "cycleOne"],
      ])
        fs.writeFileSync(
          path.join(root, "features", `${key}.json`),
          JSON.stringify({
            description: key,
            bucketBy: "userId",
            conditions: { feature: requiredFeatures },
            rules: [{ key: "all", conditions: "*", percentage: 100 }],
          }),
        );
      fs.mkdirSync(path.join(root, "variables"));
      const definitions = {
        alpha: { description: "A", compose: { partner: { variable: "beta" } } },
        beta: { description: "B", compose: { partner: { variable: "alpha" } } },
        self: {
          description: "Self",
          type: "boolean",
          defaultValue: true,
          conditions: { variable: "self", operator: "isNull" },
        },
      };
      for (const [key, definition] of Object.entries(definitions))
        fs.writeFileSync(path.join(root, "variables", `${key}.json`), JSON.stringify(definition));
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
      expect(result.errors).toEqual([
        expect.objectContaining({
          key: "cycleOne",
          path: ["conditions"],
          code: "circular_dependency",
        }),
        expect.objectContaining({
          key: "alpha",
          path: ["compose", "partner"],
          code: "circular_dependency",
          message: expect.stringContaining('compose property "partner"'),
        }),
        expect.objectContaining({
          key: "self",
          path: ["conditions"],
          code: "circular_dependency",
        }),
      ]);
      expect(result.hasError).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it.each([
    {
      compose: { member: null },
      diagnosticPath: ["compose", "member"],
      code: "invalid_union",
      message:
        "Composition members must be exactly { feature }, { feature, variation: true }, { feature, variable }, or { variable }, with nonempty string keys and no unknown fields.",
    },
    {
      compose: "literal",
      diagnosticPath: ["compose"],
      code: "custom",
      message: 'Unknown global variable "literal".',
    },
    ...[
      { compose: null, received: "null" },
      { compose: [], received: "array" },
      { compose: 42, received: "number" },
      { compose: true, received: "boolean" },
    ].map(({ compose }) => ({
      compose,
      diagnosticPath: ["compose"],
      code: "custom",
      message: "compose must be a global variable key or a nonempty map of references.",
    })),
  ])(
    "reports only the authored diagnostic for malformed compose $compose",
    async ({ compose, diagnosticPath, code, message }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-lint-"));
      try {
        fs.writeFileSync(
          path.join(root, "featurevisor.config.js"),
          'module.exports = { parser: "json" };',
        );
        fs.mkdirSync(path.join(root, "variables"));
        const variablePath = path.join(root, "variables", "composed.json");
        fs.writeFileSync(variablePath, JSON.stringify({ description: "Malformed", compose }));
        const projectConfig = getProjectConfig(root);
        const datasource = new Datasource(projectConfig, root);
        const result = await lintProject(
          { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
          { json: true },
        );
        expect(result.hasError).toBe(true);
        expect(result.errors).toStrictEqual([
          {
            filePath: path.relative(process.cwd(), variablePath),
            entityType: "variable",
            key: "composed",
            path: diagnosticPath,
            code,
            message,
            value: undefined,
          },
        ]);
        expect(result.errors.some((error) => error.code === "dependency_validation_failed")).toBe(
          false,
        );
        expect(result.warnings || []).toEqual([]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("lints composed variables and their typed consumers without an opt in", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-composition-lint-"));
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        'module.exports = { parser: "json" };',
      );
      fs.mkdirSync(path.join(root, "variables"));
      const definitions = {
        source: { description: "Source", type: "boolean", defaultValue: true },
        composed: { description: "Composed", compose: { flag: { variable: "source" } } },
        consumer: {
          description: "Consumer",
          type: "boolean",
          defaultValue: false,
          conditions: {
            variable: "composed",
            path: ["flag"],
            operator: "equals",
            value: true,
          },
        },
      };
      for (const [key, value] of Object.entries(definitions)) {
        fs.writeFileSync(path.join(root, "variables", `${key}.json`), JSON.stringify(value));
      }
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const result = await lintProject(
        { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
        { json: true, entityType: "variable" },
      );
      expect(result.errors).toEqual([]);
      expect(result.hasError).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
