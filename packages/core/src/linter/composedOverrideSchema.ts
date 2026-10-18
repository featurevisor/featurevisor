import type {
  ComposedParsedVariable,
  ParsedFeature,
  ParsedVariable,
  ParsedVariableOverride,
  Schema,
  VariableMutationPathPart,
} from "@featurevisor/types";
import type { z } from "zod";
import type { ProjectConfig } from "../config";
import { compileVariableMutation } from "../builder/variableOverrideProgram";
import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import {
  childMutationValueContext,
  type MutationValueContext,
  mutationSubject,
  resolveVariableSchema,
  superRefineVariableValue,
} from "./featureSchema";
import { getMutationPath } from "./mutationNotation";
import { isComposedVariable } from "../datasource/composition";

interface EvaluatedShape {
  /** Undefined means decoded JSON, whose runtime shape is deliberately unknown. */
  schema?: Schema;
  nullable?: boolean;
  members?: Record<string, EvaluatedShape>;
}
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Infer getter result shapes without introducing authoring or datafile schema fields. */
function compositionShape(
  variable: ComposedParsedVariable,
  features: Record<string, ParsedFeature>,
  variables: Record<string, ParsedVariable>,
  schemas: Record<string, Schema>,
  visiting = new Set<ParsedVariable>(),
): EvaluatedShape {
  if (visiting.has(variable)) return {};
  visiting.add(variable);
  const members: Record<string, EvaluatedShape> = Object.create(null);
  const ordinary = (definition: Parameters<typeof resolveVariableSchema>[0]): EvaluatedShape => {
    const schema = resolveVariableSchema(definition, schemas);
    return {
      schema: schema?.type === "json" ? undefined : (schema as Schema | undefined),
      nullable: true,
    };
  };
  if (typeof variable.compose === "string") {
    const aliases = new Set<ParsedVariable>();
    let source: ParsedVariable | undefined = variable;
    while (source && typeof source.compose === "string" && !aliases.has(source)) {
      aliases.add(source);
      source = owns(variables, source.compose) ? variables[source.compose] : undefined;
    }
    const shape =
      source && !aliases.has(source)
        ? isComposedVariable(source)
          ? { ...compositionShape(source, features, variables, schemas, visiting), nullable: true }
          : ordinary(source)
        : {};
    visiting.delete(variable);
    return shape;
  }
  for (const [alias, ref] of Object.entries(variable.compose)) {
    let member: EvaluatedShape;
    if (ref.feature !== undefined) {
      const feature = owns(features, ref.feature) ? features[ref.feature] : undefined;
      if (ref.variable !== undefined) {
        const source = feature?.variablesSchema;
        member = source && owns(source, ref.variable) ? ordinary(source[ref.variable]) : {};
      } else if (ref.variation) {
        const values = [
          ...new Set([
            ...(feature?.variations || []).map((v) => v.value),
            ...(feature?.disabledVariationValue !== undefined
              ? [feature.disabledVariationValue]
              : []),
          ]),
        ];
        member = {
          schema: values.length ? { type: "string", enum: values } : { const: null },
          nullable: true,
        };
      } else member = { schema: { type: "boolean" } };
    } else {
      const source = owns(variables, ref.variable) ? variables[ref.variable] : undefined;
      member =
        source && isComposedVariable(source)
          ? { ...compositionShape(source, features, variables, schemas, visiting), nullable: true }
          : source
            ? ordinary(source)
            : {};
    }
    members[alias] = member;
  }
  visiting.delete(variable);
  return { schema: { type: "object", required: Object.keys(members) }, members };
}

function resolve(shape: EvaluatedShape, schemas: Record<string, Schema>): EvaluatedShape {
  if (!shape.schema?.schema) return shape;
  return { ...shape, schema: resolveVariableSchema(shape.schema, schemas) as Schema | undefined };
}

function refineValue(
  shape: EvaluatedShape,
  value: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  config: ProjectConfig,
  schemas: Record<string, Schema>,
  variableKey: string,
  mutation?: MutationValueContext,
) {
  if (shape.nullable && value === null) return;
  if (shape.members) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: mutation
          ? `${mutationSubject(mutation)} must be an object with all of its declared composition properties.`
          : "A composed value must be an object with all of its declared properties.",
      });
      return;
    }
    for (const alias of Object.keys(shape.members)) {
      if (!owns(value, alias))
        ctx.addIssue({
          code: "custom",
          path: [...path, alias],
          message: mutation
            ? `${mutationSubject(mutation)} is missing composition property "${alias}".`
            : `Missing composition property "${alias}".`,
        });
    }
    for (const [alias, member] of Object.entries(value)) {
      if (!owns(shape.members, alias))
        ctx.addIssue({
          code: "custom",
          path: [...path, alias],
          message: mutation
            ? `${mutationSubject(mutation)} has unknown composition property "${alias}".`
            : `Unknown composition property "${alias}".`,
        });
      else
        refineValue(
          shape.members[alias],
          member,
          [...path, alias],
          ctx,
          config,
          schemas,
          variableKey,
          childMutationValueContext(mutation, alias),
        );
    }
  } else if (shape.schema) {
    superRefineVariableValue(
      config,
      shape.schema,
      value,
      path,
      ctx,
      variableKey,
      schemas,
      mutation,
    );
  }
}

