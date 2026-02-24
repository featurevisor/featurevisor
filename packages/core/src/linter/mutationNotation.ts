import type { Schema } from "@featurevisor/types";

import { parseNotation, type MutationOperation, type PathPart } from "../builder/mutator";

export type { MutationOperation, PathPart };
export type PathSegment = PathPart;

const OPERATION_SUFFIX = /:((?:append|prepend|after|before|remove))$/;

export interface ParsedMutationKey {
  rootKey: string;
  pathSegments: PathSegment[];
  allSegments: PathSegment[];
  operation: MutationOperation;
}

/**
 * Returns true if the key looks like mutation notation (contains path or operation).
 */
export function isMutationKey(key: string): boolean {
  const k = key.trim();
  return k.includes(".") || k.includes("[") || OPERATION_SUFFIX.test(k);
}

/**
 * Parse a full variable key (e.g. "config.width", "items[1].name", "tags:append")
 * into root variable name, path segments within the variable, and operation.
 * Uses the shared parseNotation from the mutator.
 */
export function parseMutationKey(key: string): ParsedMutationKey | null {
  const rest = key.trim();
  if (!rest) return null;

  const { segments, operation } = parseNotation(rest);
  const rootKey = segments.length > 0 && "key" in segments[0] ? segments[0].key : "";
  const first = segments[0];
  const firstPathPart: PathSegment[] =
    first && ("index" in first || "selector" in first)
      ? [
          "index" in first
            ? { key: "", index: first.index }
            : { key: "", selector: first.selector! },
        ]
      : [];
  const pathWithinVariable = firstPathPart.concat(segments.slice(1));
  return { rootKey, pathSegments: pathWithinVariable, allSegments: segments, operation };
}

/**
 * Resolve a schema reference (schema.schema -> schemasByKey[name]).
 * Follows one level of reference; the resolved schema may itself have oneOf or another ref.
 */
function resolveSchemaRef(
  schema: Schema | null,
  schemasByKey: Record<string, Schema> | undefined,
): Schema | null {
  if (!schema || typeof schema !== "object") return null;
  if (schema.schema && schemasByKey?.[schema.schema]) {
    return resolveSchemaRef(schemasByKey[schema.schema], schemasByKey);
  }
  return schema;
}

/**
 * Return true if the schema is a oneOf (multiple possible shapes); path resolution cannot descend through oneOf.
 */
function isOneOfSchema(schema: Schema): boolean {
  return Array.isArray(schema.oneOf) && schema.oneOf.length > 0;
}

/**
 * Resolve the schema at a path within a variable schema.
 * pathSegments are the path *within* the variable (e.g. for variable "config", path [ {key:"width"} ];
 * for variable "items", path [ {index:0}, {key:"name"} ]).
 * Returns the schema at that path, or null if the path is invalid.
 * Does not descend through oneOf (path through oneOf is considered invalid for mutation targets).
 */
export function resolveSchemaAtPath(
  variableSchema: Schema | null,
  pathSegments: PathSegment[],
  schemasByKey?: Record<string, Schema>,
): Schema | null {
  let current: Schema | null = resolveSchemaRef(variableSchema, schemasByKey);
  if (!current) return null;

  for (const seg of pathSegments) {
    if (isOneOfSchema(current)) return null;
    if (seg.key) {
      if (current.type !== "object") return null;
      const props = current.properties;
      if (!props || typeof props !== "object") return null;
      const next = props[seg.key];
      if (next === undefined) return null;
      current = resolveSchemaRef(next, schemasByKey);
      if (!current) return null;
    }
    if ("index" in seg || "selector" in seg) {
      if (current.type !== "array") return null;
      const itemSchema = current.items;
      if (!itemSchema || typeof itemSchema !== "object") return null;
      current = resolveSchemaRef(itemSchema, schemasByKey);
      if (!current) return null;
    }
  }
  return current;
}

/**
 * Return the schema of the container at the end of path (object or array) and the last segment.
 * Used to check if we can do append/prepend (must be array) or remove (object key or array element).
 * Does not descend through oneOf.
 */
