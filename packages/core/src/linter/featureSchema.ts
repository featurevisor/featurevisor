import type { Schema, SchemaType } from "@featurevisor/types";
import { z } from "zod";

import { ProjectConfig } from "../config";
import {
  isMutationKey,
  validateMutationKey,
  parsePathMapKey,
  resolveSchemaAtPath,
} from "./mutationNotation";
import {
  valueZodSchema,
  propertyTypeEnum,
  getSchemaZodSchema,
  refineEnumMatchesType,
  refineMinimumMaximum,
  refineStringLengthPattern,
  refineArrayItems,
} from "./schema";

const tagRegex = /^[a-z0-9-]+$/;

function isArrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isFlatObjectValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function getVariableLabel(variableSchema, variableKey, path) {
  return (
    variableKey ??
    variableSchema?.key ??
    (path.length > 0 ? String(path[path.length - 1]) : "variable")
  );
}

/**
 * Resolve variable schema to the Schema used for value validation.
 * When variable has `schema` (reference), returns the parsed Schema from schemasByKey; otherwise returns the inline variable schema.
 */
function resolveVariableSchema(
  variableSchema: {
    schema?: string;
    type?: string;
    items?: unknown;
    properties?: unknown;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    oneOf?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  },
  schemasByKey?: Record<string, Schema>,
): {
  type?: string;
  items?: unknown;
  properties?: unknown;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
} | null {
  if (variableSchema.schema) {
    return schemasByKey?.[variableSchema.schema] ?? null;
  }
  return variableSchema as {
    type?: string;
    items?: unknown;
    properties?: unknown;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    oneOf?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  };
}

/** Resolve a schema by following schema references (schema: key). Used for nested schemas that may have oneOf. */
function resolveSchemaRefs(
  schema: { schema?: string; [k: string]: unknown },
  schemasByKey?: Record<string, Schema>,
): { [k: string]: unknown } {
  if (schema.schema && schemasByKey?.[schema.schema]) {
    return resolveSchemaRefs(
      schemasByKey[schema.schema] as { schema?: string; [k: string]: unknown },
      schemasByKey,
    );
  }
  return schema;
}

/**
 * Returns true if the value matches the given schema (const, enum, type, object properties, array items, or exactly one of oneOf).
 * Used for oneOf validation: value must match exactly one branch.
 */
function valueMatchesSchema(
  schema: { [k: string]: unknown },
  value: unknown,
  schemasByKey?: Record<string, Schema>,
): boolean {
  const resolved = resolveSchemaRefs(schema, schemasByKey) as {
    type?: string;
    const?: unknown;
    enum?: unknown[];
    oneOf?: unknown[];
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  };

  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const matchCount = resolved.oneOf.filter((branch) =>
      valueMatchesSchema(branch as { [k: string]: unknown }, value, schemasByKey),
    ).length;
    return matchCount === 1;
  }

  if (resolved.const !== undefined) {
    return valueDeepEqual(value, resolved.const);
  }

  if (resolved.enum !== undefined && Array.isArray(resolved.enum)) {
    return resolved.enum.some((e) => valueDeepEqual(value, e));
  }

  const type = resolved.type;
  if (!type) return false;

  if (type === "string") {
    if (typeof value !== "string") return false;
    const s = value as string;
    if (resolved.minLength !== undefined && s.length < resolved.minLength) return false;
    if (resolved.maxLength !== undefined && s.length > resolved.maxLength) return false;
    if (resolved.pattern !== undefined) {
      try {
        if (!new RegExp(resolved.pattern).test(s)) return false;
      } catch {
        return true;
      }
    }
    return true;
  }
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return false;
    if (resolved.minimum !== undefined && (value as number) < resolved.minimum) return false;
    if (resolved.maximum !== undefined && (value as number) > resolved.maximum) return false;
    return true;
  }
  if (type === "double") {
    if (typeof value !== "number") return false;
    if (resolved.minimum !== undefined && (value as number) < resolved.minimum) return false;
    if (resolved.maximum !== undefined && (value as number) > resolved.maximum) return false;
    return true;
  }
  if (type === "json") return typeof value === "string";

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const props = resolved.properties;
    if (!props || typeof props !== "object") return true;
    const obj = value as Record<string, unknown>;
    const required = new Set(resolved.required || []);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) return false;
      if (!valueMatchesSchema(props[key] as { [k: string]: unknown }, obj[key], schemasByKey))
        return false;
    }
    for (const key of Object.keys(obj)) {
      const propSchema = props[key];
      if (!propSchema) return false;
      if (!valueMatchesSchema(propSchema as { [k: string]: unknown }, obj[key], schemasByKey))
        return false;
    }
    return true;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return false;
    const arr = value as unknown[];
    if (resolved.minItems !== undefined && arr.length < resolved.minItems) return false;
    if (resolved.maxItems !== undefined && arr.length > resolved.maxItems) return false;
    if (resolved.uniqueItems) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (valueDeepEqual(arr[i], arr[j])) return false;
        }
      }
    }
    const itemSchema = resolved.items;
    if (!itemSchema || typeof itemSchema !== "object")
      return arr.every((v) => typeof v === "string");
    return arr.every((item) =>
      valueMatchesSchema(itemSchema as { [k: string]: unknown }, item, schemasByKey),
    );
  }

  return false;
}

