import { extractSchemaReferences } from "./schemaReferences";

describe("schema references", () => {
  it("finds nested and transitive schema-bearing fields without scanning runtime values", () => {
    expect(
      Array.from(
        extractSchemaReferences({
          type: "object",
          properties: {
            profile: { schema: "profile" },
            rows: { type: "array", items: { schema: "row" } },
            lookup: { type: "object", additionalProperties: { schema: "entry" } },
            choice: { oneOf: [{ schema: "choiceA" }, { schema: "choiceB" }] },
          },
          defaultValue: {
            schema: "not-a-reference",
            nested: { schema: "also-not-a-reference" },
          },
        }),
      ).sort(),
    ).toEqual(["choiceA", "choiceB", "entry", "profile", "row"]);
  });
});
