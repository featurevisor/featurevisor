import type {
  Attribute,
  Conditions,
  ParsedFeature,
  ParsedVariable,
  Schema,
} from "@featurevisor/types";
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getSegmentZodSchema } from "./segmentSchema";
import { getVariableZodSchema } from "./variableSchema";
import { getTestsZodSchema } from "./testSchema";

const config = {
  environments: false,
  tags: [],
  namespaceCharacter: ".",
  enforceCatchAllRule: false,
} as unknown as ProjectConfig;
const attributes = {
  identity: { description: "Identity", type: "string" },
  now: { description: "Clock", type: "string", format: "date-time" },
  permissions: { description: "Permissions", type: "array", items: { type: "string" } },
} as Record<string, Attribute>;
const features = {
  checkout: {
    description: "Checkout",
    bucketBy: "identity",
    variations: [{ value: "control" }, { value: "treatment" }],
    variablesSchema: { title: { type: "string", defaultValue: "Title" } },
  },
  fallback: { description: "Fallback", disabledVariationValue: "off" },
  retired: { description: "Retired", archived: true },
} as unknown as Record<string, ParsedFeature>;
const variables = {
  policy: { description: "Policy", schema: "policy", defaultValue: { enabled: true, dates: [] } },
  title: { description: "Title", type: "string", defaultValue: "Title" },
  retired: { description: "Retired", type: "string", defaultValue: "Old", archived: true },
} as unknown as Record<string, ParsedVariable>;
const schemas = {
  policy: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      dates: { type: "array", items: { type: "string", format: "date-time" } },
    },
  },
} as Record<string, Schema>;
const segmentKeys = ["beta", "checkoutAudience"];
const attribute = { attribute: "identity", operator: "equals", value: "Ada" };
const feature = { feature: "checkout", variation: "treatment" };
const variable = { variable: "policy", path: ["enabled"], operator: "equals", value: true };
const mixed = { and: [attribute, "beta", { or: [feature, { not: [variable] }] }] };

function conditions(projectConfig = config) {
  return getConditionsZodSchema(
    projectConfig,
    attributes,
    schemas,
    features,
    variables,
    segmentKeys,
  );
}
function featureSchema(projectConfig = config) {
  return getFeatureZodSchema(
    projectConfig,
    conditions(projectConfig),
    ["identity"],
    segmentKeys as [string, ...string[]],
    Object.keys(features) as [string, ...string[]],
    Object.keys(schemas),
    schemas,
    features,
    variables,
  );
}
function variableSchema(projectConfig = config) {
  return getVariableZodSchema(projectConfig, attributes, segmentKeys, features, schemas, variables);
}
const ordinary = { description: "Title", type: "string", defaultValue: "Title" };
const baseFeature = {
  description: "Feature",
  bucketBy: "identity",
  rules: [{ key: "all", conditions: "*", percentage: 100 }],
  variablesSchema: { title: { type: "string", defaultValue: "Title" } },
};
function issues(schema: z.ZodTypeAny, value: unknown) {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected invalid authoring");
  return result.error.issues;
}

