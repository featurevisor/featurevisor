import type { ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import { z } from "zod";
import { suggestKey } from "./diagnostics";
import { getPortableTimestamp, isValidVersion } from "@featurevisor/sdk";
import { formatValueMessage, getSchemaKind, valueMatchesFormat } from "./schemaFormats";
import { getBacktrackingError } from "./regexSafety";

import { resolveVariableSchema } from "./featureSchema";
import { resolveSchemaAtPath } from "./mutationNotation";
import { ProjectConfig } from "../config";
import { findDisallowedOperators } from "./comparisonOperators";
import { getMixedListMessage } from "./listTypes";
import { UNKNOWN_REFERENCE } from "./zodHelpers";

const commonOperators = ["equals", "notEquals"];
const numericOperators = ["greaterThan", "greaterThanOrEquals", "lessThan", "lessThanOrEquals"];
const stringOperators = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "matches",
  "notMatches",
];
const semverOperators = [
  "semverEquals",
  "semverNotEquals",
  "semverGreaterThan",
  "semverGreaterThanOrEquals",
  "semverLessThan",
  "semverLessThanOrEquals",
];
const dateOperators = ["before", "after"];
const membershipOperators = ["in", "notIn"];
const arrayOperators = ["includes", "notIncludes"];
const arrayListOperators = ["includesAny", "notIncludesAny"];
const presenceOperators = ["exists", "notExists", "isNull", "notNull"];
const emptinessOperators = ["empty", "notEmpty"];
const valueLessOperators = [...presenceOperators, ...emptinessOperators];
const allOperators = [
  ...commonOperators,
  ...numericOperators,
  ...stringOperators,
  ...semverOperators,
  ...dateOperators,
  ...membershipOperators,
  ...arrayOperators,
  ...arrayListOperators,
  ...valueLessOperators,
] as [string, ...string[]];
const unsafeSegments = new Set(["__proto__", "prototype", "constructor"]);

type VariableDefinition = ParsedVariable | Record<string, unknown>;

function resolveReferenceSchema(
  definition: VariableDefinition,
  featuresByKey: Record<string, ParsedFeature>,
  variablesByKey: Record<string, ParsedVariable>,
  schemasByKey: Record<string, Schema>,
  visiting = new Set<VariableDefinition>(),
): Schema | null {
  if (!definition.compose) return resolveVariableSchema(definition, schemasByKey) as Schema | null;
  if (visiting.has(definition)) return null;
  visiting.add(definition);
  if (typeof definition.compose === "string") {
    const aliases = new Set<VariableDefinition>();
    let source: VariableDefinition | undefined = definition;
    while (source && typeof source.compose === "string" && !aliases.has(source)) {
      aliases.add(source);
      source = Object.prototype.hasOwnProperty.call(variablesByKey, source.compose)
        ? variablesByKey[source.compose]
        : undefined;
    }
    const selected =
      source && !aliases.has(source)
        ? resolveReferenceSchema(source, featuresByKey, variablesByKey, schemasByKey, visiting)
        : null;
    visiting.delete(definition);
    return selected;
  }
  const properties: Record<string, Schema> = Object.create(null);
  for (const [alias, member] of Object.entries(definition.compose)) {
    if (!member || typeof member !== "object") continue;
    const reference = member as { feature?: string; variable?: string; variation?: true };
    let selected: Schema | null = null;
    if (reference.feature) {
      const feature = Object.prototype.hasOwnProperty.call(featuresByKey, reference.feature)
        ? featuresByKey[reference.feature]
        : undefined;
      if (reference.variable) {
        const source = Object.prototype.hasOwnProperty.call(
          feature?.variablesSchema || {},
          reference.variable,
        )
          ? feature?.variablesSchema?.[reference.variable]
          : undefined;
        if (source) selected = resolveVariableSchema(source, schemasByKey) as Schema | null;
      } else if (reference.variation) {
        const values = [...(feature?.variations?.map((variation) => variation.value) || [])];
        if (feature?.disabledVariationValue !== undefined)
          values.push(feature.disabledVariationValue);
        const unique = [...new Set(values)];
        selected = { type: "string", ...(unique.length > 0 ? { enum: unique } : {}) };
      } else selected = { type: "boolean" };
    } else if (
      reference.variable &&
      Object.prototype.hasOwnProperty.call(variablesByKey, reference.variable)
    ) {
      selected = resolveReferenceSchema(
        variablesByKey[reference.variable],
        featuresByKey,
        variablesByKey,
        schemasByKey,
        visiting,
      );
    }
    properties[alias] = selected || {};
  }
  visiting.delete(definition);
  return { type: "object", properties, required: Object.keys(properties) };
}
type PathPart = string | number;

