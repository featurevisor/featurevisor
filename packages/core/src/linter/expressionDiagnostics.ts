import * as fs from "fs";

import type { ExpressionDiagnostic, ExpressionPosition } from "@featurevisor/expressions";
import { locateYamlString } from "@featurevisor/parsers";

import type { ConditionExpressionRecord } from "../datasource/expressions";

type Path = (string | number)[];

export interface ExpressionSourceLocation {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** The source line and a caret under the exact part, ready to print. */
  frame: string[];
}

function startsWith(path: Path, prefix: Path): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

/** Finds where in an expression a lint path points, from the leaf spans recorded while compiling it. */
export function findExpressionRange(
  records: ConditionExpressionRecord[],
  path: Path,
):
  | { record: ConditionExpressionRecord; start: ExpressionPosition; end: ExpressionPosition }
  | undefined {
  let best:
    | {
        record: ConditionExpressionRecord;
        start: ExpressionPosition;
        end: ExpressionPosition;
        depth: number;
      }
    | undefined;
  for (const record of records) {
    for (const span of record.spans) {
      if (!startsWith(path, span.path)) continue;
      if (best && best.depth >= span.path.length) continue;
      const rest = path.slice(span.path.length);
      let range: { start: ExpressionPosition; end: ExpressionPosition } = span;
      if (["attribute", "variable", "feature", "path"].includes(String(rest[0])))
        range = span.subject;
      else if (rest[0] === "operator" && span.operator) range = span.operator;
      else if ((rest[0] === "value" || rest[0] === "regexFlags") && span.value) range = span.value;
      best = { record, start: range.start, end: range.end, depth: span.path.length };
    }
  }
  if (best) return { record: best.record, start: best.start, end: best.end };

  // A path at or inside the expression's own value, such as an empty group.
  const record = records.find((candidate) => startsWith(path, candidate.path));
  if (!record) return undefined;
  const end = record.source.length;
  const lines = record.source.split("\n");
  return {
    record,
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: end, line: lines.length, column: lines[lines.length - 1].length + 1 },
  };
}

/** Whether a lint path points at an expression that failed to compile. */
export function isInsideFailedExpression(
  records: ConditionExpressionRecord[],
  path: Path,
): boolean {
  return records.some((record) => record.errors.length > 0 && startsWith(path, record.path));
}

/**
 * Maps positions inside expressions to the YAML files they are written in, reading each file
 * once. Projects using other parsers get no file positions, and errors keep their paths.
 */
export function createExpressionLocator(isYaml: boolean) {
  const contents = new Map<string, string | undefined>();
  const read = (filePath: string) => {
    if (!contents.has(filePath)) {
      try {
        contents.set(filePath, fs.readFileSync(filePath, "utf8"));
      } catch {
        contents.set(filePath, undefined);
      }
    }
    return contents.get(filePath);
  };

  return function locate(
    filePath: string,
    stringPath: Path,
    start: ExpressionPosition,
    end: ExpressionPosition,
  ): ExpressionSourceLocation | undefined {
    if (!isYaml) return undefined;
    const content = read(filePath);
    if (content === undefined) return undefined;
    const located = locateYamlString(content, stringPath);
    if (!located) return undefined;
    const from = located.positionAt(start.offset);
    const to = located.positionAt(Math.max(start.offset, end.offset));
    const text = located.lineText(from.line);
    const caretEnd = to.line === from.line ? Math.max(to.column, from.column + 1) : text.length + 1;
    const frame = [text, `${" ".repeat(from.column - 1)}${"^".repeat(caretEnd - from.column)}`];
    return {
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
      frame,
    };
  };
}

export type ExpressionLocator = ReturnType<typeof createExpressionLocator>;

/** A one line position inside an expression, for projects whose files have no positions. */
export function describeExpressionPosition(error: Pick<ExpressionDiagnostic, "start">): string {
  return `line ${error.start.line}, column ${error.start.column} of the expression`;
}
