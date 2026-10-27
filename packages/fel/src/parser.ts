import type { Operator } from "@featurevisor/types";

import { getAmbiguousNamespaceCharacters, isNameCharacter } from "./keys.js";
import {
  KEYWORDS,
  LIST_OPERATORS,
  NAMED_NEGATIVES,
  OPERATOR_SPELLINGS,
  POSTFIX_OPERATORS,
  REGEX_OPERATORS,
  SYMBOL_OPERATORS,
  TEXT_OPERATORS,
  WORD_OPERATORS,
  type Symbol,
} from "./operators.js";
import { createPositionResolver } from "./position.js";
import type {
  FelComparison,
  FelError,
  FelLeafNode,
  FelNode,
  FelOptions,
  FelParseResult,
  FelValue,
} from "./types.js";

export const DEFAULT_MAX_LENGTH = 10000;
export const DEFAULT_MAX_DEPTH = 64;

interface RawIssue {
  code: string;
  message: string;
  start: number;
  end: number;
  hint?: string;
}

class ParseFailure {
  constructor(readonly issue: RawIssue) {}
}

/** Tree operator names authors may reach for, with how FEL writes them. */
const TREE_OPERATOR_HINTS: Record<string, string> = {
  equals: "==",
  notEquals: "!=",
  greaterThan: ">",
  greaterThanOrEquals: ">=",
  lessThan: "<",
  lessThanOrEquals: "<=",
  semverEquals: "== semver('...')",
  semverNotEquals: "!= semver('...')",
  semverGreaterThan: "> semver('...')",
  semverGreaterThanOrEquals: ">= semver('...')",
  semverLessThan: "< semver('...')",
  semverLessThanOrEquals: "<= semver('...')",
};

/** `not in` and the like, which FEL spells as one word. */
const SPACED_NEGATIVES: Record<string, string> = {
  in: "notIn",
  contains: "notContains",
  includes: "notIncludes",
  includesAny: "notIncludesAny",
  matches: "notMatches",
  exists: "notExists",
  null: "notNull",
  empty: "notEmpty",
};

const ALL_OPERATOR_WORDS = [...WORD_OPERATORS, ...POSTFIX_OPERATORS] as string[];