/**
 * The variable that declares a value a condition reads, and the path to it inside that
 * variable, following aliases and composed members.
 */
function findDeclaringVariable(
  definition: VariableDefinition,
  parts: PathPart[],
  subject: string,
  variablesByKey: Record<string, ParsedVariable>,
): { subject: string; path: PathPart[] } | undefined {
  const readGlobal = (key: string) =>
    Object.prototype.hasOwnProperty.call(variablesByKey, key) ? variablesByKey[key] : undefined;
  let current: VariableDefinition | undefined = definition;
  let declaring = subject;
  let remaining = parts;
  for (let depth = 0; current?.compose && depth < 64; depth++) {
    if (typeof current.compose === "string") {
      declaring = `global variable "${current.compose}"`;
      current = readGlobal(current.compose);
      continue;
    }
    const members = current.compose as Record<string, unknown>;
    const [part, ...rest] = remaining;
    remaining = rest;
    const member =
      part !== undefined && Object.prototype.hasOwnProperty.call(members, String(part))
        ? (members[String(part)] as { feature?: string; variable?: string } | undefined)
        : undefined;
    if (!member || typeof member !== "object" || !member.variable) return undefined;
    if (member.feature)
      return {
        subject: `variable "${member.variable}" of feature "${member.feature}"`,
        path: remaining,
      };
    declaring = `global variable "${member.variable}"`;
    current = readGlobal(member.variable);
  }
  return current && !current.compose ? { subject: declaring, path: remaining } : undefined;
}

const unknownSchema = Symbol("unknownSchema");
const emptinessIncompatibleSchema = Symbol("emptinessIncompatibleSchema");
/**
 * A json value, and the inside of an object without declared properties. Conditions cannot
 * read either, since their contents have no declared types.
 */
const jsonSchema = Symbol("jsonSchema");
const openObjectSchema = Symbol("openObjectSchema");
type ResolvedRequiredVariableSchema =
  | Schema
  | typeof unknownSchema
  | typeof emptinessIncompatibleSchema
  | typeof jsonSchema
  | typeof openObjectSchema;

function portableRegexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
  } catch {
    return "must be a valid regular expression";
  }
  if (/\(\?/.test(pattern)) return "uses unsupported group syntax";
  if (/\\(?:[1-9]|k<|k'|g<|g')/.test(pattern)) return "uses unsupported backreferences";
  if (/(?:[?*+]|\{\d+(?:,\d*)?\})\+/.test(pattern))
    return "uses unsupported possessive quantifiers";
  return getBacktrackingError(pattern);
}

function normalizePath(path: unknown): { parts?: PathPart[]; error?: string } {
  if (typeof path === "undefined") return { parts: [] };
  const parts = typeof path === "string" ? path.split(".") : path;
  if (!Array.isArray(parts)) return { error: "path must be a dot separated string or an array" };
  if (typeof path === "string" && parts.some((part) => part.length === 0)) {
    return { error: "path must not contain empty dot components" };
  }
  const normalized: PathPart[] = [];
  for (const part of parts) {
    if (typeof part === "number") {
      if (!Number.isSafeInteger(part) || part < 0)
        return { error: "path indices must be nonnegative integers" };
      normalized.push(part);
    } else if (typeof part === "string") {
      if (unsafeSegments.has(part))
        return { error: `unsafe path segment "${part}" is not allowed` };
      if (typeof path === "string" && /^(0|[1-9]\d*)$/.test(part)) {
        const index = Number(part);
        if (!Number.isSafeInteger(index))
          return { error: "path indices must be safe nonnegative integers" };
        normalized.push(index);
      } else normalized.push(part);
    } else {
      return { error: "path array entries must be string keys or nonnegative integer indices" };
    }
  }
  return { parts: normalized };
}

