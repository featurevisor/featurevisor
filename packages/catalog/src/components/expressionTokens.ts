/**
 * Colours a condition expression by meaning, as the website's code blocks do, so the expression
 * view reads as a condition rather than one long string. A name followed by an operator is an
 * attribute, a name alone a segment, and `and`, `or`, `not` and a group's parentheses its
 * structure, with an indent guide a level inside a group. Ported from syntax-js's
 * src/lib/condition-expressions.js, which colours expressions in the documentation.
 */

export type ExpressionTokenType =
  | "name"
  | "segment"
  | "logic"
  | "operator"
  | "comment"
  | "call"
  | "string"
  | "constant"
  | "regex"
  | "punctuation"
  | "guide"
  | "plain";

export interface ExpressionToken {
  type: ExpressionTokenType;
  text: string;
}

const LOGIC = ["and", "or", "not"];
const CONSTANTS = ["true", "false", "null"];
const CALLS = ["feature", "variable", "semver"];
const WORD_OPERATORS = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "in",
  "notIn",
  "includes",
  "notIncludes",
  "includesAny",
  "notIncludesAny",
  "matches",
  "notMatches",
  "before",
  "after",
  "exists",
  "notExists",
  "isNull",
  "notNull",
  "empty",
  "notEmpty",
];

type Kind =
  | "space"
  | "newline"
  | "comment"
  | "string"
  | "regex"
  | "number"
  | "symbol"
  | "word"
  | "punctuation"
  | "other";

interface Lexed {
  kind: Kind;
  text: string;
  type?: ExpressionTokenType;
}

function lex(source: string): Lexed[] {
  const tokens: Lexed[] = [];
  let at = 0;
  let lineStart = true;
  const last = () => {
    for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].kind !== "space") return tokens[k];
    return null;
  };
  const rules: [Kind, RegExp, (() => boolean)?][] = [
    ["space", /^[ \t]+/],
    ["newline", /^\n/],
    ["comment", /^#[^\n]*/, () => lineStart],
    ["string", /^'(?:[^'\\\n]|\\.)*'/],
    [
      "regex",
      /^\/(?:[^/\\\n]|\\.)+\/[a-z]*/,
      () => ["matches", "notMatches"].includes(last()?.text ?? ""),
    ],
    ["number", /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
    ["symbol", /^(?:==|!=|>=|<=|>|<)/],
    ["word", /^[A-Za-z_][\w-]*(?:[./][A-Za-z_][\w-]*)*/],
    ["punctuation", /^[()[\],.*]/],
  ];
  while (at < source.length) {
    const rest = source.slice(at);
    let token: Lexed | null = null;
    for (const [kind, pattern, when] of rules) {
      const match = pattern.exec(rest);
      if (match && (!when || when())) {
        token = { kind, text: match[0] };
        break;
      }
    }
    token ??= { kind: "other", text: rest[0] };
    tokens.push(token);
    at += token.text.length;
    if (token.kind === "newline") lineStart = true;
    else if (token.kind !== "space") lineStart = false;
  }
  return tokens;
}

/** The colour of each token, from its neighbours */
function classify(tokens: Lexed[]): Lexed[] {
  const parentheses: ExpressionTokenType[] = [];
  const near = (k: number, step: number) => {
    for (let j = k + step; j >= 0 && j < tokens.length; j += step)
      if (tokens[j].kind !== "space") return tokens[j];
    return null;
  };
  const isOperator = (t: Lexed | null) =>
    !!t && (t.kind === "symbol" || (t.kind === "word" && WORD_OPERATORS.includes(t.text)));
  tokens.forEach((token, k) => {
    const before = near(k, -1);
    const after = near(k, 1);
    if (token.kind === "word") {
      if (LOGIC.includes(token.text)) token.type = "logic";
      else if (CONSTANTS.includes(token.text)) token.type = "constant";
      else if (after?.text === "(" && CALLS.includes(token.text)) token.type = "call";
      else if (
        WORD_OPERATORS.includes(token.text) &&
        before &&
        (before.kind === "word" || before.text === ")" || before.text === "]")
      )
        token.type = "operator";
      else if (
        before?.text === "." ||
        isOperator(after) ||
        after?.text === "." ||
        after?.text === "["
      )
        token.type = "name";
      else token.type = "segment";
    } else if (token.text === "(") {
      parentheses.push(before?.type === "call" ? "punctuation" : "logic");
      token.type = parentheses[parentheses.length - 1];
    } else if (token.text === ")") token.type = parentheses.pop() || "punctuation";
    else if (token.text === "*") token.type = "constant";
    else if (token.kind === "punctuation") token.type = "punctuation";
    else if (token.kind === "string") token.type = "string";
    else if (token.kind === "number") token.type = "constant";
    else if (token.kind === "symbol") token.type = "operator";
    else if (token.kind === "comment") token.type = "comment";
    else if (token.kind === "regex") token.type = "regex";
  });
  return tokens;
}

/** An expression's tokens, one list a line, with indent guides inside groups */
export function colourExpression(source: string): ExpressionToken[][] {
  const tokens = classify(lex(source));
  const lines: ExpressionToken[][] = [];
  let current: Lexed[] = [];
  let depth = 0;
  let lineDepth = 0;
  const flush = () => {
    const first = current.find((t) => t.kind !== "space");
    let guides = lineDepth;
    if (first?.text === ")" && first.type === "logic") guides -= 1;
    const line: ExpressionToken[] = [];
    current.forEach((token, k) => {
      if (k === 0 && token.kind === "space" && guides > 0) {
        const units = Math.min(guides, Math.floor(token.text.length / 2));
        for (let u = 0; u < units; u++) line.push({ type: "guide", text: "  " });
        const rest = token.text.slice(units * 2);
        if (rest) line.push({ type: "plain", text: rest });
      } else if (token.kind === "regex") {
        const end = token.text.lastIndexOf("/") + 1;
        line.push({ type: "regex", text: token.text.slice(0, end) });
        if (end < token.text.length) line.push({ type: "constant", text: token.text.slice(end) });
      } else line.push({ type: token.type || "plain", text: token.text });
    });
    lines.push(line);
    current = [];
    lineDepth = depth;
  };
  for (const token of tokens) {
    if (token.kind === "newline") {
      flush();
      continue;
    }
    if (token.type === "logic" && token.text === "(") depth++;
    if (token.type === "logic" && token.text === ")") depth--;
    current.push(token);
  }
  flush();
  return lines;
}
