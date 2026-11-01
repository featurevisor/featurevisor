import type {
  Attribute,
  AttributeProperty,
  Conditions,
  ParsedFeature,
  ParsedVariable,
  Schema,
} from "@featurevisor/types";
import { z } from "zod";
import { getPortableTimestamp, isValidVersion } from "@featurevisor/sdk";
import { getBacktrackingError } from "./regexSafety";
import { getSchemaKind, valueMatchesFormat } from "./schemaFormats";

import { ProjectConfig } from "../config";
import { refineWithMessage, UNKNOWN_REFERENCE } from "./zodHelpers";
import { diagnosticParseOptions, suggestKey } from "./diagnostics";
import { findDisallowedOperators } from "./comparisonOperators";
import { getMixedListMessage } from "./listTypes";
import { getFeatureConditionZodSchema } from "./requiredFeaturesSchema";
import { getVariableConditionZodSchema } from "./requiredVariablesSchema";

const commonOperators: [string, ...string[]] = ["equals", "notEquals"];
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
const arrayMembershipOperators = ["in", "notIn"];
const arrayOperators = ["includes", "notIncludes"];
const arrayListOperators = ["includesAny", "notIncludesAny"];
const emptinessOperators = ["empty", "notEmpty"];
const operatorsWithoutValue = ["exists", "notExists", "isNull", "notNull", ...emptinessOperators];
const emptinessTypes = ["primitive", "string", "semver", "date-time", "array", "object", "json"];

type SchemaNode = Attribute | AttributeProperty | Schema;
type ResolvedLeaf =
  | { kind: "schema"; schema: SchemaNode }
  | { kind: "flat-object-property" }
  | { kind: "flat-array-item" };

function isIsoDateString(value: string): boolean {
  return getPortableTimestamp(value) !== null;
}

function isPrimitiveAttributeValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** `in` and `notIn` compare with string attributes, or with integer and number attributes. */
function supportsMembership(types: string[]): boolean {
  return (
    types.length > 0 &&
    (types.every((type) => type === "string") ||
      types.every((type) => type === "integer" || type === "number"))
  );
}

/** A list of strings or of numbers, with null allowed beside either. */
function isMembershipList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  );
}

function getPortableRegexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
  } catch {
    return "must be a valid regular expression";
  }

  if (/\(\?/.test(pattern)) {
    return "must not use lookaround, named groups, noncapturing groups, atomic groups, or inline mode groups";
  }
  if (/\\(?:[1-9]|k<|k'|g<|g')/.test(pattern)) {
    return "must not use backreferences";
  }
  if (/(?:[?*+]|\{\d+(?:,\d*)?\})\+/.test(pattern)) {
    return "must not use possessive quantifiers";
  }

  return null;
}

function valueDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((value, index) => valueDeepEqual(value, b[index]));
    }

    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) {
      return false;
    }

    return keysA.every((key) =>
      valueDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }

  return false;
}

function resolveSchemaRefs(schema: SchemaNode, schemasByKey: Record<string, Schema>): SchemaNode {
  if ("schema" in schema && schema.schema && schemasByKey[schema.schema]) {
    return resolveSchemaRefs(schemasByKey[schema.schema], schemasByKey);
  }

  return schema;
}

function getLeafType(resolvedLeaf: ResolvedLeaf): string | undefined {
  if (resolvedLeaf.kind === "flat-object-property" || resolvedLeaf.kind === "flat-array-item") {
    return "primitive";
  }

  return getSchemaKind(resolvedLeaf.schema);
}

function getLeafTypes(resolvedLeaf: ResolvedLeaf, schemasByKey: Record<string, Schema>): string[] {
  if (resolvedLeaf.kind === "flat-object-property" || resolvedLeaf.kind === "flat-array-item") {
    return ["primitive"];
  }

  const resolved = resolveSchemaRefs(resolvedLeaf.schema, schemasByKey) as SchemaNode & {
    type?: string;
    format?: string;
    oneOf?: unknown[];
  };

  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return Array.from(
      new Set(
        resolved.oneOf.flatMap((branch) =>
          getLeafTypes({ kind: "schema", schema: branch as SchemaNode }, schemasByKey),
        ),
      ),
    );
  }

  const kind = getSchemaKind(resolved);
  return kind ? [kind] : [];
}

