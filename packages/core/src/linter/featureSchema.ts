import type {
  ParsedFeature,
  ParsedVariable,
  Schema,
  SchemaType,
  VariableMutations,
  VariableValue,
} from "@featurevisor/types";
import { z } from "zod";
import {
  formatValueMessage,
  isRemovedSchemaType,
  refineRemovedSchemaType,
  valueMatchesFormat,
} from "./schemaFormats";

import { DEFAULT_RESERVED_KEYS, ProjectConfig } from "../config";
import { getMutationPath, isMutationKey, validateMutationKey } from "./mutationNotation";
import { compileVariableMutation } from "../builder/variableOverrideProgram";
import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import { getMutationSchema } from "./mutationSchema";
import { withMutationResultPaths } from "./mutationResultPaths";
import {
  resolveMutationsForMultipleVariables,
  resolveMutationsForSingleVariable,
  rootVariableFromOverrideKey,
} from "../builder/mutateVariables";
import {
  countZodSchema,
  valueZodSchema,
  propertyTypeEnum,
  getSchemaZodSchema,
  refineEnumMatchesType,
  refineMinimumMaximum,
  refineStringLengthPattern,
  refineSchemaFormat,
  schemaFormatZodSchema,
  refineArrayItems,
} from "./schema";
import { refineWithMessage, UNKNOWN_REFERENCE } from "./zodHelpers";
import { suggestKey } from "./diagnostics";
import {
  removedConditionFields,
  refineRemovedConditionFields,
  refineRequiredConditions,
} from "./removedConditionFields";

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
export function resolveVariableSchema(
  variableSchema: {
    schema?: string;
    type?: string;
    items?: unknown;
    properties?: unknown;
    additionalProperties?: unknown;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    oneOf?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  },
  schemasByKey?: Record<string, Schema>,
): {
  type?: string;
  items?: unknown;
  properties?: unknown;
  additionalProperties?: unknown;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
} | null {
  if (variableSchema.schema) {
    const referenced = schemasByKey?.[variableSchema.schema];
    return referenced
      ? (resolveSchemaRefs(
          referenced as { schema?: string; [k: string]: unknown },
          schemasByKey,
        ) as Schema)
      : null;
  }
  return variableSchema as {
    type?: string;
    items?: unknown;
    properties?: unknown;
    additionalProperties?: unknown;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    oneOf?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
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

function schemaUsesTimestampFormat(
  schema: { [k: string]: unknown },
  schemasByKey?: Record<string, Schema>,
  seen = new Set<unknown>(),
): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const resolved = resolveSchemaRefs(schema, schemasByKey);
  // Literal values are checked against every format, not only timestamps.
  if (resolved.format !== undefined) return true;
  const children = [
    resolved.items,
    resolved.additionalProperties,
    ...Object.values((resolved.properties as Record<string, unknown>) || {}),
    ...((resolved.oneOf as unknown[]) || []),
  ];
  return children.some((child) =>
    child && typeof child === "object"
      ? schemaUsesTimestampFormat(child as { [k: string]: unknown }, schemasByKey, seen)
      : false,
  );
}

/**
 * Returns true if the value matches the given schema (const, enum, type, object properties, array items, or exactly one of oneOf).
 * Used for oneOf validation: value must match exactly one branch.
 */
export function valueMatchesSchema(
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
    additionalProperties?: unknown;
    required?: string[];
    items?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
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
    if (!valueDeepEqual(value, resolved.const)) return false;
    if (!schemaUsesTimestampFormat(resolved, schemasByKey)) return true;
  }

  if (resolved.enum !== undefined && Array.isArray(resolved.enum)) {
    if (!resolved.enum.some((e) => valueDeepEqual(value, e))) return false;
    if (!schemaUsesTimestampFormat(resolved, schemasByKey)) return true;
  }

  const type = resolved.type;
  if (!type) return false;

  if (type === "string") {
    if (typeof value !== "string") return false;
    if (!valueMatchesFormat(resolved.format, value)) return false;
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
  if (type === "number") {
    if (typeof value !== "number") return false;
    if (resolved.minimum !== undefined && (value as number) < resolved.minimum) return false;
    if (resolved.maximum !== undefined && (value as number) > resolved.maximum) return false;
    return true;
  }
  if (type === "json") return typeof value === "string";

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const props = resolved.properties;
    const additional = resolved.additionalProperties;
    const obj = value as Record<string, unknown>;
    if ((!props || typeof props !== "object") && (!additional || typeof additional !== "object")) {
      return true;
    }
    if (!props || typeof props !== "object") {
      return Object.keys(obj).every((key) =>
        valueMatchesSchema(additional as { [k: string]: unknown }, obj[key], schemasByKey),
      );
    }
    const required = new Set(resolved.required || []);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) return false;
      if (!valueMatchesSchema(props[key] as { [k: string]: unknown }, obj[key], schemasByKey))
        return false;
    }
    for (const key of Object.keys(obj)) {
      const propSchema = props[key];
      if (propSchema) {
        if (!valueMatchesSchema(propSchema as { [k: string]: unknown }, obj[key], schemasByKey))
          return false;
      } else if (additional && typeof additional === "object") {
        if (!valueMatchesSchema(additional as { [k: string]: unknown }, obj[key], schemasByKey))
          return false;
      } else {
        return false;
      }
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

type SchemaLikeForRequired = {
  type?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  required?: string[];
  items?: unknown;
  schema?: string;
  oneOf?: unknown[];
};

/**
 * Recursively validates that every `required` array (at this level and in nested
 * object/array schemas) only contains keys that exist in the same level's `properties`.
 * Adds Zod issues with the correct path for invalid required field names.
 * When schemasByKey is provided, resolves schema references (schema: key) so that
 * referenced and nested schemas are validated too.
 */
export function refineRequiredKeysInSchema(
  schema: SchemaLikeForRequired,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
  schemasByKey?: Record<string, Schema>,
): void {
  if (!schema || typeof schema !== "object") return;

  // Resolve schema reference so we validate the referenced schema (and can recurse into it)
  let current: SchemaLikeForRequired = schema;
  if (schema.schema && schemasByKey?.[schema.schema]) {
    current = schemasByKey[schema.schema] as SchemaLikeForRequired;
    refineRequiredKeysInSchema(current, pathPrefix, ctx, schemasByKey);
    return;
  }

  const effectiveType = current.type;
  const properties = current.properties;
  const required = current.required;
  const items = current.items;

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
          nested as SchemaLikeForRequired,
          [...pathPrefix, "properties", key],
          ctx,
          schemasByKey,
        );
      }
    }
  }
  const additionalProperties = (current as { additionalProperties?: unknown }).additionalProperties;
  if (
    additionalProperties &&
    typeof additionalProperties === "object" &&
    !Array.isArray(additionalProperties)
  ) {
    refineRequiredKeysInSchema(
      additionalProperties as SchemaLikeForRequired,
      [...pathPrefix, "additionalProperties"],
      ctx,
      schemasByKey,
    );
  }

  if (items && typeof items === "object" && !Array.isArray(items)) {
    refineRequiredKeysInSchema(
      items as SchemaLikeForRequired,
      [...pathPrefix, "items"],
      ctx,
      schemasByKey,
    );
  }

  const oneOf = (current as { oneOf?: unknown[] }).oneOf;
  if (oneOf && Array.isArray(oneOf)) {
    oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineRequiredKeysInSchema(
          branch as SchemaLikeForRequired,
          [...pathPrefix, "oneOf", i],
          ctx,
          schemasByKey,
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

/** Authored identity kept separately from schema lookup and diagnostic locations. */
export interface MutationValueContext {
  variableKey: string;
  path: string;
  /** Item operations validate the inserted or removed item, not the array at `path`. */
  operation?: string;
  /** Location inside that item, for nested values. */
  itemPath?: string;
}

const itemOperationLabels: Record<string, string> = {
  append: "Item appended to",
  appendUnique: "Item appended to",
  prepend: "Item prepended to",
  removeValue: "Item removed from",
  before: "Item inserted before",
  after: "Item inserted after",
};

function appendPath(path: string, child: string | number): string {
  return typeof child === "number" ? `${path}[${child}]` : `${path ? `${path}.` : ""}${child}`;
}

export function childMutationValueContext(
  context: MutationValueContext | undefined,
  child: string | number,
): MutationValueContext | undefined {
  if (!context) return undefined;
  if (context.operation && itemOperationLabels[context.operation])
    return { ...context, itemPath: appendPath(context.itemPath || "", child) };
  return { ...context, path: appendPath(context.path, child) };
}

export function mutationSubject(mutation: MutationValueContext): string {
  const variable = `variable "${mutation.variableKey}"`;
  const label = mutation.operation && itemOperationLabels[mutation.operation];
  if (!label)
    return mutation.path ? `Value at "${mutation.path}" in ${variable}` : `Value of ${variable}`;
  const item = `${label} ${mutation.path ? `"${mutation.path}" in ${variable}` : variable}`;
  return mutation.itemPath
    ? `Value at "${mutation.itemPath}" in the ${item.charAt(0).toLowerCase()}${item.slice(1)}`
    : item;
}

function valueSubject(
  variableSchema: unknown,
  variableKey: string | undefined,
  path: (string | number)[],
  mutation?: MutationValueContext,
): string {
  return mutation
    ? mutationSubject(mutation)
    : `Variable "${getVariableLabel(variableSchema, variableKey, path)}"`;
}

/** The authored mutation subject already names its schema, so the type aside is omitted. */
function typedSubject(subject: string, type: string, mutation?: MutationValueContext): string {
  return mutation ? subject : `${subject} (type ${type})`;
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
  mutation?: MutationValueContext,
): void {
  const subject = valueSubject(variableSchema, variableKey, path, mutation);
  const minItems = variableSchema.minItems;
  const maxItems = variableSchema.maxItems;
  const uniqueItems = variableSchema.uniqueItems;
  if (minItems !== undefined && variableValue.length < minItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${typedSubject(subject, "array", mutation)} must have at least ${minItems} items (\`minItems\`), but has ${variableValue.length}.`,
      path,
    });
  }
  if (maxItems !== undefined && variableValue.length > maxItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${typedSubject(subject, "array", mutation)} must have at most ${maxItems} items (\`maxItems\`), but has ${variableValue.length}.`,
      path,
    });
  }
  if (uniqueItems) {
    for (let i = 0; i < variableValue.length; i++) {
      for (let j = i + 1; j < variableValue.length; j++) {
        if (valueDeepEqual(variableValue[i], variableValue[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${typedSubject(subject, "array", mutation)} has duplicate items at indices ${i} and ${j} but \`uniqueItems\` is true.`,
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
        childMutationValueContext(mutation, index),
      );
    });
  } else {
    if (!isArrayOfStrings(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "array", mutation)}: when \`items\` is not set, array must contain only strings; found non-string element.`,
        path,
      });
    }
  }

  if (projectConfig.maxVariableArrayStringifiedLength) {
    const stringified = JSON.stringify(variableValue);
    if (stringified.length > projectConfig.maxVariableArrayStringifiedLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${subject} array is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableArrayStringifiedLength}`,
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
    additionalProperties?: unknown;
    required?: string[];
    type: string;
  },
  variableValue: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
  schemasByKey?: Record<string, Schema>,
  mutation?: MutationValueContext,
): void {
  const subject = valueSubject(variableSchema, variableKey, path, mutation);
  const schemaProperties = variableSchema.properties;
  const additionalProperties = variableSchema.additionalProperties;

  if (schemaProperties && typeof schemaProperties === "object") {
    // As in JSON Schema, only keys listed in `required` must be present.
    // Without the list every property is optional, matching generated types.
    const requiredKeys = (variableSchema.required || []).filter((k) =>
      Object.prototype.hasOwnProperty.call(schemaProperties, k),
    );

    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(variableValue, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: mutation
            ? `${subject} is missing required property "${key}".`
            : `Missing required property "${key}" in variable "${getVariableLabel(variableSchema, variableKey, path)}"`,
          path: [...path, key],
        });
      }
    }

    for (const key of Object.keys(variableValue)) {
      const propSchema = schemaProperties[key];
      if (!propSchema && additionalProperties && typeof additionalProperties === "object") {
        superRefineVariableValue(
          projectConfig,
          additionalProperties as Parameters<typeof superRefineVariableValue>[1],
          variableValue[key],
          [...path, key],
          ctx,
          key,
          schemasByKey,
          childMutationValueContext(mutation, key),
        );
      } else if (!propSchema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: mutation
            ? `${subject} has unknown property "${key}" (not in schema).`
            : `Unknown property "${key}" in variable "${getVariableLabel(variableSchema, variableKey, path)}" (not in schema)`,
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
          childMutationValueContext(mutation, key),
        );
      }
    }
  } else if (additionalProperties && typeof additionalProperties === "object") {
    for (const key of Object.keys(variableValue)) {
      superRefineVariableValue(
        projectConfig,
        additionalProperties as Parameters<typeof superRefineVariableValue>[1],
        variableValue[key],
        [...path, key],
        ctx,
        key,
        schemasByKey,
        childMutationValueContext(mutation, key),
      );
    }
  } else {
    for (const key of Object.keys(variableValue)) {
      const propValue = variableValue[key];
      if (!isFlatObjectValue(propValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${subject} is a flat object (no \`properties\` in schema); property "${key}" must be a primitive (string, number, boolean, or null), got: ${typeof propValue}`,
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
        message: `${subject} object is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableObjectStringifiedLength}`,
        path,
      });
    }
  }
}

