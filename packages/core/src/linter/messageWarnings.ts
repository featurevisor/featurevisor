import type { Schema } from "@featurevisor/types";

type Node = Record<string, unknown>;
type Path = (string | number)[];

export interface MessageWarning {
  path: Path;
  code: "message_never_shown" | "message_worded_twice";
  message: string;
}

/** Codes that need a value of one type, so a message for them on a field of another never shows. */
const CODE_TYPES: Record<string, string[]> = {
  minLength: ["string"],
  maxLength: ["string"],
  pattern: ["string"],
  format: ["string"],
  minimum: ["integer", "number"],
  maximum: ["integer", "number"],
  minItems: ["array"],
  maxItems: ["array"],
  uniqueItems: ["array"],
  additionalProperties: ["object"],
};

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolve(
  node: unknown,
  schemas: Record<string, Schema>,
  seen = new Set<string>(),
): Node | undefined {
  if (!isNode(node)) return undefined;
  if (typeof node.schema === "string") {
    if (seen.has(node.schema)) return undefined;
    seen.add(node.schema);
    return resolve(schemas[node.schema], schemas, seen);
  }
  return node;
}

function kindOfValue(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * The kinds of value a `oneOf` branch takes, or undefined when the branch alone
 * cannot say, as `@featurevisor/schemas` works them out: by its `type`, its
 * `const` or its `enum`, and never through a `oneOf` of its own.
 */
function kindsOf(node: Node | undefined): string[] | undefined {
  if (!node || Array.isArray(node.oneOf)) return undefined;
  if (typeof node.type === "string") return [node.type === "integer" ? "number" : node.type];
  if ("const" in node) return [kindOfValue(node.const)];
  if (Array.isArray(node.enum)) return Array.from(new Set(node.enum.map(kindOfValue)));
  return undefined;
}

/** Whether each branch of a `oneOf` takes a type no other branch does, so the value's type selects one. */
function typeSelectsBranch(node: Node, schemas: Record<string, Schema>): boolean {
  const kinds = (node.oneOf as unknown[]).map((branch) => kindsOf(resolve(branch, schemas)));
  if (kinds.some((set) => !set)) return false;
  const all = kinds.flat() as string[];
  return new Set(all).size === all.length;
}

/** The types a node's issues can come from: its own, or a type selected branch's. */
function nodeTypes(node: Node | undefined, schemas: Record<string, Schema>): string[] | undefined {
  if (!node) return undefined;
  if (typeof node.type === "string") return [node.type];
  if (Array.isArray(node.oneOf)) {
    if (!typeSelectsBranch(node, schemas)) return [];
    const types: string[] = [];
    for (const branch of node.oneOf) {
      const resolved = resolve(branch, schemas);
      if (resolved && typeof resolved.type === "string") types.push(resolved.type);
    }
    return types;
  }
  return undefined;
}

/** The node a field of `node` is, through references and type selected `oneOf` branches. */
function field(
  node: Node | undefined,
  key: string,
  schemas: Record<string, Schema>,
): Node | undefined {
  if (!node) return undefined;
  const branches = Array.isArray(node.oneOf)
    ? node.oneOf.map((branch) => resolve(branch, schemas))
    : [node];
  for (const branch of branches) {
    if (!branch) continue;
    if (key === "[]" && branch.type === "array") return resolve(branch.items, schemas);
    if (key === "*" && isNode(branch.additionalProperties))
      return resolve(branch.additionalProperties, schemas);
    if (isNode(branch.properties) && Object.prototype.hasOwnProperty.call(branch.properties, key)) {
      return resolve(branch.properties[key], schemas);
    }
  }
  return undefined;
}

/** Whether a node is a `oneOf` whose every branch is a `const`, which reports `enum` as one node. */
function isChoiceList(node: Node | undefined, schemas: Record<string, Schema>): boolean {
  return Boolean(
    node &&
    Array.isArray(node.oneOf) &&
    node.oneOf.length > 0 &&
    node.oneOf.every((branch) => {
      const resolved = resolve(branch, schemas);
      return Boolean(resolved && "const" in resolved);
    }),
  );
}

function neverShown(
  code: string,
  node: Node | undefined,
  schemas: Record<string, Schema>,
): string | undefined {
  if (isChoiceList(node, schemas)) {
    if (code === "enum" || code === "required" || code === "refine" || code === "refineError")
      return undefined;
    return "a oneOf whose every branch is a const reports enum for itself, as an enum does, so word it with the enum code";
  }
  const types = nodeTypes(node, schemas);
  if (!types) return undefined;
  if (node && Array.isArray(node.oneOf) && types.length === 0) {
    if (code === "oneOf" || code === "required" || code === "refine" || code === "refineError")
      return undefined;
    return "a oneOf whose branches do not each take a different type reports one oneOf issue for itself, so its branches' issues never show. Word it with the oneOf code on this node";
  }
  const needs = CODE_TYPES[code];
  if (!needs || types.some((type) => needs.includes(type))) return undefined;
  return `"${code}" is raised only for a value of type ${needs.join(" or ")}, and this field is ${types.join(" or ")}`;
}

/**
 * Messages in one schema file that can never show: one for a code its field
 * cannot raise, such as `maxLength` on a number, one beside the rules of a
 * `oneOf` branch that the value's type cannot select, and one that an
 * enclosing object's `messages` already word for the same field and code,
 * since the outermost wins.
 */
export function getMessageWarnings(
  root: unknown,
  schemas: Record<string, Schema>,
): MessageWarning[] {
  const warnings: MessageWarning[] = [];
  type Enclosing = { messages: Node; fieldPath: string[] };

  const checkMap = (owner: Node | undefined, messages: Node, path: Path) => {
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value === "string") {
        const reason = neverShown(key, owner, schemas);
        if (reason) {
          warnings.push({
            path: [...path, key],
            code: "message_never_shown",
            message: `This message never shows: ${reason}.`,
          });
        }
      } else if (isNode(value)) {
        checkMap(field(owner, key, schemas), value, [...path, key]);
      }
    }
  };

  const visit = (
    node: unknown,
    path: Path,
    fieldPath: string[],
    enclosing: Enclosing[],
    inUnselectableBranch: boolean,
  ) => {
    if (!isNode(node)) return;
    const messages = isNode(node.messages) ? node.messages : undefined;

    if (messages) {
      checkMap(resolve(node, schemas), messages, [...path, "messages"]);
      for (const [code, value] of Object.entries(messages)) {
        if (typeof value !== "string") continue;
        if (inUnselectableBranch) {
          warnings.push({
            path: [...path, "messages", code],
            code: "message_never_shown",
            message:
              "This message never shows: it sits in a branch of a oneOf whose branches do not each take a different type, which reports one oneOf issue for itself.",
          });
          continue;
        }
        // The outermost object that words a field wins, so wording it again here is dead.
        for (const outer of enclosing) {
          let worded: unknown = outer.messages;
          for (const key of fieldPath.slice(outer.fieldPath.length)) {
            worded = isNode(worded) ? worded[key] : undefined;
          }
          if (
            isNode(worded) &&
            typeof worded[code] === "string" &&
            outer.fieldPath.length < fieldPath.length
          ) {
            warnings.push({
              path: [...path, "messages", code],
              code: "message_worded_twice",
              message: `An enclosing object's messages already word "${code}" for this field, and the outermost wins, so this one never shows.`,
            });
            break;
          }
        }
      }
    }

    const inner = messages ? [...enclosing, { messages, fieldPath }] : enclosing;
    if (isNode(node.properties)) {
      for (const [key, property] of Object.entries(node.properties)) {
        visit(property, [...path, "properties", key], [...fieldPath, key], inner, false);
      }
    }
    if (isNode(node.items))
      visit(node.items, [...path, "items"], [...fieldPath, "[]"], inner, false);
    if (isNode(node.additionalProperties)) {
      visit(
        node.additionalProperties,
        [...path, "additionalProperties"],
        [...fieldPath, "*"],
        inner,
        false,
      );
    }
    if (Array.isArray(node.oneOf)) {
      // A list of choices validates as one node, so its branches' messages never show either.
      const selects = !isChoiceList(node, schemas) && typeSelectsBranch(node, schemas);
      node.oneOf.forEach((branch, index) =>
        visit(
          branch,
          [...path, "oneOf", index],
          fieldPath,
          inner,
          inUnselectableBranch || !selects,
        ),
      );
    }
  };

  visit(root, [], [], [], false);
  return warnings;
}