function schemaType(schema: Schema): string | undefined {
  return "type" in schema ? schema.type : undefined;
}

function schemaMaySupportEmptiness(schema: Schema, schemasByKey: Record<string, Schema>): boolean {
  const resolved = resolveSchemaAtPath(schema, [], schemasByKey) || schema;
  if ("oneOf" in resolved && Array.isArray(resolved.oneOf)) {
    return resolved.oneOf.some((branch) =>
      schemaMaySupportEmptiness(branch as Schema, schemasByKey),
    );
  }
  return schemaSupportsEmptiness(resolved);
}

function itemSchema(schema: Schema, schemasByKey: Record<string, Schema>): Schema | null {
  if (schemaType(schema) !== "array" || !("items" in schema) || !schema.items) return null;
  return resolveSchemaAtPath(schema, [{ key: "", index: 0 }], schemasByKey);
}

function isCanonicalArrayIndex(part: string): boolean {
  return /^(0|[1-9]\d*)$/.test(part) && Number.isSafeInteger(Number(part));
}

/**
 * Resolves the schema a condition reads. For a json value, or a path reading inside an open
 * object, `untyped.at` is how many path parts lead to that value or object.
 */
function resolveRequiredVariablePath(
  root: Schema,
  parts: PathPart[],
  schemasByKey: Record<string, Schema>,
  untyped: { at?: number } = {},
): ResolvedRequiredVariableSchema | null {
  type Selected = Exclude<ResolvedRequiredVariableSchema, typeof openObjectSchema>;
  const normalizeSelected = (selected: Schema): Selected => {
    const resolved = resolveSchemaAtPath(selected, [], schemasByKey) || selected;
    if (schemaType(resolved) === "json") return jsonSchema;
    if ("oneOf" in resolved) {
      return schemaMaySupportEmptiness(resolved, schemasByKey)
        ? unknownSchema
        : emptinessIncompatibleSchema;
    }
    return resolved;
  };
  let current: Selected = normalizeSelected(root);

  for (const [index, part] of parts.entries()) {
    if (current === jsonSchema) {
      untyped.at = index;
      return current;
    }
    if (current === unknownSchema || current === emptinessIncompatibleSchema) continue;
    const type = schemaType(current);
    if (!type) {
      current = unknownSchema;
      continue;
    }
    if (type === "array") {
      if (part === "length") {
        current = { type: "integer", minimum: 0 } as Schema;
        continue;
      }
      if (typeof part !== "number" && !isCanonicalArrayIndex(part)) return null;
      current = itemSchema(current, schemasByKey) || unknownSchema;
      continue;
    }
    if (type !== "object" || typeof part !== "string") return null;
    const properties = "properties" in current ? current.properties : undefined;
    const additional = (current as { additionalProperties?: unknown }).additionalProperties;
    if (properties && typeof properties === "object" && properties[part]) {
      current = normalizeSelected(properties[part] as Schema);
    } else if (additional && typeof additional === "object") {
      current = normalizeSelected(additional as Schema);
    } else if (additional === true || (!properties && typeof additional === "undefined")) {
      // The object itself is typed, so presence and emptiness still apply. Its members are not.
      untyped.at = index;
      return openObjectSchema;
    } else {
      return null;
    }
  }
  const selected =
    current === unknownSchema || current === emptinessIncompatibleSchema || current === jsonSchema
      ? current
      : normalizeSelected(current);
  if (selected === jsonSchema) untyped.at = parts.length;
  return selected;
}

