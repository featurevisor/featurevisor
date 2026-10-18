import type { Schema, VariableMutations } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getVariableZodSchema } from "./variableSchema";

const config = {
  environments: undefined,
  tags: ["all"],
  namespaceCharacter: ".",
} as ProjectConfig;

const schema: Schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    rows: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          tags: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["tags"],
      },
    },
  },
  required: ["title", "rows"],
};
type Row = {
  id?: string;
  tags: string[];
};
type Location = "global" | "continuing global" | "rule" | "variation";
interface Regression {
  name: string;
  rows: Row[];
  mutations: VariableMutations;
  responsibleIndex: number;
  responsibleKey: string;
}

const regressions: Regression[] = [
  {
    name: "renaming a selector property retains the earlier tag mutation",
    rows: [{ id: "one", tags: ["x"] }],
    mutations: [{ "rows[id=one].tags:removeValue": "x" }, { "rows[id=one].id": "renamed" }],
    responsibleIndex: 0,
    responsibleKey: "rows[id=one].tags:removeValue",
  },
  {
    name: "deleting an optional selector property retains the earlier tag mutation",
    rows: [{ id: "one", tags: ["x"] }],
    mutations: [{ "rows[id=one].tags:removeValue": "x" }, { "rows[id=one].id:remove": null }],
    responsibleIndex: 0,
    responsibleKey: "rows[id=one].tags:removeValue",
  },
  {
    name: "a duplicate selector only modifies its first actual match",
    rows: [
      { id: "same", tags: ["x"] },
      { id: "same", tags: ["x"] },
    ],
    mutations: [{ "rows[1].tags:removeValue": "x" }, { "rows[id=same].tags:append": "y" }],
    responsibleIndex: 0,
    responsibleKey: "rows[1].tags:removeValue",
  },
  {
    name: "removing an earlier row shifts the invalid row without changing responsibility",
    rows: [
      { id: "one", tags: ["x"] },
      { id: "two", tags: ["x"] },
    ],
    mutations: [{ "rows[1].tags:removeValue": "x" }, { "rows[0]:remove": null }],
    responsibleIndex: 0,
    responsibleKey: "rows[1].tags:removeValue",
  },
  {
    name: "inserting before an earlier row shifts the invalid row",
    rows: [
      { id: "one", tags: ["x"] },
      { id: "two", tags: ["x"] },
    ],
    mutations: [
      { "rows[1].tags:removeValue": "x" },
      { "rows[0]:before": { id: "new", tags: ["valid"] } },
    ],
    responsibleIndex: 0,
    responsibleKey: "rows[1].tags:removeValue",
  },
  {
    name: "inserting after an earlier row shifts the invalid row",
    rows: [
      { id: "one", tags: ["x"] },
      { id: "two", tags: ["x"] },
    ],
    mutations: [
      { "rows[1].tags:removeValue": "x" },
      { "rows[0]:after": { id: "new", tags: ["valid"] } },
    ],
    responsibleIndex: 0,
    responsibleKey: "rows[1].tags:removeValue",
  },
  {
    name: "prepending a row shifts an earlier numeric target",
    rows: [{ id: "one", tags: ["x"] }],
    mutations: [
      { "rows[0].tags:removeValue": "x" },
      { "rows:prepend": { id: "new", tags: ["valid"] } },
    ],
    responsibleIndex: 0,
    responsibleKey: "rows[0].tags:removeValue",
  },
  {
    name: "multiple insertions and removals retain the original numeric target",
    rows: [
      { id: "one", tags: ["x"] },
      { id: "two", tags: ["x"] },
    ],
    mutations: [
      { "rows[1].tags:removeValue": "x" },
      { "rows[0]:before": { id: "new", tags: ["valid"] } },
      { "rows[1]:remove": null },
      { "rows:prepend": { id: "prefix", tags: ["valid"] } },
    ],
    responsibleIndex: 0,
    responsibleKey: "rows[1].tags:removeValue",
  },
  {
    name: "a missing selector after removing the last row does not cause the length failure",
    rows: [{ id: "one", tags: ["x"] }],
    mutations: [{ "rows[0]:remove": null }, { "rows[id=missing].tags:append": "y" }],
    responsibleIndex: 0,
    responsibleKey: "rows[0]:remove",
  },
  {
    name: "a later tag mutation after a selector rename receives its own item index",
    rows: [{ id: "one", tags: ["x", "y"] }],
    mutations: [
      { "rows[id=one].tags:removeValue": "x" },
      { "rows[id=one].id": "renamed" },
      { "rows[id=renamed].tags:removeValue": "y" },
    ],
    responsibleIndex: 2,
    responsibleKey: "rows[id=renamed].tags:removeValue",
  },
];

