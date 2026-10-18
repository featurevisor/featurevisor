import * as path from "path";

export class EntityParseError extends Error {
  readonly featurevisorFilePath: string;
  readonly cause: unknown;

  constructor(filePath: string, cause: unknown, rootDirectoryPath = process.cwd()) {
    const original = cause instanceof Error ? cause.message : String(cause);
    // YAML supplies positions separately; other parsers may include them in the message.
    const positions =
      cause && typeof cause === "object" && "linePos" in cause ? cause.linePos : undefined;
    const position = Array.isArray(positions) ? positions[0] : undefined;
    const hasPosition =
      position &&
      typeof position === "object" &&
      Number.isSafeInteger(position.line) &&
      position.line > 0 &&
      Number.isSafeInteger(position.col) &&
      position.col > 0;
    const location = hasPosition ? `:${position.line}:${position.col}` : "";
    const summary = original.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
    const displayPath = path.isAbsolute(filePath)
      ? path.relative(rootDirectoryPath, filePath)
      : filePath;
    super(
      `${displayPath}${location}: ${
        hasPosition && cause instanceof Error && cause.name === "YAMLParseError"
          ? summary
          : original
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .join(" ")
      }`,
    );
    this.name = "EntityParseError";
    this.featurevisorFilePath = path.resolve(filePath);
    this.cause = cause;
  }
}
