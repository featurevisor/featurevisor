import type { Schema, VariableMutationOperation, VariableMutations } from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";
import type { z } from "zod";

import type { AllowedConditions } from "../config";
import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import { compileVariableMutation } from "../builder/variableOverrideProgram";
import { getSchemaReferences } from "../targeting";
import { getInputLeafIssues } from "./conditionSchema";

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

/** A node's lists of mutations: its list, or at a schema's root its list per environment. */
function mutationLists(mutations: unknown): unknown[][] {
  if (Array.isArray(mutations)) return [mutations];
  return isNode(mutations) ? Object.values(mutations).filter(Array.isArray) : [];
}

/** Whether a schema has rules that change, by environment or under conditions, at any node. */
function hasChangingRules(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (mutationLists(node.mutations).some((list) => list.length > 0)) return true;
  if (Array.isArray(node.issues) && node.issues.length > 0) return true;
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
  projectConfig: { environments?: unknown; allowedConditions?: AllowedConditions };
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
  options: MutationLintOptions,
): MutationFinding[] {
  const { projectConfig, schemasByKey, schemaZodSchema, conditionsZodSchema } = options;
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

  /** Reports a resolved or mutated schema's issues under the entry that made it, and whether it passed. */
  const validate = (schema: unknown, path: Path, what: string): boolean => {
    const result = schemaZodSchema.safeParse(schema);
    if (result.success) return true;
    for (const issue of result.error.issues) {
      findings.push({
        path,
        message: `${what}, the schema fails: ${issue.message} (at ${issue.path.join(".") || "the root"})`,
      });
    }
    return false;
  };

  /** The field a dot path names in a node, through references, or undefined when there is none. */
  const fieldAt = (node: Node, fieldPath: string): Node | undefined => {
    let current: Node | undefined = resolve(node);
    let field: Node | undefined;
    for (const part of fieldPath.split(".")) {
      const properties = current && isNode(current.properties) ? current.properties : undefined;
      if (!properties || !hasOwn(properties, part) || !isNode(properties[part])) return undefined;
      field = properties[part] as Node;
      current = resolve(field);
    }
    return field;
  };
  const namesField = (node: Node, fieldPath: string): boolean => !!fieldAt(node, fieldPath);
  const fieldNames = (node: Node): string => {
    const own = resolve(node);
    return (own && isNode(own.properties) ? Object.keys(own.properties) : []).join(", ") || "none";
  };

  /** Checks the `input` leaves of a mutation's or an issue's conditions against the fields of its node. */
  const checkInputs = (conditions: unknown, node: Node, path: Path) => {
    const visit = (value: unknown, at: Path) => {
      if (Array.isArray(value)) return value.forEach((child, i) => visit(child, [...at, i]));
      if (!isNode(value)) return;
      for (const group of ["and", "or", "not"])
        if (Array.isArray(value[group])) visit(value[group], [...at, group]);
      for (const [field, read] of [
        [["input"], value.input],
        [["valueFrom", "input"], isNode(value.valueFrom) ? value.valueFrom.input : undefined],
      ] as const) {
        if (typeof read === "string" && !namesField(node, read)) {
          findings.push({
            path: [...at, ...field],
            message: `\`input('${read}')\` names no field of this node, whose fields are ${fieldNames(node)}. Paths are relative to the node a mutation or an issue sits on.`,
          });
        }
      }
      // The operator and value must suit the field compared, as an attribute's must.
      if (typeof value.input !== "string" || typeof value.operator !== "string") return;
      const own = fieldAt(node, value.input);
      const from = isNode(value.valueFrom) ? value.valueFrom.input : undefined;
      const other = typeof from === "string" ? fieldAt(node, from) : undefined;
      if (!own || (typeof from === "string" && !other)) return;
      for (const issue of getInputLeafIssues(
        value as never,
        own as never,
        other as never,
        schemasByKey,
      ))
        findings.push({ path: [...at, ...issue.path], message: issue.message });
    };
    visit(conditions, path);
  };

  /** Checks conditions as conditions, and their `input` leaves against the node's fields. */
  const checkConditions = (conditions: unknown, node: Node, at: Path): boolean => {
    const parsed = conditionsZodSchema.safeParse(conditions);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        findings.push({ path: [...at, ...(issue.path as Path)], message: issue.message });
      return false;
    }
    checkInputs(conditions, node, at);
    return true;
  };

  /** Issues an object reports when their conditions match, after its own rules, nested at any depth. */
  const checkIssues = (node: Node, path: Path) => {
    const own = resolve(node);
    if (!own || (own.type !== "object" && !isNode(own.properties))) {
      findings.push({
        path: [...path, "issues"],
        message:
          "`issues` goes on object nodes only, since its entries compare an object's fields.",
      });
      return;
    }
    // Keys are unique across the whole tree, since each is an issue's `params.refine`.
    const keys = new Set<string>();
    const visitEntries = (list: unknown, at: Path, readsAbove: boolean) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry, index) => {
        const here: Path = [...at, index];
        if (!isNode(entry)) return;
        if (keys.has(entry.key as string)) {
          findings.push({
            path: [...here, "key"],
            message: `Issue key "${entry.key}" is used twice in this node.`,
          });
        }
        keys.add(entry.key as string);
        const valid = checkConditions(entry.conditions, node, [...here, "conditions"]);
        // An entry nested under others matches only when they do, so their inputs count too.
        const reads = readsAbove || (valid && readsInput(entry.conditions));
        const nested = Array.isArray(entry.issues) ? entry.issues : undefined;
        if (entry.message === undefined) {
          if (!nested) {
            findings.push({
              path: [...here, "message"],
              message:
                "An issue needs a `message`, or `issues` nested under it, which it groups under its conditions.",
            });
          } else if (entry.path !== undefined) {
            findings.push({
              path: [...here, "path"],
              message:
                "An issue's `path` says where its `message` goes, so an entry that only groups others takes none.",
            });
          }
        } else if (valid && !reads) {
          findings.push({
            path: [...here, "conditions"],
            message:
              "An issue's conditions read at least one `input`, or it would fail every value for everyone they match. They say when a value fails, such as `input('confirmPassword') != input('password')`.",
          });
        }
        if (typeof entry.path === "string" && !namesField(node, entry.path)) {
          findings.push({
            path: [...here, "path"],
            message: `\`${entry.path}\` names no field of this node, whose fields are ${fieldNames(node)}. An issue's path is relative to the node it sits on.`,
          });
        }
        visitEntries(nested, [...here, "issues"], reads);
      });
    };
    visitEntries(node.issues, [...path, "issues"], false);
  };

  /**
   * One list of a node's mutations, at a path, nested at any depth: each
   * mutation after the ones it is nested in, then all of them together.
   */
  const checkMutations = (node: Node, path: Path, list: unknown[], at: Path) => {
    // Keys are unique across the whole tree, since an issue names the mutation by its key.
    const keys = new Set<string>();
    const all: VariableMutationOperation[][] = [];
    let complete = true;
    /** `chain` holds the operations of the mutations it is nested in, or undefined when one failed. */
    const visitList = (
      entries: unknown,
      at: Path,
      chain: VariableMutationOperation[][] | undefined,
    ) => {
      if (!Array.isArray(entries)) return;
      entries.forEach((mutation, index) => {
        const here: Path = [...at, index];
        if (!isNode(mutation)) return;
        if (keys.has(mutation.key as string)) {
          findings.push({
            path: [...here, "key"],
            message: `Mutation key "${mutation.key}" is used twice in this node.`,
          });
        }
        keys.add(mutation.key as string);
        checkConditions(mutation.conditions, node, [...here, "conditions"]);
        const nested = Array.isArray(mutation.mutations) ? mutation.mutations : undefined;
        let next = chain;
        if (mutation.mutate === undefined) {
          if (!nested) {
            findings.push({
              path: [...here, "mutate"],
              message:
                "A mutation needs a `mutate`, or `mutations` nested under it, which it groups under its conditions.",
            });
          }
        } else if (!chain) {
          complete = false;
        } else {
          // A nested mutation changes what the ones around it leave, so it can reach what they add.
          const before = chain.length ? applyVariableOperations(node as never, chain.flat()) : node;
          const operations = compile(mutation.mutate, before, [...here, "mutate"], true);
          if (!operations) {
            complete = false;
            next = undefined;
          } else {
            all.push(operations);
            next = [...chain, operations];
            validate(
              withNode(root, path, applyVariableOperations(node as never, next.flat())),
              here,
              `With mutation "${mutation.key}"`,
            );
          }
        }
        visitList(nested, [...here, "mutations"], next);
      });
    };
    visitList(list, at, []);
    // Every mutation can match together, so the rules must hold with all of them applied.
    if (complete && all.length > 1) {
      validate(
        withNode(root, path, applyVariableOperations(node as never, all.flat())),
        at,
        "With every mutation applied",
      );
    }
  };

  const configured = Array.isArray(projectConfig.environments)
    ? (projectConfig.environments as string[])
    : undefined;

  // Mutations under conditions, at any node, applied when validating.
  const visitNode = (node: unknown, path: Path) => {
    if (!isNode(node)) return;
    const mutations = node.mutations;
    if (Array.isArray(mutations)) {
      if (path.length === 0 && configured) {
        findings.push({
          path: ["mutations"],
          message: `In a project with environments, a schema's root \`mutations\` go under environment names, as features' rules do, such as \`mutations: { ${configured[configured.length - 1]}: [...] }\`. A field's own mutations stay a list.`,
        });
      }
      checkMutations(node, path, mutations, [...path, "mutations"]);
    } else if (isNode(mutations)) {
      if (path.length > 0) {
        findings.push({
          path: [...path, "mutations"],
          message:
            "Only a schema's root lists its mutations by environment. A field's mutations are a list, the same in every environment.",
        });
      } else if (!configured) {
        findings.push({
          path: ["mutations"],
          message:
            "Mutations by environment need a project with environments, so this schema's `mutations` are a list. In a project with sets, each set has its own schema files.",
        });
      } else {
        for (const [environment, list] of Object.entries(mutations)) {
          const at: Path = ["mutations", environment];
          if (!configured.includes(environment)) {
            findings.push({
              path: at,
              message: `Unknown environment "${environment}". Environments: ${configured.join(", ")}.`,
            });
          } else if (Array.isArray(list)) checkMutations(node, path, list, at);
        }
      }
    }
    if (Array.isArray(node.issues)) checkIssues(node, path);
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

/** Whether conditions read the value validated, through any group. */
function readsInput(conditions: unknown): boolean {
  if (Array.isArray(conditions)) return conditions.some(readsInput);
  if (!isNode(conditions)) return false;
  if (typeof conditions.input === "string") return true;
  return ["and", "or", "not"].some((group) => readsInput(conditions[group]));
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
