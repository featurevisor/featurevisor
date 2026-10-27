import type { Conditions, Operator } from "@featurevisor/types";

import { compile } from "./compile.js";
import { isExpression, isNameCharacter } from "./keys.js";
import {
  KEYWORDS,
  LIST_OPERATORS,
  OPERATOR_SPELLINGS,
  REGEX_OPERATORS,
  TEXT_OPERATORS,
  isOperator,
} from "./operators.js";
import type { FelOptions, FelPrintOptions } from "./types.js";

const DEFAULT_WIDTH = 80;

type Printed = { text: string; group?: "and" | "or" };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function quoteString(value: string): string {
  let result = "'";
  for (const character of value) {
    if (character === "'") result += "\\'";
    else if (character === "\\") result += "\\\\";
    else if (character === "\n") result += "\\n";
    else if (character === "\t") result += "\\t";
    else if (character < " " || character === "\u007f") {
      result += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else result += character;
  }
  return `${result}'`;
}

/** Whether a key can be written bare, as a segment or attribute name. */
function isBareName(name: string, options: FelOptions): boolean {
  if (!name) return false;
  if (KEYWORDS.includes(name.toLowerCase())) return false;
  for (const character of name) {
    if (!isNameCharacter(character, options)) return false;
  }
  return true;
}

function printValue(value: unknown): string | undefined {
  if (typeof value === "string") return quoteString(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const items = value.map((item) => (Array.isArray(item) ? undefined : printValue(item)));
    return items.every((item) => item !== undefined) ? `[${items.join(", ")}]` : undefined;
  }
  return undefined;
}

function printRegex(pattern: unknown, flags: unknown): string | undefined {
  if (typeof pattern !== "string" || pattern === "" || /[\n\r]/.test(pattern)) return undefined;
  // `\/` already reads as a slash in a literal, so a pattern holding it cannot round trip.
  if (pattern.includes("\\/")) return undefined;
  if (flags !== undefined && (typeof flags !== "string" || !/^[gims]*$/.test(flags)))
    return undefined;
  return `/${pattern.replace(/\//g, "\\/")}/${flags ?? ""}`;
}

function printPath(path: unknown): string | undefined {
  if (path === undefined) return "";
  const segments =
    typeof path === "string"
      ? path.split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
      : path;
  if (!Array.isArray(segments)) return undefined;
  let result = "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Number.isInteger(segment) || segment < 0) return undefined;
      result += `[${segment}]`;
    } else if (typeof segment === "string") {
      result +=
        /^[a-zA-Z0-9_-]+$/.test(segment) && !/^(0|[1-9]\d*)$/.test(segment)
          ? `.${segment}`
          : `[${quoteString(segment)}]`;
    } else return undefined;
  }
  return result;
}

function printComparison(subject: string, condition: Record<string, unknown>): string | undefined {
  const operator = condition.operator;
  if (typeof operator !== "string" || !isOperator(operator)) return undefined;
  const spelling = OPERATOR_SPELLINGS[operator as Operator];
  const value = condition.value;
  const hasValue = Object.prototype.hasOwnProperty.call(condition, "value");
  const regexFlags = condition.regexFlags;
  if (regexFlags !== undefined && !REGEX_OPERATORS.includes(operator as Operator)) return undefined;

  if (spelling.form === "postfix") return hasValue ? undefined : `${subject} ${operator}`;
  if (!hasValue) return undefined;

  if (spelling.form === "symbol") {
    if (Array.isArray(value)) return undefined;
    if (spelling.semver) {
      return typeof value === "string"
        ? `${subject} ${spelling.symbol} semver(${quoteString(value)})`
        : undefined;
    }
    if (["<", "<=", ">", ">="].includes(spelling.symbol) && typeof value !== "number")
      return undefined;
    const printed = printValue(value);
    return printed === undefined ? undefined : `${subject} ${spelling.symbol} ${printed}`;
  }

  if (REGEX_OPERATORS.includes(operator as Operator)) {
    const regex = printRegex(value, regexFlags);
    return regex === undefined ? undefined : `${subject} ${operator} ${regex}`;
  }
  if (LIST_OPERATORS.includes(operator as Operator)) {
    if (!Array.isArray(value)) return undefined;
  } else if (Array.isArray(value)) return undefined;
  if (TEXT_OPERATORS.includes(operator as Operator) && typeof value !== "string") return undefined;
  const printed = printValue(value);
  return printed === undefined ? undefined : `${subject} ${operator} ${printed}`;
}

