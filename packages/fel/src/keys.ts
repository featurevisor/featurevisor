import type { FelOptions } from "./types.js";

export const DEFAULT_NAMESPACE_CHARACTER = ".";

const ENTITY_KEY_PATTERN = /^[a-zA-Z0-9_\-./]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNamespaceCharacter(options?: FelOptions): string {
  return options?.namespaceCharacter || DEFAULT_NAMESPACE_CHARACTER;
}

const namespacePatterns = new Map<string, RegExp>();

/**
 * The one rule for what an entity key looks like: letters, digits, `_`, `-`, `.` and `/`,
 * plus the project's namespace character. Lint checks every definition key with it, and
 * FEL reads a string of this shape in `conditions` as a segment key.
 */
export function isEntityKey(value: unknown, options?: FelOptions): value is string {
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
 * Whether a string in `conditions` is a FEL expression, read by its shape alone:
 * `'*'` is everyone, a string shaped like a key is a segment, and any other string is FEL.
 * Strings starting with `[` or `{` stay with the JSON decoding Core already applies.
 */
export function isExpression(value: unknown, options?: FelOptions): value is string {
  if (typeof value !== "string") return false;
  if (value === "*") return false;
  if (/^[[{]/.test(value)) return false;
  return !isEntityKey(value, options);
}

/** Characters FEL uses itself. A namespace character containing one makes some names ambiguous. */
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
 * character, except where the namespace character uses one of FEL's own characters.
 */
export function isNameCharacter(character: string, options?: FelOptions): boolean {
  if (/^[a-zA-Z0-9_\-./]$/.test(character)) return true;
  if (RESERVED_CHARACTERS.includes(character)) return false;
  return getNamespaceCharacter(options).includes(character);
}

export function getAmbiguousNamespaceCharacters(options?: FelOptions): string[] {
  const namespaceCharacter = getNamespaceCharacter(options);
  return RESERVED_CHARACTERS.filter((character) => namespaceCharacter.includes(character));
}