function childShape(
  input: EvaluatedShape,
  part: VariableMutationPathPart,
  schemas: Record<string, Schema>,
): EvaluatedShape {
  const shape = resolve(input, schemas);
  if (!shape.schema) return {};
  if (shape.schema.oneOf)
    throw new Error("A mutation cannot descend through oneOf. Replace the whole member instead.");
  if (typeof part === "string") {
    if (shape.schema.type !== "object")
      throw new Error("Mutation path requires an object property.");
    if (shape.members) {
      if (!owns(shape.members, part))
        throw new Error(
          `Unknown composition property "${part}". Mutation keys use path notation, not literal dotted properties.`,
        );
      return shape.members[part];
    }
    const properties = shape.schema.properties;
    if (properties && owns(properties, part)) return { schema: properties[part] };
    if (shape.schema.additionalProperties) return { schema: shape.schema.additionalProperties };
    if (!properties)
      return {
        schema: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { const: null }],
        },
      };
    throw new Error(`Unknown mutation property "${part}".`);
  }
  if (shape.schema.type !== "array") throw new Error("Mutation path requires an array.");
  const item = { schema: shape.schema.items || { type: "string" as const } };
  if (typeof part !== "number") childShape(item, part.select.property, schemas);
  return item;
}

/** Validate dynamic overrides structurally rather than running them on fictional defaults. */
export function refineComposedOverrides(
  variable: ComposedParsedVariable,
  features: Record<string, ParsedFeature>,
  variables: Record<string, ParsedVariable>,
  schemas: Record<string, Schema>,
  config: ProjectConfig,
  ctx: z.RefinementCtx,
  variableKey = "value",
) {
  const root = compositionShape(variable, features, variables, schemas);
  if (variable.disabledValue !== undefined) {
    refineValue(
      { ...root, nullable: true },
      variable.disabledValue,
      ["disabledValue"],
      ctx,
      config,
      schemas,
      variableKey,
    );
  }
  if (!variable.overrides) return;
  const groups: Array<[string | undefined, ParsedVariableOverride[]]> = Array.isArray(
    variable.overrides,
  )
    ? [[undefined, variable.overrides]]
    : Object.entries(variable.overrides);
  for (const [environment, entries] of groups) {
    const seen = new Map<string, string>();
    const inspect = (overrides: ParsedVariableOverride[], parent: (string | number)[]) => {
      overrides.forEach((override, index) => {
        const base = [...parent, index];
        // The shared array schema owns sibling duplicates. Only report a
        // duplicate here when it crosses nested sibling groups.
        const siblingGroup = JSON.stringify(parent);
        if (seen.has(override.key) && seen.get(override.key) !== siblingGroup)
          ctx.addIssue({
            code: "custom",
            path: [...base, "key"],
            message: `Duplicate override key found in tree: ${override.key}`,
          });
        if (!seen.has(override.key)) seen.set(override.key, siblingGroup);
        if (override.mutate !== undefined) {
          for (const [entryIndex, [key, operand]] of mutationEntries(override.mutate).entries()) {
            const diagnosticPath = [
              ...base,
              "mutate",
              ...mutationEntryPath(override.mutate, entryIndex, key),
            ];
            try {
              const operation = compileVariableMutation(key, operand);
              let target = root;
              let parentShape = root;
              for (const part of operation.path) {
                parentShape = resolve(target, schemas);
                target = childShape(parentShape, part, schemas);
              }
              const last = operation.path[operation.path.length - 1];
              if (operation.op === "remove") {
                if (typeof last === "string" && parentShape.schema?.required?.includes(last))
                  throw new Error(`Cannot remove required property "${last}".`);
              } else if (
                ["append", "prepend", "appendUnique", "removeValue"].includes(operation.op)
              ) {
                target = childShape(target, 0, schemas);
                refineValue(target, operand, diagnosticPath, ctx, config, schemas, variableKey, {
                  variableKey,
                  path: getMutationPath(key),
                  operation: operation.op,
                });
              } else {
                if (operation.op === "before" || operation.op === "after") {
                  if (typeof last === "string" || operation.path.length === 0)
                    throw new Error("before/after requires an array element path.");
                }
                refineValue(target, operand, diagnosticPath, ctx, config, schemas, variableKey, {
                  variableKey,
                  path: getMutationPath(key),
                  operation: operation.op,
                });
              }
            } catch (error) {
              const authoredPath = getMutationPath(key);
              const operation = key.trim().slice(authoredPath.length);
              ctx.addIssue({
                code: "custom",
                path: diagnosticPath,
                message: `Mutation "${authoredPath}" in variable "${variableKey}"${operation ? ` (operation ${operation})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }
        } else if (override.value !== undefined)
          refineValue(root, override.value, [...base, "value"], ctx, config, schemas, variableKey);
        inspect(override.overrides || [], [...base, "overrides"]);
      });
    };
    inspect(entries, environment === undefined ? ["overrides"] : ["overrides", environment]);
  }
}
