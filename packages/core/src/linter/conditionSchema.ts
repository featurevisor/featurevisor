import type { Attribute, AttributeProperty, Schema } from "@featurevisor/types";
import { z } from "zod";

import { ProjectConfig } from "../config";

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
const operatorsWithoutValue = ["exists", "notExists"];

const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|([+\-]\d{2}:\d{2})))?$/;

type SchemaNode = Attribute | AttributeProperty | Schema;
type ResolvedLeaf =
  | { kind: "schema"; schema: SchemaNode }
  | { kind: "flat-object-property" }
  | { kind: "flat-array-item" };

function isIsoDateString(value: string): boolean {
  return isoDateRegex.test(value);
}

function isPrimitiveAttributeValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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

  return "type" in resolvedLeaf.schema ? resolvedLeaf.schema.type : undefined;
}

function resolveAttributePath(
  attributePath: string,
  attributesByKey: Record<string, Attribute>,
  schemasByKey: Record<string, Schema>,
): ResolvedLeaf | null {
  const [rootKey, ...rest] = attributePath.split(".");
  const rootAttribute = attributesByKey[rootKey];

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

    if (properties && typeof properties === "object" && properties[segment]) {
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

function matchesSchemaValue(
  schema: SchemaNode,
  value: unknown,
  schemasByKey: Record<string, Schema>,
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
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  };

  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const matches = resolved.oneOf.filter((branch) =>
      matchesSchemaValue(branch as SchemaNode, value, schemasByKey),
    ).length;
    return matches === 1;
  }

  if (resolved.const !== undefined) {
    return valueDeepEqual(value, resolved.const);
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum.some((entry) => valueDeepEqual(entry, value));
  }

  const type = resolved.type;
  if (!type) {
    return true;
  }

  if (type === "boolean") {
    return typeof value === "boolean";
  }

  if (type === "string" || type === "semver" || type === "date") {
    if (typeof value !== "string") {
      return false;
    }

    if (resolved.minLength !== undefined && value.length < resolved.minLength) return false;
    if (resolved.maxLength !== undefined && value.length > resolved.maxLength) return false;

    if (resolved.pattern !== undefined) {
      try {
        if (!new RegExp(resolved.pattern).test(value)) return false;
      } catch {
        return true;
      }
    }

    if (type === "date" && !isIsoDateString(value)) {
      return false;
    }

    return true;
  }

  if (type === "integer" || type === "double") {
    if (typeof value !== "number") {
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
          if (!matchesSchemaValue(properties[key] as SchemaNode, objectValue[key], schemasByKey)) {
            return false;
          }
          continue;
        }

        if (additionalProperties && typeof additionalProperties === "object") {
          if (
            !matchesSchemaValue(additionalProperties as SchemaNode, objectValue[key], schemasByKey)
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
        matchesSchemaValue(additionalProperties as SchemaNode, entry, schemasByKey),
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
      matchesSchemaValue(resolved.items as SchemaNode, entry, schemasByKey),
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
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
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

  if (numericOperators.includes(data.operator) && !["integer", "double"].includes(leafType || "")) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with integer or double attributes.`,
    );
    return;
  }

  if (
    stringOperators.includes(data.operator) &&
    !["string", "semver", "date"].includes(leafType || "")
  ) {
    addIssue(context, `Operator "${data.operator}" can only be used with string-like attributes.`);
    return;
  }

  if (semverOperators.includes(data.operator) && !["string", "semver"].includes(leafType || "")) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with string or semver attributes.`,
    );
    return;
  }

  if (dateOperators.includes(data.operator) && !["string", "date"].includes(leafType || "")) {
    addIssue(
      context,
      `Operator "${data.operator}" can only be used with string or date attributes.`,
    );
    return;
  }

  if (arrayMembershipOperators.includes(data.operator)) {
    if (
      !["primitive", "string", "semver", "date", "integer", "double", "boolean"].includes(
        leafType || "",
      )
    ) {
      addIssue(
        context,
        `Operator "${data.operator}" can only be used with primitive attribute values.`,
      );
      return;
    }

    if (!Array.isArray(data.value)) {
      return;
    }

    data.value.forEach((entry, index) => {
      if (!matchesLeafValue(resolvedLeaf, entry, schemasByKey)) {
        addIssue(
          context,
          `Value at index ${index} does not match the schema of attribute "${data.attribute}".`,
          ["value", index],
        );
      }
    });

    return;
  }

  if (arrayOperators.includes(data.operator)) {
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

    if (!matchesLeafValue(itemLeaf, data.value, schemasByKey)) {
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
) {
  const plainConditionZodSchema = z
    .object({
      attribute: z.string().refine(
        (value) => resolveAttributePath(value, attributesByKey, schemasByKey) !== null,
        (value) => ({
          message: `Unknown attribute "${value}"`,
        }),
      ),
      operator: z.enum([
        ...commonOperators,
        ...numericOperators,
        ...stringOperators,
        ...semverOperators,
        ...dateOperators,
        ...arrayMembershipOperators,
        ...arrayOperators,
        ...operatorsWithoutValue,
      ]),
      value: z
        .union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.date(), z.null()])
        .optional(),
      regexFlags: z
        .string()
        .refine(
          (value) => {
            if (typeof value === "undefined") {
              return true;
            }

            return /^[gimsuy]{1,}$/.test(value);
          },
          {
            message: `regexFlags must of one or more of these characters: g, i, m, s, u, y`,
          },
        )
        .optional(),
    })
    .superRefine((data, context) => {
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
        addIssue(context, `when operator is "${data.operator}", value must be a string`);
      }

      if (dateOperators.includes(data.operator)) {
        if (typeof data.value === "undefined" || data.value === null || data.value === "") {
          addIssue(context, `when operator is "${data.operator}", value must be provided`);
        } else if (typeof data.value === "string") {
          if (!isIsoDateString(data.value)) {
            addIssue(
              context,
              `when operator is "${data.operator}", value must be a stringified date in ISO 8601 format`,
            );
          }
        } else if (data.value instanceof Date) {
          if (isNaN(data.value.getTime())) {
            addIssue(context, `when operator is "${data.operator}", value is a Date but invalid`);
          }
        } else {
          addIssue(
            context,
            `when operator is "${data.operator}", value must be a stringified date in ISO 8601 format or a valid Date object`,
          );
        }
      }

      if (arrayMembershipOperators.includes(data.operator) && !Array.isArray(data.value)) {
        addIssue(context, `when operator is "${data.operator}", value must be an array of strings`);
      }

      if (
        arrayMembershipOperators.includes(data.operator) &&
        Array.isArray(data.value) &&
        !isStringArray(data.value)
      ) {
        addIssue(context, `when operator is "${data.operator}", value must be an array of strings`);
      }

      if (!arrayMembershipOperators.includes(data.operator) && Array.isArray(data.value)) {
        if (!["in", "notIn"].includes(data.operator)) {
          addIssue(context, `when operator is "${data.operator}", value must not be an array`);
        }
      }

      if (regexFlagsRequired(data.operator)) {
        if (typeof data.value !== "string") {
          addIssue(context, `when operator is "${data.operator}", value must be a string`);
        }
      } else if (data.regexFlags) {
        addIssue(
          context,
          `when operator is nether "matches" nor "notMatches", regexFlags are not needed`,
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

  const andOrNotConditionZodSchema = z.union([
    z
      .object({
        and: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
    z
      .object({
        or: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
    z
      .object({
        not: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
  ]);

  const everyoneZodSchema = z.literal("*");
  const conditionZodSchema = z.union([andOrNotConditionZodSchema, plainConditionZodSchema]);

  return z.union([conditionZodSchema, z.array(conditionZodSchema), everyoneZodSchema]);
}

function regexFlagsRequired(operator: string): boolean {
  return operator === "matches" || operator === "notMatches";
}
