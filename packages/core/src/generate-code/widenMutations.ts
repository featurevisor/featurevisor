import { applyVariableOperations } from "@featurevisor/sdk";
import type { Schema, VariableMutationOperation, VariableMutations } from "@featurevisor/types";

import {
  applyAlwaysMutations,
  compileMutate,
  flattenSchemaEntries,
  flattenSchemaMutations,
} from "../builder/schemas";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const text = JSON.stringify(value);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/** The values a node lists: its `enum`, or its `const` as a list of one. */
function listed(node: Node): unknown[] | undefined {
  if ("const" in node) return [node.const];
  return Array.isArray(node.enum) ? node.enum : undefined;
}

/** What a node is, apart from its keywords: its type, reference and number of branches. */
function shapeOf(node: Node): string {
  return JSON.stringify([node.type, node.schema, Array.isArray(node.oneOf) && node.oneOf.length]);
}

/**
 * One node whose type holds every value one of the variants allows: listed
 * values and fields joined, and a field required only where every variant
 * requires it. Variants of different shapes become a union of them.
 */
function merge(variants: Node[]): Node {
  const [first] = variants;
  if (unique(variants).length === 1) return first;
  if (variants.some((variant) => shapeOf(variant) !== shapeOf(first))) {
    return { oneOf: unique(variants) };
  }

  const merged: Node = { ...first };
  delete merged.enum;
  delete merged.const;
  const lists = variants.map(listed);
  if (lists.every(Boolean)) {
    const values = unique(lists.flat());
    if (values.length === 1 && variants.every((variant) => "const" in variant))
      merged.const = values[0];
    else merged.enum = values;
  }
  if (variants.some((variant) => variant.format !== first.format)) delete merged.format;

  if (variants.some((variant) => isNode(variant.properties))) {
    const keys = unique(
      variants.flatMap((variant) =>
        isNode(variant.properties) ? Object.keys(variant.properties) : [],
      ),
    );
    merged.properties = Object.fromEntries(
      keys.map((key) => [
        key,
        merge(
          variants.map((variant) => (variant.properties as Node | undefined)?.[key]).filter(isNode),
        ),
      ]),
    );
  }
  const required = (Array.isArray(first.required) ? (first.required as string[]) : []).filter(
    (key) =>
      variants.every(
        (variant) => Array.isArray(variant.required) && variant.required.includes(key),
      ),
  );
  if (required.length > 0) merged.required = required;
  else delete merged.required;

  const extra = variants
    .map((variant) => variant.additionalProperties)
    .filter((x) => x !== undefined);
  if (extra.includes(true)) merged.additionalProperties = true;
  else if (extra.length > 0) merged.additionalProperties = merge(extra.filter(isNode));
  const items = variants.map((variant) => variant.items).filter(isNode);
  if (items.length > 0) merged.items = merge(items);
  if (Array.isArray(first.oneOf)) {
    merged.oneOf = first.oneOf.map((_, index) =>
      merge(variants.map((variant) => (variant.oneOf as unknown[])[index]).filter(isNode)),
    );
  }
  return merged;
}

function widen(authored: unknown): unknown {
  if (!isNode(authored)) return authored;
  // Nested mutations made flat, each knowing the ones that apply before it, as the builder flattens them.
  const flat = flattenSchemaMutations(authored.mutations);
  // Mutations that always apply are the rules a datafile holds, as the builder applies them.
  const node = applyAlwaysMutations(flattenSchemaEntries(authored)) as Node;
  let current = node;
  if (Array.isArray(node.mutations) && node.mutations.length > 0) {
    const { mutations, ...base } = node;
    const applied = flat.length - mutations.length;
    const compiled = flat.map(({ mutation }) => {
      try {
        return compileMutate(mutation.mutate as VariableMutations);
      } catch {
        // Lint reports a mutation that does not compile.
        return undefined;
      }
    });
    const apply = (indices: number[]): unknown => {
      const operations = indices.map((index) => compiled[index]);
      if (operations.some((each) => each === undefined)) return undefined;
      try {
        return applyVariableOperations(
          base as never,
          operations.flat() as VariableMutationOperation[],
        );
      } catch {
        return undefined;
      }
    };
    // Any mutation can match, alone, after the ones it is nested in, or with all the others.
    const rest = flat.map((_, index) => index).slice(applied);
    const variants = [
      base,
      ...rest.map((index) =>
        apply([...flat[index].ancestors.filter((ancestor) => ancestor >= applied), index]),
      ),
    ];
    if (rest.length > 1) variants.push(apply(rest));
    current = merge(variants.filter(isNode));
  }

  const result: Node = { ...current };
  if (isNode(current.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(current.properties).map(([key, property]) => [key, widen(property)]),
    );
  }
  if (isNode(current.items)) result.items = widen(current.items);
  if (isNode(current.additionalProperties))
    result.additionalProperties = widen(current.additionalProperties);
  if (Array.isArray(current.oneOf)) result.oneOf = current.oneOf.map(widen);
  return result;
}

/**
 * A schema as generated types describe it: the base, with whatever its
 * mutations widen added at every node, since any of them can match when a
 * value is validated. A field a mutation requires stays optional, a value a
 * mutation adds to an `enum` joins the union, and a field a mutation adds is
 * an optional key. No mutation changes a `type`, which lint ensures.
 */
export function widenSchemaMutations(schema: Schema): Schema {
  return widen(schema) as Schema;
}