function describe(source: string, start: number, end: number): string {
  const text = source.slice(start, end);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function outerStart(node: FelNode): number {
  return node.outerStart ?? node.start;
}

function outerEnd(node: FelNode): number {
  return node.outerEnd ?? node.end;
}

class Parser {
  private pos = 0;
  readonly warnings: RawIssue[] = [];
  private readonly maxDepth: number;
  /** The last leaf parsed, to explain what may have been meant after it. */
  private lastLeaf?: FelLeafNode;

  constructor(
    private readonly source: string,
    private readonly options: FelOptions,
  ) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  run(): FelNode {
    this.skipTrivia();
    if (this.atEnd()) {
      this.fail(
        "fel_empty",
        "Empty condition.",
        0,
        this.source.length,
        "Write an expression, or use '*' to match everyone.",
      );
    }
    const node = this.parseOr(0);
    this.skipTrivia();
    if (!this.atEnd()) this.unexpected();
    return node;
  }

  // Characters

  private atEnd() {
    return this.pos >= this.source.length;
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? "";
  }

  private isName(character: string) {
    return character !== "" && isNameCharacter(character, this.options);
  }

  private startOfLine(position: number): boolean {
    for (let index = position - 1; index >= 0; index--) {
      const character = this.source[index];
      if (character === "\n") return true;
      if (character !== " " && character !== "\t") return false;
    }
    return true;
  }

  /** Spaces, line breaks and whole line comments. */
  private skipTrivia() {
    while (!this.atEnd()) {
      const character = this.peek();
      if (character === " " || character === "\t" || character === "\n" || character === "\r") {
        this.pos++;
        continue;
      }
      if (character === "#" && this.startOfLine(this.pos)) {
        while (!this.atEnd() && this.peek() !== "\n") this.pos++;
        continue;
      }
      return;
    }
  }

  private scanName(): string {
    const start = this.pos;
    while (!this.atEnd() && this.isName(this.peek())) this.pos++;
    return this.source.slice(start, this.pos);
  }

  /** A word right here, followed by something that is not part of a name. */
  private lookingAt(word: string): boolean {
    return (
      this.source.startsWith(word, this.pos) &&
      !this.isName(this.source[this.pos + word.length] ?? "")
    );
  }

  private fail(code: string, message: string, start: number, end: number, hint?: string): never {
    const ambiguous = getAmbiguousNamespaceCharacters(this.options).filter((character) =>
      this.source.slice(Math.max(0, start - 1), Math.max(end, start + 1)).includes(character),
    );
    if (ambiguous.length) {
      hint = `The namespace character "${ambiguous[0]}" is also FEL syntax, so a key containing it cannot be written in an expression. Write that key as its own item in a YAML list instead.`;
    }
    throw new ParseFailure({ code, message, start, end: Math.max(end, start), hint });
  }

  private warn(code: string, message: string, start: number, end: number, hint?: string) {
    this.warnings.push({ code, message, start, end, hint });
  }

  // Logic

  private parseOr(depth: number): FelNode {
    const children = [this.parseAnd(depth)];
    while (true) {
      this.skipTrivia();
      if (!this.lookingAt("or")) break;
      this.pos += 2;
      this.expectCondition("or");
      children.push(this.parseAnd(depth));
    }
    if (children.length === 1) return children[0];
    const node: FelNode = {
      kind: "or",
      children,
      start: outerStart(children[0]),
      end: outerEnd(children[children.length - 1]),
    };
    if (children.some((child) => child.kind === "and" && !child.parenthesized)) {
      this.warn(
        "fel_mixed_logic",
        "`and` binds tighter than `or`, so part of this reads as one group.",
        node.start,
        node.end,
        `Add parentheses to say which conditions belong together, such as ${this.groupedExample(children)}.`,
      );
    }
    return node;
  }

  private groupedExample(children: FelNode[]): string {
    return children
      .map((child) => {
        const text = this.source.slice(outerStart(child), outerEnd(child)).replace(/\s+/g, " ");
        return child.kind === "and" && !child.parenthesized ? `(${text})` : text;
      })
      .join(" or ");
  }

  private expectCondition(after: string) {
    this.skipTrivia();
    if (this.atEnd()) {
      this.fail(
        "fel_missing_condition",
        `Expected a condition after \`${after}\`.`,
        this.pos - after.length,
        this.pos,
      );
    }
  }

  private parseAnd(depth: number): FelNode {
    const children = [this.parseUnary(depth)];
    while (true) {
      this.skipTrivia();
      if (!this.lookingAt("and")) break;
      this.pos += 3;
      this.expectCondition("and");
      children.push(this.parseUnary(depth));
    }
    if (children.length === 1) return children[0];
    return {
      kind: "and",
      children,
      start: outerStart(children[0]),
      end: outerEnd(children[children.length - 1]),
    };
  }

  private parseUnary(depth: number): FelNode {
    this.skipTrivia();
    if (depth > this.maxDepth) {
      this.fail(
        "fel_too_deep",
        `Nesting is deeper than ${this.maxDepth} levels.`,
        this.pos,
        this.pos + 1,
        "Move part of the condition into a segment.",
      );
    }
    if (this.lookingAt("not")) {
      const start = this.pos;
      this.pos += 3;
      this.skipTrivia();
      if (this.atEnd()) {
        this.fail("fel_missing_condition", "Expected a condition after `not`.", start, start + 3);
      }
      const child = this.parseUnary(depth + 1);
      this.checkNegation(start, child);
      return { kind: "not", child, start, end: outerEnd(child) };
    }
    return this.parseLeaf(depth);
  }

  /** `not (plan in [...])` differs from `plan notIn [...]` only when `plan` is missing. */
  private checkNegation(start: number, child: FelNode) {
    if (child.kind !== "attribute" && child.kind !== "variable") return;
    const negative = NAMED_NEGATIVES[child.comparison.operator];
    if (!negative) return;
    const subject = this.source.slice(child.start, child.subjectEnd);
    const spelled = (operator: Operator) =>
      OPERATOR_SPELLINGS[operator].form === "symbol" ? "!=" : operator;
    const value = child.comparison.value
      ? ` ${this.source.slice(child.comparison.value.start, child.comparison.value.end)}`
      : "";
    const positive = `${subject} ${negative === "semverNotEquals" ? "!=" : spelled(negative)}${value}`;
    this.warn(
      "fel_negation_intent",
      `\`not\` here also matches when \`${subject}\` is missing, unlike \`${spelled(negative)}\`.`,
      start,
      outerEnd(child),
      `Write \`${positive}\` to leave a missing value out, or \`${positive} or ${subject} notExists\` to keep it in.`,
    );
  }

  // Leaves

  private parseLeaf(depth: number): FelNode {
    this.skipTrivia();
    const start = this.pos;
    const character = this.peek();

    if (character === "(") {
      this.pos++;
      this.skipTrivia();
      if (this.peek() === ")") {
        this.fail("fel_empty_group", "Empty parentheses.", start, this.pos + 1);
      }
      const inner = this.parseOr(depth + 1);
      this.skipTrivia();
      if (this.peek() !== ")") {
        if (this.atEnd()) {
          this.fail(
            "fel_unclosed_parenthesis",
            "Missing `)`.",
            start,
            start + 1,
            "Close the group opened here.",
          );
        }
        this.unexpected();
      }
      this.pos++;
      return { ...inner, parenthesized: true, outerStart: start, outerEnd: this.pos };
    }

    if (character === ")") {
      this.fail("fel_missing_condition", "Expected a condition before `)`.", start, start + 1);
    }
    if (character === "'" || character === '"') {
      this.fail(
        "fel_value_first",
        "A condition starts with a name, not a value.",
        start,
        start + 1,
        "Put the name first, such as country == 'nl'.",
      );
    }
    if (!this.isName(character)) this.unexpected();

    const name = this.scanName();
    const nameEnd = this.pos;

    if (this.peek() === "(") {
      if (name === "feature" || name === "variable") return this.parseRead(name, start);
      if (name === "semver") {
        this.fail(
          "fel_semver_subject",
          "`semver(...)` goes on the value side of a comparison.",
          start,
          nameEnd,
          "Compare a version like this: appVersion >= semver('5.5.0').",
        );
      }
      this.fail(
        "fel_unknown_call",
        `Unknown call \`${name}(\`.`,
        start,
        nameEnd + 1,
        "The calls are feature('...'), variable('...') and semver('...').",
      );
    }

    if (name === "and" || name === "or") {
      this.fail(
        "fel_missing_condition",
        `Expected a condition before \`${name}\`.`,
        start,
        nameEnd,
      );
    }
    if (name === "true" || name === "false" || name === "null") {
      this.fail(
        "fel_literal_condition",
        `\`${name}\` on its own is not a condition.`,
        start,
        nameEnd,
        name === "true"
          ? "Use '*' as the whole value to match everyone."
          : "Compare a name with it, such as isPremium == " + name + ".",
      );
    }
    const keyword = KEYWORDS.find((word) => word === name.toLowerCase());
    if (keyword) {
      this.fail(
        "fel_keyword_case",
        `\`${name}\` is written in lowercase: \`${keyword}\`.`,
        start,
        nameEnd,
      );
    }

    const comparison = this.parseComparison(name);
    if (!comparison) {
      const node: FelLeafNode = { kind: "segment", segment: name, start, end: nameEnd };
      this.lastLeaf = node;
      return node;
    }
    const node: FelLeafNode = {
      kind: "attribute",
      attribute: name,
      subjectEnd: nameEnd,
      comparison,
      start,
      end: comparison.value ? comparison.value.end : comparison.operatorEnd,
    };
    this.lastLeaf = node;
    return node;
  }

  private parseRead(kind: "feature" | "variable", start: number): FelNode {
    this.pos++; // (
    this.skipTrivia();
    if (this.peek() !== "'") {
      this.fail(
        "fel_read_key",
        `\`${kind}(...)\` takes a key in single quotes.`,
        start,
        this.pos + 1,
        `Write it like this: ${kind}('checkout').`,
      );
    }
    const keyStart = this.pos;
    const key = this.scanString();
    if (key === "") {
      this.fail("fel_read_key", `\`${kind}(...)\` needs a key.`, keyStart, this.pos);
    }
    this.skipTrivia();
    if (this.peek() !== ")") {
      this.fail("fel_read_close", `Missing \`)\` after ${kind}(${quote(key)}.`, start, this.pos);
    }
    this.pos++;
    const callEnd = this.pos;

    if (kind === "variable") {
      const path = this.parsePath();
      const subject = this.source.slice(start, this.pos);
      const subjectEnd = this.pos;
      const comparison = this.parseComparison(subject);
      if (!comparison) {
        this.fail(
          "fel_variable_comparison",
          "A variable read needs a comparison.",
          start,
          subjectEnd,
          `Compare it, such as ${subject} == true.`,
        );
      }
      return this.leaf({
        kind: "variable",
        variable: key,
        path,
        subjectEnd,
        comparison,
        start,
        end: this.comparisonEnd(comparison),
      });
    }

    // feature(...)
    const accessorStart = this.pos;
    const accessor = this.parseAccessor(false);
    if (!accessor) {
      const subject = this.source.slice(start, callEnd);
      const comparison = this.parseComparison(subject);
      if (!comparison) {
        return this.leaf({
          kind: "feature",
          feature: key,
          subjectEnd: callEnd,
          start,
          end: callEnd,
        });
      }
      const value = comparison.value;
      if (
        (comparison.operator === "equals" || comparison.operator === "notEquals") &&
        value?.type === "boolean"
      ) {
        return this.leaf({
          kind: "feature",
          feature: key,
          enabled: comparison.operator === "equals" ? value.value : !value.value,
          comparison,
          subjectEnd: callEnd,
          start,
          end: value.end,
        });
      }
      this.fail(
        "fel_feature_comparison",
        "A feature compares only with == true or == false.",
        comparison.operatorStart,
        this.comparisonEnd(comparison),
        `Write ${subject} on its own for enabled, ${subject} == false for disabled, or read its variation with ${subject}.variation == 'control'.`,
      );
    }

    if ("index" in accessor) {
      this.fail("fel_path", "Expected a variable key.", accessorStart, this.pos);
    }
    if (accessor.style === "dot" && accessor.name === "variation") {
      const subject = this.source.slice(start, this.pos);
      if (this.peek() === "." || this.peek() === "[") {
        this.fail(
          "fel_variation_path",
          "A variation is a string, so nothing can follow `.variation`.",
          this.pos,
          this.pos + 1,
        );
      }
      const comparison = this.parseComparison(subject);
      if (!comparison) {
        this.fail(
          "fel_variation_comparison",
          "A variation needs a comparison.",
          start,
          this.pos,
          `Compare it, such as ${subject} == 'control'.`,
        );
      }
      const value = comparison.value;
      if (comparison.operator === "equals" && value?.type === "string") {
        return this.leaf({
          kind: "feature",
          feature: key,
          variation: value.value,
          comparison,
          subjectEnd: accessorStart + ".variation".length,
          start,
          end: value.end,
        });
      }
      const sample = value?.type === "string" ? quote(value.value) : "'control'";
      this.fail(
        "fel_variation_comparison",
        "A variation compares only with == and a string.",
        comparison.operatorStart,
        this.comparisonEnd(comparison),
        comparison.operator === "notEquals"
          ? `Write not (${subject} == ${sample}).`
          : comparison.operator === "in"
            ? `Join one comparison per variation with or, such as ${subject} == ${sample} or ${subject} == 'treatment'.`
            : `Write ${subject} == ${sample}.`,
      );
    }

    const path = this.parsePath();
    const subject = this.source.slice(start, this.pos);
    const subjectEnd = this.pos;
    const comparison = this.parseComparison(subject);
    if (!comparison) {
      this.fail(
        "fel_variable_comparison",
        "A variable read needs a comparison.",
        start,
        subjectEnd,
        `Compare it, such as ${subject} == true.`,
      );
    }
    return this.leaf({
      kind: "variable",
      variable: accessor.name,
      feature: key,
      path,
      subjectEnd,
      comparison,
      start,
      end: this.comparisonEnd(comparison),
    });
  }

  private leaf(node: FelLeafNode): FelLeafNode {
    this.lastLeaf = node;
    return node;
  }

  private comparisonEnd(comparison: FelComparison) {
    return comparison.value ? comparison.value.end : comparison.operatorEnd;
  }

  /** `.name` or `['name']`, and `[0]` when indexes are allowed. */
  private parseAccessor(
    allowIndex: boolean,
  ): { name: string; style: "dot" | "bracket" } | { index: number } | undefined {
    if (this.peek() === ".") {
      const start = this.pos;
      this.pos++;
      const nameStart = this.pos;
      while (!this.atEnd() && /[a-zA-Z0-9_-]/.test(this.peek())) this.pos++;
      const name = this.source.slice(nameStart, this.pos);
      if (!name) {
        this.fail(
          "fel_path",
          "Expected a name after `.`.",
          start,
          start + 1,
          "Use brackets for unusual keys, such as ['label.v2'].",
        );
      }
      if (allowIndex && /^(0|[1-9]\d*)$/.test(name)) return { index: Number(name) };
      return { name, style: "dot" };
    }
    if (this.peek() === "[") {
      const start = this.pos;
      this.pos++;
      this.skipTrivia();
      let result: { name: string; style: "bracket" } | { index: number };
      if (this.peek() === "'") {
        result = { name: this.scanString(), style: "bracket" };
      } else if (allowIndex && /[0-9]/.test(this.peek())) {
        const indexStart = this.pos;
        while (/[0-9]/.test(this.peek())) this.pos++;
        const text = this.source.slice(indexStart, this.pos);
        if (!/^(0|[1-9]\d*)$/.test(text)) {
          this.fail(
            "fel_path",
            "An index is a whole number without leading zeros.",
            indexStart,
            this.pos,
          );
        }
        result = { index: Number(text) };
      } else {
        this.fail(
          "fel_path",
          allowIndex
            ? "Expected a quoted key or an index inside `[...]`."
            : "Expected a quoted key inside `[...]`.",
          start,
          this.pos + 1,
          "Write keys like ['label.v2'] and indexes like [0].",
        );
      }
      this.skipTrivia();
      if (this.peek() !== "]") {
        this.fail("fel_path", "Missing `]`.", start, this.pos);
      }
      this.pos++;
      return result;
    }
    return undefined;
  }

  private parsePath(): (string | number)[] {
    const path: (string | number)[] = [];
    while (true) {
      const accessor = this.parseAccessor(true);
      if (!accessor) return path;
      path.push("index" in accessor ? accessor.index : accessor.name);
    }
  }

  // Comparisons

  private parseComparison(subject: string): FelComparison | undefined {
    this.skipTrivia();
    const start = this.pos;
    const character = this.peek();

    if ("=!<>".includes(character) && character !== "") {
      const symbol = this.scanSymbol(subject);
      if (!symbol) return undefined;
      const operatorEnd = this.pos;
      const value = this.parseValue(symbol, undefined);
      const operator: Operator =
        value.type === "semver" ? SYMBOL_OPERATORS[symbol].semver : SYMBOL_OPERATORS[symbol].plain;
      this.checkSymbolValue(symbol, value, subject);
      return { operator, operatorStart: start, operatorEnd, value };
    }

    if (!/[a-zA-Z]/.test(character)) return undefined;
    let wordEnd = this.pos;
    while (/[a-zA-Z]/.test(this.source[wordEnd] ?? "")) wordEnd++;
    const word = this.source.slice(this.pos, wordEnd);
    const after = this.source[wordEnd] ?? "";
    const isWholeWord =
      !this.isName(after) || (after === "/" && (word === "matches" || word === "notMatches"));
    if (!isWholeWord) return undefined;

    if ((WORD_OPERATORS as string[]).includes(word)) {
      const operator = word as Operator;
      this.pos = wordEnd;
      const value = this.parseValue(undefined, operator);
      this.checkWordValue(operator, value, subject);
      return { operator, operatorStart: start, operatorEnd: wordEnd, value };
    }
    if ((POSTFIX_OPERATORS as string[]).includes(word)) {
      this.pos = wordEnd;
      return { operator: word as Operator, operatorStart: start, operatorEnd: wordEnd };
    }
    if (word === "and" || word === "or") return undefined;

    if (word === "not") {
      // `plan not in [...]`
      let nextStart = wordEnd;
      while (this.source[nextStart] === " ") nextStart++;
      let nextEnd = nextStart;
      while (/[a-zA-Z]/.test(this.source[nextEnd] ?? "")) nextEnd++;
      const next = this.source.slice(nextStart, nextEnd);
      const named = SPACED_NEGATIVES[next];
      if (named) {
        this.fail(
          "fel_spaced_negative",
          `\`not ${next}\` is written as one word: \`${named}\`.`,
          start,
          nextEnd,
          `Write ${subject} ${named}${this.source.slice(nextEnd).split("\n")[0].trimEnd().slice(0, 40)}.`,
        );
      }
      return undefined;
    }

    const operatorMatch = ALL_OPERATOR_WORDS.find(
      (operator) => operator.toLowerCase() === word.toLowerCase(),
    );
    if (operatorMatch) {
      this.fail(
        "fel_operator_case",
        `Unknown operator \`${word}\`.`,
        start,
        wordEnd,
        `Operators are spelled exactly, such as \`${operatorMatch}\`.`,
      );
    }
    const treeOperator = Object.keys(TREE_OPERATOR_HINTS).find(
      (operator) => operator.toLowerCase() === word.toLowerCase(),
    );
    if (treeOperator) {
      this.fail(
        "fel_tree_operator",
        `\`${word}\` is written \`${TREE_OPERATOR_HINTS[treeOperator]}\` in FEL.`,
        start,
        wordEnd,
        `Write ${subject} ${TREE_OPERATOR_HINTS[treeOperator].replace("'...'", "'5.5.0'")}${treeOperator.startsWith("semver") ? "" : " ..."}.`,
      );
    }
    if (word.toLowerCase() === "is") {
      this.fail(
        "fel_unknown_operator",
        "`is` is not an operator.",
        start,
        wordEnd,
        `Write ${subject} == ..., or ${subject} isNull for a null value.`,
      );
    }
    if (word.toLowerCase() === "like") {
      this.fail(
        "fel_unknown_operator",
        "`like` is not an operator.",
        start,
        wordEnd,
        `Use startsWith, endsWith, contains or matches, such as ${subject} startsWith 'admin'.`,
      );
    }
    return undefined;
  }

  private scanSymbol(subject: string): Symbol | undefined {
    const start = this.pos;
    const two = this.source.slice(this.pos, this.pos + 2);
    const three = this.source.slice(this.pos, this.pos + 3);
    if (three === "===" || three === "!==") {
      this.fail(
        "fel_triple_equals",
        `\`${three}\` is written \`${three.slice(0, 2)}\` in FEL.`,
        start,
        start + 3,
      );
    }
    if (two === "<>") {
      this.fail("fel_unknown_operator", "`<>` is written `!=` in FEL.", start, start + 2);
    }
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      this.pos += 2;
      return two as Symbol;
    }
    if (two === "=<" || two === "=>") {
      this.fail(
        "fel_unknown_operator",
        `\`${two}\` is written \`${two[1]}=\` in FEL.`,
        start,
        start + 2,
      );
    }
    const character = this.peek();
    if (character === "<" || character === ">") {
      this.pos++;
      return character;
    }
    if (character === "=") {
      this.fail(
        "fel_single_equals",
        "A single `=` does not compare.",
        start,
        start + 1,
        `Use == to compare, such as ${subject} == ...`,
      );
    }
    return undefined;
  }

  private checkSymbolValue(symbol: Symbol, value: FelValue, subject: string) {
    if (value.type === "list") {
      this.fail(
        "fel_list_value",
        `\`${symbol}\` does not take a list.`,
        value.start,
        value.end,
        symbol === "!="
          ? `Use notIn for a list, such as ${subject} notIn ${this.source.slice(value.start, value.end)}.`
          : `Use in for a list, such as ${subject} in ${this.source.slice(value.start, value.end)}.`,
      );
    }
    if ((symbol === "==" || symbol === "!=") && value.type !== "semver") return;
    if (value.type === "semver" || value.type === "number") return;
    const text = this.source.slice(value.start, value.end);
    let hint = `\`${symbol}\` compares numbers, or versions written with semver('...').`;
    if (value.type === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(value.value)) {
        hint = `Compare dates with before or after, such as ${subject} ${
          symbol.startsWith(">") ? "after" : "before"
        } ${text}.`;
      } else if (/^-?\d+(\.\d+)?$/.test(value.value)) {
        hint = `Write the number without quotes: ${subject} ${symbol} ${value.value}, or compare versions with semver(${text}).`;
      } else if (/^v?\d+(\.\d+)*$/.test(value.value)) {
        hint = `Compare versions with semver, such as ${subject} ${symbol} semver(${text}).`;
      }
    }
    this.fail(
      "fel_number_comparison",
      `\`${symbol}\` needs a number or a version.`,
      value.start,
      value.end,
      hint,
    );
  }

  private checkWordValue(operator: Operator, value: FelValue, subject: string) {
    const text = this.source.slice(value.start, value.end);
    if (value.type === "semver") {
      this.fail(
        "fel_semver_operator",
        `\`semver(...)\` compares only with ==, !=, <, <=, > and >=.`,
        value.start,
        value.end,
      );
    }
    if (LIST_OPERATORS.includes(operator)) {
      if (value.type !== "list") {
        this.fail(
          "fel_list_required",
          `\`${operator}\` takes a list.`,
          value.start,
          value.end,
          `Write ${subject} ${operator} [${text}].`,
        );
      }
      return;
    }
    if (value.type === "list") {
      this.fail(
        "fel_list_value",
        `\`${operator}\` does not take a list.`,
        value.start,
        value.end,
        operator === "includes" || operator === "notIncludes"
          ? `Use ${operator === "includes" ? "includesAny" : "notIncludesAny"} for a list, such as ${subject} ${operator === "includes" ? "includesAny" : "notIncludesAny"} ${text}.`
          : undefined,
      );
    }
    if (REGEX_OPERATORS.includes(operator) && value.type !== "regex") {
      const sample =
        value.type === "string" ? `/${value.value.replace(/\//g, "\\/")}/` : "/^admin@/i";
      this.fail(
        "fel_regex_required",
        `\`${operator}\` takes a regular expression.`,
        value.start,
        value.end,
        `Write ${subject} ${operator} ${sample}.`,
      );
    }
    if (TEXT_OPERATORS.includes(operator) && value.type !== "string") {
      this.fail(
        "fel_text_required",
        `\`${operator}\` takes a string in single quotes.`,
        value.start,
        value.end,
        `Write ${subject} ${operator} '${value.type === "number" ? String(value.value) : "..."}'.`,
      );
    }
  }

  // Values

  private parseValue(symbol: Symbol | undefined, operator: Operator | undefined): FelValue {
    this.skipTrivia();
    const start = this.pos;
    const character = this.peek();
    const after = symbol ?? operator ?? "";

    if (this.atEnd()) {
      this.fail(
        "fel_missing_value",
        `Expected a value after \`${after}\`.`,
        start - after.length,
        start,
      );
    }
    if (character === "'") {
      const value = this.scanString();
      return { type: "string", value, start, end: this.pos };
    }
    if (character === '"') {
      let end = this.pos + 1;
      while (end < this.source.length && this.source[end] !== '"' && this.source[end] !== "\n")
        end++;
      const content = this.source.slice(this.pos + 1, end);
      this.fail(
        "fel_double_quotes",
        "Strings use single quotes.",
        start,
        Math.min(end + 1, this.source.length),
        `Write ${quote(content)}.`,
      );
    }
    if (character === "-" || /[0-9]/.test(character)) return this.scanNumber();
    if (character === "[") return this.scanList(symbol, operator);
    if (character === "/") {
      if (operator && REGEX_OPERATORS.includes(operator)) return this.scanRegex();
      this.fail(
        "fel_regex_operator",
        "A regular expression goes only after matches or notMatches.",
        start,
        start + 1,
      );
    }
    if (/[a-zA-Z]/.test(character)) {
      const name = this.scanName();
      if (name === "true" || name === "false") {
        return { type: "boolean", value: name === "true", start, end: this.pos };
      }
      if (name === "null") return { type: "null", value: null, start, end: this.pos };
      if (name === "semver" && this.peek() === "(") return this.scanSemver(start);
      const keyword = ["true", "false", "null"].find((word) => word === name.toLowerCase());
      if (keyword) {
        this.fail(
          "fel_keyword_case",
          `\`${name}\` is written in lowercase: \`${keyword}\`.`,
          start,
          this.pos,
        );
      }
      this.fail(
        "fel_unquoted_value",
        "Values are quoted.",
        start,
        this.pos,
        `Write ${quote(name)}.`,
      );
    }
    this.fail("fel_missing_value", `Expected a value after \`${after}\`.`, start, start + 1);
  }

  private scanString(): string {
    const start = this.pos;
    this.pos++; // opening quote
    let value = "";
    while (true) {
      if (this.atEnd() || this.peek() === "\n") {
        this.fail(
          "fel_unterminated_string",
          "Missing closing `'`.",
          start,
          this.pos,
          "Close the string with a single quote. Write a quote inside it as \\'.",
        );
      }
      const character = this.peek();
      if (character === "'") {
        this.pos++;
        return value;
      }
      if (character === "\\") {
        const next = this.peek(1);
        if (next === "'" || next === "\\") {
          value += next;
          this.pos += 2;
        } else if (next === "n") {
          value += "\n";
          this.pos += 2;
        } else if (next === "t") {
          value += "\t";
          this.pos += 2;
        } else if (
          next === "u" &&
          /^[0-9a-fA-F]{4}$/.test(this.source.slice(this.pos + 2, this.pos + 6))
        ) {
          value += String.fromCharCode(parseInt(this.source.slice(this.pos + 2, this.pos + 6), 16));
          this.pos += 6;
        } else {
          this.fail(
            "fel_string_escape",
            `Unknown escape \`\\${next}\`.`,
            this.pos,
            this.pos + 2,
            "Strings allow \\', \\\\, \\n, \\t and \\u followed by four hex digits.",
          );
        }
        continue;
      }
      value += character;
      this.pos++;
    }
  }

  private scanNumber(): FelValue {
    const start = this.pos;
    const pattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    pattern.lastIndex = this.pos;
    const match = pattern.exec(this.source);
    if (!match || match[0] === "-") {
      this.fail(
        "fel_number",
        "Invalid number.",
        start,
        start + 1,
        "Numbers follow JSON, such as 10, -5 or 2.5.",
      );
    }
    this.pos += match[0].length;
    const next = this.peek();
    if (next === "." && /[0-9]/.test(this.peek(1))) {
      let end = this.pos;
      while (/[0-9.]/.test(this.source[end] ?? "")) end++;
      const version = this.source.slice(start, end);
      this.fail(
        "fel_version_number",
        "A version is not a number.",
        start,
        end,
        `Write semver('${version}') to compare versions.`,
      );
    }
    if (this.isName(next)) {
      let end = this.pos;
      while (this.isName(this.source[end] ?? "")) end++;
      const text = this.source.slice(start, end);
      this.fail(
        "fel_number",
        /^-?0\d/.test(text) ? "Numbers have no leading zeros." : "Invalid number.",
        start,
        end,
        /^-?0\d/.test(text) ? undefined : `Quote it if it is text: ${quote(text)}.`,
      );
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      this.fail("fel_number", "The number is too large.", start, this.pos);
    }
    return { type: "number", value, start, end: this.pos };
  }

  private scanList(symbol: Symbol | undefined, operator: Operator | undefined): FelValue {
    const start = this.pos;
    this.pos++;
    const items: FelValue[] = [];
    this.skipTrivia();
    if (this.peek() === "]") {
      this.pos++;
      return { type: "list", items, start, end: this.pos };
    }
    while (true) {
      this.skipTrivia();
      if (this.peek() === "]") {
        this.fail(
          "fel_trailing_comma",
          "A list does not end with a comma.",
          this.pos - 1,
          this.pos + 1,
        );
      }
      const item = this.parseValue(symbol, operator);
      if (item.type === "regex" || item.type === "semver") {
        this.fail(
          "fel_list_item",
          `A list holds strings, numbers, booleans and null, not ${item.type === "regex" ? "regular expressions" : "versions"}.`,
          item.start,
          item.end,
        );
      }
      items.push(item);
      this.skipTrivia();
      if (this.peek() === ",") {
        this.pos++;
        continue;
      }
      if (this.peek() === "]") {
        this.pos++;
        return { type: "list", items, start, end: this.pos };
      }
      if (this.atEnd()) {
        this.fail(
          "fel_unclosed_list",
          "Missing `]`.",
          start,
          start + 1,
          "Close the list opened here.",
        );
      }
      this.fail("fel_list_separator", "Separate list items with commas.", this.pos, this.pos + 1);
    }
  }

  private scanRegex(): FelValue {
    const start = this.pos;
    this.pos++;
    let pattern = "";
    while (true) {
      if (this.atEnd() || this.peek() === "\n") {
        this.fail(
          "fel_unterminated_regex",
          "Missing closing `/`.",
          start,
          this.pos,
          "Close the regular expression with /. Write a slash inside it as \\/.",
        );
      }
      const character = this.peek();
      if (character === "\\") {
        const next = this.peek(1);
        if (next === "" || next === "\n") {
          this.fail("fel_unterminated_regex", "Missing closing `/`.", start, this.pos + 1);
        }
        pattern += next === "/" ? "/" : `\\${next}`;
        this.pos += 2;
        continue;
      }
      if (character === "/") {
        this.pos++;
        break;
      }
      pattern += character;
      this.pos++;
    }
    if (pattern === "") {
      this.fail("fel_empty_regex", "Empty regular expression.", start, this.pos);
    }
    const flagsStart = this.pos;
    while (/[a-zA-Z]/.test(this.peek())) this.pos++;
    const flags = this.source.slice(flagsStart, this.pos);
    if (!/^[gims]*$/.test(flags) || new Set(flags).size !== flags.length) {
      this.fail(
        "fel_regex_flags",
        `Invalid flags \`${flags}\`.`,
        flagsStart,
        this.pos,
        "Flags are g, i, m and s, each at most once.",
      );
    }
    return { type: "regex", pattern, flags, start, end: this.pos };
  }

  private scanSemver(start: number): FelValue {
    this.pos++; // (
    this.skipTrivia();
    if (this.peek() !== "'") {
      this.fail(
        "fel_semver_argument",
        "`semver(...)` takes a version in single quotes.",
        start,
        this.pos + 1,
        "Write it like this: semver('5.5.0').",
      );
    }
    const version = this.scanString();
    this.skipTrivia();
    if (this.peek() !== ")") {
      this.fail("fel_read_close", "Missing `)` after the version.", start, this.pos);
    }
    this.pos++;
    return { type: "semver", version, start, end: this.pos };
  }

  // Leftovers

  private unexpected(): never {
    this.skipTrivia();
    const start = this.pos;
    const character = this.peek();
    const two = this.source.slice(start, start + 2);

    if (two === "&&")
      this.fail("fel_symbol_logic", "`&&` is written `and` in FEL.", start, start + 2);
    if (two === "||")
      this.fail("fel_symbol_logic", "`||` is written `or` in FEL.", start, start + 2);
    if (character === "!") {
      this.fail(
        "fel_symbol_logic",
        "`!` is written `not` in FEL.",
        start,
        start + 1,
        "Write not (...).",
      );
    }
    if (character === ")") {
      this.fail("fel_unmatched_parenthesis", "Unmatched `)`.", start, start + 1);
    }
    if (character === ",") {
      this.fail(
        "fel_comma",
        "Conditions are joined with `and` or `or`, not commas.",
        start,
        start + 1,
      );
    }
    if (character === "#") {
      this.fail(
        "fel_comment",
        "Comments are whole lines starting with `#`.",
        start,
        start + 1,
        "Move the comment to a line of its own.",
      );
    }
    if (character === "=") {
      this.fail("fel_single_equals", "A single `=` does not compare.", start, start + 1, "Use ==.");
    }

    let end = start + 1;
    if (this.isName(character)) {
      while (end < this.source.length && this.isName(this.source[end])) end++;
    }
    const word = this.source.slice(start, end);
    const keyword = ["and", "or", "not"].find((candidate) => candidate === word.toLowerCase());
    if (keyword) {
      this.fail(
        "fel_keyword_case",
        `\`${word}\` is written in lowercase: \`${keyword}\`.`,
        start,
        end,
      );
    }

    const last = this.lastLeaf;
    const between = last ? this.source.slice(last.end, start) : "";
    if (last && /^\s*$/.test(between)) {
      if (last.kind === "segment" && (this.isName(character) || character === "'")) {
        this.fail(
          "fel_missing_operator",
          `Unexpected \`${describe(this.source, start, end)}\` after \`${last.segment}\`.`,
          start,
          end,
          `Compare with an operator, such as ${last.segment} == ${character === "'" ? describe(this.source, start, end) : quote(word)}, or join conditions with and or or.`,
        );
      }
      if (this.isName(character)) {
        this.fail(
          "fel_missing_logic",
          `Unexpected \`${word}\`.`,
          start,
          end,
          "Join conditions with and or or.",
        );
      }
    }
    this.fail("fel_unexpected", `Unexpected \`${describe(this.source, start, end)}\`.`, start, end);
  }
}

export function parse(source: string, options: FelOptions = {}): FelParseResult {
  const resolve = createPositionResolver(source);
  const toError = (issue: RawIssue, severity: "error" | "warning"): FelError => ({
    code: issue.code,
    message: issue.message,
    severity,
    start: resolve(issue.start),
    end: resolve(issue.end),
    ...(issue.hint ? { hint: issue.hint } : {}),
  });

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (source.length > maxLength) {
    return {
      errors: [
        toError(
          {
            code: "fel_too_long",
            message: `The expression is longer than ${maxLength} characters.`,
            start: 0,
            end: source.length,
            hint: "Move parts of it into segments.",
          },
          "error",
        ),
      ],
      warnings: [],
    };
  }

  const parser = new Parser(source, options);
  try {
    const ast = parser.run();
    return { ast, errors: [], warnings: parser.warnings.map((issue) => toError(issue, "warning")) };
  } catch (error) {
    if (!(error instanceof ParseFailure)) throw error;
    return {
      errors: [toError(error.issue, "error")],
      warnings: parser.warnings.map((issue) => toError(issue, "warning")),
    };
  }
}

export { quote as quoteString };