/** Schema or variable schema (e.g. type "json", defaultValue); used for value validation. */
type VariableSchemaLike =
  | (Omit<Schema, "type"> & { type?: SchemaType | "json" })
  | null
  | undefined;

export function superRefineVariableValue(
  projectConfig: ProjectConfig,
  variableSchema: VariableSchemaLike,
  variableValue: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
  schemasByKey?: Record<string, Schema>,
  mutation?: MutationValueContext,
): void {
  const subject = valueSubject(variableSchema, variableKey, path, mutation);

  if (!variableSchema) {
    const variableName =
      path.length > 0 && typeof path[path.length - 1] === "string"
        ? String(path[path.length - 1])
        : "variable";
    const message = mutation
      ? `${subject} cannot be validated because its schema is not defined.`
      : `Variable "${variableName}" is used but not defined in variablesSchema. Define it under variablesSchema first, then use it here.`;

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
      message: mutation
        ? `${subject} cannot be validated because schema "${variableSchema.schema}" could not be loaded.`
        : `Schema "${variableSchema.schema}" could not be loaded for value validation.`,
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
        message: `${subject} must match exactly one of the \`oneOf\` schemas (got ${JSON.stringify(variableValue)}; matched none).`,
        path,
      });
    } else if (matchCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${subject} must match exactly one of the \`oneOf\` schemas (matched ${matchCount}).`,
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
        message: `${subject} must equal the constant value defined in schema (got ${JSON.stringify(variableValue)}).`,
        path,
      });
    }
    if (!schemaUsesTimestampFormat(effectiveSchema, schemasByKey)) return;
  }

  const effectiveEnum = (effectiveSchema as { enum?: unknown[] }).enum;
  if (effectiveEnum !== undefined && Array.isArray(effectiveEnum) && effectiveEnum.length > 0) {
    const allowed = effectiveEnum.some((v) => valueDeepEqual(variableValue, v));
    if (!allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${subject} must be one of the allowed enum values (got ${JSON.stringify(variableValue)}).`,
        path,
      });
    }
    if (!schemaUsesTimestampFormat(effectiveSchema, schemasByKey)) return;
  }

  // Require a value (no undefined) for every variable usage
  if (variableValue === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${subject} is required.`,
      path,
    });
    return;
  }

  const expectedType = effectiveSchema.type;
  const gotType = typeOfValue(variableValue);
  const receivedType =
    gotType === "null" || gotType === "undefined"
      ? gotType
      : `${/^[aeiou]/.test(gotType) ? "an" : "a"} ${gotType}`;

  // string — only string allowed; schema minLength/maxLength/pattern applied when set
  if (expectedType === "string") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "string", mutation)} must be a string, but got ${receivedType}.`,
        path,
      });
      return;
    }

    const strMinLen = (effectiveSchema as { minLength?: number }).minLength;
    if (!valueMatchesFormat(effectiveSchema.format, variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          effectiveSchema.format === "date-time"
            ? `${subject} is not a valid portable timestamp for format: date-time. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.`
            : `${subject} is not valid for format: ${effectiveSchema.format}. ${formatValueMessage(effectiveSchema.format)}`,
        path,
      });
    }
    const strMaxLen = (effectiveSchema as { maxLength?: number }).maxLength;
    const strPattern = (effectiveSchema as { pattern?: string }).pattern;
    if (strMinLen !== undefined && variableValue.length < strMinLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "string", mutation)} must be at least ${strMinLen} characters long (\`minLength\`), but has ${variableValue.length}.`,
        path,
      });
    }
    if (strMaxLen !== undefined && variableValue.length > strMaxLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "string", mutation)} must be at most ${strMaxLen} characters long (\`maxLength\`), but has ${variableValue.length}.`,
        path,
      });
    }
    if (strPattern !== undefined) {
      try {
        if (!new RegExp(strPattern).test(variableValue)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${typedSubject(subject, "string", mutation)} does not match \`pattern\`.`,
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
        message: `${subject} is ${variableValue.length} characters long, but the project allows at most ${projectConfig.maxVariableStringLength} (maxVariableStringLength).`,
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
        message: `${typedSubject(subject, "integer", mutation)} must be a number, but got ${receivedType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "integer", mutation)} must be a finite number, but got ${variableValue}.`,
        path,
      });
      return;
    }
    if (!Number.isInteger(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "integer", mutation)} must be an integer, but got ${variableValue}.`,
        path,
      });
      return;
    }
    const intMin = (effectiveSchema as { minimum?: number }).minimum;
    const intMax = (effectiveSchema as { maximum?: number }).maximum;
    if (intMin !== undefined && variableValue < intMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "integer", mutation)} must be >= minimum (${intMin}), but got ${variableValue}.`,
        path,
      });
    }
    if (intMax !== undefined && variableValue > intMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "integer", mutation)} must be <= maximum (${intMax}), but got ${variableValue}.`,
        path,
      });
    }
    return;
  }

  // number — only finite number allowed
  if (expectedType === "number") {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "number", mutation)} must be a number, but got ${receivedType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "number", mutation)} must be a finite number, but got ${variableValue}.`,
        path,
      });
      return;
    }
    const numberMin = (effectiveSchema as { minimum?: number }).minimum;
    const numberMax = (effectiveSchema as { maximum?: number }).maximum;
    if (numberMin !== undefined && variableValue < numberMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "number", mutation)} must be >= minimum (${numberMin}), but got ${variableValue}.`,
        path,
      });
    }
    if (numberMax !== undefined && variableValue > numberMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "number", mutation)} must be <= maximum (${numberMax}), but got ${variableValue}.`,
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
        message: `${typedSubject(subject, "boolean", mutation)} must be a boolean, but got ${receivedType}.`,
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
        message: `${typedSubject(subject, "array", mutation)} must be an array, but got ${receivedType}.`,
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
      mutation,
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
        message: `${typedSubject(subject, "object", mutation)} must be a plain object, but got ${receivedType}.`,
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
      mutation,
    );
    return;
  }

  // json — only string containing valid JSON allowed
  if (expectedType === "json") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "json", mutation)} must be a string (JSON string), but got ${receivedType}.`,
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
            message: `${subject} JSON is too long (${variableValue.length} characters), max length is ${projectConfig.maxVariableJSONStringifiedLength}`,
            path,
          });
        }
      }
      // eslint-disable-next-line
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typedSubject(subject, "json", mutation)} must be a valid JSON string; parse failed.`,
        path,
      });
    }

    return;
  }

  // A removed type already reports its migration at `type`.
  if (isRemovedSchemaType(expectedType)) return;

  // Unknown variable type — schema is invalid or unsupported
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${subject} has unknown or unsupported type "${String(expectedType)}" in variablesSchema.`,
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
  const variableSchema = variableSchemaByKey[variableKey];
  if (!variableSchema && isMutationKey(variableKey)) {
    try {
      compileVariableMutation(variableKey, variableValue);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message, path });
      return;
    }
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
        validation.rootKey,
        schemasByKey,
        {
          variableKey: validation.rootKey,
          path: getMutationPath(variableKey).slice(validation.rootKey.length).replace(/^\./, ""),
          operation: validation.operation,
        },
      );
    }
    return;
  }
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

function refineResolvedVariableValues(
  values: Record<string, unknown> | undefined,
  variableSchemaByKey: Record<string, unknown>,
  path: (string | number)[],
  projectConfig: ProjectConfig,
  ctx: z.RefinementCtx,
  schemasByKey?: Record<string, Schema>,
) {
  const validValues: Record<string, unknown> = {};
  const invalidRoots = new Set<string>();
  const mutatedRoots = new Set<string>();
  for (const [key, value] of Object.entries(values || {})) {
    const root = rootVariableFromOverrideKey(key, variableSchemaByKey);
    let invalid = false;
    refineVariableEntry(
      projectConfig,
      variableSchemaByKey,
      key,
      value,
      [...path, key],
      {
        ...ctx,
        addIssue(issue) {
          invalid = true;
          ctx.addIssue(issue);
        },
      },
      schemasByKey,
    );
    if (invalid) invalidRoots.add(root);
    else validValues[key] = value;
    if (key !== root) mutatedRoots.add(root);
  }
  // Do not resolve a partially valid assignment or cascade from an invalid parent.
  for (const key of Object.keys(validValues)) {
    if (invalidRoots.has(rootVariableFromOverrideKey(key, variableSchemaByKey))) {
      delete validValues[key];
    }
  }
  try {
    const resolved = resolveMutationsForMultipleVariables(
      variableSchemaByKey as Parameters<typeof resolveMutationsForMultipleVariables>[0],
      validValues as Parameters<typeof resolveMutationsForMultipleVariables>[1],
    );
    for (const [key, value] of Object.entries(resolved || {})) {
      // Direct values were validated above. Only mutations need a result check.
      if (!mutatedRoots.has(key)) continue;
      superRefineVariableValue(
        projectConfig,
        variableSchemaByKey[key] as Schema,
        value,
        [...path, key],
        ctx,
        key,
        schemasByKey,
      );
    }
    return resolved;
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message, path });
    return undefined;
  }
}

function refineVariableOverrides({
  ctx,
  variableSchemaByKey,
  variableOverrides,
  pathPrefix,
  projectConfig,
  schemasByKey,
  baseValues,
}: {
  ctx: z.RefinementCtx;
  variableSchemaByKey: Record<string, unknown>;
  variableOverrides: Record<string, Array<{ value?: unknown; mutate?: VariableMutations }>>;
  pathPrefix: (string | number)[];
  projectConfig: ProjectConfig;
  schemasByKey?: Record<string, Schema>;
  baseValues?: ReturnType<typeof resolveMutationsForMultipleVariables>;
}) {
  for (const variableKey of Object.keys(variableOverrides)) {
    const variableSchema = variableSchemaByKey[variableKey];
    if (!variableSchema && isMutationKey(variableKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Variable override key "${variableKey}" must be a declared variable key, not mutation notation. ` +
          "Use mutation notation inside each override's `value` object.",
        path: [...pathPrefix, variableKey],
      });
      continue;
    }

    if (!variableSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${variableKey}" is not defined in \`variablesSchema\`.`,
        path: [...pathPrefix, variableKey],
      });
      continue;
    }

    const variableSchemaWithRef = variableSchema as { schema?: string };
    const resolvedVariableSchema = resolveVariableSchema(
      variableSchema as Parameters<typeof resolveVariableSchema>[0],
      schemasByKey,
    );
    if (variableSchemaWithRef.schema) {
      if (!resolvedVariableSchema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schema "${variableSchemaWithRef.schema}" could not be loaded for variable "${variableKey}".`,
          path: [...pathPrefix, variableKey],
        });
        continue;
      }
    }

    const overrides = variableOverrides[variableKey];
    if (!Array.isArray(overrides)) {
      continue;
    }

    overrides.forEach((override, overrideN) => {
      const usesExplicitMutation = typeof override.mutate !== "undefined";
      const overrideValue = usesExplicitMutation ? override.mutate : override.value;
      const valuePath = [
        ...pathPrefix,
        variableKey,
        overrideN,
        usesExplicitMutation ? "mutate" : "value",
      ];

      if (
        typeof overrideValue === "object" &&
        overrideValue !== null &&
        (!Array.isArray(overrideValue) || usesExplicitMutation)
      ) {
        const pathEntries = mutationEntries(overrideValue as VariableMutations);
        const pathKeys = pathEntries.map(([key]) => key);
        const hasStructuredObjectSchema =
          resolvedVariableSchema?.type === "object" &&
          (Boolean(resolvedVariableSchema.properties) ||
            Boolean(resolvedVariableSchema.additionalProperties));
        const treatAsPathMap =
          usesExplicitMutation ||
          pathKeys.some((pathKey) => isMutationKey(pathKey)) ||
          (hasStructuredObjectSchema && pathKeys.length > 0);

        if (treatAsPathMap) {
          let invalidOperand = false;
          const operandContext: z.RefinementCtx = {
            ...ctx,
            addIssue(issue) {
              invalidOperand = true;
              ctx.addIssue(issue);
            },
          };
          for (const [entryIndex, [pathKey, mutationValue]] of pathEntries.entries()) {
            const mutationPath = [
              ...valuePath,
              ...mutationEntryPath(overrideValue as VariableMutations, entryIndex, pathKey),
            ];
            const validationRootKey = "variable";
            const composedMutationKey = `${validationRootKey}${pathKey.startsWith("[") || pathKey.startsWith(":") ? "" : "."}${pathKey}`;
            try {
              compileVariableMutation(pathKey, mutationValue);
            } catch (error) {
              operandContext.addIssue({
                code: z.ZodIssueCode.custom,
                message: (error as Error).message,
                path: mutationPath,
              });
              continue;
            }
            const validation = validateMutationKey(
              composedMutationKey,
              { [validationRootKey]: variableSchema as Schema },
              schemasByKey,
              { variableKey, path: pathKey },
            );

            if (!validation.valid) {
              operandContext.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  validation.error ??
                  `Invalid mutation path "${pathKey}" in variableOverride for "${variableKey}".`,
                path: mutationPath,
              });
              continue;
            }

            if (validation.operation === "remove") {
              continue;
            }

            const fallbackValueSchema =
              validation.operation === "append" ||
              validation.operation === "prepend" ||
              validation.operation === "before" ||
              validation.operation === "after"
                ? ({ type: "string" } as Schema)
                : null;
            const valueSchema = validation.valueSchema ?? fallbackValueSchema;
            if (!valueSchema) {
              continue;
            }

            superRefineVariableValue(
              projectConfig,
              valueSchema,
              mutationValue,
              mutationPath,
              operandContext,
              variableKey,
              schemasByKey,
              { variableKey, path: getMutationPath(pathKey), operation: validation.operation },
            );
          }
          if (invalidOperand) return;
          try {
            const resolved = resolveMutationsForSingleVariable(
              variableSchemaByKey as Parameters<typeof resolveMutationsForSingleVariable>[0],
              variableKey,
              overrideValue as Parameters<typeof resolveMutationsForSingleVariable>[2],
              baseValues?.[variableKey],
              usesExplicitMutation,
            );
            superRefineVariableValue(
              projectConfig,
              variableSchema as Schema,
              resolved,
              valuePath,
              withMutationResultPaths(
                ctx,
                override.mutate,
                valuePath,
                baseValues?.[variableKey] === undefined
                  ? (variableSchema as Schema & { defaultValue?: VariableValue }).defaultValue
                  : baseValues[variableKey],
                variableKey,
              ),
              variableKey,
              schemasByKey,
            );
          } catch (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: (error as Error).message,
              path: valuePath,
            });
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
      refineResolvedVariableValues(
        f.variables,
        variableSchemaByKey,
        [...pathPrefix, fN, "variables"],
        projectConfig,
        ctx,
        schemasByKey,
      );
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
    // rules[n].variableOverrides[key][].value (path-map or full value)
    const baseValues = refineResolvedVariableValues(
      rule.variables,
      variableSchemaByKey,
      [...pathPrefix, ruleN, "variables"],
      projectConfig,
      ctx,
      schemasByKey,
    );
    if (rule.variableOverrides) {
      refineVariableOverrides({
        ctx,
        variableSchemaByKey,
        variableOverrides: rule.variableOverrides,
        baseValues,
        pathPrefix: [...pathPrefix, ruleN, "variableOverrides"],
        projectConfig,
        schemasByKey,
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
  featuresByKey: Record<string, ParsedFeature> = {},
  variablesByKey: Record<string, ParsedVariable> = {},
) {
  const schemaZodSchema = getSchemaZodSchema(availableSchemaKeys, schemasByKey);
  const variableValueZodSchema = valueZodSchema;
  const variableValueOrNullZodSchema = z.union([valueZodSchema, z.null()]);
  const overridePathMapValueZodSchema = z.record(z.string(), variableValueOrNullZodSchema);
  const overrideValueZodSchema = z.union([
    variableValueOrNullZodSchema,
    overridePathMapValueZodSchema,
  ]);

  const variationValueZodSchema = z.string().min(1);

  conditionsZodSchema =
    conditionsZodSchema.withEntities?.(featuresByKey, variablesByKey, availableSegmentKeys) ||
    conditionsZodSchema;
  const featureVariableOverrideSchema = z
    .object({
      key: z.string().min(1).optional(),
      description: z.string().optional(),
      promotable: z.boolean().optional(),
      conditions: conditionsZodSchema.optional(),
      ...removedConditionFields,
      value: overrideValueZodSchema.optional(),
      mutate: getMutationSchema(overridePathMapValueZodSchema).optional(),
    })
    .strict()
    .superRefine((override, ctx) => {
      refineRequiredConditions(override, ctx);
      const hasValue = Object.prototype.hasOwnProperty.call(override, "value");
      const hasMutate = Object.prototype.hasOwnProperty.call(override, "mutate");
      if (hasValue === hasMutate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A variable override must define exactly one of `value` or `mutate`.",
          path: hasValue ? ["mutate"] : ["value"],
        });
      }

      if (typeof override.promotable !== "undefined" && typeof override.key === "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A variable override key is required when `promotable` is set.",
          path: ["key"],
        });
      }
    });
  const featureVariableOverridesSchema = z
    .array(featureVariableOverrideSchema)
    .superRefine((overrides, ctx) => {
      const keys = overrides
        .map((override) => override.key)
        .filter((key): key is string => typeof key === "string");
      if (keys.length !== new Set(keys).size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate variable override keys found: ${keys.join(", ")}`,
        });
      }

      if (
        overrides.some((override) => typeof override.promotable !== "undefined") &&
        overrides.some((override) => typeof override.key === "undefined")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Every variable override in the list must have a key when `promotable` is used.",
        });
      }

      if (
        projectConfig.requireOverrideKeysInFeatures &&
        overrides.some((override) => typeof override.key === "undefined")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Every variable override inside a feature must have a key when `requireOverrideKeysInFeatures` is enabled.",
        });
      }
    });

  const exposeSchema = z
    .union([z.boolean(), z.array(z.string().refine((value) => projectConfig.tags.includes(value)))])
    .optional();

  const rulesSchema = z
    .array(
      z
        .object({
          key: z.string(),
          description: z.string().optional(),
          promotable: z.boolean().optional(),
          conditions: conditionsZodSchema.optional(),
          ...removedConditionFields,
          percentage: z.number().min(0).max(100),

          enabled: z.boolean().optional(),
          variation: variationValueZodSchema.optional(),
          variables: z.record(z.string(), variableValueOrNullZodSchema).optional(),
          variableOverrides: z.record(z.string(), featureVariableOverridesSchema).optional(),
          variationWeights: z.record(z.string(), z.number().min(0).max(100)).optional(),
        })
        .strict()
        .superRefine(refineRequiredConditions),
    )

    // must have at least one rule
    .superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must have at least one rule",
        });
      }
    })

    // duplicate rules
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      const reported = new Set<string>();
      value.forEach((rule, index) => {
        if (seen.has(rule.key) && !reported.has(rule.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate rule key "${rule.key}". Each rule key must be unique.`,
            path: [index, "key"],
          });
          reported.add(rule.key);
        }
        seen.add(rule.key);
      });
    })

    // enforce catch-all rule
    .superRefine((value, ctx) => {
      if (!projectConfig.enforceCatchAllRule) {
        return;
      }

      const hasCatchAllAsLastRule = value[value.length - 1]?.conditions === "*";
      if (!hasCatchAllAsLastRule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing catch-all rule with \`conditions: "*"\` at the end`,
        });
      }
    });

  const forceSchema = z
    .array(
      z
        .object({
          conditions: conditionsZodSchema.optional(),
          ...removedConditionFields,
          enabled: z.boolean().optional(),
          variation: variationValueZodSchema.optional(),
          variables: z.record(z.string(), variableValueOrNullZodSchema).optional(),
        })
        .strict()
        .superRefine(refineRequiredConditions),
    )
    .optional();

  const attributeKeyZodSchema = refineWithMessage(
    z.string(),
    (value) => value === "*" || availableAttributeKeys.includes(value),
    (value) => `Unknown attribute "${value}".${suggestKey(value, availableAttributeKeys)}`,
    () => UNKNOWN_REFERENCE,
  );

  const environmentKeys = Array.isArray(projectConfig.environments)
    ? projectConfig.environments
    : [];

  const featureZodSchema = z
    .object({
      archived: z.boolean().optional(),
      deprecated: z.boolean().optional(),
      promotable: z.boolean().optional(),
      description: z.string(),

      tags: z
        .array(
          refineWithMessage(
            z.string(),
            (value) => projectConfig.tags.includes(value),
            (value) => `Unknown tag "${value}"`,
          ),
        )
        .superRefine((value, ctx) => {
          const duplicates = value.filter((tag, index) => value.indexOf(tag) !== index);
          for (const tag of new Set(duplicates)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate tag "${tag}".`,
              params: { code: "duplicate_tag" },
              path: [value.lastIndexOf(tag)],
            });
          }
        })
        .optional(),

      required: z.unknown().optional(),

      conditions: conditionsZodSchema.optional(),
      ...removedConditionFields,

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
          z.string(),
          z
            .object({
              deprecated: z.boolean().optional(),

              // Reference to a reusable schema (mutually exclusive with type/properties/required/items)
              schema: refineWithMessage(
                z.string(),
                (value) => availableSchemaKeys.includes(value),
                (value) => `Unknown schema "${value}"`,
              ).optional(),

              // Inline schema (mutually exclusive with schema)
              type: z.union([z.literal("json"), propertyTypeEnum]).optional(),
              items: schemaZodSchema.optional(),
              properties: z.record(z.string(), schemaZodSchema).optional(),
              additionalProperties: schemaZodSchema.optional(),
              required: z.array(z.string()).optional(),
              enum: z.array(variableValueZodSchema).optional(),
              const: variableValueZodSchema.optional(),
              oneOf: z.array(schemaZodSchema).min(1).optional(),
              minimum: z.number().optional(),
              maximum: z.number().optional(),
              minLength: countZodSchema.optional(),
              maxLength: countZodSchema.optional(),
              pattern: z.string().optional(),
              format: schemaFormatZodSchema.optional(),
              minItems: countZodSchema.optional(),
              maxItems: countZodSchema.optional(),
              uniqueItems: z.boolean().optional(),

              description: z.string().optional(),

              defaultValue: variableValueZodSchema,
              disabledValue: variableValueZodSchema.optional(),

              useDefaultWhenDisabled: z.boolean().optional(),
            })
            .strict()
            .superRefine((variableSchema, ctx) => refineRemovedSchemaType(variableSchema, ctx))
            .superRefine((variableSchema, ctx) =>
              refineSchemaFormat(variableSchema, [], ctx, schemasByKey),
            )
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
                    "Variable schema cannot have both `schema` (reference) and inline properties (`type`, `oneOf`, `properties`, `additionalProperties`, `required`, `items`). Use one or the other.",
                  path: [],
                });
                return;
              }
              if (hasRef) {
                const hasInlineStructure =
                  ("type" in variableSchema && variableSchema.type != null) ||
                  ("properties" in variableSchema && variableSchema.properties != null) ||
                  ("additionalProperties" in variableSchema &&
                    variableSchema.additionalProperties != null) ||
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
                      "When `schema` is set, do not set `type`, `oneOf`, `properties`, `additionalProperties`, `required`, or `items`.",
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
              // Validate required ⊆ properties at this level and in all nested object schemas (resolve refs when schemasByKey provided)
              refineRequiredKeysInSchema(
                variableSchema as SchemaLikeForRequired,
                [],
                ctx,
                schemasByKey,
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
              variables: z.record(z.string(), variableValueOrNullZodSchema).optional(),
              variableOverrides: z.record(z.string(), featureVariableOverridesSchema).optional(),
            })
            .strict(),
        )
        .superRefine((value, ctx) => {
          const variationValues = value.map((v) => v.value);
          if (variationValues.length !== new Set(variationValues).size) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Duplicate variation values found: " + value.map((v) => v.value).join(", "),
            });
          }
        })
        .optional(),

      expose: !Array.isArray(projectConfig.environments)
        ? exposeSchema.optional()
        : z
            .partialRecord(z.enum(environmentKeys as [string, ...string[]]), exposeSchema)
            .optional(),

      force: !Array.isArray(projectConfig.environments)
        ? forceSchema
        : z.partialRecord(z.enum(environmentKeys as [string, ...string[]]), forceSchema).optional(),

      rules: !Array.isArray(projectConfig.environments)
        ? rulesSchema
        : z.partialRecord(z.enum(environmentKeys as [string, ...string[]]), rulesSchema),
    })
    .strict()
    .superRefine((value, ctx) => {
      refineRemovedConditionFields(value, ctx);
      if (Object.prototype.hasOwnProperty.call(value, "required")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Feature `required` has been removed. Use `conditions` and rename each `{ key: ... }` entry to `{ feature: ... }`. Schema property `required` is unchanged.",
          path: ["required"],
        });
      }

      // disabledVariationValue
      if (value.disabledVariationValue !== undefined && value.variations?.length) {
        const variationValues = value.variations.map((v) => v.value);

        if (variationValues.indexOf(value.disabledVariationValue) === -1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Disabled variation value "${value.disabledVariationValue}" is not one of the defined variations: ${variationValues.join(", ")}`,
            path: ["disabledVariationValue"],
          });
        }
      }

      // When variablesSchema is absent, variableSchemaByKey is {} so any variable key used in
      // rules/force/variations will be reported as "not defined in variablesSchema".
      const variableSchemaByKey = value.variablesSchema ?? {};
      const variationValues: string[] = [];

      if (value.variations) {
        value.variations.forEach((variation) => {
          variationValues.push(variation.value);
        });
      }

      // variablesSchema[key] — only when feature defines variablesSchema
      if (value.variablesSchema) {
        const variableKeys = Object.keys(variableSchemaByKey);
        variableKeys.forEach((variableKey) => {
          const variableSchema = variableSchemaByKey[variableKey];

          // When variable references a schema by name, ensure it resolves and validate the referenced schema
          if ("schema" in variableSchema && variableSchema.schema) {
            const resolvedSchema = resolveVariableSchema(
              variableSchema as Parameters<typeof resolveVariableSchema>[0],
              schemasByKey,
            );
            if (!resolvedSchema) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Schema "${variableSchema.schema}" could not be loaded for variable "${variableKey}".`,
                path: ["variablesSchema", variableKey],
              });
            } else {
              refineRequiredKeysInSchema(
                resolvedSchema as SchemaLikeForRequired,
                ["variablesSchema", variableKey],
                ctx,
                schemasByKey,
              );
            }
          }

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

          if ((projectConfig.reservedKeys || DEFAULT_RESERVED_KEYS).includes(variableKey)) {
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
      }

      // variations: validate variation.variables and variation.variableOverrides (each value against its variable schema)
      if (value.variations) {
        value.variations.forEach((variation, variationN) => {
          // variations[n].variableOverrides[key][].value (path-map or full value)
          const baseValues = refineResolvedVariableValues(
            variation.variables,
            variableSchemaByKey,
            ["variations", variationN, "variables"],
            projectConfig,
            ctx,
            schemasByKey,
          );
          if (variation.variableOverrides) {
            refineVariableOverrides({
              ctx,
              variableSchemaByKey,
              variableOverrides: variation.variableOverrides,
              baseValues,
              pathPrefix: ["variations", variationN, "variableOverrides"],
              projectConfig,
              schemasByKey,
            });
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

  const editorConditions = conditionsZodSchema.editorSchema || conditionsZodSchema;
  const editorOverride = z
    .object({
      ...featureVariableOverrideSchema.shape,
      conditions: editorConditions,
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  const editorOverrides = z.record(z.string(), z.array(editorOverride));
  const editorRule = z
    .object({
      ...rulesSchema.element.shape,
      conditions: editorConditions,
      variableOverrides: editorOverrides.optional(),
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  const editorForce = z
    .object({
      conditions: editorConditions,
      enabled: z.boolean().optional(),
      variation: variationValueZodSchema.optional(),
      variables: z.record(z.string(), variableValueOrNullZodSchema).optional(),
    })
    .strict();
  const editorVariation = z
    .object({
      ...featureZodSchema.shape.variations.unwrap().element.shape,
      variableOverrides: editorOverrides.optional(),
    })
    .strict();
  const editorSchema = z
    .object({
      ...featureZodSchema.shape,
      conditions: editorConditions.optional(),
      variations: z.array(editorVariation).optional(),
      rules: !Array.isArray(projectConfig.environments)
        ? z.array(editorRule).min(1)
        : z.partialRecord(
            z.enum(environmentKeys as [string, ...string[]]),
            z.array(editorRule).min(1),
          ),
      force: (!Array.isArray(projectConfig.environments)
        ? z.array(editorForce)
        : z.partialRecord(z.enum(environmentKeys as [string, ...string[]]), z.array(editorForce))
      ).optional(),
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  return Object.assign(featureZodSchema, { editorSchema });
}