function valueMatchesOperandType(schema: Schema, value: unknown): boolean {
  const type = schemaType(schema);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** Literal operands must satisfy the referenced string format. */
function validateFormatOperand(
  schema: Schema,
  value: unknown,
  ctx: z.RefinementCtx,
  path: PathPart[],
): void {
  if (value === null || typeof value !== "string") return;
  const format = "format" in schema ? schema.format : undefined;
  if (schemaType(schema) === "string" && format && !valueMatchesFormat(format, value)) {
    addValueIssue(
      ctx,
      format === "date-time"
        ? "Value must be a valid ISO 8601 timestamp for the referenced variable schema."
        : formatValueMessage(format),
      path,
    );
  }
}

function schemaSupportsEmptiness(schema: Schema): boolean {
  const type = schemaType(schema);
  if (getSchemaKind(schema) === "date-time") return false;
  return typeof type === "undefined" || ["string", "array", "object", "json"].includes(type);
}

// A date-time value compares as a time, never as text, matching date-time attributes.
const dateTimeOperators = [...dateOperators, ...presenceOperators];

/** Params that make lint report an issue as a warning */
const WARNING = { warning: true };

function addValueIssue(
  ctx: z.RefinementCtx,
  message: string,
  path: PathPart[] = ["value"],
  params?: Record<string, unknown>,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message, path, ...(params ? { params } : {}) });
}

