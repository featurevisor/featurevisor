import type { Schema, SchemaKey, Value } from "@featurevisor/types";
import { z } from "zod";

import { refineWithMessage } from "./zodHelpers";
import {
  formatValueMessage,
  refineRemovedSchemaType,
  schemaFormatZodSchema,
  schemaTypeZodSchema,
  SCHEMA_FORMATS,
  valueMatchesFormat,
} from "./schemaFormats";

export { schemaFormatZodSchema };

/** Lengths and item counts: whole numbers of zero or more. */
export const countZodSchema = z
  .number()
  .int({ error: "Must be a whole number of zero or more." })
  .min(0, { error: "Must be a whole number of zero or more." });

/** Returns true if value matches the schema type. */
function valueMatchesType(v: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}

type SchemaLike = {
  schema?: string;
  type?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  items?: unknown;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  oneOf?: unknown[];
};

/**
 * Recursively validates that when a schema has both `type` and `enum`, every enum value matches the type.
 * Also recurses into oneOf branches.
 */
export function refineEnumMatchesType(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const enumArr = schema.enum;
  if (type && Array.isArray(enumArr) && enumArr.length > 0) {
    for (let i = 0; i < enumArr.length; i++) {
      const v = enumArr[i];
      if (!valueMatchesType(v, type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${i} (${JSON.stringify(v)}) does not match type "${type}". All enum values must be of the same type as \`type\`.`,
          path: [...pathPrefix, "enum", i],
        });
      }
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineEnumMatchesType(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineEnumMatchesType(
        schema.properties[k] as SchemaLike,
        [...pathPrefix, "properties", k],
        ctx,
      );
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineEnumMatchesType(
      schema.additionalProperties as SchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineEnumMatchesType(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

/**
 * Validates that when a schema has type "integer" or "number", minimum <= maximum when both set,
 * and const/enum values (if present) fall within the range.
 */
export function refineMinimumMaximum(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const min = schema.minimum;
  const max = schema.maximum;
  const isNumeric = type === "integer" || type === "number";
  if (isNumeric && min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When \`type\` is "${type}", \`minimum\` (${min}) must be less than or equal to \`maximum\` (${max}).`,
      path: [...pathPrefix, "minimum"],
    });
  }
  if (isNumeric && min !== undefined && schema.const !== undefined) {
    const v = schema.const;
    if (typeof v === "number" && v < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value ${v} is less than \`minimum\` (${min}).`,
        path: [...pathPrefix, "const"],
      });
    }
  }
  if (isNumeric && max !== undefined && schema.const !== undefined) {
    const v = schema.const;
    if (typeof v === "number" && v > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value ${v} is greater than \`maximum\` (${max}).`,
        path: [...pathPrefix, "const"],
      });
    }
  }
  if (isNumeric && Array.isArray(schema.enum) && schema.enum.length > 0) {
    for (let i = 0; i < schema.enum.length; i++) {
      const v = schema.enum[i];
      if (typeof v === "number") {
        if (min !== undefined && v < min) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} (${v}) is less than \`minimum\` (${min}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
        if (max !== undefined && v > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} (${v}) is greater than \`maximum\` (${max}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
      }
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineMinimumMaximum(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineMinimumMaximum(
        schema.properties[k] as SchemaLike,
        [...pathPrefix, "properties", k],
        ctx,
      );
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineMinimumMaximum(
      schema.additionalProperties as SchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineMinimumMaximum(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

function invalidFormatPaths(
  schema: SchemaLike,
  value: unknown,
  path: (string | number)[],
  schemasByKey: Record<string, Schema>,
  seen = new Set<SchemaLike>(),
): (string | number)[][] {
  const resolved = resolveTimestampSchema(schema, schemasByKey);
  if (!resolved || seen.has(resolved)) return [];
  schema = resolved;
  const nextSeen = new Set(seen).add(schema);
  if (schema.type === "string" && schema.format !== undefined) {
    return typeof value === "string" && valueMatchesFormat(schema.format, value) ? [] : [path];
  }
  if (schema.oneOf) {
    const branches = (schema.oneOf as SchemaLike[])
      .map((branch) => resolveTimestampSchema(branch, schemasByKey))
      .filter((branch): branch is SchemaLike => branch !== null)
      .filter((branch) => !branch.type || valueMatchesType(value, branch.type));
    const results = branches.map((branch) =>
      invalidFormatPaths(branch, value, path, schemasByKey, nextSeen),
    );
    return results.length > 0 && results.every((result) => result.length > 0) ? [path] : [];
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    return value.flatMap((item, index) =>
      invalidFormatPaths(schema.items as SchemaLike, item, [...path, index], schemasByKey),
    );
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const child = schema.properties?.[key] || schema.additionalProperties;
      return child
        ? invalidFormatPaths(child as SchemaLike, item, [...path, key], schemasByKey)
        : [];
    });
  }
  return [];
}

function resolveTimestampSchema(
  schema: SchemaLike,
  schemasByKey: Record<string, Schema>,
): SchemaLike | null {
  const seen = new Set<SchemaLike>();
  while (schema.schema) {
    if (seen.has(schema)) return null;
    seen.add(schema);
    const referenced = schemasByKey[schema.schema];
    if (!referenced) return null;
    schema = referenced;
  }
  return schema;
}

/** The format a literal is checked against, following references and single format oneOf branches. */
function formatAt(schema: SchemaLike, schemasByKey: Record<string, Schema>): string | undefined {
  const resolved = resolveTimestampSchema(schema, schemasByKey);
  if (!resolved) return undefined;
  if (resolved.format) return resolved.format;
  const formats = (resolved.oneOf as SchemaLike[] | undefined)
    ?.map((branch) => formatAt(branch, schemasByKey))
    .filter((format): format is string => !!format);
  return formats?.length ? formats[0] : undefined;
}

/** Validate the format declaration and its literal values at this schema node. */
export function refineSchemaFormat(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
  schemasByKey: Record<string, Schema> = {},
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const isString = type === "string";
  if (schema.format !== undefined) {
    if (!(SCHEMA_FORMATS as readonly string[]).includes(schema.format)) return;
    if (!isString) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format is only supported on string schemas.",
        path: [...pathPrefix, "format"],
      });
    }
  }
  const checkFormat = (value: unknown, path: (string | number)[]) => {
    for (const invalidPath of invalidFormatPaths(schema, value, path, schemasByKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: formatValueMessage(formatAt(schema, schemasByKey)),
        path: invalidPath,
      });
    }
  };
  if (schema.const !== undefined) checkFormat(schema.const, [...pathPrefix, "const"]);
  schema.enum?.forEach((value, index) => checkFormat(value, [...pathPrefix, "enum", index]));
}

/** Validate string lengths, patterns and their literal values recursively. */
export function refineStringLengthPattern(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const minLen = schema.minLength;
  const maxLen = schema.maxLength;
  const patternStr = schema.pattern;
  const isString = schema.type === "string";
  if (isString && minLen !== undefined && maxLen !== undefined && minLen > maxLen) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When \`type\` is "string", \`minLength\` (${minLen}) must be less than or equal to \`maxLength\` (${maxLen}).`,
      path: [...pathPrefix, "minLength"],
    });
  }
  if (isString && patternStr !== undefined) {
    try {
      new RegExp(patternStr);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`pattern\` must be a valid ECMA-262 regular expression; "${patternStr}" is invalid.`,
        path: [...pathPrefix, "pattern"],
      });
    }
  }
  const testString = (s: string): { minOk: boolean; maxOk: boolean; patternOk: boolean } => {
    const minOk = minLen === undefined || s.length >= minLen;
    const maxOk = maxLen === undefined || s.length <= maxLen;
    let patternOk = true;
    if (patternStr !== undefined) {
      try {
        patternOk = new RegExp(patternStr).test(s);
      } catch {
        patternOk = true;
      }
    }
    return { minOk, maxOk, patternOk };
  };
  if (isString && schema.const !== undefined && typeof schema.const === "string") {
    const { minOk, maxOk, patternOk } = testString(schema.const);
    if (!minOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value length (${schema.const.length}) is less than \`minLength\` (${minLen}).`,
        path: [...pathPrefix, "const"],
      });
    }
    if (!maxOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value length (${schema.const.length}) is greater than \`maxLength\` (${maxLen}).`,
        path: [...pathPrefix, "const"],
      });
    }
    if (!patternOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value does not match \`pattern\`.`,
        path: [...pathPrefix, "const"],
      });
    }
  }
  if (isString && Array.isArray(schema.enum) && schema.enum.length > 0) {
    for (let i = 0; i < schema.enum.length; i++) {
      const v = schema.enum[i];
      if (typeof v === "string") {
        const { minOk, maxOk, patternOk } = testString(v);
        if (!minOk) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} length (${v.length}) is less than \`minLength\` (${minLen}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
        if (!maxOk) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} length (${v.length}) is greater than \`maxLength\` (${maxLen}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
        if (!patternOk) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} does not match \`pattern\`.`,
            path: [...pathPrefix, "enum", i],
          });
        }
      }
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineStringLengthPattern(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineStringLengthPattern(
        schema.properties[k] as SchemaLike,
        [...pathPrefix, "properties", k],
        ctx,
      );
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineStringLengthPattern(
      schema.additionalProperties as SchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineStringLengthPattern(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

/** Deep equality for primitive/array/object values (used for uniqueItems check). */
function valueDeepEqualForRefine(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => valueDeepEqualForRefine(v, b[i]));
    }
    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
    return keysA.every((k) =>
      valueDeepEqualForRefine((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * Validates that when a schema has type "array", minItems <= maxItems when both set,
 * and const/enum array values (if present) satisfy length and uniqueItems.
 */
export function refineArrayItems(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const minItems = schema.minItems;
  const maxItems = schema.maxItems;
  const uniqueItems = schema.uniqueItems;
  const isArray = type === "array";
  if (isArray && minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When \`type\` is "array", \`minItems\` (${minItems}) must be less than or equal to \`maxItems\` (${maxItems}).`,
      path: [...pathPrefix, "minItems"],
    });
  }
  const checkArray = (arr: unknown[], pathSuffix: (string | number)[]) => {
    if (minItems !== undefined && arr.length < minItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Array length (${arr.length}) is less than \`minItems\` (${minItems}).`,
        path: pathSuffix,
      });
    }
    if (maxItems !== undefined && arr.length > maxItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Array length (${arr.length}) is greater than \`maxItems\` (${maxItems}).`,
        path: pathSuffix,
      });
    }
    if (uniqueItems) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (valueDeepEqualForRefine(arr[i], arr[j])) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Array has duplicate items at indices ${i} and ${j} but \`uniqueItems\` is true.`,
              path: pathSuffix,
            });
            return;
          }
        }
      }
    }
  };
  if (isArray && Array.isArray(schema.const)) {
    checkArray(schema.const, [...pathPrefix, "const"]);
  }
  if (isArray && Array.isArray(schema.enum) && schema.enum.length > 0) {
    for (let i = 0; i < schema.enum.length; i++) {
      const v = schema.enum[i];
      if (Array.isArray(v)) checkArray(v, [...pathPrefix, "enum", i]);
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineArrayItems(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineArrayItems(schema.properties[k] as SchemaLike, [...pathPrefix, "properties", k], ctx);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    refineArrayItems(
      schema.additionalProperties as SchemaLike,
      [...pathPrefix, "additionalProperties"],
      ctx,
    );
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineArrayItems(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

// Recursive schema for Value: boolean | string | number | ObjectValue | Value[]
export const valueZodSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.string(),
    z.number(),
    // | Date // @TODO: support in future
    z.record(z.string(), valueZodSchema),
    z.array(valueZodSchema),
  ]),
);

export const propertyTypeEnum = schemaTypeZodSchema();

export function getSchemaZodSchema(
  schemaKeys: SchemaKey[] = [],
  schemasByKey: Record<string, Schema> = {},
) {
  const schemaZodSchema: z.ZodType<Schema> = z.lazy(() =>
    z
      .object({
        description: z.string().optional(),
        promotable: z.boolean().optional(),
        type: propertyTypeEnum.optional(),
        enum: z.array(valueZodSchema).optional(),
        const: valueZodSchema.optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        minLength: countZodSchema.optional(),
        maxLength: countZodSchema.optional(),
        pattern: z.string().optional(),
        format: schemaFormatZodSchema.optional(),
        items: schemaZodSchema.optional(),
        minItems: countZodSchema.optional(),
        maxItems: countZodSchema.optional(),
        uniqueItems: z.boolean().optional(),
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), schemaZodSchema).optional(),
        additionalProperties: schemaZodSchema.optional(),
        // Annotations: default?: Value; examples?: Value[];

        schema: refineWithMessage(
          z.string(),
          (value) => schemaKeys.includes(value),
          (value) => `Unknown schema "${value}"`,
        ).optional(),
        oneOf: z.array(schemaZodSchema).min(2).optional(),
      })
      .strict()
      .superRefine((data, ctx) => refineRemovedSchemaType(data, ctx))
      .superRefine((data, ctx) => {
        if (data.type === "array" && data.items === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'When `type` is "array", `items` is required. Define the schema for array elements.',
            path: ["items"],
          });
        }
      })
      .superRefine((data, ctx) => refineEnumMatchesType(data, [], ctx))
      .superRefine((data, ctx) => refineMinimumMaximum(data, [], ctx))
      .superRefine((data, ctx) => refineStringLengthPattern(data, [], ctx))
      .superRefine((data, ctx) => refineSchemaFormat(data, [], ctx, schemasByKey))
      .superRefine((data, ctx) => refineArrayItems(data, [], ctx)),
  );

  return schemaZodSchema;
}