describe("unified condition authoring", () => {
  it.each(
    [attribute, "beta", feature, variable, mixed, [attribute, "beta", feature, variable], "*"].map(
      (value) => [value],
    ),
  )("preserves authored order and shape %j", (value) => {
    expect(conditions().parse(value)).toEqual(value);
  });
  it.each(
    [
      [],
      { and: [] },
      { or: [] },
      { not: [] },
      ["*"],
      { and: ["*"] },
      { or: [attribute, "*"] },
      { not: ["*"] },
      { and: [[attribute]] },
      { and: [attribute], or: [feature] },
      { attribute: "identity", feature: "checkout", operator: "exists" },
      { attribute: "identity", variable: "title", operator: "exists" },
      { feature: "checkout", variable: "title", enabled: true, operator: "exists" },
      { feature: "checkout", variable: "title", variation: "control", operator: "exists" },
      { feature: "checkout", extra: true },
      { ...attribute, extra: true },
      { ...variable, extra: true },
    ].map((value) => [value]),
  )("rejects malformed or ambiguous expressions %j", (value) => {
    expect(conditions().safeParse(value).success).toBe(false);
  });
  it("distinguishes a feature name from a segment and gives the exact replacement", () => {
    expect(issues(conditions(), "checkout")).toEqual([
      expect.objectContaining({
        message: 'Unknown segment "checkout". "checkout" is a feature: use { feature: checkout }.',
        path: [],
      }),
    ]);
    expect(
      issues(conditions(), { feature: "checkout", operator: "equals", value: "control" }),
    ).toEqual([
      expect.objectContaining({
        message: "To compare a variation, use variation: <value>",
        path: ["operator"],
      }),
    ]);
  });
  it("uses a bare string as a segment when both key spaces contain the key", () => {
    expect(
      getConditionsZodSchema(config, attributes, schemas, features, variables, ["checkout"]).parse(
        "checkout",
      ),
    ).toBe("checkout");
  });
  it("checks every leaf beneath mixed groups with precise paths", () => {
    const errors = issues(conditions({ ...config, disallowOperators: ["equals"] }), {
      or: [attribute, { and: ["beta", variable] }],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["or", 0, "operator"],
          message: expect.stringContaining("disallowed"),
        }),
        expect.objectContaining({
          path: ["or", 1, "and", 1, "operator"],
          message: expect.stringContaining("disallowed"),
        }),
      ]),
    );
  });
  it.each([
    [{ feature: "checkout", variation: "missing" }, ["variation"], "Unknown variation"],
    [{ variable: "policy", path: "absent", operator: "exists" }, ["path"], "Path does not exist"],
    [
      { variable: "policy", path: "enabled", operator: "equals", value: "true" },
      ["value"],
      "Value type",
    ],
    [
      { attribute: "now", operator: "equals", value: "2026-01-01" },
      ["operator"],
      "date-time attribute",
    ],
    [
      { attribute: "now", operator: "before", value: "2026-02-30T00:00:00Z" },
      ["value"],
      "ISO 8601",
    ],
    [{ variable: "title", operator: "matches", value: "(?=x)" }, ["value"], "Regular expression"],
    [
      { attribute: "identity", operator: "matches", value: "x", regexFlags: "ii" },
      ["regexFlags"],
      "unique",
    ],
  ])("retains existing leaf validation %j", (value, path, message) => {
    expect(issues(conditions(), value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, message: expect.stringContaining(message) }),
      ]),
    );
  });
  it("allows feature variables and disabled variation fallbacks", () => {
    expect(
      conditions().safeParse({
        feature: "checkout",
        variable: "title",
        operator: "startsWith",
        value: "T",
      }).success,
    ).toBe(true);
    expect(
      conditions().safeParse({ feature: "fallback", enabled: false, variation: "off" }).success,
    ).toBe(true);
  });
  it("validates date-time candidates selected through a referenced variable schema", () => {
    const result = conditions().safeParse({
      variable: "policy",
      path: ["dates"],
      operator: "includesAny",
      value: ["2026-10-15T12:00:00Z", "2026-02-30T00:00:00Z"],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["value", 1],
          message: expect.stringContaining("ISO 8601"),
        }),
      ]);
  });
  it("enforces a final wildcard rule using conditions", () => {
    const schema = featureSchema({ ...config, enforceCatchAllRule: true });
    expect(schema.safeParse(baseFeature).success).toBe(true);
    expect(
      issues(schema, {
        ...baseFeature,
        rules: [{ key: "beta", conditions: "beta", percentage: 100 }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["rules"],
          message: 'Missing catch-all rule with `conditions: "*"` at the end',
        }),
      ]),
    );
    expect(schema.safeParse({ ...baseFeature, rules: [] }).success).toBe(false);
  });
  it("provides a structural editor grammar containing every leaf kind", () => {
    const output = JSON.stringify(
      z.toJSONSchema(conditions().editorSchema, { unrepresentable: "any", io: "input" }),
    );
    for (const field of ["attribute", "feature", "variable", "and", "or", "not", "regexFlags"])
      expect(output).toContain(`"${field}"`);
  });
});

it("requires selectors and omits legacy fields in editor authoring shapes", () => {
  const options = { unrepresentable: "any", io: "input" } as const;
  const feature = z.toJSONSchema(featureSchema().editorSchema, options) as any;
  expect(feature.properties.rules.items.required).toContain("conditions");
  expect(feature.properties.force.items.required).toContain("conditions");
  expect(
    feature.properties.rules.items.properties.variableOverrides.additionalProperties.items.required,
  ).toContain("conditions");
  for (const field of ["segments", "requiredFeatures", "requiredVariables"]) {
    expect(feature.properties).not.toHaveProperty(field);
    expect(feature.properties.rules.items.properties).not.toHaveProperty(field);
    expect(feature.properties.force.items.properties).not.toHaveProperty(field);
  }
  const segment = z.toJSONSchema(
    getSegmentZodSchema(config, conditions()).editorSchema,
    options,
  ) as any;
  expect(segment.required).toContain("conditions");
  expect(segment.properties).not.toHaveProperty("requiredFeatures");
  const variable = JSON.stringify(z.toJSONSchema(variableSchema().editorSchema, options));
  expect(variable).toContain('"conditions"');
  expect(variable).not.toContain('"requiredVariables"');
  expect(variable).not.toContain('"requiredFeatures"');
});