function validateOperand(
  leaf: { operator: string; value?: unknown; regexFlags?: string },
  schema: Schema,
  schemasByKey: Record<string, Schema>,
  ctx: z.RefinementCtx,
): void {
  const { operator, value } = leaf;
  const type = schemaType(schema);
  const kind = getSchemaKind(schema);
  if (kind === "date-time" && !dateTimeOperators.includes(operator)) {
    addValueIssue(
      ctx,
      emptinessOperators.includes(operator)
        ? `Operator "${operator}" cannot be used with a date-time variable. Use exists or notNull to check that a date was set.`
        : `Operator "${operator}" cannot be used with a date-time variable. Compare dates with before or after. To compare it as text too, declare it as a plain string without a format.`,
      ["operator"],
    );
    return;
  }
  if (commonOperators.includes(operator)) validateFormatOperand(schema, value, ctx, ["value"]);
  if (membershipOperators.includes(operator) && Array.isArray(value))
    value.forEach((entry, index) => validateFormatOperand(schema, entry, ctx, ["value", index]));
  if (presenceOperators.includes(operator)) {
    if (typeof value !== "undefined")
      addValueIssue(ctx, `when operator is "${operator}", value is not needed`);
  } else if (emptinessOperators.includes(operator)) {
    if (typeof value !== "undefined")
      addValueIssue(ctx, `when operator is "${operator}", value is not needed`);
    if (!schemaSupportsEmptiness(schema))
      addValueIssue(ctx, `Operator "${operator}" requires a string, array or object variable.`);
  } else if (commonOperators.includes(operator)) {
    if (value !== null) {
      if (["object", "array"].includes(type || ""))
        addValueIssue(ctx, `Operator "${operator}" does not support deep equality.`);
      else if (typeof value === "undefined" || !valueMatchesOperandType(schema, value))
        addValueIssue(ctx, "Value type does not match the referenced variable type.");
    }
  } else if (numericOperators.includes(operator)) {
    if (!["integer", "number"].includes(type || ""))
      addValueIssue(ctx, `Operator "${operator}" requires a numeric variable.`);
    if (typeof value !== "number")
      addValueIssue(ctx, `when operator is "${operator}", value must be a number`);
  } else if (stringOperators.includes(operator)) {
    if (type !== "string") addValueIssue(ctx, `Operator "${operator}" requires a string variable.`);
    if (typeof value !== "string")
      addValueIssue(ctx, `when operator is "${operator}", value must be a string`);
  } else if (semverOperators.includes(operator)) {
    if (type !== "string") addValueIssue(ctx, `Operator "${operator}" requires a string variable.`);
    if (typeof value !== "string")
      addValueIssue(ctx, `when operator is "${operator}", value must be a string`);
    else if (!isValidVersion(value))
      addValueIssue(
        ctx,
        `when operator is "${operator}", value must be a version the operators can compare, such as 5.5.0, 5.5 or v5.5.0`,
      );
  } else if (dateOperators.includes(operator)) {
    if (type !== "string") addValueIssue(ctx, `Operator "${operator}" requires a string variable.`);
    if (typeof value !== "string" || getPortableTimestamp(value) === null)
      addValueIssue(
        ctx,
        `when operator is "${operator}", use an ISO 8601 timestamp YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm and optional 1 to 9 fractional digits, for example 2026-11-27T00:00:00.123456Z`,
      );
  } else if (membershipOperators.includes(operator)) {
    if (["object", "array", "boolean"].includes(type || ""))
      addValueIssue(
        ctx,
        `Operator "${operator}" requires a string, number or null value. Use equals or notEquals for booleans.`,
      );
    if (!Array.isArray(value))
      addValueIssue(ctx, `when operator is "${operator}", value must be an array`);
    else {
      let entryIssue = false;
      value.forEach((entry, index) => {
        if (
          entry !== null &&
          (typeof entry === "boolean" || !valueMatchesOperandType(schema, entry))
        ) {
          entryIssue = true;
          addValueIssue(ctx, "Value type does not match the referenced variable type.", [
            "value",
            index,
          ]);
        }
      });
      const mixed = !entryIssue && getMixedListMessage(operator, value);
      if (mixed) addValueIssue(ctx, mixed, ["value"], WARNING);
    }
  } else if ([...arrayOperators, ...arrayListOperators].includes(operator)) {
    const items = itemSchema(schema, schemasByKey);
    if (!items || ["object", "array"].includes(schemaType(items) || ""))
      addValueIssue(ctx, `Operator "${operator}" requires an array of primitive values.`);
    else if (arrayListOperators.includes(operator)) {
      if (!Array.isArray(value))
        addValueIssue(
          ctx,
          `when operator is "${operator}", value must be an array of primitive values`,
        );
      else {
        let entryIssue = false;
        value.forEach((entry, index) => {
          validateFormatOperand(items, entry, ctx, ["value", index]);
          if (
            !valueMatchesOperandType(items, entry) ||
            (typeof entry === "number" && !Number.isFinite(entry))
          ) {
            entryIssue = true;
            addValueIssue(ctx, "Value type does not match the referenced variable item type.", [
              "value",
              index,
            ]);
          }
        });
        const mixed = !entryIssue && getMixedListMessage(operator, value);
        if (mixed) addValueIssue(ctx, mixed, ["value"], WARNING);
      }
    } else {
      validateFormatOperand(items, value, ctx, ["value"]);
      if (typeof value === "undefined" || !valueMatchesOperandType(items, value))
        addValueIssue(ctx, "Value type does not match the referenced variable item type.");
    }
  }

  if (["matches", "notMatches"].includes(operator)) {
    if (typeof value === "string") {
      const error = portableRegexError(value);
      if (error) addValueIssue(ctx, `Regular expression ${error}.`);
    }
  } else if (leaf.regexFlags) {
    addValueIssue(ctx, "regexFlags are only allowed with matches or notMatches.", ["regexFlags"]);
  }
}