function resolveAttributePath(
  attributePath: string,
  attributesByKey: Record<string, Attribute>,
  schemasByKey: Record<string, Schema>,
): ResolvedLeaf | null {
  const [rootKey, ...rest] = attributePath.split(".");
  const rootAttribute = Object.prototype.hasOwnProperty.call(attributesByKey, rootKey)
    ? attributesByKey[rootKey]
    : undefined;

  if (!rootAttribute) {
    return null;
  }

  let current: SchemaNode = rootAttribute;

  if (rest.length === 0) {
    return { kind: "schema", schema: resolveSchemaRefs(current, schemasByKey) };
  }

  for (let index = 0; index < rest.length; index++) {
    const segment = rest[index];
    current = resolveSchemaRefs(current, schemasByKey);
    const type = "type" in current ? current.type : undefined;

    if (type !== "object") {
      return null;
    }

    if ("oneOf" in current && Array.isArray(current.oneOf) && current.oneOf.length > 0) {
      return null;
    }

    const properties = "properties" in current ? current.properties : undefined;
    const additionalProperties =
      "additionalProperties" in current ? current.additionalProperties : undefined;

    if (
      properties &&
      typeof properties === "object" &&
      Object.prototype.hasOwnProperty.call(properties, segment)
    ) {
      current = properties[segment];
      continue;
    }

    if (additionalProperties && typeof additionalProperties === "object") {
      current = additionalProperties;
      continue;
    }

    if (!properties && !additionalProperties) {
      return index === rest.length - 1 ? { kind: "flat-object-property" } : null;
    }

    return null;
  }

  return { kind: "schema", schema: resolveSchemaRefs(current, schemasByKey) };
}

export function matchesSchemaValue(
  schema: SchemaNode,
  value: unknown,
  schemasByKey: Record<string, Schema>,
  nativeDates = false,
): boolean {
  const resolved = resolveSchemaRefs(schema, schemasByKey) as SchemaNode & {
    type?: string;
    enum?: unknown[];
    const?: unknown;
    oneOf?: unknown[];
    properties?: Record<string, unknown>;
    additionalProperties?: unknown;
    required?: string[];
    items?: unknown;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  };

  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const matches = resolved.oneOf.filter((branch) =>
      matchesSchemaValue(branch as SchemaNode, value, schemasByKey, nativeDates),
    ).length;
    return matches === 1;
  }

  const isDateTime = getSchemaKind(resolved) === "date-time";
  if (isDateTime && nativeDates && value instanceof Date) {
    const timestamp = getPortableTimestamp(value);
    if (timestamp === null) return false;
    if (resolved.const !== undefined && getPortableTimestamp(resolved.const) !== timestamp) {
      return false;
    }
    if (
      resolved.enum?.length &&
      !resolved.enum.some((entry) => getPortableTimestamp(entry) === timestamp)
    ) {
      return false;
    }
    return true;
  }
  // Enum and const constrain a valid timestamp; they must not bypass its type.
  if (isDateTime && (typeof value !== "string" || !isIsoDateString(value))) {
    return false;
  }

  if (resolved.const !== undefined && !valueDeepEqual(value, resolved.const)) {
    return false;
  }

  if (resolved.enum?.length && !resolved.enum.some((entry) => valueDeepEqual(entry, value))) {
    return false;
  }

  const type = resolved.type;
  if (!type) {
    return true;
  }

  if (type === "boolean") {
    return typeof value === "boolean";
  }

  if (type === "string") {
    if (typeof value !== "string") {
      return false;
    }
    if (!valueMatchesFormat(resolved.format, value)) return false;

    if (resolved.minLength !== undefined && value.length < resolved.minLength) return false;
    if (resolved.maxLength !== undefined && value.length > resolved.maxLength) return false;

    if (resolved.pattern !== undefined) {
      try {
        if (!new RegExp(resolved.pattern).test(value)) return false;
      } catch {
        return true;
      }
    }

    return true;
  }

  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return false;
    }

    if (type === "integer" && !Number.isInteger(value)) {
      return false;
    }

    if (resolved.minimum !== undefined && value < resolved.minimum) return false;
    if (resolved.maximum !== undefined && value > resolved.maximum) return false;
    return true;
  }

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const objectValue = value as Record<string, unknown>;
    const properties = resolved.properties;
    const additionalProperties = resolved.additionalProperties;

    if ((!properties || typeof properties !== "object") && !additionalProperties) {
      return Object.values(objectValue).every((entry) => isPrimitiveAttributeValue(entry));
    }

    if (properties && typeof properties === "object") {
      const required = new Set(resolved.required || []);
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, key)) {
          return false;
        }
      }

      for (const key of Object.keys(objectValue)) {
        if (properties[key]) {
          if (
            !matchesSchemaValue(
              properties[key] as SchemaNode,
              objectValue[key],
              schemasByKey,
              nativeDates,
            )
          ) {
            return false;
          }
          continue;
        }

        if (additionalProperties && typeof additionalProperties === "object") {
          if (
            !matchesSchemaValue(
              additionalProperties as SchemaNode,
              objectValue[key],
              schemasByKey,
              nativeDates,
            )
          ) {
            return false;
          }
          continue;
        }

        return false;
      }

      return true;
    }

    if (additionalProperties && typeof additionalProperties === "object") {
      return Object.values(objectValue).every((entry) =>
        matchesSchemaValue(additionalProperties as SchemaNode, entry, schemasByKey, nativeDates),
      );
    }

    return true;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      return false;
    }

    if (resolved.minItems !== undefined && value.length < resolved.minItems) return false;
    if (resolved.maxItems !== undefined && value.length > resolved.maxItems) return false;

    if (resolved.uniqueItems) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (valueDeepEqual(value[i], value[j])) return false;
        }
      }
    }

    if (!resolved.items || typeof resolved.items !== "object") {
      return value.every((entry) => typeof entry === "string");
    }

    return value.every((entry) =>
      matchesSchemaValue(resolved.items as SchemaNode, entry, schemasByKey, nativeDates),
    );
  }

  return true;
}