const placements = [
  [
    "segment",
    (selector: object) => ({
      schema: getSegmentZodSchema(config, conditions()),
      input: { description: "Segment", ...selector },
      path: [],
    }),
  ],
  [
    "feature root",
    (selector: object) => ({
      schema: featureSchema(),
      input: { ...baseFeature, ...selector },
      path: [],
    }),
  ],
  [
    "rule",
    (selector: object) => ({
      schema: featureSchema(),
      input: { ...baseFeature, rules: [{ key: "rule", percentage: 100, ...selector }] },
      path: ["rules", 0],
    }),
  ],
  [
    "force",
    (selector: object) => ({
      schema: featureSchema(),
      input: { ...baseFeature, force: [{ enabled: true, ...selector }] },
      path: ["force", 0],
    }),
  ],
  [
    "rule override",
    (selector: object) => ({
      schema: featureSchema(),
      input: {
        ...baseFeature,
        rules: [
          {
            ...baseFeature.rules[0],
            variableOverrides: { title: [{ value: "Title", ...selector }] },
          },
        ],
      },
      path: ["rules", 0, "variableOverrides", "title", 0],
    }),
  ],
  [
    "variation override",
    (selector: object) => ({
      schema: featureSchema(),
      input: {
        ...baseFeature,
        variations: [
          {
            value: "control",
            weight: 100,
            variableOverrides: { title: [{ value: "Title", ...selector }] },
          },
        ],
      },
      path: ["variations", 0, "variableOverrides", "title", 0],
    }),
  ],
  [
    "global root",
    (selector: object) => ({
      schema: variableSchema(),
      input: { ...ordinary, ...selector },
      path: [],
    }),
  ],
  [
    "global override",
    (selector: object) => ({
      schema: variableSchema(),
      input: { ...ordinary, overrides: [{ key: "override", value: "Title", ...selector }] },
      path: ["overrides", 0],
    }),
  ],
  [
    "nested override",
    (selector: object) => ({
      schema: variableSchema(),
      input: {
        ...ordinary,
        overrides: [
          {
            key: "parent",
            conditions: "beta",
            value: "Title",
            overrides: [{ key: "child", value: "Title", ...selector }],
          },
        ],
      },
      path: ["overrides", 0, "overrides", 0],
    }),
  ],
  [
    "composition root",
    (selector: object) => ({
      schema: variableSchema(),
      input: { description: "Alias", compose: "title", ...selector },
      path: [],
    }),
  ],
] as const;

describe.each(placements)("conditions in %s", (_name, make) => {
  it.each([
    {
      value: [],
      relativePath: [],
      message: "conditions must not be empty. Use '*' to match everything.",
    },
    ...["and", "or", "not"].flatMap((group) => [
      {
        value: { [group]: [] },
        relativePath: [group],
        message: `\`${group}\` must contain at least one condition`,
      },
      {
        value: [attribute, { not: [{ or: [feature, { [group]: [] }] }] }],
        relativePath: [1, "not", 0, "or", 1, group],
        message: `\`${group}\` must contain at least one condition`,
      },
    ]),
  ])("gives a friendly empty expression error for $value", ({ value, relativePath, message }) => {
    const { schema, input, path } = make({ conditions: value });
    const errors = issues(schema, input);
    expect(errors).toEqual([
      expect.objectContaining({ path: [...path, "conditions", ...relativePath], message }),
    ]);
    expect(JSON.stringify(errors)).not.toMatch(/Too small|expected array to have|>=1 items/);
  });
  it("accepts every leaf kind together", () => {
    const { schema, input } = make({ conditions: mixed });
    expect(schema.safeParse(input).success).toBe(true);
  });
  it.each([
    ["segments", "beta", "Replace `segments` with `conditions`. Segment keys stay as strings."],
    [
      "requiredFeatures",
      ["checkout"],
      "Move into `conditions`. Write each feature key as { feature: <key> }. Object entries keep their shape.",
    ],
    ["requiredVariables", variable, "Move into `conditions`. Each entry keeps its shape."],
  ])("rejects removed %s with exact migration guidance", (field, value, message) => {
    const { schema, input, path } = make({ [field]: value });
    expect(issues(schema, input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [...path, field], message })]),
    );
  });
  it("explains how to combine multiple old selectors", () => {
    const { schema, input, path } = make({
      segments: "beta",
      conditions: attribute,
      requiredFeatures: ["checkout"],
      requiredVariables: variable,
    });
    expect(issues(schema, input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: [...path, "conditions"],
          message:
            "Combine `segments`, `conditions`, `requiredFeatures` and `requiredVariables` into one `conditions` array. An array means AND.",
        }),
      ]),
    );
  });
});

