import type { Attribute, AttributeProperty, AssertionMatrix, Schema } from "@featurevisor/types";
import { getPortableTimestamp } from "@featurevisor/sdk";

import { matchesSchemaValue } from "./conditionSchema";
import { getSchemaKind } from "./schemaFormats";
import { applyCombinationToValue, getMatrixCombinations } from "../list/matrix";

type SchemaNode = Attribute | AttributeProperty | Schema;
type ValuePath = Array<string | number>;

export interface ContextWarning {
  attribute: string;
  message: string;
  path: ValuePath;
  value: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return /\${{[^{}]*}}/.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  return isObject(value) && Object.values(value).some(hasPlaceholder);
}

function resolveSchema(
  schema: SchemaNode,
  schemas: Record<string, Schema>,
  seen = new Set<SchemaNode>(),
): SchemaNode | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);
  if ("schema" in schema && schema.schema) {
    const referenced = schemas[schema.schema];
    return referenced ? resolveSchema(referenced, schemas, seen) : undefined;
  }
  return schema;
}

function isResolvable(
  schema: SchemaNode,
  schemas: Record<string, Schema>,
  ancestors = new Set<SchemaNode>(),
): boolean {
  const resolved = resolveSchema(schema, schemas);
  if (!resolved || ancestors.has(resolved)) return false;
  const next = new Set(ancestors).add(resolved);
  const children = [
    ...Object.values(resolved.properties || {}),
    ...(resolved.oneOf || []),
    resolved.items,
    resolved.additionalProperties,
  ].filter((child): child is SchemaNode => !!child && typeof child === "object");
  return children.every((child) => isResolvable(child, schemas, next));
}

function getTypes(schema: SchemaNode, schemas: Record<string, Schema>): string[] {
  const resolved = resolveSchema(schema, schemas);
  if (!resolved) return [];
  if (resolved.oneOf?.length) {
    return Array.from(new Set(resolved.oneOf.flatMap((branch) => getTypes(branch, schemas))));
  }
  const kind = getSchemaKind(resolved);
  return kind ? [kind] : [];
}

function describeKind(kind: string): string {
  return kind === "date-time" || kind === "semver" ? `string with format ${kind}` : kind;
}

function describeValue(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * When a value has the declared type but breaks one of its constraints, name
 * the constraint. Otherwise the warning would blame a type the value has.
 */
function describeConstraintFailure(
  schema: SchemaNode,
  value: unknown,
  schemas: Record<string, Schema>,
): string | undefined {
  if (schema.oneOf?.length || !schema.type) return undefined;
  const typeOnly = {
    type: schema.type,
    ...(schema.format !== undefined && { format: schema.format }),
  } as SchemaNode;
  if (!matchesSchemaValue(typeOnly, value, schemas, true)) return undefined;

  const list = (values: unknown[]) => values.map(describeValue).join(", ");
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    return `is not one of its allowed values: ${list(schema.enum)}`;
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    return `must equal ${describeValue(schema.const)}`;
  }
  if (typeof value === "string") {
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          return `does not match its pattern ${schema.pattern}`;
        }
      } catch {
        // Lint reports invalid patterns on the attribute itself.
      }
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return `is shorter than its minLength of ${schema.minLength}`;
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return `is longer than its maxLength of ${schema.maxLength}`;
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `is below its minimum of ${schema.minimum}`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `is above its maximum of ${schema.maximum}`;
    }
  }
  return "does not satisfy its declared constraints";
}