function getContainerSchemaAtPath(
  variableSchema: Schema | null,
  pathSegments: PathSegment[],
  schemasByKey?: Record<string, Schema>,
): { containerSchema: Schema; lastSegment: PathSegment; parentSchema: Schema } | null {
  if (pathSegments.length === 0) {
    const resolved = variableSchema ? resolveSchemaRef(variableSchema, schemasByKey) : null;
    return resolved
      ? { containerSchema: resolved, lastSegment: { key: "" }, parentSchema: resolved }
      : null;
  }
  let current: Schema | null = resolveSchemaRef(variableSchema, schemasByKey);
  if (!current) return null;
  const pathWithoutLast = pathSegments.slice(0, -1);
  const lastSegment = pathSegments[pathSegments.length - 1];
  for (const seg of pathWithoutLast) {
    if (isOneOfSchema(current)) return null;
    if ("index" in seg || "selector" in seg) {
      if (current.type !== "array") return null;
      const itemSchema = current.items;
      if (!itemSchema || typeof itemSchema !== "object") return null;
      current = resolveSchemaRef(itemSchema, schemasByKey);
    } else {
      if (current.type !== "object") return null;
      const props = current.properties;
      if (!props || typeof props !== "object") return null;
      const next = props[seg.key];
      if (next === undefined) return null;
      current = resolveSchemaRef(next, schemasByKey);
    }
    if (!current) return null;
  }
  if (!current) return null;
  const parentSchema = current;
  if ("index" in lastSegment || "selector" in lastSegment) {
    return { containerSchema: parentSchema, lastSegment, parentSchema };
  }
  const propSchema = parentSchema.properties?.[lastSegment.key];
  const resolvedProp =
    propSchema && typeof propSchema === "object" ? resolveSchemaRef(propSchema, schemasByKey) : null;
  return resolvedProp ? { containerSchema: resolvedProp, lastSegment, parentSchema } : null;
}

export interface MutationValidationResult {
  valid: boolean;
  rootKey: string;
  pathSegments: PathSegment[];
  operation: MutationOperation;
  valueSchema: Schema | null;
  error?: string;
}

/**
 * Validate mutation key against variable schema: root exists, path valid, operation allowed.
 * Returns valueSchema to validate the value against (for set: schema at path; for append/prepend/after/before: item schema).
 * Uses Schema from @featurevisor/types; validates required (no :remove on required props) and does not allow path through oneOf.
 */