function validate(location: Location, rows: Row[], mutations: VariableMutations) {
  const defaultValue = { title: "Default", rows };
  const override = { key: "all", conditions: "*", mutate: mutations };
  if (location === "global" || location === "continuing global") {
    return getVariableZodSchema(config, {}, [], {}, {}).safeParse({
      description: "Mutation provenance",
      ...schema,
      defaultValue,
      overrides: [{ ...override, ...(location === "continuing global" ? { continue: true } : {}) }],
    });
  }

  return getFeatureZodSchema(
    config,
    getConditionsZodSchema(config, {}),
    ["userId"],
    ["*"],
    ["checkout"],
  ).safeParse({
    description: "Mutation provenance",
    tags: ["all"],
    bucketBy: "userId",
    variablesSchema: { policy: { ...schema, defaultValue } },
    variations: [
      {
        value: "control",
        weight: 100,
        ...(location === "variation" ? { variableOverrides: { policy: [override] } } : {}),
      },
    ],
    rules: [
      {
        key: "all",
        conditions: "*",
        percentage: 100,
        ...(location === "rule" ? { variableOverrides: { policy: [override] } } : {}),
      },
    ],
  });
}

function mutationPath(location: Location) {
  if (location === "global" || location === "continuing global") {
    return ["overrides", 0, "mutate"];
  }
  return location === "rule"
    ? ["rules", 0, "variableOverrides", "policy", 0, "mutate"]
    : ["variations", 0, "variableOverrides", "policy", 0, "mutate"];
}

describe.each<Location>(["global", "continuing global", "rule", "variation"])(
  "%s final mutation result provenance",
  (location) => {
    test.each(regressions)("$name", ({ rows, mutations, responsibleIndex, responsibleKey }) => {
      const before = JSON.stringify({ rows, mutations });
      const result = validate(location, rows, mutations);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].message).toContain("minItems");
        expect(result.error.issues[0].path).toEqual([
          ...mutationPath(location),
          responsibleIndex,
          responsibleKey,
        ]);
      }
      expect(JSON.stringify({ rows, mutations })).toBe(before);
    });

    test.each([
      {
        name: "a later append repairs a temporarily empty tags array",
        mutations: [
          { "rows[id=one].tags:removeValue": "x" },
          { "rows[id=one].tags:append": "repaired" },
        ],
      },
      {
        name: "a renamed selector can repair the same row",
        mutations: [
          { "rows[id=one].tags:removeValue": "x" },
          { "rows[id=one].id": "renamed" },
          { "rows[id=renamed].tags:append": "repaired" },
        ],
      },
      {
        name: "repair follows a numeric target shifted by an insertion",
        mutations: [
          { "rows[0].tags:removeValue": "x" },
          { "rows[0]:before": { id: "new", tags: ["valid"] } },
          { "rows[1].tags:append": "repaired" },
        ],
      },
    ] as Array<{
      name: string;
      mutations: VariableMutations;
    }>)("$name", ({ mutations }) => {
      const result = validate(location, [{ id: "one", tags: ["x"] }], mutations);
      expect(result.success).toBe(true);
    });

    test("removing the invalid row preserves acceptance of the valid final value", () => {
      const result = validate(
        location,
        [
          { id: "one", tags: ["x"] },
          { id: "two", tags: ["x"] },
        ],
        [{ "rows[id=one].tags:removeValue": "x" }, { "rows[id=one]:remove": null }],
      );
      expect(result.success).toBe(true);
    });
  },
);