function printLeaf(value: unknown, options: FelOptions): string | undefined {
  if (typeof value === "string") {
    return value !== "*" && !isExpression(value, options) && isBareName(value, options)
      ? value
      : undefined;
  }
  if (!isObject(value)) return undefined;

  if (typeof value.attribute === "string") {
    if (!hasOnlyKeys(value, ["attribute", "operator", "value", "regexFlags"])) return undefined;
    if (!isBareName(value.attribute, options)) return undefined;
    return printComparison(value.attribute, value);
  }

  if (typeof value.variable === "string") {
    if (!hasOnlyKeys(value, ["feature", "variable", "path", "operator", "value", "regexFlags"])) {
      return undefined;
    }
    if (value.variable === "") return undefined;
    const path = printPath(value.path);
    if (path === undefined) return undefined;
    let subject: string;
    if (value.feature !== undefined) {
      if (typeof value.feature !== "string" || value.feature === "") return undefined;
      const key =
        /^[a-zA-Z0-9_-]+$/.test(value.variable) &&
        !/^(0|[1-9]\d*)$/.test(value.variable) &&
        value.variable !== "variation"
          ? `.${value.variable}`
          : `[${quoteString(value.variable)}]`;
      subject = `feature(${quoteString(value.feature)})${key}${path}`;
    } else {
      subject = `variable(${quoteString(value.variable)})${path}`;
    }
    return printComparison(subject, value);
  }

  if (typeof value.feature === "string") {
    if (!hasOnlyKeys(value, ["feature", "enabled", "variation"]) || value.feature === "") {
      return undefined;
    }
    const subject = `feature(${quoteString(value.feature)})`;
    const hasEnabled = Object.prototype.hasOwnProperty.call(value, "enabled");
    const hasVariation = Object.prototype.hasOwnProperty.call(value, "variation");
    if (hasVariation) {
      // A disabled feature's variation has no FEL form. It stays a tree.
      // `enabled: true` beside a variation adds nothing, since a variation check already needs
      // the feature enabled. Only exact printing keeps such a leaf a tree.
      const redundantEnabled =
        (options as FelPrintOptions).exact === false && value.enabled === true;
      if ((hasEnabled && !redundantEnabled) || typeof value.variation !== "string")
        return undefined;
      return `${subject}.variation == ${quoteString(value.variation)}`;
    }
    if (hasEnabled) {
      return typeof value.enabled === "boolean" ? `${subject} == ${value.enabled}` : undefined;
    }
    return subject;
  }

  return undefined;
}

function printGroup(
  children: unknown,
  join: "and" | "or",
  options: FelOptions,
): string[] | undefined {
  if (!Array.isArray(children) || children.length === 0) return undefined;
  const parts: string[] = [];
  for (const child of children) {
    const printed = printNode(child, options);
    if (!printed) return undefined;
    parts.push(printed.group ? `(${printed.text})` : printed.text);
  }
  return parts;
}

function printNode(value: unknown, options: FelOptions): Printed | undefined {
  if (isObject(value)) {
    const groupKeys = ["and", "or", "not"].filter((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
    if (groupKeys.length) {
      if (groupKeys.length > 1 || Object.keys(value).length !== 1) return undefined;
      const key = groupKeys[0] as "and" | "or" | "not";
      const children = value[key];
      if (key === "not") {
        if (!Array.isArray(children) || children.length === 0) return undefined;
        if (children.length === 1) {
          const child = printNode(children[0], options);
          if (!child) return undefined;
          return { text: child.group ? `not (${child.text})` : `not ${child.text}` };
        }
        const parts = printGroup(children, "and", options);
        return parts ? { text: `not (${parts.join(" and ")})` } : undefined;
      }
      const parts = printGroup(children, key, options);
      return parts ? { text: parts.join(` ${key} `), group: key } : undefined;
    }
  }
  const text = printLeaf(value, options);
  return text === undefined ? undefined : { text };
}

/** Top level operands of a printed value, for breaking long expressions over lines. */
function printOperands(
  value: Conditions,
  options: FelOptions,
): { parts: string[]; join: "and" | "or" } | undefined {
  if (Array.isArray(value)) {
    const parts = printGroup(value, "and", options);
    return parts ? { parts, join: "and" } : undefined;
  }
  if (isObject(value) && Object.keys(value).length === 1) {
    for (const key of ["and", "or"] as const) {
      if (Array.isArray(value[key])) {
        const parts = printGroup(value[key], key, options);
        return parts ? { parts, join: key } : undefined;
      }
    }
  }
  return undefined;
}

/**
 * FEL text for a whole `conditions` value, or undefined when part of it has no FEL form.
 * A list prints as its items joined with `and`. Long expressions break before each top level
 * `and` or `or`, one operand per line.
 */
export function print(value: Conditions, options: FelPrintOptions = {}): string | undefined {
  const width = options.width ?? DEFAULT_WIDTH;
  const operands = printOperands(value, options);
  if (operands) {
    const line = operands.parts.join(` ${operands.join} `);
    if (line.length <= width || operands.parts.length < 2) return line;
    return [
      operands.parts[0],
      ...operands.parts.slice(1).map((part) => `${operands.join} ${part}`),
    ].join("\n");
  }
  return printNode(value, options)?.text;
}

/** How a printed string reads back, following the same rules as reading a project. */
function readBack(text: string, root: boolean, options: FelOptions): unknown {
  if (!isExpression(text, options)) return text;
  const result = compile(text, { ...options, root });
  return result.errors.length ? undefined : result.conditions;
}

/**
 * Variable paths written as dotted strings become arrays when a datafile is built, exactly as
 * an expression's path does, so both are compared in that built form.
 */
function asBuilt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asBuilt);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "path" && typeof child === "string" && typeof value.variable === "string") {
      result[key] = child
        .split(".")
        .map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
    } else result[key] = asBuilt(child);
  }
  return result;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(asBuilt(left)) === JSON.stringify(asBuilt(right));
}

