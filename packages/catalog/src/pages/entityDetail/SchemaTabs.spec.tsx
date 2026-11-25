import { describeConditions, parseConditions } from "../../components/conditionExpression";
import { getTestOwner } from "../../testReferences";
import { countSchemaIssues, countSchemaMutations, getSchemaEntryNodes } from "./SchemaTabs";

const schema = {
  type: "object",
  properties: {
    password: { type: "string" },
    confirmPassword: { type: "string" },
    address: {
      type: "object",
      properties: { country: { type: "string" }, state: { type: "string" } },
      mutations: [
        {
          key: "unitedStates",
          conditions: { input: "country", operator: "equals", value: "US" },
          mutate: { required: ["state"] },
          // Checked once its parent matches, and counted with it.
          mutations: [
            {
              key: "california",
              conditions: { input: "state", operator: "equals", value: "CA" },
              mutate: { "properties.state.minLength": 2 },
            },
          ],
        },
      ],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { quantity: { type: "integer" } },
        issues: [
          {
            key: "tooMany",
            conditions: { input: "quantity", operator: "greaterThan", value: 9 },
            path: "quantity",
            message: "At most 9",
          },
        ],
      },
    },
  },
  mutations: {
    dev: [{ key: "short", conditions: "*", mutate: { "properties.password.minLength": 1 } }],
    production: [],
  },
  issues: [
    {
      key: "passwordsDiffer",
      conditions: {
        input: "confirmPassword",
        operator: "notEquals",
        valueFrom: { input: "password" },
      },
      path: "confirmPassword",
      message: "The passwords do not match",
    },
  ],
};

describe("a schema's Mutations and Issues tabs", () => {
  test("finds every node with mutations or issues, the root first, and says where each sits", () => {
    expect(getSchemaEntryNodes(schema).map(({ path }) => path)).toEqual(["", "address", "items[]"]);
  });

  test("counts mutations, in every environment's list and nested, and issues, each for its own tab", () => {
    expect(countSchemaMutations(schema)).toBe(3);
    expect(countSchemaIssues(schema)).toBe(2);
    expect(countSchemaMutations({ type: "string" })).toBe(0);
    expect(countSchemaIssues({ type: "string" })).toBe(0);
  });

  test("an input leaf reads as a field, compared with a value or another field", () => {
    expect(
      describeConditions(
        parseConditions({ input: "accountType", operator: "equals", value: "business" })!,
      ),
    ).toBe('field accountType equals "business"');
    expect(describeConditions(parseConditions(schema.issues[0].conditions)!)).toBe(
      "field confirmPassword notEquals field password",
    );
  });

  test("a schema's spec is its own test spec", () => {
    expect(getTestOwner({ schema: "signUp", assertions: [] } as never)).toEqual({
      type: "schema",
      key: "signUp",
      reason: "Own test spec",
    });
  });
});
