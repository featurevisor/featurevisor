import type { ExpressionOptions } from "./types.js";

export const DEFAULT_NAMESPACE_CHARACTER = ".";

const ENTITY_KEY_PATTERN = /^[a-zA-Z0-9_\-./]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNamespaceCharacter(options?: ExpressionOptions): string {
  return options?.namespaceCharacter || DEFAULT_NAMESPACE_CHARACTER;
}

const namespacePatterns = new Map<string, RegExp>();

/**
 * The one rule for what an entity key looks like: letters, digits, `_`, `-`, `.` and `/`,
 * plus the project's namespace character. Lint checks every definition key with it, and
 * a string of this shape in `conditions` reads as a segment key.
 */
export function isEntityKey(value: unknown, options?: ExpressionOptions): value is string {
  if (typeof value !== "string") return false;
  const namespaceCharacter = getNamespaceCharacter(options);
  let pattern = namespacePatterns.get(namespaceCharacter);
  if (!pattern) {
    pattern = new RegExp(escapeRegExp(namespaceCharacter), "g");
    namespacePatterns.set(namespaceCharacter, pattern);
  }
  return ENTITY_KEY_PATTERN.test(value.replace(pattern, ""));
}

/**
 * Whether a string in `conditions` is an expression, read by its shape alone:
 * `'*'` is everyone, a string shaped like a key is a segment, and any other string is an expression.
 * Strings starting with `[` or `{` stay with the JSON decoding Core already applies.
 */
export function isExpression(value: unknown, options?: ExpressionOptions): value is string {
  if (typeof value !== "string") return false;
  if (value === "*") return false;
  if (/^[[{]/.test(value)) return false;
  return !isEntityKey(value, options);
}

/** Characters expressions use themselves. A namespace character containing one makes some names ambiguous. */
export const RESERVED_CHARACTERS = [
  " ",
  "\t",
  "\n",
  "\r",
  "=",
  "!",
  "<",
  ">",
  "(",
  ")",
  "[",
  "]",
  "'",
  '"',
  ",",
  "#",
];

/**
 * Characters a name may contain in an expression: the key characters plus the namespace
 * character, except where the namespace character uses one of the characters expressions use.
 */
export function isNameCharacter(character: string, options?: ExpressionOptions): boolean {
  if (/^[a-zA-Z0-9_\-./]$/.test(character)) return true;
  if (RESERVED_CHARACTERS.includes(character)) return false;
  return getNamespaceCharacter(options).includes(character);
}

export function getAmbiguousNamespaceCharacters(options?: ExpressionOptions): string[] {
  const namespaceCharacter = getNamespaceCharacter(options);
  return RESERVED_CHARACTERS.filter((character) => namespaceCharacter.includes(character));
}