/** Deep equality for variable values (primitives, plain objects, arrays). */
function valueDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => valueDeepEqual(v, b[i]));
    }
    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
    return keysA.every((k) =>
      valueDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * Recursively validates that every `required` array (at this level and in nested
 * object/array schemas) only contains keys that exist in the same level's `properties`.
 * Adds Zod issues with the correct path for invalid required field names.
 */
function refineRequiredKeysInSchema(
  schema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
  },
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  const effectiveType = schema.type;
  const properties = schema.properties;
  const required = schema.required;
  const items = schema.items;

  if (
    effectiveType === "object" &&
    Array.isArray(required) &&
    required.length > 0 &&
    properties &&
    typeof properties === "object"
  ) {
    const allowedKeys = Object.keys(properties);
    required.forEach((key, index) => {
      if (!allowedKeys.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown required field "${key}". \`required\` must only contain property names defined in \`properties\`. Allowed: ${allowedKeys.length ? allowedKeys.join(", ") : "(none)"}.`,
          path: [...pathPrefix, "required", index],
        });
      }
    });
  }

  if (properties && typeof properties === "object") {
    for (const key of Object.keys(properties)) {
      const nested = properties[key];
      if (nested && typeof nested === "object") {
        refineRequiredKeysInSchema(
          nested as Parameters<typeof refineRequiredKeysInSchema>[0],
          [...pathPrefix, "properties", key],
          ctx,
        );
      }
    }
  }

  if (items && typeof items === "object" && !Array.isArray(items)) {
    refineRequiredKeysInSchema(
      items as Parameters<typeof refineRequiredKeysInSchema>[0],
      [...pathPrefix, "items"],
      ctx,
    );
  }

  const oneOf = (schema as { oneOf?: unknown[] }).oneOf;
  if (oneOf && Array.isArray(oneOf)) {
    oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineRequiredKeysInSchema(
          branch as Parameters<typeof refineRequiredKeysInSchema>[0],
          [...pathPrefix, "oneOf", i],
          ctx,
        );
      }
    });
  }
}

function typeOfValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validates a variable value against an array schema. Recursively validates each item
 * when the schema defines `items` (nested arrays/objects use the same refinement).
 * Enforces minItems, maxItems, and uniqueItems when set.
 */
function refineVariableValueArray(
  projectConfig: ProjectConfig,
  variableSchema: {
    items?: unknown;
    type: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  },
  variableValue: unknown[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
  schemasByKey?: Record<string, Schema>,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);
  const minItems = variableSchema.minItems;
  const maxItems = variableSchema.maxItems;
  const uniqueItems = variableSchema.uniqueItems;
  if (minItems !== undefined && variableValue.length < minItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Variable "${label}" (type array) length (${variableValue.length}) is less than \`minItems\` (${minItems}).`,
      path,
    });
  }
  if (maxItems !== undefined && variableValue.length > maxItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Variable "${label}" (type array) length (${variableValue.length}) is greater than \`maxItems\` (${maxItems}).`,
      path,
    });
  }
  if (uniqueItems) {
    for (let i = 0; i < variableValue.length; i++) {
      for (let j = i + 1; j < variableValue.length; j++) {
        if (valueDeepEqual(variableValue[i], variableValue[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable "${label}" (type array) has duplicate items at indices ${i} and ${j} but \`uniqueItems\` is true.`,
            path,
          });
          break;
        }
      }
    }
  }
  const itemSchema = variableSchema.items;

  if (itemSchema) {
    variableValue.forEach((item, index) => {
      superRefineVariableValue(
        projectConfig,
        itemSchema,
        item,
        [...path, index],
        ctx,
        variableKey,
        schemasByKey,
      );
    });
  } else {
    if (!isArrayOfStrings(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type array): when \`items\` is not set, array must contain only strings; found non-string element.`,
        path,
      });
    }
  }

  if (projectConfig.maxVariableArrayStringifiedLength) {
    const stringified = JSON.stringify(variableValue);
    if (stringified.length > projectConfig.maxVariableArrayStringifiedLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" array is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableArrayStringifiedLength}`,
        path,
      });
    }
  }
}

/**
 * Validates a variable value against an object schema. Recursively validates each property
 * when the schema defines `properties` (nested objects/arrays use the same refinement).
 */