export function validateMutationKey(
  key: string,
  variableSchemaByKey: Record<string, Schema>,
  schemasByKey?: Record<string, Schema>,
): MutationValidationResult {
  const parsed = parseMutationKey(key);
  if (!parsed) {
    return {
      valid: false,
      rootKey: "",
      pathSegments: [],
      operation: "set",
      valueSchema: null,
      error: `Invalid mutation notation: "${key}"`,
    };
  }
  const { rootKey, pathSegments, operation } = parsed;
  if (!rootKey) {
    return {
      valid: false,
      rootKey: "",
      pathSegments: [],
      operation,
      valueSchema: null,
      error: `Mutation key must start with a variable name: "${key}"`,
    };
  }
  const variableSchema = variableSchemaByKey[rootKey];
  if (!variableSchema) {
    return {
      valid: false,
      rootKey,
      pathSegments,
      operation,
      valueSchema: null,
      error: `Variable "${rootKey}" is not defined in \`variablesSchema\`.`,
    };
  }
  const resolvedRoot = resolveSchemaRef(variableSchema, schemasByKey);
  if (!resolvedRoot) {
    const refName =
      variableSchema && typeof variableSchema === "object" && "schema" in variableSchema
        ? (variableSchema as { schema?: string }).schema
        : undefined;
    return {
      valid: false,
      rootKey,
      pathSegments,
      operation,
      valueSchema: null,
      error:
        refName != null
          ? `Schema "${refName}" could not be loaded for variable "${rootKey}".`
          : `Could not resolve schema for variable "${rootKey}".`,
    };
  }
  if (pathSegments.length > 0 && isOneOfSchema(resolvedRoot)) {
    return {
      valid: false,
      rootKey,
      pathSegments,
      operation,
      valueSchema: null,
      error: `Cannot mutate path into variable "${rootKey}" (root schema is \`oneOf\`; path resolution not defined).`,
    };
  }

  const container = getContainerSchemaAtPath(variableSchema, pathSegments, schemasByKey);
  const valueSchemaAtPath = resolveSchemaAtPath(variableSchema, pathSegments, schemasByKey);

  switch (operation) {
    case "append":
    case "prepend": {
      if (!container) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Path "${key}" is invalid for variable "${rootKey}" (path does not exist in schema).`,
        };
      }
      const arrResolved = container.containerSchema;
      if (!arrResolved || arrResolved.type !== "array") {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Operation ":${operation}" is only allowed on array variables or object properties of type array; path "${key}" does not point to an array.`,
        };
      }
      if (isOneOfSchema(arrResolved)) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Operation ":${operation}" is not allowed when array \`items\` is \`oneOf\` (path "${key}").`,
        };
      }
      const itemSchema =
        arrResolved.items && typeof arrResolved.items === "object"
          ? resolveSchemaRef(arrResolved.items, schemasByKey)
          : null;
      return {
        valid: true,
        rootKey,
        pathSegments,
        operation,
        valueSchema: itemSchema,
      };
    }
    case "after":
    case "before":
    case "remove": {
      if (!container) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Path "${key}" is invalid for variable "${rootKey}" (path does not exist in schema).`,
        };
      }
      const last = container.lastSegment;
      if ("index" in last || "selector" in last) {
        if (container.parentSchema.type !== "array") {
          return {
            valid: false,
            rootKey,
            pathSegments,
            operation,
            valueSchema: null,
            error: `Operation ":${operation}" with array index/selector is only allowed on arrays; path "${key}" does not point to an array element.`,
          };
        }
        if (operation === "after" || operation === "before") {
          const parentItems = container.parentSchema.items;
          if (parentItems && typeof parentItems === "object" && isOneOfSchema(parentItems)) {
            return {
              valid: false,
              rootKey,
              pathSegments,
              operation,
              valueSchema: null,
              error: `Operation ":${operation}" is not allowed when array \`items\` is \`oneOf\` (path "${key}").`,
            };
          }
          const itemSchema =
            parentItems && typeof parentItems === "object"
              ? resolveSchemaRef(parentItems, schemasByKey)
              : null;
          return { valid: true, rootKey, pathSegments, operation, valueSchema: itemSchema };
        }
        return { valid: true, rootKey, pathSegments, operation, valueSchema: null };
      }
      if (container.parentSchema.type !== "object") {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Operation ":${operation}" on a property is only allowed on objects; path "${key}" does not point to an object property.`,
        };
      }
      const requiredKeys = container.parentSchema.required;
      if (
        operation === "remove" &&
        Array.isArray(requiredKeys) &&
        requiredKeys.includes(last.key)
      ) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Cannot remove required property "${last.key}" from variable "${rootKey}" (listed in schema \`required\`).`,
        };
      }
      return { valid: true, rootKey, pathSegments, operation, valueSchema: null };
    }
    case "set": {
      if (valueSchemaAtPath === null && pathSegments.length > 0) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Path "${key}" is invalid for variable "${rootKey}" (path does not exist in schema).`,
        };
      }
      if (valueSchemaAtPath && isOneOfSchema(valueSchemaAtPath)) {
        return {
          valid: false,
          rootKey,
          pathSegments,
          operation,
          valueSchema: null,
          error: `Cannot set value at path "${key}" (target schema is \`oneOf\`; mutation target must be a single schema).`,
        };
      }
      return {
        valid: true,
        rootKey,
        pathSegments,
        operation,
        valueSchema: valueSchemaAtPath,
      };
    }
    default:
      return {
        valid: true,
        rootKey,
        pathSegments,
        operation,
        valueSchema: valueSchemaAtPath,
      };
  }
}

/**
 * Parse a path-map key (relative to a variable) into path segments for resolveSchemaAtPath.
 * e.g. "display.fontSize" -> [{key:"display"},{key:"fontSize"}], "[0].name" -> [{key:"",index:0},{key:"name"}].
 */
export function parsePathMapKey(relativePath: string): PathSegment[] | null {
  const parsed = parseMutationKey(relativePath);
  if (!parsed) return null;
  return parsed.allSegments.length > 0 ? parsed.allSegments : null;
}