function validateUnknownOperand(
  leaf: { operator: string; value?: unknown; regexFlags?: string },
  ctx: z.RefinementCtx,
): void {
  const { operator, value } = leaf;
  const primitive = value === null || ["string", "number", "boolean"].includes(typeof value);
  if (valueLessOperators.includes(operator)) {
    if (typeof value !== "undefined")
      addValueIssue(ctx, `when operator is "${operator}", value is not needed`);
  } else if (commonOperators.includes(operator)) {
    if (typeof value === "undefined" || !primitive)
      addValueIssue(
        ctx,
        `Operator "${operator}" requires a primitive or null value and does not support deep equality.`,
      );
  } else if (numericOperators.includes(operator) && typeof value !== "number") {
    addValueIssue(ctx, `when operator is "${operator}", value must be a number`);
  } else if (
    [...stringOperators, ...semverOperators].includes(operator) &&
    typeof value !== "string"
  ) {
    addValueIssue(ctx, `when operator is "${operator}", value must be a string`);
  } else if (semverOperators.includes(operator) && !isValidVersion(value)) {
    addValueIssue(
      ctx,
      `when operator is "${operator}", value must be a version the operators can compare, such as 5.5.0, 5.5 or v5.5.0`,
    );
  } else if (
    dateOperators.includes(operator) &&
    (typeof value !== "string" || getPortableTimestamp(value) === null)
  ) {
    addValueIssue(
      ctx,
      `when operator is "${operator}", use an ISO 8601 timestamp YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm and optional 1 to 9 fractional digits, for example 2026-11-27T00:00:00.123456Z`,
    );
  } else if (arrayListOperators.includes(operator)) {
    if (!Array.isArray(value))
      addValueIssue(
        ctx,
        `when operator is "${operator}", value must be an array of primitive values`,
      );
    else {
      let entryIssue = false;
      value.forEach((entry, index) => {
        if (
          (entry !== null && !["string", "number", "boolean"].includes(typeof entry)) ||
          (typeof entry === "number" && !Number.isFinite(entry))
        ) {
          entryIssue = true;
          addValueIssue(ctx, "Each candidate must be a string, number, boolean or null.", [
            "value",
            index,
          ]);
        }
      });
      // The value's type is unknown to lint, so the list's own types have to agree.
      const mixed = !entryIssue && getMixedListMessage(operator, value);
      if (mixed) addValueIssue(ctx, mixed, ["value"], WARNING);
    }
  } else if (membershipOperators.includes(operator)) {
    if (
      !Array.isArray(value) ||
      !value.every((entry) => entry === null || ["string", "number"].includes(typeof entry))
    ) {
      addValueIssue(
        ctx,
        `when operator is "${operator}", value must be an array of strings, numbers or null`,
      );
    } else {
      const mixed = getMixedListMessage(operator, value);
      if (mixed) addValueIssue(ctx, mixed, ["value"], WARNING);
    }
  } else if (arrayOperators.includes(operator) && (typeof value === "undefined" || !primitive)) {
    addValueIssue(ctx, `when operator is "${operator}", value must be primitive or null`);
  }

  if (["matches", "notMatches"].includes(operator)) {
    if (typeof value === "string") {
      const error = portableRegexError(value);
      if (error) addValueIssue(ctx, `Regular expression ${error}.`);
    }
  } else if (leaf.regexFlags) {
    addValueIssue(ctx, "regexFlags are only allowed with matches or notMatches.", ["regexFlags"]);
  }
}

