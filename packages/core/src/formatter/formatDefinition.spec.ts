import { parsers, type CustomParser } from "@featurevisor/parsers";

import {
  canFormat,
  FormatGuardError,
  FormatParseError,
  formatDefinition,
  isIgnoredFile,
} from "./formatDefinition";
import { HOUSE_STYLE } from "./style";

// How a file goes through its parser's format and the guards, whatever the house style is

/** A JSON parser whose format is the given function */
function jsonWith(format: CustomParser["format"], extra: Partial<CustomParser> = {}) {
  return {
    extension: "custom",
    parse: (content: string) => JSON.parse(content),
    stringify: (content: unknown) => JSON.stringify(content),
    format,
    ...extra,
  } as CustomParser;
}

describe("formatDefinition", () => {
  const yml = parsers.yml;

  it("reports whether formatting changed a file, and is stable", () => {
    // YAML lists are always written in block style, so this changes in any house style
    const first = formatDefinition("feature", "tags: [web, ios]\ndescription: x\n", yml);

    expect(first.changed).toBe(true);
    expect(formatDefinition("feature", first.output, yml)).toEqual({
      output: first.output,
      changed: false,
    });
  });

  it("hands the layout to a custom parser's format, and ends the file with a newline", () => {
    const custom = jsonWith((source, layout) =>
      JSON.stringify(layout.orderValue(JSON.parse(source))),
    );
    const output = formatDefinition(
      "segment",
      '{"conditions":"*","description":"x"}',
      custom,
    ).output;

    expect(output.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(output))).toEqual(
      Object.keys(JSON.parse(formatDefinition("segment", output, parsers.json).output)),
    );
  });

  it("leaves a file as it is when its parser has no format", () => {
    const source = '{"conditions":"*","description":"x"}';
    const custom = jsonWith(undefined);

    expect(canFormat(custom)).toBe(false);
    expect(canFormat(parsers.yml)).toBe(true);
    expect(canFormat(parsers.json)).toBe(true);
    expect(formatDefinition("segment", source, custom)).toEqual({ output: source, changed: false });
  });

  it("leaves a file as it is when the parser's format declines it", () => {
    expect(
      formatDefinition(
        "segment",
        '{"description":"x"}',
        jsonWith(() => undefined),
      ),
    ).toEqual({
      output: '{"description":"x"}',
      changed: false,
      declined: true,
    });
  });

  it("writes the house style's line endings, and keeps a byte order mark", () => {
    const lf = "bucketBy: userId\ndescription: Checkout\n";
    const formatted = formatDefinition("feature", lf, yml).output;
    const crlf = (text: string) => text.replace(/\n/g, "\r\n");

    for (const source of [lf, crlf(lf)]) {
      const own = source.includes("\r\n") ? "crlf" : "lf";
      const ending = HOUSE_STYLE.endOfLine === "auto" ? own : HOUSE_STYLE.endOfLine;
      const { output } = formatDefinition("feature", `\uFEFF${source}`, yml);

      expect(output).toBe(`\uFEFF${ending === "crlf" ? crlf(formatted) : formatted}`);
      expect(formatDefinition("feature", output, yml).changed).toBe(false);
    }
  });

  it("leaves a file with the ignore comment at its top as it is", () => {
    const source = "# Owned by the growth team\n#featurevisor-ignore\ntags: [web]\n";

    expect(formatDefinition("feature", source, yml)).toEqual({
      output: source,
      changed: false,
      ignored: true,
    });
    expect(isIgnoredFile("\uFEFF\r\n// featurevisor-ignore\r\n{}")).toBe(true);
    expect(isIgnoredFile("tags: [web]\n# featurevisor-ignore\n")).toBe(false);
    expect(isIgnoredFile("# featurevisor-ignore-line\n")).toBe(false);
  });

  it("reports a parse error with its line", () => {
    expect(() => formatDefinition("feature", "description: [unclosed\nbucketBy: x\n", yml)).toThrow(
      expect.objectContaining({ name: "FormatParseError", line: expect.any(Number) }),
    );
  });

  it("reports where a parser that gives a line and column failed", () => {
    const toml = jsonWith((source) => source, {
      parse: () => {
        throw Object.assign(new Error("Invalid TOML document: invalid value"), {
          line: 1,
          column: 5,
        });
      },
    });

    let error: unknown;
    try {
      formatDefinition("feature", "a = \n", toml);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(FormatParseError);
    expect(error).toMatchObject({
      message: "Invalid TOML document: invalid value",
      line: 1,
      column: 5,
    });
  });

  it("reports a parser's format that fails, without writing", () => {
    const failing = jsonWith(() => {
      throw new Error("Something broke.");
    });

    expect(() => formatDefinition("segment", '{"description":"x"}', failing)).toThrow(
      new FormatGuardError("Something broke."),
    );
  });

  it("refuses output that would change the parsed value", () => {
    const lossy = jsonWith((source) =>
      JSON.stringify({ ...JSON.parse(source), conditions: undefined }),
    );

    expect(() =>
      formatDefinition("segment", '{"conditions":"*","description":"x"}', lossy),
    ).toThrow(new FormatGuardError("Formatting would change the parsed value."));
  });

  it("refuses output that does not parse", () => {
    const broken = jsonWith((source) => source.replace("}", ""));

    expect(() => formatDefinition("segment", '{"description":"x"}', broken)).toThrow(
      new FormatGuardError("Formatting would change the parsed value."),
    );
  });

  it("refuses output that changes a date", () => {
    const dated = jsonWith(() => "1999-01-01", {
      parse: (content) => ({ startsAt: new Date(content.trim()) }) as never,
    });

    expect(() => formatDefinition("segment", "2026-10-28\n", dated)).toThrow(
      new FormatGuardError("Formatting would change the parsed value."),
    );
  });

  it("refuses output that loses a comment, when the parser lists them", () => {
    const commented = jsonWith((source) => source.replace(/ *#.*$/gm, ""), {
      parse: (content) => JSON.parse(content.replace(/#.*$/gm, "")),
      listComments: (source) => source.match(/#.*$/gm) || [],
    });

    expect(() => formatDefinition("segment", '{"description": "x"} # who\n', commented)).toThrow(
      new FormatGuardError("Formatting would lose or change a comment."),
    );
  });

  it("refuses output that a second pass changes", () => {
    let pass = 0;
    const unstable = jsonWith((source) => `${source.trim()}${" ".repeat(++pass)}`);

    expect(() => formatDefinition("segment", '{"description":"x"}', unstable)).toThrow(
      new FormatGuardError("Formatting is not stable: a second pass changes the output."),
    );
  });
});
