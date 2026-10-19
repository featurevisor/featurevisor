/**
 * Unit tests for feature schema validation, with focus on variablesSchema and
 * variable value validation (defaultValue, disabledValue, variations, variableOverrides,
 * rules, force). Ensures every place a variable value can be set is validated against
 * the variable's schema.
 */
import type { Attribute, ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema, valueMatchesSchema } from "./featureSchema";
import { getVariableZodSchema } from "./variableSchema";

/** Minimal project config for feature schema tests (no file paths used for variable validation). */
function minimalProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    schemasDirectoryPath: "",
    targetsDirectoryPath: "",
    variablesDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    catalogDirectoryPath: "",
    setsDirectoryPath: "",
    environments: ["staging", "production"],
    sets: false,
    namespaceCharacter: ".",
    tags: ["all"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
    enforceCatchAllRule: false,
    ...overrides,
  };
}

/** Attributes and segments that appear in conditions; keep small for tests. */
const TEST_ATTRIBUTES: Record<string, Attribute> = {
  userId: {
    description: "User ID",
    type: "string",
  },
  country: {
    description: "Country",
    type: "string",
  },
  device: {
    description: "Device",
    type: "string",
  },
  permissions: {
    description: "Permissions",
    type: "array",
    items: {
      type: "string",
      enum: ["read", "write", "admin"],
    },
  },
  version: {
    description: "Version",
    oneOf: [{ type: "string" }, { type: "number" }],
  },
  traits: {
    description: "Traits",
    type: "object",
  },
};
const TEST_ATTRIBUTE_KEYS: [string, ...string[]] = [
  "userId",
  "country",
  "device",
  "permissions",
  "version",
  "traits",
];
const TEST_SEGMENTS: [string, ...string[]] = ["*", "countries.germany", "countries.france"];
const TEST_FEATURES: [string, ...string[]] = ["testFeature", "dependency", "noVariations"];
const TEST_FEATURES_BY_KEY: Record<string, ParsedFeature> = {
  testFeature: { description: "Test feature" } as ParsedFeature,
  dependency: {
    description: "Dependency",
    variations: [{ value: "control" }, { value: "treatment" }],
  } as ParsedFeature,
  noVariations: { description: "No variations" } as ParsedFeature,
};
const TEST_SCHEMA_KEYS = ["link", "slugSchema"];

/** Resolved schema for "slugSchema": string with pattern and length. */
const slugSchemaResolved: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 30,
  pattern: "^[a-z0-9-]+$",
};

/** Resolved schema for "link": object with title and url. */
const linkSchemaResolved: Schema = {
  type: "object",
  required: ["title", "url"],
  properties: {
    title: { type: "string" },
    url: { type: "string" },
  },
};

const TEST_SCHEMAS_BY_KEY: Record<string, Schema> = {
  link: linkSchemaResolved,
  slugSchema: slugSchemaResolved,
};
const TEST_VARIABLES_BY_KEY = {
  globalGate: { type: "boolean", defaultValue: true },
} as unknown as Record<string, ParsedVariable>;

function getFeatureSchema(projectConfigOverrides: Partial<ProjectConfig> = {}) {
  const projectConfig = minimalProjectConfig(projectConfigOverrides);
  const conditionsZodSchema = getConditionsZodSchema(projectConfig, TEST_ATTRIBUTES);
  return getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    TEST_ATTRIBUTE_KEYS,
    TEST_SEGMENTS,
    TEST_FEATURES,
    TEST_SCHEMA_KEYS,
    TEST_SCHEMAS_BY_KEY,
    TEST_FEATURES_BY_KEY,
    TEST_VARIABLES_BY_KEY,
  );
}

/** Base feature shape required by getFeatureZodSchema (description, tags, bucketBy, rules). */
function baseFeature(overrides: Record<string, unknown> = {}) {
  return {
    description: "Test feature",
    tags: ["all"],
    bucketBy: "userId",
    rules: {
      staging: [{ key: "r1", conditions: "*", percentage: 100 }],
      production: [{ key: "r1", conditions: "*", percentage: 100 }],
    },
    ...overrides,
  };
}

describe("disabled variation fallbacks", () => {
  it.each([{ variations: undefined }, { variations: [] }])(
    "allows a standalone fallback with $variations",
    ({ variations }) => {
      expect(
        getFeatureSchema().safeParse(baseFeature({ disabledVariationValue: "off", variations }))
          .success,
      ).toBe(true);
    },
  );
  it("still rejects a fallback outside declared variation values", () => {
    const result = getFeatureSchema().safeParse(
      baseFeature({ disabledVariationValue: "off", variations: [{ value: "on", weight: 100 }] }),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["disabledVariationValue"] }),
      );
  });
});

