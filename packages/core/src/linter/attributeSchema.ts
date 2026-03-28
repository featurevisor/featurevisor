import type { Attribute, AttributeProperty } from "@featurevisor/types";
import { z } from "zod";

import { valueZodSchema, refineArrayItems, refineMinimumMaximum } from "./schema";

const attributeTypeEnum = z.enum([
  "boolean",
  "string",
  "integer",
  "double",
  "date",
  "semver",
  "object",
  "array",
]);

type AttributeSchemaLike = {
  type?: Attribute["type"];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: unknown;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  required?: string[];
  oneOf?: unknown[];
};

function isArrayOfStrings(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringLikeAttributeType(type?: Attribute["type"]): boolean {
  return type === "string" || type === "date" || type === "semver";
}

function valueMatchesAttributeType(value: unknown, type: Attribute["type"]): boolean {
  if (type === "date" || type === "semver") {
    return typeof value === "string";
  }

  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "double":
      return typeof value === "number";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return isArrayOfStrings(value);
    default:
      return true;
  }
}

function refineAttributeEnumMatchesType(
  schema: AttributeSchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  if (schema.type && Array.isArray(schema.enum) && schema.enum.length > 0) {
    for (let i = 0; i < schema.enum.length; i++) {
      const value = schema.enum[i];
      if (!valueMatchesAttributeType(value, schema.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${i} (${JSON.stringify(value)}) does not match type "${schema.type}". All enum values must be of the same type as \`type\`.`,
          path: [...pathPrefix, "enum", i],
        });
      }
    }
  }

  if (schema.items && typeof schema.items === "object") {
    refineAttributeEnumMatchesType(
      schema.items as AttributeSchemaLike,
      [...pathPrefix, "items"],
      ctx,
    );
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      refineAttributeEnumMatchesType(
        schema.properties[key] as AttributeSchemaLike,
        [...pathPrefix, "properties", key],
        ctx,
      );
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineAttributeEnumMatchesType(
      schema.additionalProperties as AttributeSchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, index) => {
      if (branch && typeof branch === "object") {
        refineAttributeEnumMatchesType(
          branch as AttributeSchemaLike,
          [...pathPrefix, "oneOf", index],
          ctx,
        );
      }
    });
  }
}

function refineAttributeStringLengthPattern(
  schema: AttributeSchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  const minLength = schema.minLength;
  const maxLength = schema.maxLength;
  const pattern = schema.pattern;
  const isString = isStringLikeAttributeType(schema.type);

  if (isString && minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When \`type\` is "${schema.type}", \`minLength\` (${minLength}) must be less than or equal to \`maxLength\` (${maxLength}).`,
      path: [...pathPrefix, "minLength"],
    });
  }

  if (isString && pattern !== undefined) {
    try {
      new RegExp(pattern);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`pattern\` must be a valid ECMA-262 regular expression; "${pattern}" is invalid.`,
        path: [...pathPrefix, "pattern"],
      });
    }
  }

  const testString = (value: string) => {
    const minOk = minLength === undefined || value.length >= minLength;
    const maxOk = maxLength === undefined || value.length <= maxLength;
    let patternOk = true;

    if (pattern !== undefined) {
      try {
        patternOk = new RegExp(pattern).test(value);
      } catch {
        patternOk = true;
      }
    }

    return { minOk, maxOk, patternOk };
  };

  if (isString && typeof schema.const === "string") {
    const result = testString(schema.const);
    if (!result.minOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value length (${schema.const.length}) is less than \`minLength\` (${minLength}).`,
        path: [...pathPrefix, "const"],
      });
    }
    if (!result.maxOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value length (${schema.const.length}) is greater than \`maxLength\` (${maxLength}).`,
        path: [...pathPrefix, "const"],
      });
    }
    if (!result.patternOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value does not match \`pattern\`.`,
        path: [...pathPrefix, "const"],
      });
    }
  }

  if (isString && Array.isArray(schema.enum)) {
    schema.enum.forEach((value, index) => {
      if (typeof value !== "string") return;
      const result = testString(value);
      if (!result.minOk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${index} length (${value.length}) is less than \`minLength\` (${minLength}).`,
          path: [...pathPrefix, "enum", index],
        });
      }
      if (!result.maxOk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${index} length (${value.length}) is greater than \`maxLength\` (${maxLength}).`,
          path: [...pathPrefix, "enum", index],
        });
      }
      if (!result.patternOk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${index} does not match \`pattern\`.`,
          path: [...pathPrefix, "enum", index],
        });
      }
    });
  }

  if (schema.items && typeof schema.items === "object") {
    refineAttributeStringLengthPattern(
      schema.items as AttributeSchemaLike,
      [...pathPrefix, "items"],
      ctx,
    );
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      refineAttributeStringLengthPattern(
        schema.properties[key] as AttributeSchemaLike,
        [...pathPrefix, "properties", key],
        ctx,
      );
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineAttributeStringLengthPattern(
      schema.additionalProperties as AttributeSchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, index) => {
      if (branch && typeof branch === "object") {
        refineAttributeStringLengthPattern(
          branch as AttributeSchemaLike,
          [...pathPrefix, "oneOf", index],
          ctx,
        );
      }
    });
  }
}

