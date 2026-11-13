import * as fs from "fs";
import * as path from "path";

import { LINT_WARNING_CODES } from "./warningCodes";

/** Each call to `name` in a source, from its name to its closing parenthesis */
function calls(source: string, name: string): string[] {
  const found: string[] = [];
  for (
    let start = source.indexOf(`${name}(`);
    start !== -1;
    start = source.indexOf(`${name}(`, start + 1)
  ) {
    // Not the function's own definition
    if (/function\s+$/.test(source.slice(Math.max(0, start - 20), start))) continue;
    let depth = 0;
    for (let index = start + name.length; index < source.length; index++) {
      const char = source[index];
      if (char === '"' || char === "'" || char === "`") {
        // Strings hold parentheses of their own, such as messages do
        for (index++; index < source.length && source[index] !== char; index++) {
          if (source[index] === "\\") index++;
        }
        continue;
      }
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) {
        found.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  return found;
}

/** Quoted words with an underscore, as every warning code has */
function codesIn(text: string): string[] {
  return [...text.matchAll(/"([a-z]+(?:_[a-z]+)+)"/g)].map((match) => match[1]);
}

/** Every warning code lint can report, read from the places it warns from */
function getReportedWarningCodes(): string[] {
  const sources = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith(".ts") && !file.includes(".spec."))
    .map((file) => ({ file, source: fs.readFileSync(path.join(__dirname, file), "utf8") }));
  // Expressions warn from their own package, which sits beside this one
  const parser = fs.readFileSync(
    path.join(__dirname, "../../../expressions/src/parser.ts"),
    "utf8",
  );

  const codes = new Set<string>();
  const add = (found: string[]) => found.forEach((code) => codes.add(code));
  for (const { file, source } of sources) {
    // Warnings lint reports itself, with a literal code
    for (const call of calls(source, "reportWarning")) {
      add([...call.matchAll(/code: "([a-z_]+)"/g)].map((match) => match[1]));
    }
    // Zod issues flagged as warnings
    for (const call of calls(source, "addWarning")) add(codesIn(call));
    add([...source.matchAll(/warning: true, code: "([a-z_]+)"/g)].map((match) => match[1]));
    // Modules that only warn, such as deadlines and compositions
    if (file.endsWith("Warnings.ts")) {
      for (const match of source.matchAll(/code: ((?:"[a-z_]+"\s*\|?\s*)+)/g))
        add(codesIn(match[1]));
    }
  }
  for (const call of calls(parser, "this.warn")) add(codesIn(call).slice(0, 1));
  return [...codes].sort();
}

describe("lint warning codes", () => {
  it("lists exactly the codes lint warns with", () => {
    expect(getReportedWarningCodes()).toEqual([...LINT_WARNING_CODES].sort());
  });
});