function matchesLeafValue(
  leaf: ResolvedLeaf,
  value: unknown,
  schemasByKey: Record<string, Schema>,
): boolean {
  if (leaf.kind === "flat-object-property" || leaf.kind === "flat-array-item") {
    return leaf.kind === "flat-array-item"
      ? typeof value === "string"
      : isPrimitiveAttributeValue(value);
  }

  return matchesSchemaValue(leaf.schema, value, schemasByKey);
}

function getArrayItemLeaf(
  leaf: ResolvedLeaf,
  schemasByKey: Record<string, Schema>,
): ResolvedLeaf | null {
  if (leaf.kind !== "schema") {
    return leaf.kind === "flat-array-item" ? leaf : null;
  }

  const resolved = resolveSchemaRefs(leaf.schema, schemasByKey);
  if ("oneOf" in resolved && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const itemLeaves = resolved.oneOf
      .map((branch) =>
        getArrayItemLeaf({ kind: "schema", schema: branch as SchemaNode }, schemasByKey),
      )
      .filter((item): item is ResolvedLeaf => item !== null);

    if (itemLeaves.length === 0) {
      return null;
    }

    if (itemLeaves.every((item) => item.kind === "flat-array-item")) {
      return { kind: "flat-array-item" };
    }

    return {
      kind: "schema",
      schema: {
        oneOf: itemLeaves.map((item) =>
          item.kind === "schema" ? item.schema : ({ type: "string" } as AttributeProperty),
        ),
      } as AttributeProperty,
    };
  }

  if (!("type" in resolved) || resolved.type !== "array") {
    return null;
  }

  if ("items" in resolved && resolved.items && typeof resolved.items === "object") {
    return {
      kind: "schema",
      schema: resolveSchemaRefs(resolved.items as SchemaNode, schemasByKey),
    };
  }

  return { kind: "flat-array-item" };
}

function addIssue(
  context: z.RefinementCtx,
  message: string,
  path: (string | number)[] = ["value"],
  code?: string,
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
    ...(code ? { params: { code } } : {}),
  });
}

/** An issue lint reports as a warning, such as a check stricter than earlier versions had */
function addWarning(
  context: z.RefinementCtx,
  message: string,
  path: (string | number)[] = ["value"],
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path, params: { warning: true } });
}