function refineRequiredKeysInAttributeSchema(
  schema: AttributeSchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  if (
    schema.type === "object" &&
    Array.isArray(schema.required) &&
    schema.properties &&
    typeof schema.properties === "object"
  ) {
    const allowedKeys = Object.keys(schema.properties);
    schema.required.forEach((key, index) => {
      if (!allowedKeys.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown required field "${key}". \`required\` must only contain property names defined in \`properties\`. Allowed: ${allowedKeys.length ? allowedKeys.join(", ") : "(none)"}.`,
          path: [...pathPrefix, "required", index],
        });
      }
    });
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      refineRequiredKeysInAttributeSchema(
        schema.properties[key] as AttributeSchemaLike,
        [...pathPrefix, "properties", key],
        ctx,
      );
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineRequiredKeysInAttributeSchema(
      schema.additionalProperties as AttributeSchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }

  if (schema.items && typeof schema.items === "object") {
    refineRequiredKeysInAttributeSchema(
      schema.items as AttributeSchemaLike,
      [...pathPrefix, "items"],
      ctx,
    );
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, index) => {
      if (branch && typeof branch === "object") {
        refineRequiredKeysInAttributeSchema(
          branch as AttributeSchemaLike,
          [...pathPrefix, "oneOf", index],
          ctx,
        );
      }
    });
  }
}

