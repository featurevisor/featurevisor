import type { Attribute, ParsedFeature, Schema } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { getVariableZodSchema } from "./variableSchema";

const config = {
  environments: ["staging", "production"],
  tags: ["web", "shared"],
  namespaceCharacter: ".",
} as ProjectConfig;
const attributes: Record<string, Attribute> = {
  country: { type: "string", description: "Country" },
};
const features: Record<string, ParsedFeature> = {
  checkout: {
    description: "Checkout",
    variations: [{ value: "control" }, { value: "treatment" }],
  } as ParsedFeature,
  archived: { description: "Archived", archived: true } as ParsedFeature,
};
const schemas: Record<string, Schema> = {
  banner: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
};

function parse(value: unknown) {
  const variables = {
    gate: { type: "boolean", defaultValue: true },
  } as unknown as Record<string, import("@featurevisor/types").ParsedVariable>;
  return getVariableZodSchema(
    config,
    attributes,
    ["europe"],
    features,
    schemas,
    variables,
  ).safeParse(value);
}

describe("global variable schema", () => {
  it.each([
    ["double", 1.5, "Replace `type: double` with `type: number`."],
    [
      "date",
      "2026-01-01T00:00:00Z",
      "Replace `type: date` with `type: string` and `format: date-time`.",
    ],
  ])("reports removed type %s once, at type", (type, defaultValue, message) => {
    const result = parse({ description: "Removed", type, defaultValue });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["type"],
          message,
          params: { code: "removed_schema_type" },
        }),
      ]);
  });

  it("checks semver default values against the version grammar", () => {
    expect(
      parse({ description: "Version", type: "string", format: "semver", defaultValue: "5.5" })
        .success,
    ).toBe(true);
    expect(
      parse({ description: "Version", type: "string", format: "semver", defaultValue: "5.5,0" })
        .success,
    ).toBe(false);
  });

  describe.each(["ordinary", "composed"])("%s catch all diagnostic paths", (kind) => {
    describe.each([true, false])("environments=%s", (withEnvironments) => {
      describe.each([true, false])("nested=%s", (nested) => {
        it.each(["conditions", "conditions"])(
          "reports the authored %s selector and accepts continuation",
          (selector) => {
            const validate = getVariableZodSchema(
              withEnvironments ? config : { ...config, environments: undefined },
              attributes,
              ["europe"],
              features,
              schemas,
            );
            const value = { enabled: true };
            const definition =
              kind === "composed"
                ? { description: "Composition", compose: { enabled: { feature: "checkout" } } }
                : {
                    description: "Ordinary object",
                    type: "object",
                    properties: { enabled: { type: "boolean" } },
                    defaultValue: value,
                  };
            const makeDefinition = (continuing: boolean) => {
              const siblings = [
                { key: "all", [selector]: "*", continue: continuing, value },
                { key: "later", conditions: "europe", value },
              ];
              const overrides = nested
                ? [{ key: "parent", conditions: "europe", value, overrides: siblings }]
                : siblings;
              return {
                ...definition,
                overrides: withEnvironments ? { staging: overrides } : overrides,
              };
            };
            const result = validate.safeParse(makeDefinition(false));
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.issues.map(({ path, message }) => ({ path, message }))).toEqual([
                {
                  path: [
                    "overrides",
                    ...(withEnvironments ? ["staging"] : []),
                    ...(nested ? [0, "overrides"] : []),
                    0,
                    selector,
                  ],
                  message:
                    "A catch-all override must be the final override because subsequent overrides are unreachable.",
                },
              ]);
            }
            expect(validate.safeParse(makeDefinition(true)).success).toBe(true);
          },
        );
      });
    });
  });

  describe("portable timestamp format", () => {
    const valid = "1970-01-01T00:00:00Z";
    it("checks unused global enum entries through nested references", () => {
      const schemas = { timestamp: { type: "string" as const, format: "date-time" as const } };
      const validate = getVariableZodSchema(config, attributes, [], features, schemas, {});
      const result = validate.safeParse({
        description: "Schedule",
        type: "object",
        properties: { when: { schema: "timestamp" } },
        defaultValue: { when: valid },
        enum: [{ when: valid }, { when: "soon" }],
      });

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.path)).toEqual([["enum", 1, "when"]]);
    });
    const definition = {
      description: "Timestamp",
      type: "string",
      format: "date-time",
      defaultValue: valid,
    };

    it("accepts the global root format and preserves its string default", () => {
      const result = parse(definition);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.defaultValue).toBe(valid);
    });

    it.each(["defaultValue", "disabledValue", "enum", "const"])("checks %s timestamps", (field) => {
      for (const value of [
        valid,
        "soon",
        "2026-02-29T00:00:00Z",
        "2026-01-01",
        "2026-01-01T00:00:00+14:01",
      ]) {
        const result = parse({ ...definition, [field]: field === "enum" ? [value] : value });
        expect(result.success).toBe(value === valid);
        if (!result.success)
          expect(
            result.error.issues.some(
              (issue) => issue.path[0] === field && issue.message.includes("portable timestamp"),
            ),
          ).toBe(true);
      }
    });

    it.each(["email", "date", 42, null, true])("rejects unsupported format %j", (format) => {
      const result = parse({ ...definition, format });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["format"]);
    });

    it.each(["integer", "number", "boolean", "json", "object", "array"])(
      "rejects format on %s",
      (type) => {
        const result = parse({
          ...definition,
          type,
          ...(type === "array" ? { items: { type: "string" } } : {}),
        });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(
            result.error.issues.some(
              (issue) =>
                issue.path.join(".") === "format" &&
                issue.message === "format is only supported on string schemas.",
            ),
          ).toBe(true);
      },
    );

    it("rejects format attached to a reusable reference rather than its string definition", () => {
      expect(
        parse({
          description: "Reference",
          schema: "banner",
          format: "date-time",
          defaultValue: { title: "hello" },
        }).success,
      ).toBe(false);
    });

    it.each([true, false])(
      "checks root and child overrides with precomputeMutations=%s",
      (precomputeMutations) => {
        const validate = getVariableZodSchema(
          { ...config, precomputeMutations },
          attributes,
          [],
          features,
          {},
          {},
        );
        for (const value of [valid, "soon"]) {
          const result = validate.safeParse({
            ...definition,
            overrides: {
              staging: [
                {
                  key: "parent",
                  conditions: "*",
                  value: valid,
                  overrides: [{ key: "child", conditions: "*", value }],
                },
              ],
            },
          });
          expect(result.success).toBe(value === valid);
          if (!result.success)
            expect(
              result.error.issues.some(
                (issue) => issue.path.join(".") === "overrides.staging.0.overrides.0.value",
              ),
            ).toBe(true);
        }
      },
    );

    it.each([true, false])(
      "checks final mutation results with precomputeMutations=%s",
      (precomputeMutations) => {
        const validate = getVariableZodSchema(
          { ...config, precomputeMutations },
          attributes,
          [],
          features,
          {},
          {},
        );
        const object = {
          description: "Date map",
          type: "object",
          additionalProperties: { type: "string", format: "date-time" },
          defaultValue: { when: valid },
        };
        for (const value of [valid, "soon"]) {
          const result = validate.safeParse({
            ...object,
            overrides: { staging: [{ key: "all", conditions: "*", mutate: { when: value } }] },
          });
          expect(result.success).toBe(value === valid);
          if (!result.success)
            expect(
              result.error.issues.some((issue) => issue.message.includes("portable timestamp")),
            ).toBe(true);
        }
      },
    );

    it.each([true, false])(
      "checks completed timestamp mutations without rejecting repairable intermediate results with precomputeMutations=%s",
      (precomputeMutations) => {
        const validate = getVariableZodSchema(
          { ...config, precomputeMutations },
          attributes,
          [],
          features,
          {},
          {},
        );
        const definition = {
          description: "Fixed schedule",
          type: "object",
          properties: { when: { type: "string", format: "date-time" } },
          enum: [{ when: valid }],
          defaultValue: { when: valid },
        };
        const later = "2026-01-01T00:00:00Z";
        const result = validate.safeParse({
          ...definition,
          overrides: { staging: [{ key: "all", conditions: "*", mutate: { when: later } }] },
        });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(
            result.error.issues.some(
              (issue) =>
                issue.message.includes("allowed enum values") && issue.path.includes("mutate"),
            ),
          ).toBe(true);
        expect(
          validate.safeParse({
            ...definition,
            overrides: {
              staging: [
                { key: "all", conditions: "*", mutate: [{ when: later }, { when: valid }] },
              ],
            },
          }).success,
        ).toBe(true);
      },
    );
  });

  it("lets mutations remove properties that required does not list", () => {
    const variable = (required?: string[]) => ({
      description: "Limits",
      type: "object",
      properties: {
        perOrder: { type: "integer" },
        daily: {
          type: "object",
          properties: { amount: { type: "integer" }, orders: { type: "integer" } },
          ...(required ? { required } : {}),
        },
      },
      defaultValue: { perOrder: 250, daily: { amount: 1000, orders: 5 } },
      overrides: {
        staging: [{ key: "all", conditions: "*", mutate: { "daily.orders:remove": true } }],
        production: [{ key: "all", conditions: "*", mutate: { "daily:remove": true } }],
      },
    });

    expect(parse(variable()).success).toBe(true);
    expect(parse(variable(["amount"])).success).toBe(true);

    const required = parse(variable(["amount", "orders"]));
    expect(required.success).toBe(false);
    expect(JSON.stringify(required.error?.issues)).toContain("orders");
  });

  it.each([true, false])(
    "validates mutation results regardless of precomputeMutations=%s",
    (precomputeMutations) => {
      const validate = getVariableZodSchema(
        { ...config, precomputeMutations },
        attributes,
        [],
        features,
        schemas,
        {},
      );
      const variable = {
        description: "Limits",
        type: "object",
        properties: { limit: { type: "integer", minimum: 1 } },
        defaultValue: { limit: 2 },
        overrides: { staging: [{ key: "all", conditions: "*", mutate: { limit: 0 } }] },
      };
      expect(validate.safeParse(variable).success).toBe(false);
      variable.overrides.staging[0].mutate.limit = 3;
      expect(validate.safeParse(variable).success).toBe(true);
      expect(validate.safeParse({ ...variable, precomputeMutations: false }).success).toBe(false);
      expect(
        validate.safeParse({
          ...variable,
          overrides: {
            staging: [{ ...variable.overrides.staging[0], precomputeMutations: false }],
          },
        }).success,
      ).toBe(false);
    },
  );
  describe.each([false, true])("array mutations with continuation %s", (continuing) => {
    function variable(mutate: Record<string, unknown>) {
      return {
        description: "Policy",
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        defaultValue: { tags: ["x", "x"], rows: [{ id: "a", tags: [] }] },
        overrides: { staging: [{ key: "all", conditions: "*", continue: continuing, mutate }] },
      };
    }

    it.each(["appendUnique", "removeValue"])(
      "validates %s operands even when selectors miss",
      (op) => {
        for (const path of ["tags", "rows[id=absent].tags"]) {
          expect(parse(variable({ [`${path}:${op}`]: "x" })).success).toBe(true);
          for (const operand of [5, null, {}, []]) {
            const result = parse(variable({ [`${path}:${op}`]: operand }));
            expect(result.success).toBe(false);
            if (!result.success)
              expect(
                result.error.issues.some((issue) => issue.path.includes(`${path}:${op}`)),
              ).toBe(true);
          }
        }
      },
    );

    it.each([
      "rows[-1]:remove",
      "rows[01]:remove",
      "rows..id",
      "rows:before",
      "tags:after",
      "__proto__.x",
      "rows[constructor=a]:remove",
    ])("rejects malformed or unsafe path %s", (path) => {
      expect(parse(variable({ [path]: null })).success).toBe(false);
    });

    it("checks replacement operands even when a selector misses", () => {
      expect(parse(variable({ "rows[id=missing]": "not an object" })).success).toBe(false);
      expect(parse(variable({ "rows[0]:before": "not an object" })).success).toBe(false);
    });

    it("rejects removing a required property", () => {
      expect(parse({ ...variable({ "tags:remove": true }), required: ["tags"] }).success).toBe(
        false,
      );
    });
    it("checks resulting array size after primitive mutations", () => {
      for (const [op, value] of [
        ["removeValue", "x"],
        ["appendUnique", "new"],
      ]) {
        const result = parse({
          description: "Bounded",
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 1,
          defaultValue: ["x"],
          overrides: {
            staging: [
              { key: "all", conditions: "*", continue: continuing, mutate: { [`:${op}`]: value } },
            ],
          },
        });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.error.issues.some((issue) => /minItems|maxItems/.test(issue.message))).toBe(
            true,
          );
      }
    });
  });
  it.each(["conditions", "conditions"])(
    "a wildcard %s selector with variable requirements is not a catch all",
    (selector) => {
      const overrides = [
        {
          key: "gated",
          [selector]: "*",
          conditions: { variable: "gate", operator: "equals", value: true },
          value: "yes",
        },
        { key: "fallback", conditions: "*", value: "no" },
      ];
      expect(
        parse({
          description: "Gated overrides",
          type: "string",
          defaultValue: "default",
          overrides: { production: overrides },
        }).success,
      ).toBe(true);
      expect(
        parse({
          description: "Nested gated overrides",
          type: "string",
          defaultValue: "default",
          overrides: {
            production: [{ key: "parent", conditions: "*", value: "parent", overrides }],
          },
        }).success,
      ).toBe(true);
    },
  );
  it.each(["conditions", "conditions"])(
    "explores the miss branch of a continuing wildcard %s selector with variable requirements",
    (selector) => {
      const result = parse({
        description: "Bounded accumulation",
        type: "array",
        items: { type: "string" },
        maxItems: 2,
        defaultValue: ["first", "second"],
        overrides: {
          production: [
            {
              key: "conditional-removal",
              [selector]: "*",
              conditions: { variable: "gate", operator: "equals", value: true },
              continue: true,
              mutate: { ":removeValue": "second" },
            },
            {
              key: "append",
              conditions: "*",
              mutate: { ":append": "third" },
            },
          ],
        },
      });

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.some((issue) => issue.message.includes("maxItems"))).toBe(true);
    },
  );

  it("supports requiredVariables at the root and on overrides with segments", () => {
    const result = parse({
      description: "Dependent variable",
      type: "string",
      defaultValue: "off",
      conditions: { variable: "gate", operator: "equals", value: true },
      overrides: {
        production: [
          {
            key: "europe",
            conditions: ["europe", { variable: "gate", operator: "notNull" }],
            value: "on",
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts inline and referenced schemas with environment overrides", () => {
    expect(
      parse({
        description: "Support email",
        tags: ["shared"],
        type: "string",
        defaultValue: "help@example.com",
        conditions: [{ feature: "checkout", variation: "treatment" }],
        overrides: {
          production: [
            { key: "europe", conditions: "europe", value: "eu@example.com" },
            {
              key: "nl",
              conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
              value: "nl@example.com",
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      parse({
        description: "Banner",
        schema: "banner",
        defaultValue: { title: "Hello" },
        overrides: { staging: [{ key: "all", conditions: "*", mutate: { title: "Hi" } }] },
      }).success,
    ).toBe(true);
  });

  it("accepts oneOf when the value matches exactly one branch", () => {
    expect(
      parse({
        description: "External identifier",
        oneOf: [{ type: "string" }, { type: "integer" }],
        defaultValue: "anonymous",
        overrides: {
          production: [{ key: "numeric", conditions: "europe", value: 42 }],
        },
      }).success,
    ).toBe(true);
  });

  it("accepts nested overrides with independently targeted refinements", () => {
    expect(
      parse({
        description: "Banner",
        schema: "banner",
        defaultValue: { title: "Default" },
        overrides: {
          production: [
            {
              key: "europe",
              conditions: "europe",
              mutate: { title: "Europe" },
              overrides: [
                {
                  key: "netherlands",
                  conditions: { attribute: "country", operator: "equals", value: "nl" },
                  mutate: { title: "Netherlands" },
                  overrides: [
                    {
                      key: "checkout",
                      conditions: { feature: "checkout" },
                      mutate: { title: "Dutch checkout" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["boolean", { type: "boolean", defaultValue: true }],
    ["integer", { type: "integer", minimum: 1, maximum: 5, defaultValue: 3 }],
    ["number", { type: "number", defaultValue: 1.5 }],
    ["string", { type: "string", minLength: 2, maxLength: 5, defaultValue: "okay" }],
    [
      "array",
      {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        uniqueItems: true,
        defaultValue: ["one"],
      },
    ],
    [
      "object",
      {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        defaultValue: { title: "Hello" },
      },
    ],
    ["json", { type: "json", defaultValue: '{"arbitrary":[true,1,"value"]}' }],
  ])("accepts a valid %s definition", (_type, definition) => {
    expect(parse({ description: "Typed variable", ...definition }).success).toBe(true);
  });

  it("rejects mixed, unmatched, and ambiguous oneOf roots", () => {
    expect(
      parse({
        description: "Mixed",
        type: "string",
        oneOf: [{ type: "string" }],
        defaultValue: "value",
      }).success,
    ).toBe(false);

    expect(
      parse({
        description: "Unmatched",
        oneOf: [{ type: "string" }, { type: "integer" }],
        defaultValue: false,
      }).success,
    ).toBe(false);

    expect(
      parse({
        description: "Ambiguous",
        oneOf: [{ type: "integer" }, { type: "number" }],
        defaultValue: 1,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["unknown tag", { tags: ["unknown"] }],
    ["missing type", { type: undefined }],
    ["mixed schema forms", { type: "object", schema: "banner" }],
    ["invalid default", { type: "integer", defaultValue: "five" }],
    ["unknown required variation", { conditions: [{ feature: "checkout", variation: "x" }] }],
  ])("rejects %s", (_label, changes) => {
    const value = {
      description: "Variable",
      type: "string",
      defaultValue: "value",
      ...changes,
    };
    expect(parse(value).success).toBe(false);
  });

  it("requires keyed, explicitly targeted overrides with exactly one value operation", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    expect(
      parse({ ...base, overrides: { staging: [{ conditions: "*", value: "x" }] } }).success,
    ).toBe(false);
    expect(parse({ ...base, overrides: { staging: [{ key: "x", value: "x" }] } }).success).toBe(
      false,
    );
    expect(
      parse({
        ...base,
        overrides: {
          staging: [{ key: "x", conditions: "*", value: "x", mutate: { value: "y" } }],
        },
      }).success,
    ).toBe(false);
  });

  it("validates disabled values, override values, environments, and mutation results", () => {
    const objectVariable = {
      description: "Settings",
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "integer" },
      },
      required: ["title", "count"],
      defaultValue: { title: "Default", count: 1 },
    };

    expect(parse({ ...objectVariable, disabledValue: { title: "Missing count" } }).success).toBe(
      false,
    );
    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [{ key: "wrong", conditions: "*", value: { title: "Missing count" } }],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [{ key: "wrong", conditions: "*", mutate: { count: "not-an-integer" } }],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...objectVariable,
        overrides: {
          unknown: [
            { key: "wrong-environment", conditions: "*", value: objectVariable.defaultValue },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts direct override arrays when the project has no environments", () => {
    const environmentlessConfig = {
      ...config,
      environments: false,
    } as unknown as ProjectConfig;
    const result = getVariableZodSchema(
      environmentlessConfig,
      attributes,
      ["europe"],
      features,
      schemas,
    ).safeParse({
      description: "Environmentless",
      type: "string",
      defaultValue: "default",
      overrides: [
        { key: "europe", conditions: "europe", value: "Europe" },
        { key: "fallback", conditions: "*", value: "Fallback" },
      ],
    });

    expect(result.success).toBe(true);
  });
  it("supports feature leaves directly and mixed with other conditions", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    const validOverrides = [
      { key: "required", conditions: { feature: "checkout" }, value: "x" },
      {
        key: "conditions",
        conditions: [
          { attribute: "country", operator: "equals", value: "nl" },
          { feature: "checkout", enabled: false, variation: "control" },
        ],
        value: "x",
      },
      {
        key: "conditions",
        conditions: ["europe", { feature: "checkout" }],
        value: "x",
      },
    ];

    for (const override of validOverrides) {
      expect(parse({ ...base, overrides: { production: [override] } }).success).toBe(true);
    }

    expect(
      parse({
        ...base,
        overrides: {
          production: [
            {
              key: "invalid",
              segments: "europe",
              conditions: { attribute: "country", operator: "equals", value: "nl" },
              value: "x",
            },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...base,
        overrides: { production: [{ key: "empty", conditions: [], value: "x" }] },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate keys, non-final catch-alls, and invalid mutation paths", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "same", conditions: "europe", value: "a" },
            { key: "same", conditions: "*", value: "b" },
          ],
        },
      }).success,
    ).toBe(false);
    for (const segments of [["*"], { or: ["europe", "*"] }, { not: [{ not: ["*"] }] }]) {
      expect(
        parse({
          ...base,
          overrides: {
            staging: [
              { key: "all", segments, value: "a" },
              { key: "later", conditions: "europe", value: "b" },
            ],
          },
        }).success,
      ).toBe(false);
    }
    for (const conditions of [
      ["*"],
      {
        or: [{ attribute: "country", operator: "equals", value: "de" }, "*"],
      },
      { not: [{ not: ["*"] }] },
    ]) {
      expect(
        parse({
          ...base,
          overrides: {
            staging: [
              { key: "all", conditions, value: "a" },
              {
                key: "later",
                conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
                value: "b",
              },
            ],
          },
        }).success,
      ).toBe(false);
    }

    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "all", conditions: "*", value: "a" },
            { key: "later", conditions: "europe", value: "b" },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        description: "Object",
        type: "object",
        properties: { title: { type: "string" } },
        defaultValue: { title: "Hello" },
        overrides: {
          staging: [{ key: "bad", conditions: "*", mutate: { unknown: "x" } }],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "never", conditions: { and: ["europe", { not: ["europe"] }] }, value: "never" },
            { key: "later", conditions: "europe", value: "later" },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("validates nested override keys, values, mutations, and sibling reachability", () => {
    const objectVariable = {
      description: "Settings",
      type: "object",
      properties: { title: { type: "string" }, count: { type: "integer" } },
      required: ["title", "count"],
      defaultValue: { title: "Default", count: 1 },
    };

    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [
            {
              key: "parent",
              conditions: "europe",
              value: { title: "Parent", count: 2 },
              overrides: [
                {
                  key: "parent",
                  conditions: { attribute: "country", operator: "equals", value: "nl" },
                  mutate: { count: 3 },
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [
            {
              key: "parent",
              conditions: "europe",
              value: { title: "Parent", count: 2 },
              overrides: [
                {
                  key: "invalid-value",
                  conditions: "europe",
                  value: { title: "Missing count" },
                },
                {
                  key: "invalid-mutation",
                  conditions: "europe",
                  mutate: { count: "three" },
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [
            {
              key: "parent",
              conditions: "europe",
              value: { title: "Parent", count: 2 },
              overrides: [
                {
                  key: "all",
                  conditions: "*",
                  mutate: { count: 3 },
                },
                {
                  key: "unreachable",
                  conditions: "europe",
                  mutate: { count: 4 },
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
