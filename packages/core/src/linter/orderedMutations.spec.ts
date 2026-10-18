import type { ParsedFeature, Schema } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { mutationEntries } from "../builder/mutationEntries";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getVariableZodSchema } from "./variableSchema";
import { getMutationOrderChanges } from "./mutationOrder";

const config = {
  environments: false,
  tags: ["all"],
  namespaceCharacter: ".",
} as unknown as ProjectConfig;
const valueSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    methods: { type: "array", items: { type: "string" }, minItems: 1 },
    rows: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
  },
  required: ["title", "methods"],
} as Schema;
const defaultValue = { title: "Default", methods: ["card"], rows: [{ id: "one" }] };
const override = (mutate: unknown) => ({ key: "all", conditions: "*", mutate });
const variable = (mutate: unknown) => ({
  description: "Policy",
  ...valueSchema,
  defaultValue,
  overrides: [override(mutate)],
});
const feature = (mutate: unknown) => ({
  description: "Checkout",
  tags: ["all"],
  bucketBy: "userId",
  variablesSchema: { policy: { ...valueSchema, defaultValue } },
  rules: [
    {
      key: "all",
      conditions: "*",
      percentage: 100,
      variableOverrides: { policy: [override(mutate)] },
    },
  ],
});
const globalSchema = () => getVariableZodSchema(config, {}, [], {}, {});
const featureSchema = () =>
  getFeatureZodSchema(config, getConditionsZodSchema(config, {}), ["userId"], ["*"], ["checkout"]);

describe.each(["variable", "feature"])("ordered %s mutation linting", (entity) => {
  const validate = (mutate: unknown) =>
    entity === "variable"
      ? globalSchema().safeParse(variable(mutate))
      : featureSchema().safeParse(feature(mutate));
  const path =
    entity === "variable"
      ? ["overrides", 0, "mutate"]
      : ["rules", 0, "variableOverrides", "policy", 0, "mutate"];

  it.each([
    { mutate: [{ title: "First" }, { title: "Last" }] },
    { mutate: [{ "methods:append": "ideal" }, { "methods:append": "paypal" }] },
  ])("accepts valid mutations $mutate", ({ mutate }) => {
    expect(validate(mutate).success).toBe(true);
  });

  it("keeps empty list validation identical to empty map validation", () => {
    expect(validate([]).success).toBe(validate({}).success);
  });

  it.each([null, "path", 2, true, [], {}, { title: "First", methods: [] }].map((item) => [item]))(
    "rejects malformed list item %j without throwing",
    (item) => {
      const result = validate([{ title: "Valid" }, item]);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: [...path, 1] })]),
        );
    },
  );

  it.each([
    ["title:future", "x"],
    ["title", 2],
    ["missing", "x"],
    ["methods:appendUnique", {}],
    ["methods:removeValue", []],
    ["rows[id=absent]", "not an object"],
    ["rows[-1]:remove", true],
    ["methods:remove", "wrong operand"],
    ["__proto__.title", "unsafe"],
  ])("reports the list index for invalid path or operand %s", (key, value) => {
    const result = validate([{ title: "Valid" }, { [key]: value }]);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [...path, 1, key] })]),
      );
  });

  it("still rejects invalid final values and value plus mutate", () => {
    expect(validate([{ "methods:removeValue": "card" }]).success).toBe(false);
    const input = entity === "variable" ? variable([]) : feature([]);
    const target =
      entity === "variable"
        ? (input as ReturnType<typeof variable>).overrides[0]
        : (input as ReturnType<typeof feature>).rules[0].variableOverrides.policy[0];
    Object.assign(target, { value: defaultValue });
    expect(
      (entity === "variable" ? globalSchema() : featureSchema()).safeParse(input).success,
    ).toBe(false);
  });

  it("attributes final schema errors to the item changing that property", () => {
    const result = validate([{ "methods:removeValue": "card" }, { title: "Unrelated" }]);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [...path, 0, "methods:removeValue"] }),
        ]),
      );
  });

  it("allows a temporary invalid value repaired by a later item", () => {
    expect(
      validate([{ "methods:removeValue": "card" }, { "methods:append": "ideal" }]).success,
    ).toBe(true);
  });

  it("distinguishes selectors targeting different rows in final value diagnostics", () => {
    const mutations = [
      { "rows[id=one].tags:removeValue": "x" },
      { "rows[id=two].tags:append": "y" },
    ];
    const input = JSON.parse(
      JSON.stringify(entity === "variable" ? variable(mutations) : feature(mutations)),
    );
    const schema = entity === "variable" ? input : input.variablesSchema.policy;
    schema.properties.rows.items.properties.tags = {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    };
    schema.defaultValue.rows = [
      { id: "one", tags: ["x"] },
      { id: "two", tags: ["x"] },
    ];
    const result = (entity === "variable" ? globalSchema() : featureSchema()).safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [...path, 0, "rows[id=one].tags:removeValue"] }),
        ]),
      );
      expect(
        result.error.issues.some(
          (issue) =>
            JSON.stringify(issue.path) === JSON.stringify([...path, 1, "rows[id=two].tags:append"]),
        ),
      ).toBe(false);
    }
  });
});

describe("ordered mutation validation boundaries", () => {
  it.each([true, false])(
    "attributes final accumulating result errors with continuation %s",
    (continuing) => {
      const input = variable([{ title: "Updated" }, { "methods:removeValue": "card" }]);
      Object.assign(input.overrides[0], { continue: continuing });
      const result = globalSchema().safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["overrides", 0, "mutate", 1, "methods:removeValue"] }),
          ]),
        );
    },
  );
  it.each([true, false])(
    "reports nested environment list indexes with precomputation %s",
    (precomputeMutations) => {
      const schema = getVariableZodSchema(
        { ...config, environments: ["production"], precomputeMutations } as ProjectConfig,
        {},
        [],
        {},
        {},
      );
      const result = schema.safeParse({
        ...variable({}),
        overrides: {
          production: [
            { ...override({}), overrides: [override([{ title: "Good" }, { title: 2 }])] },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["overrides", "production", 0, "overrides", 0, "mutate", 1, "title"],
            }),
          ]),
        );
    },
  );

  it("does not reinterpret legacy literal arrays as mutation lists", () => {
    const input = feature([]);
    input.variablesSchema.policy = {
      type: "array",
      items: { type: "string" },
      defaultValue: ["card"],
    } as any;
    input.rules[0].variableOverrides.policy = [
      { key: "all", conditions: "*", value: ["ideal", "paypal"] } as any,
    ];
    expect(featureSchema().safeParse(input).success).toBe(true);
    input.rules[0].variableOverrides.policy[0] = {
      key: "all",
      conditions: "*",
      value: [{ ":append": "ideal" }],
    } as any;
    expect(featureSchema().safeParse(input).success).toBe(false);
  });

  it("keeps the v3 mutation order diagnostic for maps only", () => {
    const mutations = { "methods:append": "ideal", methods: ["card"] };
    expect(getMutationOrderChanges(feature(mutations) as unknown as ParsedFeature)).toHaveLength(1);
    expect(
      getMutationOrderChanges(
        feature(
          mutationEntries(mutations).map(([key, value]) => ({ [key]: value })),
        ) as unknown as ParsedFeature,
      ),
    ).toEqual([]);
  });

  it("rejects invalid list shapes even when building without lint", () => {
    for (const item of [null, [], {}, { first: 1, second: 2 }]) {
      expect(() => mutationEntries([item] as any)).toThrow("exactly one mutation path");
    }
  });
});