describe("variation weights and rule fields", () => {
  function issues(feature: Record<string, unknown>) {
    const result = getFeatureSchema().safeParse(baseFeature(feature));
    return result.success ? [] : result.error.issues;
  }

  it("requires feature variation weights to sum to 100", () => {
    expect(
      issues({
        variations: [
          { value: "control", weight: 50 },
          { value: "treatment", weight: 40 },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["variations"],
        message: "Variation weights must sum to 100, but they sum to 90.",
      }),
    );
  });

  it("accepts three decimal weights that sum to 100", () => {
    expect(
      issues({
        variations: [
          { value: "a", weight: 33.333 },
          { value: "b", weight: 33.333 },
          { value: "c", weight: 33.334 },
        ],
      }),
    ).toEqual([]);
  });

  it("reports the actual sum of a rule's variation weights", () => {
    expect(
      issues({
        variations: [
          { value: "control", weight: 50 },
          { value: "treatment", weight: 50 },
        ],
        rules: {
          staging: [{ key: "r1", conditions: "*", percentage: 100 }],
          production: [
            {
              key: "r1",
              conditions: "*",
              percentage: 100,
              variationWeights: { control: 70, treatment: 20 },
            },
          ],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["rules", "production", 0, "variationWeights"],
        message: "Variation weights must sum to 100, but they sum to 90.",
      }),
    );
  });

  it.each([true, false])("rejects enabled: %s on a rule and points to percentage 0", (enabled) => {
    expect(
      issues({
        rules: {
          staging: [{ key: "r1", conditions: "*", percentage: 100 }],
          production: [{ key: "r1", conditions: "*", percentage: 100, enabled }],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: ["rules", "production", 0, "enabled"],
        message:
          "Rules do not take `enabled`. Set `percentage: 0` to switch this audience off, or add a `force` entry.",
      }),
    );
  });
});

describe("variable diagnostic ownership", () => {
  const cases = [
    { name: "type", schema: { type: "integer", defaultValue: 1 }, invalid: "nope" },
    {
      name: "length",
      schema: { type: "string", minLength: 5, defaultValue: "abcdef" },
      invalid: "ab",
    },
    { name: "enum", schema: { type: "string", enum: ["a", "b"], defaultValue: "a" }, invalid: "c" },
    {
      name: "format",
      schema: { type: "string", format: "date-time", defaultValue: "2026-01-01T00:00:00Z" },
      invalid: "tomorrow",
    },
  ];
  const locations = [
    "variation",
    "rule",
    "force",
    "variation override",
    "rule override",
    "default",
    "disabled",
    "global default",
    "global disabled",
    "global override",
    "global child override",
  ];

  test.each(cases.flatMap((entry) => locations.map((location) => ({ ...entry, location }))))(
    "reports one $name error at $location",
    ({ schema, invalid, location }) => {
      let result;
      if (location.startsWith("global")) {
        const definition = { description: "Value", ...schema };
        const additions =
          location === "global default"
            ? { defaultValue: invalid }
            : location === "global disabled"
              ? { disabledValue: invalid }
              : {
                  overrides: {
                    staging: [
                      {
                        key: "parent",
                        conditions: "*",
                        value: location === "global child override" ? schema.defaultValue : invalid,
                        ...(location === "global child override"
                          ? { overrides: [{ key: "child", conditions: "*", value: invalid }] }
                          : {}),
                      },
                    ],
                  },
                };
        result = getVariableZodSchema(
          minimalProjectConfig(),
          TEST_ATTRIBUTES,
          TEST_SEGMENTS,
          TEST_FEATURES_BY_KEY,
          {},
        ).safeParse({ ...definition, ...additions });
      } else {
        const variableSchema = {
          ...schema,
          ...(location === "default" ? { defaultValue: invalid } : {}),
          ...(location === "disabled" ? { disabledValue: invalid } : {}),
        };
        const assignment = location.includes("override")
          ? { variableOverrides: { code: [{ conditions: "*", value: invalid }] } }
          : { variables: { code: invalid } };
        const additions = location.startsWith("variation")
          ? { variations: [{ value: "control", weight: 100, ...assignment }] }
          : location.startsWith("rule")
            ? {
                rules: {
                  staging: [{ key: "everyone", conditions: "*", percentage: 100, ...assignment }],
                },
              }
            : location === "force"
              ? { force: { staging: [{ conditions: "*", ...assignment }] } }
              : {};
        result = getFeatureSchema().safeParse(
          baseFeature({ variablesSchema: { code: variableSchema }, ...additions }),
        );
      }
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toHaveLength(1);
    },
  );

  it("reports one invalid operand without a second mutation error from its invalid parent", () => {
    const result = getFeatureSchema().safeParse(
      baseFeature({
        variablesSchema: {
          config: {
            type: "object",
            properties: { count: { type: "integer" } },
            defaultValue: { count: 1 },
          },
        },
        rules: {
          staging: [
            {
              key: "all",
              conditions: "*",
              percentage: 100,
              variables: { config: "bad", "config.count": 2 },
            },
          ],
        },
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(1);
  });

  test.each(
    cases.flatMap((entry) =>
      ["variation", "rule", "global", "global continued", "global child"].flatMap((location) =>
        [true, false].flatMap((precomputeMutations) =>
          [true, false].map((ordered) => ({ ...entry, location, precomputeMutations, ordered })),
        ),
      ),
    ),
  )(
    "reports one $name mutation issue in $location (ordered=$ordered, precompute=$precomputeMutations)",
    ({ schema: leafSchema, invalid, location, ordered, precomputeMutations }) => {
      const { defaultValue, ...leaf } = leafSchema;
      const schema = {
        type: "object",
        properties: { when: leaf },
        defaultValue: { when: defaultValue },
      };
      const override = {
        key: "bad",
        conditions: "*",
        mutate: ordered ? [{ when: invalid }] : { when: invalid },
      };
      let result;
      if (location.startsWith("global")) {
        const overrides =
          location === "global child"
            ? [
                {
                  key: "parent",
                  conditions: "*",
                  value: schema.defaultValue,
                  overrides: [override],
                },
              ]
            : [{ ...override, ...(location === "global continued" ? { continue: true } : {}) }];
        result = getVariableZodSchema(
          minimalProjectConfig({ precomputeMutations }),
          TEST_ATTRIBUTES,
          TEST_SEGMENTS,
          TEST_FEATURES_BY_KEY,
          {},
        ).safeParse({ description: "Config", ...schema, overrides: { staging: overrides } });
      } else {
        const variableOverrides = { config: [override] };
        result = getFeatureSchema({ precomputeMutations }).safeParse(
          baseFeature({
            variablesSchema: { config: schema },
            ...(location === "variation"
              ? { variations: [{ value: "control", weight: 100, variableOverrides }] }
              : {
                  rules: {
                    staging: [{ key: "all", conditions: "*", percentage: 100, variableOverrides }],
                  },
                }),
          }),
        );
      }
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toHaveLength(1);
    },
  );
});

describe("variable timestamp format", () => {
  const valid = "1970-01-01T00:00:00Z";
  const timestamp = { type: "string", format: "date-time" };
  it("checks unused inline feature enum entries through nested references", () => {
    const config = minimalProjectConfig();
    const schemas = { timestamp: timestamp as Schema };
    const validate = getFeatureZodSchema(
      config,
      getConditionsZodSchema(config, TEST_ATTRIBUTES),
      TEST_ATTRIBUTE_KEYS,
      TEST_SEGMENTS,
      TEST_FEATURES,
      Object.keys(schemas),
      schemas,
      TEST_FEATURES_BY_KEY,
      TEST_VARIABLES_BY_KEY,
    );
    const result = validate.safeParse(
      baseFeature({
        variablesSchema: {
          schedule: {
            type: "object",
            properties: { when: { schema: "timestamp" } },
            defaultValue: { when: valid },
            enum: [{ when: valid }, { when: "soon" }],
          },
        },
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ["variablesSchema", "schedule", "enum", 1, "when"],
      ]);
  });
  const feature = (overrides: Record<string, unknown> = {}) =>
    baseFeature({
      variablesSchema: { when: { ...timestamp, defaultValue: valid } },
      ...overrides,
    });

  it.each(["defaultValue", "disabledValue", "const", "enum"])("validates %s", (field) => {
    for (const value of [valid, "soon", "2026-02-29T00:00:00Z"]) {
      const result = getFeatureSchema().safeParse(
        feature({
          variablesSchema: {
            when: {
              ...timestamp,
              defaultValue: valid,
              [field]: field === "enum" ? [value] : value,
            },
          },
        }),
      );
      expect(result.success).toBe(value === valid);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) => issue.path.includes(field) && issue.message.includes("portable timestamp"),
          ),
        ).toBe(true);
    }
  });

  it.each(["email", 1, null])("rejects unsupported feature format %j", (format) => {
    expect(
      getFeatureSchema().safeParse(
        feature({
          variablesSchema: { when: { type: "string", format, defaultValue: valid } },
        }),
      ).success,
    ).toBe(false);
  });

  it.each(["integer", "boolean", "json", "object"])(
    "rejects nonstring feature format on %s",
    (type) => {
      const result = getFeatureSchema().safeParse(
        feature({
          variablesSchema: { when: { type, format: "date-time", defaultValue: valid } },
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) =>
              issue.path.join(".") === "variablesSchema.when.format" &&
              issue.message === "format is only supported on string schemas.",
          ),
        ).toBe(true);
    },
  );

  it.each(["const", "enum"])("does not let a matching %s bypass the timestamp check", (keyword) => {
    const schema = { ...timestamp, [keyword]: keyword === "enum" ? ["soon"] : "soon" };
    expect(valueMatchesSchema(schema, "soon")).toBe(false);
    expect(
      getFeatureSchema().safeParse(
        feature({
          variablesSchema: { when: { ...schema, defaultValue: "soon" } },
        }),
      ).success,
    ).toBe(false);
  });

  it("counts only valid timestamp branches in oneOf", () => {
    const schema = { oneOf: [timestamp, { type: "integer" }] };
    expect(valueMatchesSchema(schema, valid)).toBe(true);
    expect(valueMatchesSchema(schema, "soon")).toBe(false);
    expect(valueMatchesSchema(schema, 1)).toBe(true);
    expect(valueMatchesSchema({ oneOf: [timestamp, { type: "string" }] }, valid)).toBe(false);
  });

  it.each(["variation", "rule", "force", "override", "ruleOverride"])(
    "validates %s values through the existing feature pathway",
    (location) => {
      for (const value of [valid, "soon"]) {
        const variables = { when: value };
        const variableOverrides = { when: [{ conditions: "*", value }] };
        const changes = {
          variation: { variations: [{ value: "control", weight: 100, variables }] },
          rule: {
            rules: { staging: [{ key: "all", conditions: "*", percentage: 100, variables }] },
          },
          force: { force: { staging: [{ conditions: "*", enabled: true, variables }] } },
          override: { variations: [{ value: "control", weight: 100, variableOverrides }] },
          ruleOverride: {
            rules: {
              staging: [{ key: "all", conditions: "*", percentage: 100, variableOverrides }],
            },
          },
        }[location];
        const result = getFeatureSchema().safeParse(feature(changes));
        expect(result.success).toBe(value === valid);
        if (!result.success)
          expect(
            result.error.issues.some((issue) => issue.message.includes("portable timestamp")),
          ).toBe(true);
      }
    },
  );

  it.each([true, false])(
    "validates mutation operands and final results with precomputeMutations=%s",
    (precomputeMutations) => {
      for (const mutate of [{ when: "soon" }, [{ when: "soon" }]]) {
        const result = getFeatureSchema({ precomputeMutations }).safeParse(
          baseFeature({
            variablesSchema: {
              config: {
                type: "object",
                properties: { when: timestamp },
                defaultValue: { when: valid },
              },
            },
            rules: {
              staging: [
                {
                  key: "all",
                  conditions: "*",
                  percentage: 100,
                  variableOverrides: { config: [{ conditions: "*", mutate }] },
                },
              ],
            },
          }),
        );
        expect(result.success).toBe(false);
        if (!result.success)
          expect(
            result.error.issues.some((issue) => issue.message.includes("portable timestamp")),
          ).toBe(true);
      }
      expect(
        getFeatureSchema({ precomputeMutations }).safeParse(
          baseFeature({
            variablesSchema: {
              config: {
                type: "object",
                properties: { when: timestamp },
                defaultValue: { when: valid },
              },
            },
            rules: {
              staging: [
                {
                  key: "all",
                  conditions: "*",
                  percentage: 100,
                  variableOverrides: {
                    config: [{ conditions: "*", mutate: [{ when: valid }, { when: valid }] }],
                  },
                },
              ],
            },
          }),
        ).success,
      ).toBe(true);
    },
  );

  it("validates reusable schemas, nested global values and child overrides", () => {
    const schemas = { instant: { schema: "timestampLeaf" }, timestampLeaf: timestamp as Schema };
    const validate = getVariableZodSchema(
      minimalProjectConfig(),
      TEST_ATTRIBUTES,
      TEST_SEGMENTS,
      TEST_FEATURES_BY_KEY,
      schemas,
      {},
    );
    for (const schema of [
      { schema: "instant" },
      { type: "array", items: { schema: "instant" } },
      { type: "object", properties: { when: { schema: "instant" } } },
      { type: "object", additionalProperties: { schema: "instant" } },
      { oneOf: [{ schema: "instant" }, { type: "integer" }] },
    ]) {
      const wrap = (value: string) =>
        schema.type === "array" ? [value] : schema.type === "object" ? { when: value } : value;
      expect(
        validate.safeParse({ description: "Timestamp", ...schema, defaultValue: wrap(valid) })
          .success,
      ).toBe(true);
      expect(
        validate.safeParse({ description: "Timestamp", ...schema, defaultValue: wrap("soon") })
          .success,
      ).toBe(false);
      expect(
        validate.safeParse({
          description: "Timestamp",
          ...schema,
          defaultValue: wrap(valid),
          disabledValue: wrap("soon"),
        }).success,
      ).toBe(false);
      expect(
        validate.safeParse({
          description: "Timestamp",
          ...schema,
          defaultValue: wrap(valid),
          overrides: {
            staging: [
              {
                key: "parent",
                conditions: "*",
                value: wrap(valid),
                overrides: [{ key: "child", conditions: "*", value: wrap("soon") }],
              },
            ],
          },
        }).success,
      ).toBe(false);
    }
  });

  it.each([true, false])(
    "checks completed feature timestamp mutation results with precomputeMutations=%s",
    (precomputeMutations) => {
      const config = {
        type: "object",
        properties: { when: timestamp },
        enum: [{ when: valid }],
        defaultValue: { when: valid },
      };
      const feature = (mutate: unknown) =>
        baseFeature({
          variablesSchema: { config },
          rules: {
            staging: [
              {
                key: "all",
                conditions: "*",
                percentage: 100,
                variableOverrides: { config: [{ conditions: "*", mutate }] },
              },
            ],
          },
        });
      const later = "2026-01-01T00:00:00Z";
      const result = getFeatureSchema({ precomputeMutations }).safeParse(feature({ when: later }));
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) =>
              issue.message.includes("allowed enum values") && issue.path.includes("mutate"),
          ),
        ).toBe(true);
      expect(
        getFeatureSchema({ precomputeMutations }).safeParse(
          feature([{ when: later }, { when: valid }]),
        ).success,
      ).toBe(true);
    },
  );

  it.each([true, false])(
    "validates global mutation values through referenced timestamp leaves with precomputeMutations=%s",
    (precomputeMutations) => {
      const schemas = { instant: timestamp as Schema };
      const validate = getVariableZodSchema(
        minimalProjectConfig({ precomputeMutations }),
        TEST_ATTRIBUTES,
        TEST_SEGMENTS,
        TEST_FEATURES_BY_KEY,
        schemas,
        {},
      );
      const schema = {
        type: "object",
        properties: {
          dates: { type: "array", items: { schema: "instant" } },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, when: { schema: "instant" } },
            },
          },
        },
      };
      for (const path of [
        "dates:append",
        "dates:appendUnique",
        "dates:removeValue",
        "rows[id=absent].when",
      ]) {
        for (const value of [valid, "soon"]) {
          const result = validate.safeParse({
            description: "Dates",
            ...schema,
            defaultValue: { dates: [valid], rows: [] },
            overrides: { staging: [{ key: "all", conditions: "*", mutate: { [path]: value } }] },
          });
          expect(result.success).toBe(value === valid);
          if (!result.success)
            expect(
              result.error.issues.some(
                (issue) =>
                  issue.message.includes("portable timestamp") && issue.path.includes(path),
              ),
            ).toBe(true);
        }
      }
    },
  );

  it("rejects native dates and epochs rather than broadening variable string types", () => {
    for (const value of [new Date(valid), 0, null]) {
      expect(valueMatchesSchema(timestamp, value)).toBe(false);
      expect(
        getFeatureSchema().safeParse(
          feature({
            variablesSchema: {
              when: { ...timestamp, defaultValue: value },
            },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("keeps timestamp format conjunctive with existing string constraints", () => {
    expect(valueMatchesSchema({ ...timestamp, minLength: 21 }, valid)).toBe(false);
    expect(valueMatchesSchema({ ...timestamp, maxLength: 19 }, valid)).toBe(false);
    expect(valueMatchesSchema({ ...timestamp, pattern: "^2026" }, valid)).toBe(false);
    expect(
      valueMatchesSchema({ ...timestamp, minLength: 20, maxLength: 20, pattern: "Z$" }, valid),
    ).toBe(true);
    expect(valueMatchesSchema({ type: "string", enum: ["soon"] }, "soon")).toBe(true);
    expect(
      getFeatureSchema().safeParse(
        feature({
          variablesSchema: {
            when: { type: "string", defaultValue: "soon" },
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("keeps before and after legal on unannotated string requirements", () => {
    for (const operator of ["before", "after"]) {
      expect(
        getFeatureSchema().safeParse(
          baseFeature({
            conditions: { variable: "globalGate", operator, value: valid },
          }),
        ).success,
      ).toBe(false);
      const config = minimalProjectConfig();
      const variable = { type: "string", defaultValue: "soon" } as ParsedVariable;
      const validate = getFeatureZodSchema(
        config,
        getConditionsZodSchema(config, TEST_ATTRIBUTES),
        TEST_ATTRIBUTE_KEYS,
        TEST_SEGMENTS,
        TEST_FEATURES,
        [],
        {},
        {},
        { when: variable },
      );
      expect(
        validate.safeParse(
          baseFeature({ conditions: { variable: "when", operator, value: valid } }),
        ).success,
      ).toBe(true);
    }
  });
});
describe("conditions", () => {
  it("reports migration for legacy authored required without affecting schema required", () => {
    const legacy = getFeatureSchema().safeParse(baseFeature({ required: [{ key: "dependency" }] }));
    expect(legacy.success).toBe(false);
    if (!legacy.success) {
      expect(legacy.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["required"],
            message: expect.stringContaining("Use `conditions`"),
          }),
        ]),
      );
    }
    const schemaRequired = baseFeature({
      variablesSchema: {
        settings: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          defaultValue: { title: "ok" },
        },
      },
    });
    expect(getFeatureSchema().safeParse(schemaRequired).success).toBe(true);
  });
  it.each(["rule", "variation", "force", "override"])(
    "checks final array constraints for %s mutations",
    (location) => {
      const variablesSchema = {
        tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 2,
          defaultValue: ["x"],
        },
      };
      for (const [op, value] of [
        ["removeValue", "x"],
        ["appendUnique", "z"],
      ]) {
        const variables = {
          tags: op === "appendUnique" ? ["x", "y"] : ["x"],
          [`tags:${op}`]: value,
        };
        const changes =
          location === "rule"
            ? { rules: { staging: [{ key: "all", conditions: "*", percentage: 100, variables }] } }
            : location === "variation"
              ? { variations: [{ value: "a", weight: 100, variables }] }
              : location === "force"
                ? { force: { staging: [{ conditions: "*", enabled: true, variables }] } }
                : {
                    rules: {
                      staging: [
                        {
                          key: "all",
                          conditions: "*",
                          percentage: 100,
                          variables: { tags: op === "appendUnique" ? ["x", "y"] : ["x"] },
                          variableOverrides: {
                            tags: [{ conditions: "*", mutate: { [`:${op}`]: value } }],
                          },
                        },
                      ],
                    },
                  };
        const result = parseFeature(baseFeature({ variablesSchema, ...changes }));
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.error.issues.some((issue) => /minItems|maxItems/.test(issue.message))).toBe(
            true,
          );
      }
    },
  );
  it.each(["appendUnique", "removeValue"])(
    "validates %s for feature mutations and override arrays",
    (op) => {
      const variablesSchema = {
        tags: { type: "array", items: { type: "string" }, defaultValue: ["x"] },
      };
      for (const value of ["x", {}, [], null, 3]) {
        for (const changes of [
          { variables: { [`tags:${op}`]: value } },
          { variableOverrides: { tags: [{ conditions: "*", mutate: { [`:${op}`]: value } }] } },
        ]) {
          const result = parseFeature(
            baseFeature({
              variablesSchema,
              rules: {
                staging: [{ key: "all", conditions: "*", percentage: 100, ...changes }],
                production: [{ key: "all", conditions: "*", percentage: 100 }],
              },
            }),
          );
          expect(result.success).toBe(value === "x");
        }
      }
    },
  );
  it.each(
    [
      { feature: "dependency" },
      [{ feature: "dependency" }],
      [{ feature: "dependency" }],
      [{ feature: "dependency", enabled: false }],
      [{ feature: "dependency", enabled: false, variation: "control" }],
    ].map((value) => [value]),
  )("accepts canonical condition %j", (conditions) => {
    expect(getFeatureSchema().safeParse(baseFeature({ conditions })).success).toBe(true);
  });

  it("rejects empty, unknown, invalid variation, and mixed legacy definitions", () => {
    expect(getFeatureSchema().safeParse(baseFeature({ conditions: [] })).success).toBe(false);
    expect(
      getFeatureSchema().safeParse(baseFeature({ conditions: { feature: "missing" } })).success,
    ).toBe(false);
    expect(
      getFeatureSchema().safeParse(
        baseFeature({ conditions: [{ feature: "dependency", variation: "missing" }] }),
      ).success,
    ).toBe(false);
    expect(
      getFeatureSchema().safeParse(
        baseFeature({ conditions: [{ feature: "noVariations", variation: "control" }] }),
      ).success,
    ).toBe(false);
    expect(
      getFeatureSchema().safeParse(
        baseFeature({ required: ["dependency"], conditions: { feature: "dependency" } }),
      ).success,
    ).toBe(false);
  });
});
describe("conditions", () => {
  it("supports feature roots and variable overrides alongside conditions", () => {
    expect(
      getFeatureSchema().safeParse(
        baseFeature({
          conditions: { variable: "globalGate", operator: "equals", value: true },
          variablesSchema: { message: { type: "string", defaultValue: "Hello" } },
          variations: [
            {
              value: "control",
              weight: 100,
              variableOverrides: {
                message: [
                  {
                    conditions: [
                      { attribute: "country", operator: "equals", value: "nl" },
                      { variable: "globalGate", operator: "notNull" },
                    ],
                    value: "Hallo",
                  },
                ],
              },
            },
          ],
        }),
      ).success,
    ).toBe(true);
  });
});

function parseFeature(
  feature: unknown,
  projectConfigOverrides: Partial<ProjectConfig> = {},
): z.ZodSafeParseResult<unknown> {
  return getFeatureSchema(projectConfigOverrides).safeParse(feature);
}

function expectParseSuccess(
  feature: unknown,
  projectConfigOverrides: Partial<ProjectConfig> = {},
): void {
  const result = parseFeature(feature, projectConfigOverrides);
  expect(result.success).toBe(true);
  if (!result.success) {
    const err = (result as z.ZodSafeParseError<unknown>).error;
    const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Expected success but got: ${msg}`);
  }
}

function expectParseFailure(
  feature: unknown,
  messageSubstring?: string,
  projectConfigOverrides: Partial<ProjectConfig> = {},
): z.ZodError {
  const result = parseFeature(feature, projectConfigOverrides);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected parse failure");
  const err = (result as z.ZodSafeParseError<unknown>).error;
  if (messageSubstring) {
    const messages = err.issues
      .map((i) => (typeof i.message === "string" ? i.message : ""))
      .join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

/** Assert that an intentional mistake produces an error at the expected path with expected message. */
function expectErrorSurfaces(
  feature: unknown,
  opts: {
    pathContains: string[];
    messageContains: string;
  },
): void {
  const err = expectParseFailure(feature, opts.messageContains);
  const pathStrings = err.issues.map((i) => i.path.join("."));
  const hasMatchingPath = pathStrings.some((p) =>
    opts.pathContains.every((seg) => p.includes(seg)),
  );
  expect(hasMatchingPath).toBe(true);
}

describe("featureSchema.ts :: getFeatureZodSchema (variablesSchema and variable values)", () => {
  describe("tags", () => {
    it("accepts missing tags", () => {
      const feature = baseFeature();
      delete feature.tags;

      expectParseSuccess(feature);
    });

    it("accepts tags defined in project config", () => {
      expectParseSuccess(baseFeature({ tags: ["all", "beta"] }), { tags: ["all", "beta"] });
    });

    it("rejects tags missing from project config", () => {
      expectParseFailure(baseFeature({ tags: ["unknown"] }), 'Unknown tag "unknown"');
    });

    it("rejects duplicate tags", () => {
      expectParseFailure(baseFeature({ tags: ["all", "all"] }), 'Duplicate tag "all".');
    });
  });

  describe("rule segments", () => {
    it("rejects empty and/or/not group segment arrays", () => {
      expectParseFailure(
        baseFeature({
          rules: {
            staging: [{ key: "r1", conditions: { and: [] }, percentage: 100 }],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );

      expectParseFailure(
        baseFeature({
          rules: {
            staging: [{ key: "r1", conditions: { or: [] }, percentage: 100 }],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );

      expectParseFailure(
        baseFeature({
          rules: {
            staging: [{ key: "r1", conditions: { not: [] }, percentage: 100 }],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });
  });

  describe("attribute-aware rule and force conditions", () => {
    it("accepts force conditions using semver operators on oneOf attributes", () => {
      expectParseSuccess(
        baseFeature({
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [
                  { attribute: "version", operator: "semverGreaterThan", value: "5.0.0" },
                ],
                variation: "treatment",
              },
            ],
            production: [],
          },
        }),
      );
    });

    it("accepts force conditions using flat object nested paths", () => {
      expectParseSuccess(
        baseFeature({
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [
                  { attribute: "traits.favoriteTheme", operator: "equals", value: "dark" },
                ],
                variation: "treatment",
              },
            ],
            production: [],
          },
        }),
      );
    });

    it("rejects force conditions when oneOf attribute value matches no branch", () => {
      expectParseFailure(
        baseFeature({
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "version", operator: "equals", value: true }],
                variation: "treatment",
              },
            ],
            production: [],
          },
        }),
        'Value does not match the schema of attribute "version"',
      );
    });

    it("rejects force conditions when array item value violates enum constraints", () => {
      expectParseFailure(
        baseFeature({
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "permissions", operator: "includes", value: "delete" }],
                variation: "treatment",
              },
            ],
            production: [],
          },
        }),
        'Value does not match the item schema of attribute "permissions"',
      );
    });
  });

  describe("variablesSchema: schema reference", () => {
    it("accepts variable with schema reference and valid defaultValue", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
    });

    it("rejects variable with unknown schema reference", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "nonexistentSchema",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "Unknown schema",
      );
    });

    it("rejects variable with schema reference when schema could not be loaded (missing from schemasByKey)", () => {
      const projectConfig = minimalProjectConfig();
      const conditionsZodSchema = getConditionsZodSchema(projectConfig, TEST_ATTRIBUTES);
      const schemaWithEmptySchemasByKey = getFeatureZodSchema(
        projectConfig,
        conditionsZodSchema,
        TEST_ATTRIBUTE_KEYS,
        TEST_SEGMENTS,
        TEST_FEATURES,
        ["link"],
        {},
      );
      const result = schemaWithEmptySchemasByKey.safeParse(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      const messages = (result as z.ZodSafeParseError<unknown>).error.issues
        .map((i) => (typeof i.message === "string" ? i.message : ""))
        .join(" ");
      expect(messages).toContain("could not be loaded");
      expect(messages).toContain("link");
      expect(messages).toContain("myLink");
    });

    it("rejects variable with schema reference when defaultValue does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home" }, // missing required "url"
            },
          },
        }),
      );
    });
  });

  describe("variablesSchema: inline schema and defaultValue", () => {
    it("accepts inline string variable with valid defaultValue", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "hello" },
          },
        }),
      );
    });

    it("accepts inline integer with min/max and defaultValue in range", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 5,
            },
          },
        }),
      );
    });

    it("rejects inline integer defaultValue below minimum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 0,
            },
          },
        }),
        "minimum",
      );
    });

    it("rejects inline integer defaultValue above maximum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 11,
            },
          },
        }),
        "maximum",
      );
    });

    it("rejects inline string defaultValue that violates minLength", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              minLength: 3,
              defaultValue: "ab",
            },
          },
        }),
        "minLength",
      );
    });

    it("rejects inline string defaultValue that violates maxLength", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              maxLength: 5,
              defaultValue: "toolong",
            },
          },
        }),
        "maxLength",
      );
    });

    it("rejects inline string defaultValue that does not match pattern", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9-]+$",
              defaultValue: "INVALID",
            },
          },
        }),
        "pattern",
      );
    });

    it("rejects inline array defaultValue with length below minItems", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              defaultValue: ["one"],
            },
          },
        }),
        "minItems",
      );
    });

    it("rejects inline array defaultValue with length above maxItems", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              maxItems: 2,
              defaultValue: ["a", "b", "c"],
            },
          },
        }),
        "maxItems",
      );
    });

    it("rejects inline array defaultValue with duplicate items when uniqueItems is true", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            codes: {
              type: "array",
              items: { type: "string" },
              uniqueItems: true,
              defaultValue: ["x", "x"],
            },
          },
        }),
        "duplicate",
      );
    });

    it("rejects inline const variable when defaultValue does not equal const", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            status: {
              type: "string",
              const: "active",
              defaultValue: "inactive",
            },
          },
        }),
        "constant",
      );
    });

    it("rejects inline enum variable when defaultValue is not in enum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            theme: {
              type: "string",
              enum: ["light", "dark"],
              defaultValue: "blue",
            },
          },
        }),
      );
    });

    it("accepts inline oneOf variable when defaultValue matches exactly one branch", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: "ref-123",
            },
          },
        }),
      );
    });

    it("rejects when variable has both schema reference and inline type", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              type: "object",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "schema",
      );
    });

    it.each(["feature", "variation", "variable"])(
      "rejects reserved variable key '%s'",
      (variableKey) => {
        expectParseFailure(
          baseFeature({
            variablesSchema: {
              [variableKey]: { type: "string", defaultValue: "control" },
            },
          }),
          "reserved",
        );
      },
    );

    it("uses custom reserved variable keys as an exact, case-sensitive list", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            custom: { type: "string", defaultValue: "value" },
          },
        }),
        "reserved",
        { reservedKeys: ["custom"] },
      );
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            variation: { type: "string", defaultValue: "control" },
            Custom: { type: "string", defaultValue: "value" },
          },
        }),
        { reservedKeys: ["custom"] },
      );
    });
  });

  describe("variablesSchema: disabledValue", () => {
    it("accepts valid disabledValue matching variable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: {
              type: "string",
              defaultValue: "on",
              disabledValue: "off",
            },
          },
        }),
      );
    });

    it("rejects disabledValue that does not match variable schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 5,
              disabledValue: 99,
            },
          },
        }),
        "maximum",
      );
    });
  });

  describe("variations: variables", () => {
    it("accepts variation variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { label: "treatment-label" } },
          ],
        }),
      );
    });

    it("rejects variation variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: { type: "integer", minimum: 1, maximum: 10, defaultValue: 1 },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { level: 100 } },
          ],
        }),
        "maximum",
      );
    });

    it("rejects when variation uses a variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { unknownVar: "x" } },
          ],
        }),
        "not defined in",
      );
    });
  });

  describe("variations: variableOverrides", () => {
    it("accepts variableOverrides with values matching variable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9-]+$",
              minLength: 1,
              maxLength: 20,
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variables: { slug: "treatment" },
              variableOverrides: {
                slug: [
                  { conditions: "countries.germany", value: "de" },
                  { conditions: "countries.france", value: "fr" },
                ],
              },
            },
          ],
        }),
      );
    });

    it("requires keys in variation variableOverrides when configured", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: { type: "string", defaultValue: "home" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ conditions: "countries.germany", value: "de" }],
              },
            },
          ],
        }),
        "must have a key when `requireOverrideKeysInFeatures` is enabled",
        { requireOverrideKeysInFeatures: true },
      );
    });

    it("rejects variableOverride value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z]+$",
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ conditions: "*", value: "UPPERCASE" }],
              },
            },
          ],
        }),
        "pattern",
      );
    });

    it("rejects variableOverride for variable key not in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                notDefined: [{ conditions: "*", value: "x" }],
              },
            },
          ],
        }),
        "not defined in",
      );
    });

    it("validates variableOverrides even when variation has no variables", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: { type: "string", maxLength: 5, defaultValue: "home" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ conditions: "*", value: "toolongvalue" }],
              },
            },
          ],
        }),
        "maxLength",
      );
    });

    it("accepts plain-key partial object overrides for structured object schemas", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["theme", "compact"],
              defaultValue: { theme: "light", compact: true },
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                config: [{ conditions: "*", value: { theme: "dark" } }],
              },
            },
          ],
        }),
      );
    });
  });

  describe("rules: variables", () => {
    it("accepts rule variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100 },
              {
                key: "r2",
                conditions: "countries.germany",
                percentage: 100,
                variables: { title: "Germany" },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects rule variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            count: { type: "integer", minimum: 0, maximum: 10, defaultValue: 0 },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100 },
              {
                key: "r2",
                conditions: "countries.germany",
                percentage: 100,
                variables: { count: 100 },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        "maximum",
      );
    });

    it("rejects rule variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100 },
              {
                key: "r2",
                conditions: "countries.germany",
                percentage: 100,
                variables: { unknownVar: "x" },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        "not defined in",
      );
    });

    it("rejects rule variable key when feature has no variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          rules: {
            staging: [{ key: "r1", conditions: "*", percentage: 100 }],
            production: [
              {
                key: "r1",
                conditions: "*",
                percentage: 80,
                variables: { blah123: "some value" },
              },
            ],
          },
        }),
        "not defined in",
      );
    });
  });

  describe("rules: variableOverrides", () => {
    it("accepts an exact namespaced variablesSchema key before mutation notation", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            "config.policy": {
              type: "object",
              properties: { retries: { type: "integer" } },
              defaultValue: { retries: 1 },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: { "config.policy": { retries: 2 } },
                variableOverrides: {
                  "config.policy": [{ conditions: "*", value: { retries: 3 } }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("accepts rule variableOverrides with values matching variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                title: { type: "string" },
                nested: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                  },
                },
              },
              defaultValue: {
                title: "default",
                nested: { count: 0 },
              },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      conditions: "countries.germany",
                      value: {
                        "nested.count": 5,
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("accepts the aligned keyed, mutation, and required feature forms", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" }, compact: { type: "boolean" } },
              defaultValue: { title: "Default", compact: false },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      key: "german-treatment",
                      description: "German treatment configuration",
                      promotable: true,
                      conditions: [
                        { attribute: "country", operator: "equals", value: "de" },
                        {
                          feature: "dependency",
                          enabled: true,
                          variation: "treatment",
                        },
                      ],
                      mutate: { title: "Behandlung" },
                    },
                    {
                      key: "dependency-only",
                      conditions: { feature: "dependency" },
                      value: { title: "Dependency", compact: true },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("keeps legacy unkeyed value mutation maps valid", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" }, compact: { type: "boolean" } },
              defaultValue: { title: "Default", compact: false },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  config: [{ conditions: "*", value: { title: "Legacy" } }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("requires keys in rule variableOverrides when configured", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  label: [{ conditions: "countries.germany", value: "de" }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        "must have a key when `requireOverrideKeysInFeatures` is enabled",
        { requireOverrideKeysInFeatures: true },
      );
    });

    it("accepts keyed rule and variation variableOverrides when configured", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                label: [{ key: "variation-germany", conditions: "countries.germany", value: "de" }],
              },
            },
          ],
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  label: [{ key: "rule-germany", conditions: "countries.germany", value: "de" }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        { requireOverrideKeysInFeatures: true },
      );
    });

    it.each([
      {
        name: "missing selector",
        override: { key: "invalid", value: "x" },
        message: "must define `conditions`",
      },
      {
        name: "conditions and segments together",
        override: { key: "invalid", conditions: "*", segments: "*", value: "x" },
        message: "Combine `segments`, `conditions`",
      },
      {
        name: "value and mutate together",
        override: { key: "invalid", conditions: "*", value: "x", mutate: { title: "x" } },
        message: "exactly one of `value` or `mutate`",
      },
      {
        name: "neither value nor mutate",
        override: { key: "invalid", conditions: "*" },
        message: "exactly one of `value` or `mutate`",
      },
      {
        name: "promotable without key",
        override: { promotable: false, conditions: "*", value: "x" },
        message: "key is required when `promotable` is set",
      },
    ])("rejects $name", ({ override, message }) => {
      expectParseFailure(
        baseFeature({
          variablesSchema: { label: { type: "string", defaultValue: "default" } },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: { label: [override] },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        message,
      );
    });

    it("rejects duplicate provided keys and mixed keyed promotion lists", () => {
      const feature = baseFeature({
        variablesSchema: { label: { type: "string", defaultValue: "default" } },
        rules: {
          staging: [
            {
              key: "r1",
              conditions: "*",
              percentage: 100,
              variableOverrides: {
                label: [
                  { key: "same", promotable: false, conditions: "*", value: "first" },
                  { key: "same", conditions: "*", value: "second" },
                  { conditions: "*", value: "legacy" },
                ],
              },
            },
          ],
          production: [{ key: "r1", conditions: "*", percentage: 100 }],
        },
      });
      expectParseFailure(feature, "Duplicate variable override keys");
      expectParseFailure(feature, "Every variable override in the list must have a key");
    });

    it("rejects rule variableOverrides for unknown variable key", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: { type: "string", defaultValue: "x" },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  unknown: [{ conditions: "*", value: "x" }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        "not defined in",
      );
    });

    it("rejects mutation notation in rule variableOverrides key", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" } },
              defaultValue: { title: "x" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  "config.title": [{ conditions: "*", value: "y" }],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        "must be a declared variable key",
      );
    });

    it("rejects rule variableOverride path not present in schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" } },
              defaultValue: { title: "x" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      conditions: "*",
                      value: {
                        "nested.missing": "x",
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        'Path "nested.missing" does not exist in the schema of variable "config".',
      );
    });

    it("ignores the placeholder payload for :remove like global overrides", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" }, optional: { type: "string" } },
              required: ["title"],
              defaultValue: { title: "x", optional: "y" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      conditions: [{ attribute: "country", operator: "equals", value: "de" }],
                      value: {
                        "optional:remove": "not-null",
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });
  });

  describe("force: variables", () => {
    it("accepts force variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "treatment",
                variables: { title: "Forced" },
              },
            ],
            production: [],
          },
        }),
      );
    });

    it("rejects force variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: { type: "integer", minimum: 1, maximum: 5, defaultValue: 1 },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "control",
                variables: { level: 10 },
              },
            ],
            production: [],
          },
        }),
        "maximum",
      );
    });

    it("rejects force variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "control",
                variables: { notDefined: "x" },
              },
            ],
            production: [],
          },
        }),
        "not defined in",
      );
    });
  });

  describe("environment maps", () => {
    it("allows direct rules, force, and expose when environments are omitted", () => {
      expectParseSuccess(
        baseFeature({
          expose: true,
          force: [{ conditions: "*", variation: "control" }],
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          rules: [{ key: "r1", conditions: "*", percentage: 100 }],
        }),
        { environments: undefined },
      );
    });

    it("allows a subset of configured environments in rules, force, and expose", () => {
      expectParseSuccess(
        baseFeature({
          expose: {
            staging: true,
          },
          force: {
            staging: [{ conditions: "*", variation: "control" }],
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          rules: {
            staging: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects direct rules when environments are configured", () => {
      const err = expectParseFailure(
        baseFeature({
          rules: [{ key: "r1", conditions: "*", percentage: 100 }],
        }),
      );

      expect(err.issues.some((issue) => issue.path.join(".").includes("rules"))).toBe(true);
    });

    it("rejects unknown environment keys in rules", () => {
      const err = expectParseFailure(
        baseFeature({
          rules: {
            qa: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );

      expect(err.issues.some((issue) => issue.path.join(".").includes("rules"))).toBe(true);
      expect(err.issues.some((issue) => issue.code === "invalid_key")).toBe(true);
    });
  });

  describe("oneOf: value must match exactly one branch", () => {
    it("rejects defaultValue that matches no oneOf branch", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: 42, // number matches neither
            },
          },
        }),
      );
    });

    it("rejects defaultValue that matches more than one oneOf branch when one is string", () => {
      // If we had two branches that both accept the same value, we'd get "matched more than one"
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: "id-1",
            },
          },
        }),
      );
    });
  });

  describe("schema reference: defaultValue resolved and validated", () => {
    it("rejects defaultValue for schema-ref variable when value violates resolved schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              schema: "slugSchema",
              defaultValue: "INVALID-SLUG", // pattern is ^[a-z0-9-]+$
            },
          },
        }),
      );
    });

    it("accepts defaultValue for schema-ref variable when value satisfies resolved schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            slug: {
              schema: "slugSchema",
              defaultValue: "valid-slug",
            },
          },
        }),
      );
    });
  });

  describe("complex cases (mirroring example-1 withSchema / withComplexSchema)", () => {
    it("accepts inline object variable with properties and valid defaultValue (e.g. settings)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              defaultValue: { theme: "light", compact: true },
            },
          },
        }),
      );
    });

    it("accepts object variable with additionalProperties only and arbitrary keys", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            labels: {
              type: "object",
              additionalProperties: { type: "string" },
              defaultValue: { title: "Welcome", subtitle: "Hello" },
            },
          },
        }),
      );
    });

    it("accepts object variable with properties and additionalProperties together", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            metadata: {
              type: "object",
              properties: {
                fixed: { type: "integer" },
              },
              additionalProperties: { type: "string" },
              required: ["fixed"],
              defaultValue: { fixed: 1, dynamicKey: "value" },
            },
          },
        }),
      );
    });

    it("rejects object variable when unknown key is present and additionalProperties is not defined", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
              },
              defaultValue: { theme: "light", subtitle: "hello" },
            },
          },
        }),
        "Unknown property",
      );
    });

    it("accepts object variable with additionalProperties that references reusable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            linksByLocale: {
              type: "object",
              additionalProperties: { schema: "link" },
              defaultValue: {
                en: { title: "Home", url: "/" },
                de: { title: "Start", url: "/de" },
              },
            },
          },
        }),
      );
    });

    it("rejects object variable when additionalProperties value does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            linksByLocale: {
              type: "object",
              additionalProperties: { schema: "link" },
              defaultValue: {
                en: { title: "Home" },
              },
            },
          },
        }),
        "Missing required property",
      );
    });

    it("treats object properties as optional when required is absent, as in JSON Schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              defaultValue: { compact: true },
            },
          },
        }),
      );
    });

    it("rejects inline object variable when defaultValue is missing required property", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["theme"],
              defaultValue: { compact: true },
            },
          },
        }),
      );
    });

    it("accepts inline array variable with items schema ref (e.g. linkPair)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            linkPair: {
              type: "array",
              items: { schema: "link" },
              defaultValue: [
                { title: "First", url: "/first" },
                { title: "Second", url: "/second" },
              ],
            },
          },
        }),
      );
    });

    it("rejects inline array with items schema ref when an item does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            linkPair: {
              type: "array",
              items: { schema: "link" },
              defaultValue: [{ title: "Only title, missing url" }],
            },
          },
        }),
      );
    });

    it("accepts oneOf variable when defaultValue matches object branch (e.g. refOrLink as link)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            refOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
    });

    it("accepts object variable with nested const in property (e.g. statusInfo.kind const active)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "active", label: "Default" },
            },
          },
        }),
      );
    });

    it("rejects object variable when nested const property has wrong value", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "inactive", label: "Default" },
            },
          },
        }),
      );
    });

    it("accepts object variable with nested enum in property (e.g. themeConfig.theme)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            themeConfig: {
              type: "object",
              properties: {
                theme: { type: "string", enum: ["light", "dark", "system"] },
                label: { type: "string" },
              },
              required: ["theme", "label"],
              defaultValue: { theme: "light", label: "Default" },
            },
          },
        }),
      );
    });

    it("rejects object variable when nested enum property has invalid value", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            themeConfig: {
              type: "object",
              properties: {
                theme: { type: "string", enum: ["light", "dark", "system"] },
                label: { type: "string" },
              },
              required: ["theme", "label"],
              defaultValue: { theme: "invalid", label: "Default" },
            },
          },
        }),
      );
    });

    it("accepts rule variables with object value (e.g. singleLink, themeColor in rules)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            singleLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: {
                  singleLink: { title: "DE Link", url: "/de" },
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects rule variable when object value does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            singleLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: {
                  singleLink: { title: "Missing url" },
                },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });
  });

  describe("errors surface properly: intentional mistakes produce correct path and message", () => {
    it("unknown schema ref: error path points to variable and message says Unknown schema", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "nonexistent",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "myLink", "schema"],
          messageContains: "Unknown schema",
        },
      );
    });

    it("defaultValue below minimum: error path includes defaultValue, message mentions minimum", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 10,
              maximum: 100,
              defaultValue: 5,
            },
          },
        }),
        { pathContains: ["variablesSchema", "level", "defaultValue"], messageContains: "minimum" },
      );
    });

    it("defaultValue above maximum: error path includes defaultValue, message mentions maximum", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              defaultValue: 99,
            },
          },
        }),
        { pathContains: ["variablesSchema", "level", "defaultValue"], messageContains: "maximum" },
      );
    });

    it("variation uses undeclared variable: error path points to variations.*.variables, message says not defined", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "x" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { typoVar: "y" } },
          ],
        }),
        {
          pathContains: ["variations", "variables", "typoVar"],
          messageContains: "not defined in",
        },
      );
    });

    it("variableOverrides value violates pattern: error path points to variableOverrides.*.value", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z-]+$",
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ conditions: "*", value: "INVALID-UPPERCASE" }],
              },
            },
          ],
        }),
        {
          pathContains: ["variableOverrides", "slug", "value"],
          messageContains: "pattern",
        },
      );
    });

    it("rule variable wrong type: error path points to rules.*.variables, message surfaces constraint", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            count: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              defaultValue: 0,
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: { count: 100 },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables", "count"],
          messageContains: "maximum",
        },
      );
    });

    it("disabledValue violates schema: error path includes disabledValue", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              defaultValue: 1,
              disabledValue: 99,
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "level", "disabledValue"],
          messageContains: "maximum",
        },
      );
    });

    it("reserved key variation: error path points to variablesSchema.variation", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            variation: { type: "string", defaultValue: "control" },
          },
        }),
        {
          pathContains: ["variablesSchema", "variation"],
          messageContains: "reserved",
        },
      );
    });

    it("object defaultValue missing required property: error path includes defaultValue and key, message says Missing required", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: { theme: { type: "string" }, requiredKey: { type: "string" } },
              required: ["requiredKey"],
              defaultValue: { theme: "light" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "settings", "defaultValue"],
          messageContains: "Missing required",
        },
      );
    });

    it("nested const property wrong: error path points into object value", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "inactive", label: "x" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "statusInfo", "defaultValue"],
          messageContains: "constant",
        },
      );
    });

    it("force variable not in variablesSchema: error path points to force.*.variables", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "control",
                variables: { typoKey: "x" },
              },
            ],
            production: [],
          },
        }),
        {
          pathContains: ["force", "variables", "typoKey"],
          messageContains: "not defined in",
        },
      );
    });
  });

  describe("mutation notation in variables", () => {
    it("accepts valid dot-notation mutation keys in rules.variables", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                width: { type: "integer" },
              },
              defaultValue: { theme: "light", width: 100 },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: { "config.theme": "dark", "config.width": 1200 },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("accepts valid array-index mutation keys in rules.variables", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              defaultValue: ["a", "b"],
            },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100, variables: { "tags[0]": "first" } },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects mutation key when root variable is not in variablesSchema", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100, variables: { "unknownVar.foo": "x" } },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables", "unknownVar.foo"],
          messageContains: "not defined in",
        },
      );
    });

    it("rejects invalid path (property not in schema)", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { theme: { type: "string" } },
              defaultValue: { theme: "light" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: { "config.unknownProp": "x" },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables"],
          messageContains:
            'Path "config.unknownProp" does not exist in the schema of variable "config".',
        },
      );
    });

    it("rejects :append on non-array (object property)", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { theme: { type: "string" } },
              defaultValue: { theme: "light" },
            },
          },
          rules: {
            staging: [
              { key: "r1", conditions: "*", percentage: 100, variables: { "config:append": "x" } },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        { pathContains: ["rules", "variables"], messageContains: "only allowed on array" },
      );
    });

    it("rejects :remove on required object property", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["compact"],
              defaultValue: { theme: "light", compact: true },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                conditions: "*",
                percentage: 100,
                variables: { "config.compact:remove": null },
              },
            ],
            production: [{ key: "r1", conditions: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables"],
          messageContains: "Cannot remove required property",
        },
      );
    });

    it("additionalProperties type mismatch: error path includes dynamic object key", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            labels: {
              type: "object",
              additionalProperties: { type: "string" },
              defaultValue: {
                title: 123,
              },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "labels", "defaultValue", "title"],
          messageContains: "type string",
        },
      );
    });

    it("rejects variable schema with schema reference mixed with inline additionalProperties", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              additionalProperties: { type: "string" },
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "additionalProperties",
      );
    });
  });
});