function refineNoNestedObjectProperties(
  schema: AttributeSchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      const property = schema.properties[key] as AttributeSchemaLike;
      if (property?.type === "object") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Object attributes must stay flat. Property "${key}" cannot be of type "object".`,
          path: [...pathPrefix, "properties", key, "type"],
        });
      }
    }
  }

  if (schema.items && typeof schema.items === "object") {
    refineNoNestedObjectProperties(
      schema.items as AttributeSchemaLike,
      [...pathPrefix, "items"],
      ctx,
    );
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      refineNoNestedObjectProperties(
        schema.properties[key] as AttributeSchemaLike,
        [...pathPrefix, "properties", key],
        ctx,
      );
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineNoNestedObjectProperties(
      schema.additionalProperties as AttributeSchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, index) => {
      if (branch && typeof branch === "object") {
        refineNoNestedObjectProperties(
          branch as AttributeSchemaLike,
          [...pathPrefix, "oneOf", index],
          ctx,
        );
      }
    });
  }
}

function refineArrayAttributesAreStringArrays(
  schema: AttributeSchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  if (schema.type === "array") {
    if (schema.items && typeof schema.items === "object") {
      const itemSchema = schema.items as AttributeSchemaLike;
      if (itemSchema.type !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Attribute arrays must contain strings only. \`items.type\` must be "string".`,
          path: [...pathPrefix, "items", "type"],
        });
      }
    }

    if (schema.const !== undefined && !isArrayOfStrings(schema.const)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Attribute arrays must contain strings only. \`const\` must be an array of strings.`,
        path: [...pathPrefix, "const"],
      });
    }

    if (Array.isArray(schema.enum)) {
      schema.enum.forEach((entry, index) => {
        if (!isArrayOfStrings(entry)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Attribute arrays must contain strings only. Enum value at index ${index} must be an array of strings.`,
            path: [...pathPrefix, "enum", index],
          });
        }
      });
    }
  }

  if (schema.items && typeof schema.items === "object") {
    refineArrayAttributesAreStringArrays(
      schema.items as AttributeSchemaLike,
      [...pathPrefix, "items"],
      ctx,
    );
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const key of Object.keys(schema.properties)) {
      refineArrayAttributesAreStringArrays(
        schema.properties[key] as AttributeSchemaLike,
        [...pathPrefix, "properties", key],
        ctx,
      );
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineArrayAttributesAreStringArrays(
      schema.additionalProperties as AttributeSchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, index) => {
      if (branch && typeof branch === "object") {
        refineArrayAttributesAreStringArrays(
          branch as AttributeSchemaLike,
          [...pathPrefix, "oneOf", index],
          ctx,
        );
      }
    });
  }
}

export function getAttributeZodSchema() {
  const attributePropertySchema: z.ZodType<AttributeProperty> = z.lazy(() =>
    z
      .object({
        description: z.string().optional(),
        type: attributeTypeEnum.optional(),
        enum: z.array(valueZodSchema).optional(),
        const: valueZodSchema.optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        pattern: z.string().optional(),
        items: attributePropertySchema.optional(),
        minItems: z.number().optional(),
        maxItems: z.number().optional(),
        uniqueItems: z.boolean().optional(),
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), attributePropertySchema).optional(),
        additionalProperties: attributePropertySchema.optional(),
        schema: z.string().optional(),
        oneOf: z.array(attributePropertySchema).min(2).optional(),
      })
      .strict()
      .superRefine((data, ctx) => {
        const hasStructuredArrayDetails =
          data.items !== undefined ||
          data.minItems !== undefined ||
          data.maxItems !== undefined ||
          data.uniqueItems !== undefined ||
          data.oneOf !== undefined ||
          data.enum !== undefined ||
          data.const !== undefined;

        if (data.type === "array" && hasStructuredArrayDetails && data.items === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'When `type` is "array" and additional schema properties are provided, `items` is required.',
            path: ["items"],
          });
        }
      })
      .superRefine((data, ctx) => refineAttributeEnumMatchesType(data, [], ctx))
      .superRefine((data, ctx) =>
        refineMinimumMaximum(data as Parameters<typeof refineMinimumMaximum>[0], [], ctx),
      )
      .superRefine((data, ctx) => refineAttributeStringLengthPattern(data, [], ctx))
      .superRefine((data, ctx) =>
        refineArrayItems(data as Parameters<typeof refineArrayItems>[0], [], ctx),
      )
      .superRefine((data, ctx) => refineRequiredKeysInAttributeSchema(data, [], ctx))
      .superRefine((data, ctx) => refineNoNestedObjectProperties(data, [], ctx))
      .superRefine((data, ctx) => refineArrayAttributesAreStringArrays(data, [], ctx)),
  );

  const attributeZodSchema = z
    .object({
      archived: z.boolean().optional(),
      type: attributeTypeEnum,
      description: z.string(),
      enum: z.array(valueZodSchema).optional(),
      const: valueZodSchema.optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
      items: attributePropertySchema.optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      uniqueItems: z.boolean().optional(),
      required: z.array(z.string()).optional(),
      properties: z.record(z.string(), attributePropertySchema).optional(),
      additionalProperties: attributePropertySchema.optional(),
      oneOf: z.array(attributePropertySchema).min(2).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasStructuredArrayDetails =
        data.items !== undefined ||
        data.minItems !== undefined ||
        data.maxItems !== undefined ||
        data.uniqueItems !== undefined ||
        data.oneOf !== undefined ||
        data.enum !== undefined ||
        data.const !== undefined;

      if (data.type === "array" && hasStructuredArrayDetails && data.items === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'When `type` is "array" and additional schema properties are provided, `items` is required.',
          path: ["items"],
        });
      }
    })
    .superRefine((data, ctx) => refineAttributeEnumMatchesType(data, [], ctx))
    .superRefine((data, ctx) =>
      refineMinimumMaximum(data as Parameters<typeof refineMinimumMaximum>[0], [], ctx),
    )
    .superRefine((data, ctx) => refineAttributeStringLengthPattern(data, [], ctx))
    .superRefine((data, ctx) =>
      refineArrayItems(data as Parameters<typeof refineArrayItems>[0], [], ctx),
    )
    .superRefine((data, ctx) => refineRequiredKeysInAttributeSchema(data, [], ctx))
    .superRefine((data, ctx) => refineNoNestedObjectProperties(data, [], ctx))
    .superRefine((data, ctx) => refineArrayAttributesAreStringArrays(data, [], ctx));

  return attributeZodSchema;
}