function getDateOperatorError(
  attribute: string,
  operator: string,
  attributesByKey: Record<string, Attribute>,
  schemasByKey: Record<string, Schema>,
): string | null {
  const leaf = resolveAttributePath(attribute, attributesByKey, schemasByKey);
  const isDateSchema = (schema: SchemaNode): boolean => {
    const resolved = resolveSchemaRefs(schema, schemasByKey);
    if ("oneOf" in resolved && resolved.oneOf?.length) {
      return resolved.oneOf.every((branch) => isDateSchema(branch as SchemaNode));
    }
    return getSchemaKind(resolved) === "date-time";
  };
  if (
    !leaf ||
    leaf.kind !== "schema" ||
    !isDateSchema(leaf.schema) ||
    [...dateOperators, "exists", "notExists", "isNull", "notNull"].includes(operator)
  ) {
    return null;
  }
  return emptinessOperators.includes(operator)
    ? `Operator "${operator}" cannot be used with date-time attribute "${attribute}". Use exists or notNull to check that a date was sent.`
    : `Operator "${operator}" cannot be used with date-time attribute "${attribute}". Compare dates with before or after. To compare it as text too, declare it as a plain string without a format.`;
}

function validateAttributeAwareCondition(
  data: {
    attribute: string;
    operator: string;
    value?: unknown;
    regexFlags?: string;
  },
  context: z.RefinementCtx,
  attributesByKey: Record<string, Attribute>,
  schemasByKey: Record<string, Schema>,
): void {
  const resolvedLeaf = resolveAttributePath(data.attribute, attributesByKey, schemasByKey);
  if (!resolvedLeaf) {
    return;
  }

  const leafType = getLeafType(resolvedLeaf);
  const leafTypes = getLeafTypes(resolvedLeaf, schemasByKey);

  if (emptinessOperators.includes(data.operator)) {
    if (leafTypes.length > 0 && !leafTypes.some((type) => emptinessTypes.includes(type))) {
      addIssue(
        context,
        `Operator "${data.operator}" can only be used with string, array or object attributes.`,
      );
    }
    return;
  }

  if (operatorsWithoutValue.includes(data.operator)) {
    return;
  }

  if (resolvedLeaf.kind === "schema" && leafType === "object") {
    addIssue(
      context,
      `Attribute "${data.attribute}" resolves to an object. Use a nested attribute path or \`exists\`/\`notExists\` instead.`,
    );
    return;
  }

  if (
    numericOperators.includes(data.operator) &&
    !leafTypes.some((type) => ["integer", "number"].includes(type))
  ) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with integer or number attributes.`,
    );
    return;
  }

  if (
    stringOperators.includes(data.operator) &&
    !leafTypes.some((type) => ["string", "semver", "date-time"].includes(type))
  ) {
    addIssue(context, `Operator "${data.operator}" can only be used with string-like attributes.`);
    return;
  }

  if (
    semverOperators.includes(data.operator) &&
    !leafTypes.some((type) => ["string", "semver"].includes(type))
  ) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with string attributes, including format: semver.`,
    );
    return;
  }

  if (
    dateOperators.includes(data.operator) &&
    !leafTypes.some((type) => ["string", "date-time"].includes(type))
  ) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with string attributes, including format: date-time.`,
    );
    return;
  }

  if (arrayMembershipOperators.includes(data.operator)) {
    if (!supportsMembership(leafTypes)) {
      addIssue(
        context,
        `Operator "${data.operator}" can only be used with string, integer or number attributes, or nested paths declared as one of them.`,
      );
      return;
    }

    if (!Array.isArray(data.value)) {
      return;
    }

    let entryIssue = false;
    data.value.forEach((entry, index) => {
      if (entry !== null && !matchesLeafValue(resolvedLeaf, entry, schemasByKey)) {
        entryIssue = true;
        addIssue(
          context,
          `Value at index ${index} does not match the schema of attribute "${data.attribute}".`,
          ["value", index],
        );
      }
    });
    const mixed = !entryIssue && getMixedListMessage(data.operator, data.value);
    if (mixed) addWarning(context, mixed);

    return;
  }

  if ([...arrayOperators, ...arrayListOperators].includes(data.operator)) {
    const itemLeaf = getArrayItemLeaf(resolvedLeaf, schemasByKey);
    if (!itemLeaf) {
      addIssue(context, `Operator "${data.operator}" can only be used with array attributes.`);
      return;
    }

    const itemType = getLeafType(itemLeaf);
    if (itemType === "object" || itemType === "array") {
      addIssue(context, `Operator "${data.operator}" only supports arrays of primitive values.`);
      return;
    }

    if (arrayListOperators.includes(data.operator)) {
      let entryIssue = false;
      if (Array.isArray(data.value))
        data.value.forEach((value, index) => {
          // Malformed candidates already have an indexed operand diagnostic.
          if (
            !isPrimitiveAttributeValue(value) ||
            (typeof value === "number" && !Number.isFinite(value))
          ) {
            entryIssue = true;
            return;
          }
          if (!matchesLeafValue(itemLeaf, value, schemasByKey)) {
            entryIssue = true;
            addIssue(
              context,
              `Value at index ${index} does not match the item schema of attribute "${data.attribute}".`,
              ["value", index],
            );
          }
        });
      const mixed = !entryIssue && getMixedListMessage(data.operator, data.value);
      if (mixed) addWarning(context, mixed);
    } else if (!matchesLeafValue(itemLeaf, data.value, schemasByKey)) {
      addIssue(context, `Value does not match the item schema of attribute "${data.attribute}".`);
    }

    return;
  }

  if (commonOperators.includes(data.operator)) {
    if (data.value === null) {
      return;
    }

    if (!matchesLeafValue(resolvedLeaf, data.value, schemasByKey)) {
      addIssue(context, `Value does not match the schema of attribute "${data.attribute}".`);
    }
  }
}

export function getConditionsZodSchema(
  projectConfig: ProjectConfig,
  attributesByKey: Record<string, Attribute>,
  schemasByKey: Record<string, Schema> = {},
  featuresByKey: Record<string, ParsedFeature> = {},
  variablesByKey: Record<string, ParsedVariable> = {},
  segmentKeys: string[] = [],
) {
  const plainConditionZodSchema = z
    .object({
      attribute: refineWithMessage(
        z.string(),
        (value) => resolveAttributePath(value, attributesByKey, schemasByKey) !== null,
        (value) =>
          `Unknown attribute "${value}".${suggestKey(value, Object.keys(attributesByKey))}`,
        () => UNKNOWN_REFERENCE,
      ),
      operator: z.enum([
        ...commonOperators,
        ...numericOperators,
        ...stringOperators,
        ...semverOperators,
        ...dateOperators,
        ...arrayMembershipOperators,
        ...arrayOperators,
        ...arrayListOperators,
        ...operatorsWithoutValue,
      ]),
      value: z
        .union([z.string(), z.array(z.unknown()), z.number(), z.boolean(), z.date(), z.null()])
        .optional(),
      regexFlags: z
        .string()
        .refine(
          (value) => {
            if (typeof value === "undefined") {
              return true;
            }

            return /^[gims]+$/.test(value) && new Set(value).size === value.length;
          },
          {
            message: `regexFlags must contain unique characters from the cross-SDK set: g, i, m, s`,
          },
        )
        .optional(),
      compareTo: z.never().optional(),
    })
    .strict()
    .superRefine((data, context) => {
      for (const issue of findDisallowedOperators(
        data,
        projectConfig.disallowOperators || [],
        [],
      )) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: `Operator "${issue.operator}" is disallowed by project configuration.`,
        });
      }
      const dateOperatorError = getDateOperatorError(
        data.attribute,
        data.operator,
        attributesByKey,
        schemasByKey,
      );
      if (dateOperatorError) {
        addIssue(context, dateOperatorError, ["operator"]);
        return;
      }
      // Diagnose the unsupported attribute before checking its membership values.
      if (arrayMembershipOperators.includes(data.operator)) {
        const leaf = resolveAttributePath(data.attribute, attributesByKey, schemasByKey);
        const types = leaf ? getLeafTypes(leaf, schemasByKey) : [];
        if (leaf && !supportsMembership(types)) {
          validateAttributeAwareCondition(data, context, attributesByKey, schemasByKey);
          return;
        }
      }
      if (
        commonOperators.includes(data.operator) &&
        !(
          data.value === null ||
          typeof data.value === "string" ||
          typeof data.value === "number" ||
          typeof data.value === "boolean" ||
          data.value instanceof Date ||
          data.value === null
        )
      ) {
        addIssue(
          context,
          `when operator is "${data.operator}", value has to be either a string, number, boolean, date or null`,
        );
      }

      if (numericOperators.includes(data.operator) && typeof data.value !== "number") {
        addIssue(context, `when operator is "${data.operator}", value must be a number`);
      }

      if (
        [...stringOperators, ...semverOperators].includes(data.operator) &&
        typeof data.value !== "string"
      ) {
        addIssue(
          context,
          semverOperators.includes(data.operator) && typeof data.value === "number"
            ? `when operator is "${data.operator}", value must be a string. Quote versions such as '5.5' so YAML keeps them as text.`
            : `when operator is "${data.operator}", value must be a string`,
        );
      } else if (semverOperators.includes(data.operator) && !isValidVersion(data.value)) {
        // The operators treat an unparseable version as no match, so the condition can never pass.
        addIssue(
          context,
          `when operator is "${data.operator}", value must be a version the operators can compare, such as 5.5.0, 5.5 or v5.5.0`,
        );
      }

      if (dateOperators.includes(data.operator)) {
        if (typeof data.value === "undefined" || data.value === null || data.value === "") {
          addIssue(context, `when operator is "${data.operator}", value must be provided`);
        } else if (typeof data.value === "string") {
          if (!isIsoDateString(data.value)) {
            addIssue(
              context,
              `when operator is "${data.operator}", use an ISO 8601 timestamp YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm and optional 1 to 9 fractional digits, for example 2026-11-27T00:00:00.123456Z`,
            );
          }
        } else if (data.value instanceof Date) {
          if (getPortableTimestamp(data.value) === null) {
            addIssue(context, `when operator is "${data.operator}", value is a Date but invalid`);
          }
        } else {
          addIssue(
            context,
            `when operator is "${data.operator}", use an ISO 8601 timestamp YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm and optional 1 to 9 fractional digits, for example 2026-11-27T00:00:00.123456Z`,
          );
        }
      }

      if (arrayMembershipOperators.includes(data.operator) && !isMembershipList(data.value)) {
        addIssue(
          context,
          `when operator is "${data.operator}", value must be a list of strings or of numbers`,
        );
      } else if (arrayMembershipOperators.includes(data.operator)) {
        const leaf = resolveAttributePath(data.attribute, attributesByKey, schemasByKey);
        // Without a known attribute, the list's own types still have to agree.
        const mixed = !leaf && getMixedListMessage(data.operator, data.value);
        if (mixed) addWarning(context, mixed);
      }

      if (arrayListOperators.includes(data.operator)) {
        if (!Array.isArray(data.value)) {
          addIssue(
            context,
            `when operator is "${data.operator}", value must be an array of primitive values`,
            ["value"],
          );
        } else
          for (let index = 0; index < data.value.length; index++) {
            const value = data.value[index];
            if (
              !isPrimitiveAttributeValue(value) ||
              (typeof value === "number" && !Number.isFinite(value))
            )
              addIssue(
                context,
                `when operator is "${data.operator}", each candidate must be a string, number, boolean or null`,
                ["value", index],
              );
          }
      }

      if (!arrayMembershipOperators.includes(data.operator) && Array.isArray(data.value)) {
        if (!arrayListOperators.includes(data.operator)) {
          addIssue(context, `when operator is "${data.operator}", value must not be an array`);
        }
      }

      if (regexFlagsRequired(data.operator)) {
        if (typeof data.value !== "string") {
          addIssue(context, `when operator is "${data.operator}", value must be a string`);
        } else {
          const portableRegexError = getPortableRegexError(data.value);
          const backtrackingError = !portableRegexError && getBacktrackingError(data.value);
          if (portableRegexError) {
            addIssue(
              context,
              `when operator is "${data.operator}", value ${portableRegexError} in the cross-SDK regex subset`,
              ["value"],
              "unportable_regex",
            );
          } else if (backtrackingError) {
            addIssue(
              context,
              `when operator is "${data.operator}", value ${backtrackingError}.`,
              ["value"],
              "regex_backtracking",
            );
          }
        }
      } else if (data.regexFlags) {
        addIssue(
          context,
          `when operator is neither "matches" nor "notMatches", regexFlags are not needed`,
          ["regexFlags"],
        );
      }

      if (operatorsWithoutValue.includes(data.operator) && data.value !== undefined) {
        addIssue(context, `when operator is "${data.operator}", value is not needed`);
      }

      validateAttributeAwareCondition(
        data as {
          attribute: string;
          operator: string;
          value?: unknown;
          regexFlags?: string;
        },
        context,
        attributesByKey,
        schemasByKey,
      );
    });

  const featureSchema = getFeatureConditionZodSchema(featuresByKey);
  const variableSchema = getVariableConditionZodSchema(
    featuresByKey,
    variablesByKey,
    schemasByKey,
    projectConfig,
  );
  const segmentSchema = refineWithMessage(
    z.string().min(1),
    (key) => key !== "*" && segmentKeys.includes(key),
    (key) =>
      key === "*"
        ? "`*` is only allowed as the entire `conditions` value."
        : Object.prototype.hasOwnProperty.call(featuresByKey, key)
          ? `Unknown segment "${key}". "${key}" is a feature: use { feature: ${key} }.`
          : `Unknown segment "${key}".${suggestKey(key, segmentKeys)}`,
    (key) => (key === "*" ? undefined : UNKNOWN_REFERENCE),
  );
  // Dispatch before parsing, keeping leaf diagnostics and their exact authored paths.
  const expression: z.ZodTypeAny = z.lazy(() =>
    z.unknown().transform((value, ctx) => {
      let selected: z.ZodTypeAny;
      if (typeof value === "string") selected = segmentSchema;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const owns = (key: string) => Object.prototype.hasOwnProperty.call(object, key);
        if (owns("attribute") && (owns("feature") || owns("variable"))) {
          ctx.addIssue({
            code: "custom",
            message: "An attribute condition cannot also contain feature or variable.",
            path: ["attribute"],
          });
          return z.NEVER;
        }
        const groups = ["and", "or", "not"].filter(owns);
        if (groups.length)
          selected = z
            .object({
              [groups[0]]: z
                .array(expression)
                .min(1, `\`${groups[0]}\` must contain at least one condition`),
            })
            .strict();
        else if (owns("variable")) selected = variableSchema;
        else if (owns("feature")) {
          if (owns("operator")) {
            ctx.addIssue({
              code: "custom",
              message: "To compare a variation, use variation: <value>",
              path: ["operator"],
            });
            return z.NEVER;
          }
          selected = featureSchema;
        } else selected = plainConditionZodSchema;
      } else selected = plainConditionZodSchema;
      const result = selected.safeParse(value, diagnosticParseOptions);
      if (!result.success) {
        for (const issue of result.error.issues) ctx.addIssue({ ...issue });
        return z.NEVER;
      }
      return result.data;
    }),
  );
  const schema = z.unknown().transform((value, ctx) => {
    if (value === "*") return value;
    const result = (
      Array.isArray(value)
        ? z.array(expression).min(1, "conditions must not be empty. Use '*' to match everything.")
        : expression
    ).safeParse(value, diagnosticParseOptions);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue });
      return z.NEVER;
    }
    return result.data;
  });
  const editorExpression: z.ZodTypeAny = z.lazy(() =>
    z.union([
      plainConditionZodSchema,
      featureSchema,
      variableSchema,
      z
        .string()
        .min(1)
        .regex(/^(?!\*$).+/),
      z
        .object({
          and: z.array(editorExpression).min(1, "`and` must contain at least one condition"),
        })
        .strict(),
      z
        .object({
          or: z.array(editorExpression).min(1, "`or` must contain at least one condition"),
        })
        .strict(),
      z
        .object({
          not: z.array(editorExpression).min(1, "`not` must contain at least one condition"),
        })
        .strict(),
    ]),
  );
  return Object.assign(schema as z.ZodType<Conditions>, {
    editorSchema: z.union([
      z.literal("*"),
      editorExpression,
      z
        .array(editorExpression)
        .min(1, "conditions must not be empty. Use '*' to match everything."),
    ]),
    withEntities: (
      features: Record<string, ParsedFeature>,
      variables: Record<string, ParsedVariable>,
      segments: string[],
    ) =>
      getConditionsZodSchema(
        projectConfig,
        attributesByKey,
        schemasByKey,
        features,
        variables,
        segments,
      ),
  });
}

function regexFlagsRequired(operator: string): boolean {
  return operator === "matches" || operator === "notMatches";
}
