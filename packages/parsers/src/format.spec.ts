import { parse } from "yaml";

import { formatYml, listYmlComments, YmlFormatError, type YmlLayout } from "./format";
import { jsonParser } from "./json";
import type { FormatLayout } from "./layout";
import { ymlParser } from "./yml";

const layout: YmlLayout = {
  orderKeys: (path) => {
    if (path.length === 0) return ["description", "bucketBy", "rules"];
    if (path.length === 2 && path[0] === "rules") return ["key", "conditions", "percentage"];
    return undefined;
  },
  spaceItems: (path) => path.length === 1 && path[0] === "rules",
};

describe("formatYml", () => {
  it("separates top level keys with a blank line and packs nested ones", () => {
    const source =
      "description: Checkout\nbucketBy: userId\nrules:\n\n  - key: everyone\n\n    percentage: 100\n";

    expect(formatYml(source, layout)).toBe(
      "description: Checkout\n\nbucketBy: userId\n\nrules:\n  - key: everyone\n    percentage: 100\n",
    );
  });

  it("orders keys as the layout asks, keeping unknown keys in their authored order after them", () => {
    const source = "zeta: 1\nrules: []\nalpha: 2\ndescription: Checkout\n";

    expect(formatYml(source, layout)).toBe(
      "description: Checkout\n\nrules: []\n\nzeta: 1\n\nalpha: 2\n",
    );
  });

  it("puts a blank line between the items of the lists the layout names", () => {
    const source = [
      "rules:",
      "  - percentage: 50",
      "    key: nl",
      "    conditions: [netherlands]",
      "  # everyone else",
      "  - key: everyone",
      "    conditions: '*'",
      "    percentage: 100",
      "",
    ].join("\n");

    expect(formatYml(source, layout)).toBe(
      [
        "rules:",
        "  - key: nl",
        "    conditions:",
        "      - netherlands",
        "    percentage: 50",
        "",
        "  # everyone else",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
  });

  it("keeps comments with the key below them when keys move", () => {
    const source = [
      "# Checkout flag",
      "",
      "# the rules first",
      "rules: []",
      "description: Checkout # short",
      "# how users are bucketed",
      "bucketBy: userId",
      "",
    ].join("\n");

    expect(formatYml(source, layout)).toBe(
      [
        "# Checkout flag",
        "",
        "description: Checkout # short",
        "",
        "# how users are bucketed",
        "bucketBy: userId",
        "",
        "# the rules first",
        "rules: []",
        "",
      ].join("\n"),
    );
  });

  it("moves a comment above the first key of a nested map along with that key", () => {
    const nested: YmlLayout = {
      orderKeys: (path) => (path[0] === "settings" ? ["b", "a"] : undefined),
    };

    expect(formatYml("settings:\n  # about a\n  a: 1\n  b: 2\n", nested)).toBe(
      "settings:\n  b: 2\n  # about a\n  a: 1\n",
    );
  });

  it("writes flow collections as blocks, but keeps empty ones inline", () => {
    expect(formatYml("tags: [web, ios]\nvalue: { a: 1 }\nnone: []\nempty: {}\n")).toBe(
      "tags:\n  - web\n  - ios\n\nvalue:\n  a: 1\n\nnone: []\n\nempty: {}\n",
    );
  });

  it("quotes only where needed, double unless the text holds a double quote", () => {
    const source = [
      'description: "Checkout"',
      "everyone: '*'",
      `json: '{"foo": "bar"}'`,
      'country: "no"',
      "date: '2026-10-28'",
      'number: "1.0"',
      "empty: ''",
      "",
    ].join("\n");

    expect(formatYml(source)).toBe(
      [
        "description: Checkout",
        "",
        'everyone: "*"',
        "",
        `json: '{"foo": "bar"}'`,
        "",
        'country: "no"',
        "",
        'date: "2026-10-28"',
        "",
        'number: "1.0"',
        "",
        'empty: ""',
        "",
      ].join("\n"),
    );
  });

  it("adds quotes to strings YAML 1.1 tools would read as another type", () => {
    expect(formatYml("country: no\nanswer: yes\n")).toBe('country: "no"\n\nanswer: "yes"\n');
  });

  it("never folds long strings", () => {
    const long =
      "A description well past eighty characters, which the yaml library folds by default";
    expect(formatYml(`description: ${long}\n`)).toBe(`description: ${long}\n`);
  });

  it("keeps block scalars and drops a document start marker", () => {
    expect(formatYml("---\nmessage: |\n  line one\n  line two\n")).toBe(
      "message: |\n  line one\n  line two\n",
    );
  });

  it("keeps the parsed value and comments, and is stable", () => {
    const source = [
      "# header",
      "",
      "rules:",
      "  # first",
      "  - {percentage: 100, key: a}",
      "  - key: b # inline",
      "    percentage: 0",
      "description: 'Checkout'",
      "",
    ].join("\n");
    const output = formatYml(source, layout);

    expect(parse(output)).toEqual(parse(source));
    expect(listYmlComments(output)).toEqual(listYmlComments(source));
    expect(formatYml(output, layout)).toBe(output);
  });

  it("throws YmlFormatError with a position for invalid YAML and for several documents", () => {
    expect(() => formatYml("description: [unclosed\n")).toThrow(YmlFormatError);
    expect(() => formatYml("a: 1\n---\nb: 2\n")).toThrow(YmlFormatError);

    let error: unknown;
    try {
      formatYml("key: value\n  bad: indentation\n");
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(YmlFormatError);
    expect((error as YmlFormatError).linePos).toEqual({
      line: expect.any(Number),
      col: expect.any(Number),
    });
  });

  it("returns an empty document as it is", () => {
    expect(formatYml("")).toBe("");
    expect(formatYml("# only a comment\n")).toBe("# only a comment\n");
  });
});

describe("listYmlComments", () => {
  it("lists every comment line, sorted", () => {
    expect(listYmlComments("# b\nkey: 1 # a\n# c\nother: 2\n")).toEqual(["a", "b", "c"]);
  });
});

describe("parser formats", () => {
  const layout: FormatLayout = {
    orderKeys: (path) => (path.length === 0 ? ["description", "conditions"] : undefined),
    spaceItems: () => false,
    orderValue: <T>(value: T) => {
      const record = value as Record<string, unknown>;
      return { description: record.description, conditions: record.conditions } as T;
    },
  };

  it("lays out YAML in full", () => {
    expect(ymlParser.format!("conditions: '*'\ndescription: x\n", layout)).toBe(
      'description: x\n\nconditions: "*"\n',
    );
  });

  it("orders JSON keys and indents with two spaces", () => {
    expect(jsonParser.format!('{"conditions":"*","description":"x"}', layout)).toBe(
      '{\n  "description": "x",\n  "conditions": "*"\n}\n',
    );
  });
});
