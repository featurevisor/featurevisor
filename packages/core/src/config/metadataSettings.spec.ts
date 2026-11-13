import { assertMetadataSettings } from "./metadataSettings";

function check(metadataSchema: unknown) {
  return () => assertMetadataSettings({ metadataSchema });
}

describe("metadataSchema", () => {
  it("accepts the keywords and formats of reusable schemas, and deadline types", () => {
    expect(
      check({
        type: "object",
        description: "What teams record about a definition",
        properties: {
          owner: { type: "string", enum: ["checkout-team"] },
          jira: { type: "string", pattern: "^[A-Z]+-[0-9]+$", minLength: 3, maxLength: 20 },
          launchedOn: { type: "string", format: "date-time" },
          budget: { type: "integer", minimum: 0, maximum: 10 },
          reviewers: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
          idOrName: { oneOf: [{ type: "integer" }, { type: "string" }] },
          deadlines: {
            type: "object",
            description: "Plans for each definition",
            properties: {
              review: { description: "Check the flag still earns its place" },
              remove: {
                type: "object",
                properties: { ticket: { type: "string", format: "date-time" } },
                required: ["ticket", "description"],
              },
            },
            required: ["remove"],
            additionalProperties: {},
          },
        },
        required: ["owner", "deadlines"],
        additionalProperties: {},
      }),
    ).not.toThrow();
  });

  it.each([
    ["text", "Invalid metadataSchema: expected a schema object."],
    [{}, 'Invalid metadataSchema.type: expected "object", since metadata is an object.'],
    [
      { type: "string" },
      'Invalid metadataSchema.type: expected "object", since metadata is an object.',
    ],
    [
      { type: "object", schema: "link" },
      'Invalid metadataSchema.schema: unknown keyword. Expected one of "description", "type"',
    ],
    [
      { type: "object", properties: { a: { type: "date" } } },
      'Invalid metadataSchema.properties.a.type: expected one of "boolean", "string"',
    ],
    [
      { type: "object", properties: { a: { type: "integer", format: "semver" } } },
      'Invalid metadataSchema.properties.a.format: format is only supported with type "string".',
    ],
    [
      { type: "object", properties: { a: { type: "string", format: "email" } } },
      'Invalid metadataSchema.properties.a.format: expected one of "date-time", "semver".',
    ],
    [
      { type: "object", properties: { a: { type: "string", format: "date" } } },
      'Invalid metadataSchema.properties.a.format: unsupported format "date". Use `format: date-time`, a timestamp with a timezone.',
    ],
    [
      { type: "object", properties: { a: { type: "string", enum: ["x", 1] } } },
      'Invalid metadataSchema.properties.a.enum[1]: 1 is not of type "string".',
    ],
    [
      { type: "object", properties: { a: { type: "integer", minimum: 5, maximum: 1 } } },
      "Invalid metadataSchema.properties.a.minimum: must not be greater than maximum.",
    ],
    [
      { type: "object", properties: { a: { type: "string", pattern: "(" } } },
      "Invalid metadataSchema.properties.a.pattern: expected a valid regular expression.",
    ],
    [
      { type: "object", properties: { a: { type: "array" } } },
      'Invalid metadataSchema.properties.a.items: required when type is "array".',
    ],
    [
      { type: "object", properties: { a: { oneOf: [{ type: "string" }] } } },
      "Invalid metadataSchema.properties.a.oneOf: expected a list of two or more schemas.",
    ],
    [
      { type: "object", required: ["jira"] },
      'Invalid metadataSchema.required: "jira" is not declared in properties.',
    ],
    [
      { type: "object", properties: { deadlines: { enum: ["a"] } } },
      'Invalid metadataSchema.properties.deadlines.enum: unknown keyword. Expected one of "type", "description", "properties", "required", "additionalProperties".',
    ],
    [
      { type: "object", properties: { deadlines: { properties: { done: {} } } } },
      'Invalid metadataSchema.properties.deadlines.properties.done: "done" is a deadline status, so it cannot name a deadline type.',
    ],
    [
      { type: "object", properties: { deadlines: { properties: { "1st": {} } } } },
      "Invalid metadataSchema.properties.deadlines.properties.1st: a deadline type starts with a letter, and has only letters, digits, _ and -.",
    ],
    [
      {
        type: "object",
        properties: {
          deadlines: { properties: { review: { properties: { by: { type: "string" } } } } },
        },
      },
      'Invalid metadataSchema.properties.deadlines.properties.review.properties.by: "by" is a field of every deadline, and its shape cannot change.',
    ],
    [
      {
        type: "object",
        properties: {
          deadlines: { properties: { remove: { additionalProperties: { type: "string" } } } },
        },
      },
      "Invalid metadataSchema.properties.deadlines.properties.remove.additionalProperties: a deadline type declares each of its own fields in properties.",
    ],
    [
      {
        type: "object",
        properties: { deadlines: { additionalProperties: { additionalProperties: {} } } },
      },
      "Invalid metadataSchema.properties.deadlines.additionalProperties.additionalProperties: a deadline type declares each of its own fields in properties.",
    ],
    [
      {
        type: "object",
        properties: { deadlines: { properties: { review: { required: ["by"] } } } },
      },
      'Invalid metadataSchema.properties.deadlines.properties.review.required: "by" is always required.',
    ],
    [
      {
        type: "object",
        properties: { deadlines: { properties: { review: { required: ["done"] } } } },
      },
      'Invalid metadataSchema.properties.deadlines.properties.review.required: "done" cannot be required, or every deadline would be done.',
    ],
    [
      {
        type: "object",
        properties: { deadlines: { properties: { review: { required: ["ticket"] } } } },
      },
      'Invalid metadataSchema.properties.deadlines.properties.review.required: "ticket" is not "description" or a field declared in properties.',
    ],
    [
      { type: "object", properties: { deadlines: { required: ["remove"] } } },
      'Invalid metadataSchema.properties.deadlines.required: "remove" is not a deadline type declared in properties.',
    ],
  ])("refuses %j", (schema, message) => {
    expect(check(schema)).toThrow(message);
  });
});

describe("requireMetadataIn", () => {
  it("accepts kinds of definition", () => {
    expect(() =>
      assertMetadataSettings({ requireMetadataIn: ["features", "variables", "schemas"] }),
    ).not.toThrow();
  });

  it.each([
    [[], "Invalid requireMetadataIn: expected a list of"],
    ["features", "Invalid requireMetadataIn: expected a list of"],
    [["tests"], 'Invalid requireMetadataIn: "tests" is not one of "features", "variables"'],
    [["features", "features"], 'Invalid requireMetadataIn: duplicate kind "features".'],
  ])("refuses %j", (value, message) => {
    expect(() => assertMetadataSettings({ requireMetadataIn: value })).toThrow(message);
  });
});
