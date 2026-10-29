import * as path from "path";

export interface ParseErrorDescription {
  /** One line, as lint and fmt print it */
  message: string;
  line?: number;
  column?: number;
}

function isPosition(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * What went wrong when a parser could not read a file, and where. YAML gives the position as
 * `linePos`, and other parsers, such as smol-toml for TOML, as `line` and `column`.
 */
export function describeParseError(cause: unknown): ParseErrorDescription {
  const original = cause instanceof Error ? cause.message : String(cause);
  const source = cause && typeof cause === "object" ? (cause as Record<string, unknown>) : {};
  const linePos = Array.isArray(source.linePos) ? source.linePos[0] : undefined;
  const position =
    "linePos" in source
      ? linePos && typeof linePos === "object"
        ? { line: linePos.line, column: linePos.col }
        : undefined
      : { line: source.line, column: source.column };
  const hasPosition = position && isPosition(position.line) && isPosition(position.column);

  // YAML repeats the position in its message, and other parsers may explain over several lines
  const message =
    hasPosition && cause instanceof Error && cause.name === "YAMLParseError"
      ? original.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "")
      : original
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ");

  return hasPosition
    ? { message, line: position.line as number, column: position.column as number }
    : { message };
}

export class EntityParseError extends Error {
  readonly featurevisorFilePath: string;
  readonly cause: unknown;

  constructor(filePath: string, cause: unknown, rootDirectoryPath = process.cwd()) {
    const { message, line, column } = describeParseError(cause);
    const location = line ? `:${line}:${column}` : "";
    const displayPath = path.isAbsolute(filePath)
      ? path.relative(rootDirectoryPath, filePath)
      : filePath;
    super(`${displayPath}${location}: ${message}`);
    this.name = "EntityParseError";
    this.featurevisorFilePath = path.resolve(filePath);
    this.cause = cause;
  }
}
