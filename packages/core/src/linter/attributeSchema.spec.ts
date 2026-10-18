import { z } from "zod";

import { getAttributeZodSchema } from "./attributeSchema";

function parseAttribute(input: unknown): z.ZodSafeParseResult<unknown> {
  return getAttributeZodSchema().safeParse(input);
}

function expectAttributeSuccess(input: unknown): void {
  const result = parseAttribute(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const error = (result as z.ZodSafeParseError<unknown>).error;
    const msg = error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Expected attribute to pass: ${msg}`);
  }
}

function expectAttributeFailure(input: unknown, messageSubstring?: string): z.ZodError {
  const result = parseAttribute(input);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected attribute to fail");
  }

  const error = (result as z.ZodSafeParseError<unknown>).error;

  if (messageSubstring) {
    const messages = error.issues.map((issue) => issue.message).join(" ");
    expect(messages).toContain(messageSubstring);
  }

  return error;
}

describe("attributeSchema.ts :: getAttributeZodSchema", () => {
  describe("portable date literals", () => {
    it("distinguishes invalid timestamps from enum type mismatches and names const values", () => {
      const error = expectAttributeFailure({
        description: "Launch",
        type: "string",
        format: "date-time",
        enum: ["soon", 42],
        const: "later",
      });
      expect(error.issues.map((issue) => ({ path: issue.path, message: issue.message }))).toEqual([
        {
          path: ["enum", 0],
          message:
            'Enum value at index 0 ("soon") is not a portable ISO 8601 timestamp for format: date-time.',
        },
        {
          path: ["enum", 1],
          message:
            'Enum value at index 1 (42) does not match type "string". All enum values must be of the same type as `type`.',
        },
        {
          path: ["const"],
          message:
            '`const` value ("later") is not a portable ISO 8601 timestamp for format: date-time.',
        },
      ]);
    });
    it.each([
      "2026-01-01",
      "2026-01-01T00:00:00",
      "2026-02-29T00:00:00Z",
      "2026-01-01T00:00:00+14:01",
      "0000-01-01T00:00:00Z",
      "soon",
      42,
      null,
    ])("rejects date enum and const literal %s", (value) => {
      for (const field of ["enum", "const"] as const) {
        const error = expectAttributeFailure({
          description: "Launch",
          type: "string",
          format: "date-time",
          [field]: field === "enum" ? [value] : value,
        });
        expect(error.issues).toHaveLength(1);
        expect(error.issues[0].path).toEqual(field === "enum" ? ["enum", 0] : ["const"]);
      }
    });

    it("accepts offsets, leap days and extended precision", () => {
      expectAttributeSuccess({
        description: "Launch",
        type: "string",
        format: "date-time",
        enum: ["2024-02-29T12:00:00Z", "2026-01-01T00:00:00.123456789+14:00"],
        const: "2026-01-01T00:00:00-14:00",
      });
    });

    it.each(["properties", "additionalProperties", "oneOf"])(
      "reports exactly one indexed issue for dates nested through %s",
      (location) => {
        const child = { type: "string", format: "date-time", enum: ["soon"] };
        const definition =
          location === "oneOf"
            ? { description: "Dates", oneOf: [child, { type: "string" }] }
            : {
                description: "Dates",
                type: "object",
                [location]: location === "properties" ? { launch: child } : child,
              };
        const error = expectAttributeFailure(definition);
        expect(error.issues).toHaveLength(1);
        expect(error.issues[0].path).toEqual(
          location === "properties"
            ? [location, "launch", "enum", 0]
            : location === "oneOf"
              ? [location, 0, "enum", 0]
              : [location, "enum", 0],
        );
      },
    );
  });

  it("accepts flat object attributes without additional schema details", () => {
    expectAttributeSuccess({
      description: "Traits",
      type: "object",
    });
  });

  it("accepts flat object properties and typed arrays", () => {
    expectAttributeSuccess({
      description: "Account",
      type: "object",
      required: ["plan"],
      properties: {
        plan: {
          type: "string",
          enum: ["free", "pro"],
        },
        locale: {
          type: "string",
        },
        permissions: {
          type: "array",
          items: {
            type: "string",
            enum: ["read", "write", "admin"],
          },
        },
      },
    });
  });

  it("accepts array attributes without items when they stay flat", () => {
    expectAttributeSuccess({
      description: "Tags",
      type: "array",
    });
  });

  it("accepts string-array enums on array attributes", () => {
    expectAttributeSuccess({
      description: "Permissions",
      type: "array",
      items: {
        type: "string",
      },
      enum: [["read"], ["write", "admin"]],
    });
  });

  it("accepts top-level oneOf attributes without type", () => {
    expectAttributeSuccess({
      description: "Version number of the app",
      oneOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("accepts top-level oneOf attributes with branch-specific enums", () => {
    expectAttributeSuccess({
      description: "Plan or score",
      oneOf: [
        { type: "string", enum: ["free", "pro"] },
        { type: "number", minimum: 0 },
      ],
    });
  });

  it("requires items when array schema adds extra constraints", () => {
    expectAttributeFailure(
      {
        description: "Permissions",
        type: "array",
        enum: [["read"], ["write"]],
      },
      "`items` is required",
    );
  });

  it("rejects attributes without top-level type or oneOf", () => {
    expectAttributeFailure(
      {
        description: "Country",
      },
      "either `type` or `oneOf`",
    );
  });

  it("rejects attributes with both top-level type and oneOf", () => {
    expectAttributeFailure(
      {
        description: "Version number of the app",
        type: "string",
        oneOf: [{ type: "string" }, { type: "number" }],
      },
      "cannot have both `type` and `oneOf`",
    );
  });

  it("rejects top-level oneOf attributes when a branch enum does not match its type", () => {
    expectAttributeFailure(
      {
        description: "Plan or score",
        oneOf: [{ type: "string", enum: ["free", 1] }, { type: "number" }],
      },
      'does not match type "string"',
    );
  });

  it("rejects nested object properties inside object attributes", () => {
    expectAttributeFailure(
      {
        description: "Account",
        type: "object",
        properties: {
          metadata: {
            type: "object",
            properties: {
              locale: {
                type: "string",
              },
            },
          },
        },
      },
      "must stay flat",
    );
  });

  it("rejects object additionalProperties that allow nested objects", () => {
    expectAttributeFailure(
      {
        description: "Labels",
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            locale: {
              type: "string",
            },
          },
        },
      },
      "must stay flat",
    );
  });

  it("rejects object properties whose oneOf allows nested objects", () => {
    expectAttributeFailure(
      {
        description: "Account",
        type: "object",
        properties: {
          metadata: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  locale: {
                    type: "string",
                  },
                },
              },
            ],
          },
        },
      },
      "must stay flat",
    );
  });

  it("rejects object additionalProperties whose oneOf allows nested objects", () => {
    expectAttributeFailure(
      {
        description: "Labels",
        type: "object",
        additionalProperties: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                locale: {
                  type: "string",
                },
              },
            },
          ],
        },
      },
      "must stay flat",
    );
  });

  it("rejects non-string item types for array attributes", () => {
    expectAttributeFailure(
      {
        description: "Scores",
        type: "array",
        items: {
          type: "integer",
        },
      },
      "items.type",
    );
  });

  it("rejects non-string enum values for array attributes", () => {
    expectAttributeFailure(
      {
        description: "Scores",
        type: "array",
        enum: [[1, 2]],
      },
      "array of strings",
    );
  });

  it("rejects non-string const values for array attributes", () => {
    expectAttributeFailure(
      {
        description: "Scores",
        type: "array",
        items: {
          type: "string",
        },
        const: [1, 2],
      },
      "array of strings",
    );
  });

  it("rejects required keys that are not declared in properties", () => {
    expectAttributeFailure(
      {
        description: "Account",
        type: "object",
        required: ["plan", "tier"],
        properties: {
          plan: {
            type: "string",
          },
        },
      },
      "Unknown required field",
    );
  });

  it("rejects required keys on flat object attributes without declared properties", () => {
    // Without declared properties every key is optional, so nothing can be required.
    expectAttributeFailure(
      {
        description: "Traits",
        type: "object",
        required: ["plan"],
      },
      'Unknown required field "plan"',
    );
  });

  it("accepts object attributes without required keys", () => {
    expectAttributeSuccess({
      description: "Account",
      type: "object",
      properties: { locale: { type: "string" } },
    });
  });

  it("rejects enum values that do not match formatted string types", () => {
    expectAttributeFailure(
      {
        description: "Browser version",
        type: "string",
        format: "semver",
        enum: ["1.0.0", 2],
      },
      'does not match type "string"',
    );
    expectAttributeFailure(
      {
        description: "Browser version",
        type: "string",
        format: "semver",
        enum: ["1.0.0", "5.5,0"],
      },
      "is not a version the version operators can compare",
    );
  });

  it("rejects minimum values greater than maximum for numeric attributes", () => {
    expectAttributeFailure(
      {
        description: "Score",
        type: "number",
        minimum: 10,
        maximum: 5,
      },
      "minimum",
    );
  });

  it("rejects minLength values greater than maxLength for string attributes", () => {
    expectAttributeFailure(
      {
        description: "Country",
        type: "string",
        minLength: 5,
        maxLength: 2,
      },
      "minLength",
    );
  });

  it("rejects invalid string patterns nested under object properties", () => {
    expectAttributeFailure(
      {
        description: "Profile",
        type: "object",
        properties: {
          email: {
            type: "string",
            pattern: "[",
          },
        },
      },
      "valid ECMA-262",
    );
  });
});