function refineVariableValueObject(
  projectConfig: ProjectConfig,
  variableSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
    type: string;
  },
  variableValue: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
  schemasByKey?: Record<string, Schema>,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);
  const schemaProperties = variableSchema.properties;

  if (schemaProperties && typeof schemaProperties === "object") {
    const requiredKeys =
      variableSchema.required && variableSchema.required.length > 0
        ? variableSchema.required.filter((k) =>
            Object.prototype.hasOwnProperty.call(schemaProperties, k),
          )
        : Object.keys(schemaProperties);

    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(variableValue, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required property "${key}" in variable "${label}"`,
          path: [...path, key],
        });
      }
    }

    for (const key of Object.keys(variableValue)) {
      const propSchema = schemaProperties[key];
      if (!propSchema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown property "${key}" in variable "${label}" (not in schema)`,
          path: [...path, key],
        });
      } else {
        superRefineVariableValue(
          projectConfig,
          propSchema,
          variableValue[key],
          [...path, key],
          ctx,
          key,
          schemasByKey,
        );
      }
    }
  } else {
    for (const key of Object.keys(variableValue)) {
      const propValue = variableValue[key];
      if (!isFlatObjectValue(propValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variable "${label}" is a flat object (no \`properties\` in schema); property "${key}" must be a primitive (string, number, boolean, or null), got: ${typeof propValue}`,
          path: [...path, key],
        });
      }
    }
  }

  if (projectConfig.maxVariableObjectStringifiedLength) {
    const stringified = JSON.stringify(variableValue);
    if (stringified.length > projectConfig.maxVariableObjectStringifiedLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" object is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableObjectStringifiedLength}`,
        path,
      });
    }
  }
}

/** Schema or variable schema (e.g. type "json", defaultValue); used for value validation. */
type VariableSchemaLike = (Omit<Schema, "type"> & { type?: SchemaType | "json" }) | null | undefined;

function superRefineVariableValue(
  projectConfig: ProjectConfig,
  variableSchema: VariableSchemaLike,
  variableValue: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
  schemasByKey?: Record<string, Schema>,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);

  if (!variableSchema) {
    const variableName =
      path.length > 0 && typeof path[path.length - 1] === "string"
        ? String(path[path.length - 1])
        : "variable";
    const message = `Variable "${variableName}" is used but not defined in variablesSchema. Define it under variablesSchema first, then use it here.`;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path,
    });

    return;
  }

  const effectiveSchema = resolveVariableSchema(variableSchema, schemasByKey);
  if (variableSchema.schema && effectiveSchema === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Schema "${variableSchema.schema}" could not be loaded for value validation.`,
      path,
    });
    return;
  }

  if (!effectiveSchema) {
    return;
  }

  const effectiveOneOf = (effectiveSchema as { oneOf?: unknown[] }).oneOf;
  if (effectiveOneOf !== undefined && Array.isArray(effectiveOneOf) && effectiveOneOf.length > 0) {
    const matchCount = effectiveOneOf.filter((branch) =>
      valueMatchesSchema(branch as { [k: string]: unknown }, variableValue, schemasByKey),
    ).length;
    if (matchCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" must match exactly one of the \`oneOf\` schemas (got ${JSON.stringify(variableValue)}; matched none).`,
        path,
      });
    } else if (matchCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" must match exactly one of the \`oneOf\` schemas (matched ${matchCount}).`,
        path,
      });
    }
    return;
  }

  const effectiveConst = (effectiveSchema as { const?: unknown }).const;
  if (effectiveConst !== undefined) {
    if (!valueDeepEqual(variableValue, effectiveConst)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" must equal the constant value defined in schema (got ${JSON.stringify(variableValue)}).`,
        path,
      });
    }
    return;
  }

  const effectiveEnum = (effectiveSchema as { enum?: unknown[] }).enum;
  if (effectiveEnum !== undefined && Array.isArray(effectiveEnum) && effectiveEnum.length > 0) {
    const allowed = effectiveEnum.some((v) => valueDeepEqual(variableValue, v));
    if (!allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" must be one of the allowed enum values (got ${JSON.stringify(variableValue)}).`,
        path,
      });
    }
    return;
  }

  // Require a value (no undefined) for every variable usage
  if (variableValue === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Variable "${label}" value is required (got undefined).`,
      path,
    });
    return;
  }

  const expectedType = effectiveSchema.type;
  const gotType = typeOfValue(variableValue);

  // string — only string allowed; schema minLength/maxLength/pattern applied when set
  if (expectedType === "string") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type string) must be a string; got ${gotType}.`,
        path,
      });
      return;
    }

    const strMinLen = (effectiveSchema as { minLength?: number }).minLength;
    const strMaxLen = (effectiveSchema as { maxLength?: number }).maxLength;
    const strPattern = (effectiveSchema as { pattern?: string }).pattern;
    if (strMinLen !== undefined && variableValue.length < strMinLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type string) length (${variableValue.length}) is less than \`minLength\` (${strMinLen}).`,
        path,
      });
    }
    if (strMaxLen !== undefined && variableValue.length > strMaxLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type string) length (${variableValue.length}) is greater than \`maxLength\` (${strMaxLen}).`,
        path,
      });
    }
    if (strPattern !== undefined) {
      try {
        if (!new RegExp(strPattern).test(variableValue)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable "${label}" (type string) does not match \`pattern\`.`,
            path,
          });
        }
      } catch {
        // invalid regex already reported at schema parse time
      }
    }

    if (
      projectConfig.maxVariableStringLength &&
      variableValue.length > projectConfig.maxVariableStringLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" value is too long (${variableValue.length} characters), max length is ${projectConfig.maxVariableStringLength}`,
        path,
      });
    }

    return;
  }

  // integer — only integer number allowed (no NaN, no Infinity, no float)
  if (expectedType === "integer") {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be a number; got ${gotType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be a finite number; got ${variableValue}.`,
        path,
      });
      return;
    }
    if (!Number.isInteger(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be an integer; got ${variableValue}.`,
        path,
      });
      return;
    }
    const intMin = (effectiveSchema as { minimum?: number }).minimum;
    const intMax = (effectiveSchema as { maximum?: number }).maximum;
    if (intMin !== undefined && variableValue < intMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be >= minimum (${intMin}); got ${variableValue}.`,
        path,
      });
    }
    if (intMax !== undefined && variableValue > intMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be <= maximum (${intMax}); got ${variableValue}.`,
        path,
      });
    }
    return;
  }

  // double — only finite number allowed
  if (expectedType === "double") {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be a number; got ${gotType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be a finite number; got ${variableValue}.`,
        path,
      });
      return;
    }
    const doubleMin = (effectiveSchema as { minimum?: number }).minimum;
    const doubleMax = (effectiveSchema as { maximum?: number }).maximum;
    if (doubleMin !== undefined && variableValue < doubleMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be >= minimum (${doubleMin}); got ${variableValue}.`,
        path,
      });
    }
    if (doubleMax !== undefined && variableValue > doubleMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be <= maximum (${doubleMax}); got ${variableValue}.`,
        path,
      });
    }
    return;
  }

  // boolean — only boolean allowed
  if (expectedType === "boolean") {
    if (typeof variableValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type boolean) must be a boolean; got ${gotType}.`,
        path,
      });
    }
    return;
  }

  // array — only array allowed; without items schema = array of strings
  if (expectedType === "array") {
    if (!Array.isArray(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type array) must be an array; got ${gotType}.`,
        path,
      });
      return;
    }
    refineVariableValueArray(
      projectConfig,
      effectiveSchema as {
        items?: unknown;
        type: string;
        minItems?: number;
        maxItems?: number;
        uniqueItems?: boolean;
      },
      variableValue,
      path,
      ctx,
      variableKey,
      schemasByKey,
    );
    return;
  }

  // object — only plain object allowed (no null, no array)
  if (expectedType === "object") {
    if (
      typeof variableValue !== "object" ||
      variableValue === null ||
      Array.isArray(variableValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type object) must be a plain object; got ${gotType}.`,
        path,
      });
      return;
    }
    refineVariableValueObject(
      projectConfig,
      effectiveSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
        type: string;
      },
      variableValue as Record<string, unknown>,
      path,
      ctx,
      variableKey,
      schemasByKey,
    );
    return;
  }

  // json — only string containing valid JSON allowed
  if (expectedType === "json") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type json) must be a string (JSON string); got ${gotType}.`,
        path,
      });
      return;
    }
    try {
      JSON.parse(variableValue);

      if (projectConfig.maxVariableJSONStringifiedLength) {
        if (variableValue.length > projectConfig.maxVariableJSONStringifiedLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable "${label}" JSON is too long (${variableValue.length} characters), max length is ${projectConfig.maxVariableJSONStringifiedLength}`,
            path,
          });
        }
      }
      // eslint-disable-next-line
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type json) must be a valid JSON string; parse failed.`,
        path,
      });
    }

    return;
  }

  // Unknown variable type — schema is invalid or unsupported
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Variable "${label}" has unknown or unsupported type "${String(expectedType)}" in variablesSchema.`,
    path,
  });
}