/** Advisory only. Context and evaluation values are never changed. */
export function getContextWarnings(
  context: unknown,
  attributes: Record<string, Attribute>,
  schemas: Record<string, Schema> = {},
): ContextWarning[] {
  const warnings: ContextWarning[] = [];
  if (!isObject(context)) return warnings;

  function visit(schema: SchemaNode, value: unknown, path: ValuePath): void {
    const resolved = resolveSchema(schema, schemas);
    if (!resolved || !isResolvable(resolved, schemas)) return;
    if (typeof value === "string" && hasPlaceholder(value)) return;
    const deferred = hasPlaceholder(value);
    if (!deferred && matchesSchemaValue(resolved, value, schemas, true)) return;

    const previousCount = warnings.length;
    if (!resolved.oneOf?.length && resolved.type === "object" && isObject(value)) {
      for (const [key, childValue] of Object.entries(value)) {
        const childSchema = Object.prototype.hasOwnProperty.call(resolved.properties || {}, key)
          ? resolved.properties![key]
          : resolved.additionalProperties;
        if (childSchema) visit(childSchema, childValue, [...path, key]);
        else if (resolved.properties) {
          const property = [...path, key].join(".");
          warnings.push({
            attribute: property,
            path: [...path, key],
            value: childValue,
            message: `Context property "${property}" is not declared by attribute "${path.join(".")}".`,
          });
        }
      }
    }
    if (!resolved.oneOf?.length && resolved.type === "array" && Array.isArray(value)) {
      value.forEach((entry, index) =>
        visit(resolved.items || { type: "string" }, entry, [...path, index]),
      );
    }
    if (deferred || warnings.length > previousCount) return;

    const attribute = path.join(".");
    const types = getTypes(resolved, schemas);
    const invalidDate =
      types.length === 1 && types[0] === "date-time" && getPortableTimestamp(value) === null;
    const description = describeValue(value);
    const received = description.length > 80 ? `${description.slice(0, 79)}…` : description;
    const constraint = invalidDate
      ? undefined
      : describeConstraintFailure(resolved, value, schemas);
    warnings.push({
      attribute,
      path,
      value,
      message: invalidDate
        ? `Context value ${received} for "${attribute}" is not a valid date. The before and after operators do not match this value. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.`
        : constraint
          ? `Context value ${received} for "${attribute}" ${constraint}.`
          : `Context value ${received} for "${attribute}" does not match its attribute type "${types.map(describeKind).join(" or ") || "declared schema"}".${
              types.includes("semver") && typeof value === "number"
                ? " YAML reads an unquoted version such as 100.0 as a number. Quote versions."
                : ""
            }`,
    });
  }

  for (const [key, value] of Object.entries(context)) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) visit(attributes[key], value, [key]);
  }
  return warnings;
}

/** Inspect authored context fields, preserving their source paths after matrix expansion. */
export function getTestContextWarnings(
  spec: unknown,
  attributes: Record<string, Attribute>,
  schemas: Record<string, Schema> = {},
  scenario = false,
): ContextWarning[] {
  if (!isObject(spec)) return [];
  const warnings: ContextWarning[] = [];
  const seen = new Set<string>();
  const assertions = scenario ? [spec] : Array.isArray(spec.assertions) ? spec.assertions : [];

  assertions.forEach((assertion, index) => {
    if (!isObject(assertion)) return;
    let combinations: Record<string, unknown>[] = [{}];
    if (assertion.matrix !== undefined) {
      if (!isObject(assertion.matrix) || !Object.keys(assertion.matrix).length) return;
      if (
        Object.values(assertion.matrix).some((values) => !Array.isArray(values) || !values.length)
      )
        return;
      combinations = getMatrixCombinations(assertion.matrix as AssertionMatrix);
    }

    for (const combination of combinations) {
      function expand(value: unknown): unknown {
        if (typeof value === "string") {
          const placeholders = value.match(/\${{[^{}]*}}/g) || [];
          const complete = { ...combination };
          for (const placeholder of placeholders) {
            const key = placeholder.slice(3, -2).trim();
            if (!Object.prototype.hasOwnProperty.call(complete, key)) complete[key] = placeholder;
          }
          return applyCombinationToValue(value, complete);
        }
        if (Array.isArray(value)) return value.map(expand);
        if (isObject(value))
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, expand(entry)]),
          );
        return value;
      }

      function visitContextFields(entry: Record<string, unknown>, path: ValuePath): void {
        for (const warning of getContextWarnings(expand(entry.context), attributes, schemas)) {
          const contextual = { ...warning, path: [...path, "context", ...warning.path] };
          const identity = JSON.stringify([
            contextual.path,
            contextual.message,
            describeValue(contextual.value),
          ]);
          if (!seen.has(identity)) {
            seen.add(identity);
            warnings.push(contextual);
          }
        }
        if (Array.isArray(entry.children)) {
          entry.children.forEach((child, childIndex) => {
            if (isObject(child)) visitContextFields(child, [...path, "children", childIndex]);
          });
        }
      }
      visitContextFields(assertion, scenario ? [] : ["assertions", index]);
    }
  });
  return warnings;
}
