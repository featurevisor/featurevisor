import type {
  Schema,
  SchemaMutation,
  VariableMutationOperation,
  VariableMutations,
} from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";
import type { z } from "zod";

import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import { compileVariableMutation } from "../builder/variableOverrideProgram";
import { getSchemaReferences } from "../targeting";

type Node = Record<string, unknown>;
type Path = (string | number)[];

export interface MutationFinding {
  path: Path;
  message: string;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Whether a schema has rules that change, by environment or under conditions, at any node. */
function hasChangingRules(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (node.environments !== undefined) return true;
  if (Array.isArray(node.mutations) && node.mutations.length > 0) return true;
  if (isNode(node.properties) && Object.values(node.properties).some(hasChangingRules)) return true;
  if (Array.isArray(node.oneOf) && node.oneOf.some(hasChangingRules)) return true;
  return hasChangingRules(node.items) || hasChangingRules(node.additionalProperties);
}

/**
 * Whether a schema varies, by environment or under conditions, itself or
 * through a schema it references, so no variable may use it: a variable's
 * schema, values and type are the same everywhere and for everyone.
 */
export function schemaVaries(
  key: string,
  schemasByKey: Record<string, Schema>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  const schema = schemasByKey[key];
  if (!schema) return false;
  if (hasChangingRules(schema)) return true;
  for (const reference of getSchemaReferences(schema)) {
    if (schemaVaries(reference, schemasByKey, seen)) return true;
  }
  return false;
}

/** The part of an operation's path that a value lacks, or undefined when it reaches. */
function missingPart(target: unknown, operation: VariableMutationOperation): number | undefined {
  let current = target;
  const last = operation.path.length - 1;
  for (let index = 0; index <= last; index++) {
    const part = operation.path[index];
    // A new key can be set at the end, as a new property is added. Anything else must exist.
    const mayBeNew = index === last && operation.op === "set";
    let next: unknown;
    if (typeof part === "object") {
      next = Array.isArray(current)
        ? current.find(
            (item) =>
              isNode(item) &&
              part.select.values.some((value) => item[part.select.property] === value),
          )
        : undefined;
    } else if (Array.isArray(current) && typeof part === "number") {
      next = current[part];
    } else if (isNode(current) && typeof part === "string") {
      next = hasOwn(current, part) ? current[part] : undefined;
      if (next === undefined && mayBeNew) return undefined;
    }
    if (next === undefined) return mayBeNew && Array.isArray(current) ? undefined : index;
    current = next;
  }
  return undefined;
}

function readable(path: VariableMutationOperation["path"], upTo: number): string {
  return path
    .slice(0, upTo + 1)
    .map((part) =>
      typeof part === "object"
        ? `[${part.select.property}=${part.select.values[0]}]`
        : typeof part === "number"
          ? `[${part}]`
          : part,
    )
    .join(".")
    .replace(/\.\[/g, "[");
}

interface MutationLintOptions {
  projectConfig: { environments?: unknown };
  schemasByKey: Record<string, Schema>;
  /** The schema files' own Zod, which every resolved and mutated schema must pass. */
  schemaZodSchema: z.ZodTypeAny;
  /** Conditions as features take them, with `input` leaves too. */
  conditionsZodSchema: z.ZodTypeAny;
}

/**
 * Checks a schema file's `environments` and `mutations`: every path in a
 * `mutate` reaches into what it changes, every environment's resolved schema
 * and every combination of a node's mutations is still a valid schema,
 * conditions are valid with `input` paths that name fields of their node, keys
 * are unique within a node, and no mutation changes a `type`.
 */
export function getSchemaMutationFindings(
  root: unknown,
  { projectConfig, schemasByKey, schemaZodSchema, conditionsZodSchema }: MutationLintOptions,
): MutationFinding[] {
  const findings: MutationFinding[] = [];
  if (!isNode(root)) return findings;

  /** The node a `schema` reference leads to, through any chain of them. */
  const resolve = (node: unknown, seen = new Set<string>()): Node | undefined => {
    if (!isNode(node)) return undefined;
    if (typeof node.schema === "string") {
      if (seen.has(node.schema)) return undefined;
      seen.add(node.schema);
      return resolve(schemasByKey[node.schema], seen);
    }
    return node;
  };

  /** Compiles a `mutate`, reporting what does not compile or reach into its target. */
  const compile = (
    mutate: unknown,
    target: unknown,
    path: Path,
    forbidType: boolean,
  ): VariableMutationOperation[] | undefined => {
    let entries: [string, unknown][];
    try {
      entries = mutationEntries(mutate as VariableMutations);
    } catch (error) {
      findings.push({ path, message: (error as Error).message });
      return undefined;
    }
    const operations: VariableMutationOperation[] = [];
    entries.forEach(([notation, value], index) => {
      const at = [...path, ...mutationEntryPath(mutate as VariableMutations, index, notation)];
      let operation: VariableMutationOperation;
      try {
        operation = compileVariableMutation(notation, value);
      } catch (error) {
        findings.push({ path: at, message: (error as Error).message });
        return;
      }
      const missing = missingPart(target, operation);
      if (missing !== undefined) {
        findings.push({
          path: at,
          message: `\`${notation}\` reaches nothing: \`${readable(operation.path, missing)}\` is not there. A mutation changes what exists, and creates no objects on the way.`,
        });
        return;
      }
      if (forbidType && operation.path[operation.path.length - 1] === "type") {
        findings.push({
          path: at,
          message:
            "A mutation cannot change a `type`, so a field's type is the same whatever matches, for reading form data and for generated types.",
        });
        return;
      }
      operations.push(operation);
    });
    return operations.length === entries.length ? operations : undefined;
  };

  /** Reports a resolved or mutated schema's issues under the entry that made it. */
  const validate = (schema: unknown, path: Path, what: string) => {
    const result = schemaZodSchema.safeParse(schema);
    if (result.success) return;
    for (const issue of result.error.issues) {
      findings.push({
        path,
        message: `${what}, the schema fails: ${issue.message} (at ${issue.path.join(".") || "the root"})`,
      });
    }
  };

  // Changes per environment, resolved at build time.
  if (root.environments !== undefined) {
    const configured = Array.isArray(projectConfig.environments)
      ? (projectConfig.environments as string[])
      : undefined;
    if (!configured) {
      findings.push({
        path: ["environments"],
        message:
          "`environments` needs a project with environments. In a project with sets, each set has its own schema files.",
      });
    } else if (isNode(root.environments)) {
      const { environments, ...base } = root;
      for (const [environment, entry] of Object.entries(environments as Node)) {
        const at: Path = ["environments", environment];
        if (!configured.includes(environment)) {
          findings.push({
            path: at,
            message: `Unknown environment "${environment}". Environments: ${configured.join(", ")}.`,
          });
          continue;
        }
        if (!isNode(entry) || entry.mutate === undefined) continue;
        const operations = compile(entry.mutate, base, [...at, "mutate"], false);
        if (!operations) continue;
        validate(
          applyVariableOperations(base as never, operations),
          [...at, "mutate"],
          `In ${environment}`,
        );
      }
    }
  }

  /** Checks the `input` leaves of a mutation's conditions against the fields of its node. */
  const checkInputs = (conditions: unknown, node: Node, path: Path) => {
    const fields = (fieldPath: string): boolean => {
      let current: Node | undefined = resolve(node);
      for (const part of fieldPath.split(".")) {
        const properties = current && isNode(current.properties) ? current.properties : undefined;
        if (!properties || !hasOwn(properties, part)) return false;
        current = resolve(properties[part]);
      }
      return true;
    };
    const visit = (value: unknown, at: Path) => {
      if (Array.isArray(value)) return value.forEach((child, i) => visit(child, [...at, i]));
      if (!isNode(value)) return;
      for (const group of ["and", "or", "not"])
        if (Array.isArray(value[group])) visit(value[group], [...at, group]);
      for (const [field, read] of [
        [["input"], value.input],
        [["valueFrom", "input"], isNode(value.valueFrom) ? value.valueFrom.input : undefined],
      ] as const) {
        if (typeof read === "string" && !fields(read)) {
          const own = resolve(node);
          const known = own && isNode(own.properties) ? Object.keys(own.properties) : [];
          findings.push({
            path: [...at, ...field],
            message: `\`input('${read}')\` names no field of this node, whose fields are ${known.join(", ") || "none"}. Paths are relative to the node a mutation sits on.`,
          });
        }
      }
    };
    visit(conditions, path);
  };

  // Mutations under conditions, at any node, applied when validating.
  const visitNode = (node: unknown, path: Path) => {
    if (!isNode(node)) return;
    if (Array.isArray(node.mutations)) {
      const keys = new Set<string>();
      const compiled: VariableMutationOperation[][] = [];
      (node.mutations as SchemaMutation[]).forEach((mutation, index) => {
        const at: Path = [...path, "mutations", index];
        if (!isNode(mutation)) return;
        if (keys.has(mutation.key)) {
          findings.push({
            path: [...at, "key"],
            message: `Mutation key "${mutation.key}" is used twice in this node.`,
          });
        }
        keys.add(mutation.key);
        const conditions = conditionsZodSchema.safeParse(mutation.conditions);
        if (!conditions.success) {
          for (const issue of conditions.error.issues) {
            findings.push({
              path: [...at, "conditions", ...(issue.path as Path)],
              message: issue.message,
            });
          }
        } else checkInputs(mutation.conditions, node, [...at, "conditions"]);
        const operations = compile(mutation.mutate, node, [...at, "mutate"], true);
        if (!operations) return;
        compiled.push(operations);
        validate(
          withNode(root, path, applyVariableOperations(node as never, operations)),
          at,
          `With mutation "${mutation.key}"`,
        );
      });
      // Every mutation can match together, so the rules must hold with all of them applied.
      if (compiled.length > 1 && compiled.length === node.mutations.length) {
        validate(
          withNode(root, path, applyVariableOperations(node as never, compiled.flat())),
          [...path, "mutations"],
          "With every mutation applied",
        );
      }
    }
    if (isNode(node.properties))
      for (const [key, property] of Object.entries(node.properties))
        visitNode(property, [...path, "properties", key]);
    if (isNode(node.items)) visitNode(node.items, [...path, "items"]);
    if (isNode(node.additionalProperties))
      visitNode(node.additionalProperties, [...path, "additionalProperties"]);
    if (Array.isArray(node.oneOf))
      node.oneOf.forEach((branch, i) => visitNode(branch, [...path, "oneOf", i]));
  };
  visitNode(root, []);

  return findings;
}

/** A copy of the root with the node at a path replaced, so the whole file can be validated. */
function withNode(root: unknown, path: Path, node: unknown): unknown {
  if (path.length === 0) return node;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = withNode(root[head as number], rest, node);
    return copy;
  }
  const record = root as Node;
  return { ...record, [head]: withNode(record[head as string], rest, node) };
}