describe("composed disabled values", () => {
  it.each(["Fallback", null, undefined])(
    "accepts a compatible alias fallback %j",
    (disabledValue) => {
      expect(
        variableSchema().safeParse({
          description: "Alias",
          compose: "title",
          conditions: mixed,
          disabledValue,
        }).success,
      ).toBe(true);
    },
  );
  it.each([0, false, [], {}].map((value) => [value]))(
    "rejects an incompatible alias fallback %j",
    (disabledValue) => {
      expect(
        issues(variableSchema(), { description: "Alias", compose: "title", disabledValue }),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["disabledValue"] })]));
    },
  );
  it("validates all inferred members of a map fallback", () => {
    const definition = {
      description: "Map",
      compose: {
        title: { variable: "title" },
        enabled: { feature: "checkout" },
        variation: { feature: "checkout", variation: true },
        policy: { variable: "policy" },
      },
      conditions: mixed,
    };
    expect(
      variableSchema().safeParse({
        ...definition,
        disabledValue: {
          title: "Fallback",
          enabled: false,
          variation: "control",
          policy: { enabled: true, dates: [] },
        },
      }).success,
    ).toBe(true);
    expect(variableSchema().safeParse({ ...definition, disabledValue: null }).success).toBe(true);
    expect(
      issues(variableSchema(), {
        ...definition,
        disabledValue: { title: 1, enabled: "yes", variation: "missing", extra: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["disabledValue", "title"] }),
        expect.objectContaining({ path: ["disabledValue", "enabled"] }),
        expect.objectContaining({ path: ["disabledValue", "variation"] }),
        expect.objectContaining({ path: ["disabledValue", "policy"] }),
        expect.objectContaining({ path: ["disabledValue", "extra"] }),
      ]),
    );
  });
  it.each(["defaultValue", "useDefaultWhenDisabled"])("still rejects %s", (field) => {
    expect(
      issues(variableSchema(), { description: "Alias", compose: "title", [field]: undefined }),
    ).toEqual([
      expect.objectContaining({
        path: [field],
        message: `\`${field}\` is not supported on a composed variable.`,
      }),
    ]);
  });
});

describe("segment assertion dependency context", () => {
  const segments = {
    beta: { description: "Beta", conditions: "checkoutAudience" },
    checkoutAudience: { description: "Audience", conditions: mixed as Conditions },
    plain: { description: "Plain", conditions: attribute as Conditions },
  };
  const schema = (environments: false | string[]) =>
    getTestsZodSchema(
      { ...config, environments: environments || undefined },
      ["checkout"],
      ["beta", "checkoutAudience", "plain"],
      ["all"],
      ["policy", "title"],
      features,
      segments,
    );
  it("requires an environment for transitive feature or variable dependencies", () => {
    expect(
      issues(schema(["production"]), {
        segment: "beta",
        assertions: [{ context: {}, expectedToMatch: false }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["assertions", 0, "environment"],
          message: expect.stringContaining("environment is required"),
        }),
      ]),
    );
  });
  it("accepts environment, at and both sticky maps", () => {
    expect(
      schema(["production"]).safeParse({
        segment: "beta",
        assertions: [
          {
            environment: "production",
            at: 5,
            stickyFeatures: { checkout: { enabled: false } },
            stickyVariables: { title: "Sticky" },
            context: {},
            expectedToMatch: false,
          },
        ],
      }).success,
    ).toBe(true);
  });
  it("does not require an environment for attribute segments or flat projects", () => {
    expect(
      schema(["production"]).safeParse({
        segment: "plain",
        assertions: [{ context: {}, expectedToMatch: false }],
      }).success,
    ).toBe(true);
    expect(
      schema(false).safeParse({
        segment: "beta",
        assertions: [{ context: {}, expectedToMatch: false }],
      }).success,
    ).toBe(true);
  });
  it("validates matrix environment members and rejects unknown environments", () => {
    const assertion = {
      matrix: { lane: ["production", "qa"] },
      environment: "${{ lane }}",
      context: {},
      expectedToMatch: false,
    };
    expect(issues(schema(["production"]), { segment: "beta", assertions: [assertion] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["assertions", 0, "matrix", "lane", 1],
          message: 'Unknown environment "qa"',
        }),
      ]),
    );
  });
});