/**
 * Validate a single variable entry (key + value) in variables map.
 * Key may be a root variable name or mutation notation (e.g. "config.width", "items[0].name").
 */
function refineVariableEntry(
  projectConfig: ProjectConfig,
  variableSchemaByKey: Record<string, unknown>,
  variableKey: string,
  variableValue: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  schemasByKey?: Record<string, Schema>,
): void {
  if (isMutationKey(variableKey)) {
    const validation = validateMutationKey(
      variableKey,
      variableSchemaByKey as Record<string, Schema>,
      schemasByKey,
    );
    if (!validation.valid && validation.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: validation.error,
        path,
      });
      return;
    }
    if (validation.valueSchema) {
      superRefineVariableValue(
        projectConfig,
        validation.valueSchema,
        variableValue,
        path,
        ctx,
        variableKey,
        schemasByKey,
      );
    }
    return;
  }
  const variableSchema = variableSchemaByKey[variableKey];
  if (!variableSchema) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Variable "${variableKey}" is not defined in \`variablesSchema\`.`,
      path,
    });
    return;
  }
  superRefineVariableValue(
    projectConfig,
    variableSchema as Parameters<typeof superRefineVariableValue>[1],
    variableValue,
    path,
    ctx,
    variableKey,
    schemasByKey,
  );
}

