import { z } from "zod";

import { getAttributeZodSchema } from "./attributeSchema";

function parseAttribute(input: unknown): z.SafeParseReturnType<unknown, unknown> {
  return getAttributeZodSchema().safeParse(input);
}

function expectAttributeSuccess(input: unknown): void {
  const result = parseAttribute(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const error = (result as z.SafeParseError<unknown>).error;
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

  const error = (result as z.SafeParseError<unknown>).error;

  if (messageSubstring) {
    const messages = error.issues.map((issue) => issue.message).join(" ");
    expect(messages).toContain(messageSubstring);
  }

  return error;
}

describe("attributeSchema.ts :: getAttributeZodSchema", () => {
  it("accepts flat object attributes without additional schema details", () => {
    expectAttributeSuccess({
      description: "Traits",
      type: "object",
    });
  });

  it("accepts typed object and array schemas with nested properties", () => {
    expectAttributeSuccess({
      description: "Account",
      type: "object",
      required: ["plan"],
      properties: {
        plan: {
          type: "string",
          enum: ["free", "pro"],
        },
        metadata: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
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

  it("rejects enum values that do not match semver/date string-like types", () => {
    expectAttributeFailure(
      {
        description: "Browser version",
        type: "semver",
        enum: ["1.0.0", 2],
      },
      'does not match type "semver"',
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