/**
 * A tree in a form where trees that mean the same compare equal: keys sorted, a whole value's
 * `{ and: [...] }` or single item list read as its items, a `not` around one `and` group read
 * as `not` over its items, and `enabled: true` beside a variation dropped.
 */
function meaning(value: unknown, root: boolean): unknown {
  if (root && isObject(value) && Object.keys(value).length === 1 && Array.isArray(value.and)) {
    return meaning(value.and, true);
  }
  if (root && Array.isArray(value) && value.length === 1) return meaning(value[0], false);
  if (Array.isArray(value)) return value.map((item) => meaning(item, false));
  if (!isObject(value)) return value;
  if (Array.isArray(value.not) && value.not.length === 1 && isObject(value.not[0])) {
    const inner = value.not[0];
    if (Object.keys(inner).length === 1 && Array.isArray(inner.and)) {
      return { not: inner.and.map((item) => meaning(item, false)) };
    }
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (
      key === "enabled" &&
      value.enabled === true &&
      typeof value.feature === "string" &&
      "variation" in value
    ) {
      continue;
    }
    result[key] = meaning(value[key], false);
  }
  return result;
}

function printExactly(value: unknown, root: boolean, options: FelPrintOptions): string | undefined {
  const text = root ? print(value as Conditions, options) : printNode(value, options)?.text;
  if (text === undefined || !isExpression(text, options)) return undefined;
  const read = readBack(text, root, options);
  if (options.exact === false) {
    return JSON.stringify(meaning(asBuilt(read), root)) ===
      JSON.stringify(meaning(asBuilt(value), root))
      ? text
      : undefined;
  }
  return sameJson(read, value) ? text : undefined;
}

/**
 * Converts a `conditions` value to FEL wherever the result reads back to exactly the same
 * tree, key order included, so a converted project builds identical datafiles. A leaf
 * without an exact FEL form stays an object, and only the smallest group around it stays a
 * tree: a list keeps its items, and a group's children can be FEL strings.
 */
export function toFel(value: Conditions, options: FelPrintOptions = {}): Conditions {
  if (typeof value === "string") return value;
  const whole = printExactly(value, true, options);
  if (whole !== undefined) return whole;

  const convert = (node: unknown): unknown => {
    if (typeof node === "string") return node;
    const text = printExactly(node, false, options);
    if (text !== undefined) return text;
    if (isObject(node) && Object.keys(node).length === 1) {
      for (const key of ["and", "or", "not"]) {
        if (Array.isArray(node[key])) return { [key]: (node[key] as unknown[]).map(convert) };
      }
    }
    return node;
  };

  if (Array.isArray(value)) return value.map(convert) as Conditions;
  // A whole value that is a single group keeps its object, since `a and b` alone reads as a list.
  if (isObject(value) && Object.keys(value).length === 1) {
    for (const key of ["and", "or", "not"]) {
      if (Array.isArray(value[key]))
        return { [key]: (value[key] as unknown[]).map(convert) } as unknown as Conditions;
    }
  }
  return value;
}