function refineForce({
  ctx,
  parsedFeature, // eslint-disable-line
  variableSchemaByKey,
  variationValues,
  force,
  pathPrefix,
  projectConfig,
  schemasByKey,
}) {
  force.forEach((f, fN) => {
    // force[n].variation
    if (f.variation) {
      if (variationValues.indexOf(f.variation) === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown variation "${f.variation}" in force`,
          path: [...pathPrefix, fN, "variation"],
        });
      }
    }

    // force[n].variables[key]
    if (f.variables) {
      Object.keys(f.variables).forEach((variableKey) => {
        refineVariableEntry(
          projectConfig,
          variableSchemaByKey,
          variableKey,
          f.variables[variableKey],
          pathPrefix.concat([fN, "variables", variableKey]),
          ctx,
          schemasByKey,
        );
      });
    }
  });
}

function refineRules({
  ctx,
  parsedFeature,
  variableSchemaByKey,
  variationValues,
  rules,
  pathPrefix,
  projectConfig,
  schemasByKey,
}) {
  rules.forEach((rule, ruleN) => {
    // rules[n].variables[key]
    if (rule.variables) {
      Object.keys(rule.variables).forEach((variableKey) => {
        refineVariableEntry(
          projectConfig,
          variableSchemaByKey,
          variableKey,
          rule.variables[variableKey],
          pathPrefix.concat([ruleN, "variables", variableKey]),
          ctx,
          schemasByKey,
        );
      });
    }

    // rules[n].variationWeights
    if (rule.variationWeights) {
      if (!parsedFeature.variations) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Variation weights are overridden from rule, but no variations are present in feature.",
          path: pathPrefix.concat([ruleN, "variationWeights"]),
        });
      } else {
        const overriddenVariationValues = Object.keys(rule.variationWeights);
        const overriddenVariationWeights: number[] = Object.values(rule.variationWeights);

        // unique keys
        if (overriddenVariationValues.length !== new Set(overriddenVariationValues).size) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Duplicate variation values found in variationWeights: " +
              overriddenVariationValues.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // all original variations must be used
        const missingVariations = variationValues.filter(
          (v) => !overriddenVariationValues.includes(v),
        );

        if (missingVariations.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Missing variations: " + missingVariations.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // unknown variations
        const unknownVariations = overriddenVariationValues.filter(
          (v) => !variationValues.includes(v),
        );

        if (unknownVariations.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Variation weights contain unknown variations: " + unknownVariations.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // weights sum must be 100
        const weightsSum = overriddenVariationWeights.reduce((sum, weight) => sum + weight, 0);

        if (weightsSum !== 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Variation weights must sum to 100",
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }
      }
    }
  });
}

export function getFeatureZodSchema(
  projectConfig: ProjectConfig,
  conditionsZodSchema,
  availableAttributeKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
  availableFeatureKeys: [string, ...string[]],
  availableSchemaKeys: string[] = [],
  schemasByKey: Record<string, Schema> = {},
) {
  const schemaZodSchema = getSchemaZodSchema(availableSchemaKeys);
  const variableValueZodSchema = valueZodSchema;
  const variableValueOrNullZodSchema = z.union([valueZodSchema, z.null()]);

  const variationValueZodSchema = z.string().min(1);

  const plainGroupSegment = z.string().refine(
    (value) => value === "*" || availableSegmentKeys.includes(value),
    (value) => ({
      message: `Unknown segment key "${value}"`,
    }),
  );

  const andOrNotGroupSegment = z.union([
    z
      .object({
        and: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
    z
      .object({
        or: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
    z
      .object({
        not: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
  ]);

  const groupSegmentZodSchema = z.union([andOrNotGroupSegment, plainGroupSegment]);

  const groupSegmentsZodSchema = z.union([z.array(groupSegmentZodSchema), groupSegmentZodSchema]);

  const exposeSchema = z
    .union([z.boolean(), z.array(z.string().refine((value) => projectConfig.tags.includes(value)))])
    .optional();

  const rulesSchema = z
    .array(
      z
        .object({
          key: z.string(),
          description: z.string().optional(),
          segments: groupSegmentsZodSchema,
          percentage: z.number().min(0).max(100),

          enabled: z.boolean().optional(),
          variation: variationValueZodSchema.optional(),
          variables: z.record(variableValueOrNullZodSchema).optional(),
          variationWeights: z.record(z.number().min(0).max(100)).optional(),
        })
        .strict(),
    )

    // must have at least one rule
    .refine(
      (value) => value.length > 0,
      () => ({
        message: "Must have at least one rule",
      }),
    )

    // duplicate rules
    .refine(
      (value) => {
        const keys = value.map((v) => v.key);
        return keys.length === new Set(keys).size;
      },
      (value) => ({
        message: "Duplicate rule keys found: " + value.map((v) => v.key).join(", "),
      }),
    )

    // enforce catch-all rule
    .refine(
      (value) => {
        if (!projectConfig.enforceCatchAllRule) {
          return true;
        }

        const hasCatchAllAsLastRule = value[value.length - 1].segments === "*";
        return hasCatchAllAsLastRule;
      },
      () => ({
        message: `Missing catch-all rule with \`segments: "*"\` at the end`,
      }),
    );

  const forceSchema = z
    .array(
      z.union([
        z
          .object({
            segments: groupSegmentsZodSchema,
            enabled: z.boolean().optional(),
            variation: variationValueZodSchema.optional(),
            variables: z.record(variableValueOrNullZodSchema).optional(),
          })
          .strict(),
        z
          .object({
            conditions: conditionsZodSchema,
            enabled: z.boolean().optional(),
            variation: variationValueZodSchema.optional(),
            variables: z.record(variableValueOrNullZodSchema).optional(),
          })
          .strict(),
      ]),
    )
    .optional();

  const attributeKeyZodSchema = z.string().refine(
    (value) => value === "*" || availableAttributeKeys.includes(value),
    (value) => ({
      message: `Unknown attribute "${value}"`,
    }),
  );

  const featureKeyZodSchema = z.string().refine(
    (value) => availableFeatureKeys.includes(value),
    (value) => ({
      message: `Unknown feature "${value}"`,
    }),
  );

  const environmentKeys = projectConfig.environments || [];

  const featureZodSchema = z
    .object({
      archived: z.boolean().optional(),
      deprecated: z.boolean().optional(),
      description: z.string(),

      tags: z
        .array(
          z.string().refine(
            (value) => tagRegex.test(value),
            (value) => ({
              message: `Tag "${value}" must be lower cased and alphanumeric, and may contain hyphens.`,
            }),
          ),
        )
        .refine(
          (value) => {
            return value.length === new Set(value).size;
          },
          (value) => ({
            message: "Duplicate tags found: " + value.join(", "),
          }),
        ),

      required: z
        .array(
          z.union([
            featureKeyZodSchema,
            z
              .object({
                key: featureKeyZodSchema,
                variation: z.string().optional(),
              })
              .strict(),
          ]),
        )
        .optional(),

      bucketBy: z.union([
        attributeKeyZodSchema,
        z.array(attributeKeyZodSchema),
        z
          .object({
            or: z.array(attributeKeyZodSchema),
          })
          .strict(),
      ]),

      variablesSchema: z
        .record(
          z
            .object({
              deprecated: z.boolean().optional(),

              // Reference to a reusable schema (mutually exclusive with type/properties/required/items)
              schema: z
                .string()
                .refine(
                  (value) => availableSchemaKeys.includes(value),
                  (value) => ({ message: `Unknown schema "${value}"` }),
                )
                .optional(),

              // Inline schema (mutually exclusive with schema)
              type: z.union([z.literal("json"), propertyTypeEnum]).optional(),
              items: schemaZodSchema.optional(),
              properties: z.record(schemaZodSchema).optional(),
              required: z.array(z.string()).optional(),
              enum: z.array(variableValueZodSchema).optional(),
              const: variableValueZodSchema.optional(),
              oneOf: z.array(schemaZodSchema).min(1).optional(),
              minimum: z.number().optional(),
              maximum: z.number().optional(),
              minLength: z.number().optional(),
              maxLength: z.number().optional(),
              pattern: z.string().optional(),
              minItems: z.number().optional(),
              maxItems: z.number().optional(),
              uniqueItems: z.boolean().optional(),

              description: z.string().optional(),

              defaultValue: variableValueZodSchema,
              disabledValue: variableValueZodSchema.optional(),

              useDefaultWhenDisabled: z.boolean().optional(),
            })
            .strict()
            .superRefine((variableSchema, ctx) => {
              const hasRef = "schema" in variableSchema && variableSchema.schema != null;
              const hasInline =
                "type" in variableSchema &&
                variableSchema.type != null &&
                variableSchema.type !== undefined;
              const hasOneOf =
                "oneOf" in variableSchema &&
                Array.isArray(variableSchema.oneOf) &&
                variableSchema.oneOf.length > 0;
              if (hasRef && (hasInline || hasOneOf)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Variable schema cannot have both `schema` (reference) and inline properties (`type`, `oneOf`, `properties`, `required`, `items`). Use one or the other.",
                  path: [],
                });
                return;
              }
              if (hasRef) {
                const hasInlineStructure =
                  ("type" in variableSchema && variableSchema.type != null) ||
                  ("properties" in variableSchema && variableSchema.properties != null) ||
                  ("required" in variableSchema && variableSchema.required != null) ||
                  ("items" in variableSchema && variableSchema.items != null) ||
                  ("oneOf" in variableSchema && variableSchema.oneOf != null);
                const hasInlineValidation =
                  ("minimum" in variableSchema && variableSchema.minimum !== undefined) ||
                  ("maximum" in variableSchema && variableSchema.maximum !== undefined) ||
                  ("minLength" in variableSchema && variableSchema.minLength !== undefined) ||
                  ("maxLength" in variableSchema && variableSchema.maxLength !== undefined) ||
                  ("pattern" in variableSchema && variableSchema.pattern !== undefined) ||
                  ("minItems" in variableSchema && variableSchema.minItems !== undefined) ||
                  ("maxItems" in variableSchema && variableSchema.maxItems !== undefined) ||
                  ("uniqueItems" in variableSchema && variableSchema.uniqueItems !== undefined);
                if (hasInlineStructure) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                      "When `schema` is set, do not set `type`, `oneOf`, `properties`, `required`, or `items`.",
                    path: [],
                  });
                }
                if (hasInlineValidation) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                      "When `schema` is set, do not set `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, or `uniqueItems`; use the referenced schema to define these.",
                    path: [],
                  });
                }
                return;
              }
              if (!hasInline && !hasOneOf) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Variable schema must have either `schema` (reference to a schema key), `type` (inline schema), or `oneOf` (inline oneOf schemas).",
                  path: [],
                });
                return;
              }
              if (hasInline && hasOneOf) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Variable schema cannot have both `type` and `oneOf` at the top level. Use one or the other.",
                  path: [],
                });
                return;
              }
              // Validate required ⊆ properties at this level and in all nested object schemas
              refineRequiredKeysInSchema(
                variableSchema as Parameters<typeof refineRequiredKeysInSchema>[0],
                [],
                ctx,
              );
            }),
        )
        .optional(),

      disabledVariationValue: variationValueZodSchema.optional(),

      variations: z
        .array(
          z
            .object({
              description: z.string().optional(),
              value: variationValueZodSchema,
              weight: z.number().min(0).max(100),
              variables: z.record(variableValueOrNullZodSchema).optional(),
              variableOverrides: z
                .record(
                  z.array(
                    z.union([
                      z
                        .object({
                          conditions: conditionsZodSchema,
                          value: variableValueZodSchema,
                        })
                        .strict(),
                      z
                        .object({
                          segments: groupSegmentsZodSchema,
                          value: variableValueZodSchema,
                        })
                        .strict(),
                    ]),
                  ),
                )
                .optional(),
            })
            .strict(),
        )
        .refine(
          (value) => {
            const variationValues = value.map((v) => v.value);
            return variationValues.length === new Set(variationValues).size;
          },
          (value) => ({
            message: "Duplicate variation values found: " + value.map((v) => v.value).join(", "),
          }),
        )
        .optional(),

      expose:
        projectConfig.environments === false
          ? exposeSchema.optional()
          : z.record(z.enum(environmentKeys as [string, ...string[]]), exposeSchema).optional(),

      force:
        projectConfig.environments === false
          ? forceSchema
          : z.record(z.enum(environmentKeys as [string, ...string[]]), forceSchema).optional(),

      rules:
        projectConfig.environments === false
          ? rulesSchema
          : z.record(z.enum(environmentKeys as [string, ...string[]]), rulesSchema),
    })
    .strict()
    .superRefine((value, ctx) => {
      // disabledVariationValue
      if (value.disabledVariationValue) {
        if (!value.variations) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Disabled variation value is set, but no variations are present in feature.",
            path: ["disabledVariationValue"],
          });
        } else {
          const variationValues = value.variations.map((v) => v.value);

          if (variationValues.indexOf(value.disabledVariationValue) === -1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Disabled variation value "${value.disabledVariationValue}" is not one of the defined variations: ${variationValues.join(", ")}`,
              path: ["disabledVariationValue"],
            });
          }
        }
      }

      if (!value.variablesSchema) {
        return;
      }

      // Every variable value is validated against its schema from variablesSchema. Sources covered:
      // 1. variablesSchema[key].defaultValue  2. variablesSchema[key].disabledValue
      // 3. variations[n].variables[key]       4. variations[n].variableOverrides[key][].value
      // 5. rules[env][n].variables[key]       6. force[env][n].variables[key]
      const variableSchemaByKey = value.variablesSchema;
      const variationValues: string[] = [];

      if (value.variations) {
        value.variations.forEach((variation) => {
          variationValues.push(variation.value);
        });
      }

      // variablesSchema[key]
      const variableKeys = Object.keys(variableSchemaByKey);
      variableKeys.forEach((variableKey) => {
        const variableSchema = variableSchemaByKey[variableKey];

        // When type and enum are both present, all enum values must match the type
        const effectiveSchema = resolveVariableSchema(variableSchema, schemasByKey);
        if (
          effectiveSchema &&
          effectiveSchema.type &&
          Array.isArray(effectiveSchema.enum) &&
          effectiveSchema.enum.length > 0
        ) {
          refineEnumMatchesType(
            effectiveSchema as Parameters<typeof refineEnumMatchesType>[0],
            ["variablesSchema", variableKey],
            ctx,
          );
        }

        // Inline variable schemas: validate minimum/maximum, minLength/maxLength/pattern, minItems/maxItems/uniqueItems
        if (!("schema" in variableSchema) || !variableSchema.schema) {
          const pathPrefix = ["variablesSchema", variableKey];
          refineMinimumMaximum(
            variableSchema as Parameters<typeof refineMinimumMaximum>[0],
            pathPrefix,
            ctx,
          );
          refineStringLengthPattern(
            variableSchema as Parameters<typeof refineStringLengthPattern>[0],
            pathPrefix,
            ctx,
          );
          refineArrayItems(
            variableSchema as Parameters<typeof refineArrayItems>[0],
            pathPrefix,
            ctx,
          );
        }

        if (variableKey === "variation") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable key "${variableKey}" is reserved and cannot be used.`,
            path: ["variablesSchema", variableKey],
          });
        }

        // defaultValue
        superRefineVariableValue(
          projectConfig,
          variableSchema,
          variableSchema.defaultValue,
          ["variablesSchema", variableKey, "defaultValue"],
          ctx,
          variableKey,
          schemasByKey,
        );

        // disabledValue (only when present)
        if (variableSchema.disabledValue !== undefined) {
          superRefineVariableValue(
            projectConfig,
            variableSchema,
            variableSchema.disabledValue,
            ["variablesSchema", variableKey, "disabledValue"],
            ctx,
            variableKey,
            schemasByKey,
          );
        }
      });

      // variations: validate variation.variables and variation.variableOverrides (each value against its variable schema)
      if (value.variations) {
        value.variations.forEach((variation, variationN) => {
          // variations[n].variables[key]
          if (variation.variables) {
            for (const variableKey of Object.keys(variation.variables)) {
              refineVariableEntry(
                projectConfig,
                variableSchemaByKey,
                variableKey,
                variation.variables[variableKey],
                ["variations", variationN, "variables", variableKey],
                ctx,
                schemasByKey,
              );
            }
          }

          // variations[n].variableOverrides[key][].value (path-map or full value)
          if (variation.variableOverrides) {
            for (const variableKey of Object.keys(variation.variableOverrides)) {
              const variableSchema = variableSchemaByKey[variableKey];
              if (!variableSchema) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Variable "${variableKey}" is not defined in \`variablesSchema\`.`,
                  path: ["variations", variationN, "variableOverrides", variableKey],
                });
                continue;
              }
              const overrides = variation.variableOverrides[variableKey];
              if (!Array.isArray(overrides)) continue;
              overrides.forEach((override, overrideN) => {
                const overrideValue = override.value;
                const valuePath = [
                  "variations",
                  variationN,
                  "variableOverrides",
                  variableKey,
                  overrideN,
                  "value",
                ];
                if (
                  typeof overrideValue === "object" &&
                  overrideValue !== null &&
                  !Array.isArray(overrideValue)
                ) {
                  const pathMap = overrideValue as Record<string, unknown>;
                  for (const pathKey of Object.keys(pathMap)) {
                    const pathSegments = parsePathMapKey(pathKey);
                    if (!pathSegments || pathSegments.length === 0) {
                      ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Invalid mutation path "${pathKey}" in variableOverride for "${variableKey}".`,
                        path: [...valuePath, pathKey],
                      });
                      continue;
                    }
                    const atPathSchema = resolveSchemaAtPath(
                      variableSchema as Schema,
                      pathSegments,
                      schemasByKey,
                    );
                    if (!atPathSchema) {
                      const effectiveSchema = resolveVariableSchema(
                        variableSchema as Parameters<typeof resolveVariableSchema>[0],
                        schemasByKey,
                      );
                      const isFlatObject =
                        effectiveSchema?.type === "object" &&
                        (!effectiveSchema.properties ||
                          Object.keys(effectiveSchema.properties).length === 0);
                      if (isFlatObject) {
                        continue;
                      }
                      ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Path "${pathKey}" is invalid for variable "${variableKey}" (not in schema).`,
                        path: [...valuePath, pathKey],
                      });
                      continue;
                    }
                    superRefineVariableValue(
                      projectConfig,
                      atPathSchema,
                      pathMap[pathKey],
                      [...valuePath, pathKey],
                      ctx,
                      pathKey,
                      schemasByKey,
                    );
                  }
                } else {
                  superRefineVariableValue(
                    projectConfig,
                    variableSchema as Parameters<typeof superRefineVariableValue>[1],
                    overrideValue,
                    valuePath,
                    ctx,
                    variableKey,
                    schemasByKey,
                  );
                }
              });
            }
          }
        });
      }

      if (environmentKeys.length > 0) {
        // with environments
        for (const environmentKey of environmentKeys) {
          // rules
          if (value.rules && value.rules[environmentKey]) {
            refineRules({
              parsedFeature: value,
              variableSchemaByKey,
              variationValues,
              rules: value.rules[environmentKey],
              pathPrefix: ["rules", environmentKey],
              ctx,
              projectConfig,
              schemasByKey,
            });
          }

          // force
          if (value.force && value.force[environmentKey]) {
            refineForce({
              parsedFeature: value,
              variableSchemaByKey,
              variationValues,
              force: value.force[environmentKey],
              pathPrefix: ["force", environmentKey],
              ctx,
              projectConfig,
              schemasByKey,
            });
          }
        }
      } else {
        // no environments

        // rules
        if (value.rules) {
          refineRules({
            parsedFeature: value,
            variableSchemaByKey,
            variationValues,
            rules: value.rules,
            pathPrefix: ["rules"],
            ctx,
            projectConfig,
            schemasByKey,
          });
        }

        // force
        if (value.force) {
          refineForce({
            parsedFeature: value,
            variableSchemaByKey,
            variationValues,
            force: value.force,
            pathPrefix: ["force"],
            ctx,
            projectConfig,
            schemasByKey,
          });
        }
      }
    });

  return featureZodSchema;
}