export function getVariableConditionZodSchema(
  featuresByKey: Record<string, ParsedFeature>,
  variablesByKey: Record<string, ParsedVariable>,
  schemasByKey: Record<string, Schema> = {},
  projectConfig?: Pick<ProjectConfig, "disallowOperators">,
) {
  const leafSchema = z
    .object({
      feature: z.string().min(1).optional(),
      variable: z.string().min(1),
      path: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional(),
      operator: z.enum(allOperators),
      value: z.unknown().optional(),
      regexFlags: z
        .string()
        .regex(/^[gims]+$/, "regexFlags may only contain g, i, m and s")
        .refine(
          (value) => new Set(value).size === value.length,
          "regexFlags must not contain duplicates",
        )
        .optional(),
    })
    .strict()
    .superRefine((leaf, ctx) => {
      for (const issue of findDisallowedOperators(
        leaf,
        projectConfig?.disallowOperators || [],
        [],
      )) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: `Operator "${issue.operator}" is disallowed by project configuration.`,
        });
      }
      let definition: VariableDefinition | undefined;
      if (leaf.feature) {
        const feature = Object.prototype.hasOwnProperty.call(featuresByKey, leaf.feature)
          ? featuresByKey[leaf.feature]
          : undefined;
        if (!feature) {
          addValueIssue(
            ctx,
            `Unknown feature "${leaf.feature}".${suggestKey(leaf.feature, Object.keys(featuresByKey))}`,
            ["feature"],
            UNKNOWN_REFERENCE,
          );
          return;
        } else
          definition = Object.prototype.hasOwnProperty.call(
            feature.variablesSchema || {},
            leaf.variable,
          )
            ? (feature.variablesSchema?.[leaf.variable] as VariableDefinition | undefined)
            : undefined;
      } else {
        definition = Object.prototype.hasOwnProperty.call(variablesByKey, leaf.variable)
          ? variablesByKey[leaf.variable]
          : undefined;
      }
      if (!definition) {
        // reading "enabled" usually means the feature's own state, which takes no variable
        const state =
          leaf.feature && ["enabled", "isEnabled"].includes(leaf.variable)
            ? ` To require feature "${leaf.feature}" to be enabled, leave out "variable".`
            : "";
        addValueIssue(
          ctx,
          `Unknown ${leaf.feature ? "feature " : "global "}variable "${leaf.variable}".${state}`,
          ["variable"],
          UNKNOWN_REFERENCE,
        );
        return;
      }
      const root = resolveReferenceSchema(definition, featuresByKey, variablesByKey, schemasByKey);
      if (!root) return;
      const normalized = normalizePath(leaf.path);
      if (normalized.error) {
        addValueIssue(ctx, normalized.error, ["path"]);
        return;
      }
      const parts = normalized.parts || [];
      const untyped: { at?: number } = {};
      const selected = resolveRequiredVariablePath(root, parts, schemasByKey, untyped);
      if (!selected) {
        addValueIssue(ctx, "Path does not exist in the referenced variable schema.", ["path"]);
        return;
      }
      if (selected === jsonSchema || selected === openObjectSchema) {
        const subject = leaf.feature
          ? `variable "${leaf.variable}" of feature "${leaf.feature}"`
          : `global variable "${leaf.variable}"`;
        const json = selected === jsonSchema;
        const fix = json
          ? "a declared shape, such as type object with properties,"
          : "properties, or additionalProperties for a map,";
        // A variable that is itself untyped is reshaped in place. Otherwise name the variable
        // declaring the untyped value, reached through a path, an alias or a composed member.
        const direct = !definition.compose && untyped.at === 0;
        const what = json ? "json values" : "inside objects without declared properties";
        const declaring = findDeclaringVariable(
          definition,
          parts.slice(0, untyped.at),
          subject,
          variablesByKey,
        );
        const location = !declaring
          ? json
            ? "its json source"
            : "the object it reads"
          : declaring.path.length > 0
            ? `"${declaring.path.join(".")}" in ${declaring.subject}`
            : declaring.subject;
        addValueIssue(
          ctx,
          direct
            ? `Conditions cannot read ${json ? "json variables" : what}, since their contents have no declared types. Give ${subject} ${fix} to use it here.`
            : `Conditions cannot read ${what}, since their contents have no declared types, and this condition reads ${json ? "one" : "inside one"} through ${subject}. Give ${location} ${fix} to use it here.`,
          [typeof leaf.path === "undefined" || (direct && json) ? "variable" : "path"],
          // conditions like this passed lint before, so it warns until the next major version
          WARNING,
        );
        return;
      }
      if (selected === emptinessIncompatibleSchema && emptinessOperators.includes(leaf.operator)) {
        addValueIssue(
          ctx,
          `Operator "${leaf.operator}" requires a string, array or object variable.`,
        );
      } else if (selected === unknownSchema || selected === emptinessIncompatibleSchema) {
        validateUnknownOperand(leaf, ctx);
      } else validateOperand(leaf, selected, schemasByKey, ctx);
    });

  return leafSchema;
}
