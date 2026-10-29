import { parse } from "yaml";

import type { FormatLayout } from "./layout";
import { ymlParser } from "./yml";
import { formatYml, listYmlComments, type YmlLayout } from "./ymlFormat";

// a blank line between top level keys, as Featurevisor's layout asks for every definition
const top: YmlLayout = { spaceEntries: (path) => path.length === 0 };

const layout: YmlLayout = {
  ...top,
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

  it("adds blank lines only where the layout asks, between entries or items", () => {
    const source = "a: 1\nb:\n  first: 1\n  second: 2\nc:\n  - 1\n  - 2\n";

    expect(formatYml(source)).toBe(source);
    expect(
      formatYml(source, {
        spaceEntries: (path) => path.length === 0 || path[0] === "b",
        spaceItems: (path) => path[0] === "c",
      }),
    ).toBe("a: 1\n\nb:\n  first: 1\n\n  second: 2\n\nc:\n  - 1\n\n  - 2\n");
  });

  it("stays stable when a list ends in a comment above a spaced entry", () => {
    const spaced: YmlLayout = { spaceEntries: () => true };
    const source = "staging:\n  - 1\n  # 2\n\n\nproduction:\n  - 3\n";
    const output = formatYml(source, spaced);

    expect(output).toBe("staging:\n  - 1\n  # 2\n\nproduction:\n  - 3\n");
    expect(formatYml(output, spaced)).toBe(output);
  });

  it("indents by the layout's width", () => {
    expect(formatYml("a:\n  b: 1\n", { indent: 4 })).toBe("a:\n    b: 1\n");
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
    expect(formatYml("tags: [web, ios]\nvalue: { a: 1 }\nnone: []\nempty: {}\n", top)).toBe(
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

    expect(formatYml(source, top)).toBe(
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
    expect(formatYml("country: no\nanswer: yes\n", top)).toBe('country: "no"\n\nanswer: "yes"\n');
  });

  it("never folds long strings", () => {
    const long =
      "A description well past eighty characters, which the yaml library folds by default";
    expect(formatYml(`description: ${long}\n`)).toBe(`description: ${long}\n`);
  });

  it("keeps block scalars and drops the document start and end markers", () => {
    expect(formatYml("---\nmessage: |\n  line one\n  line two\n...\n")).toBe(
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

  it("throws YAML's parse error, with its position, for invalid YAML and for several documents", () => {
    expect(() => formatYml("description: [unclosed\n")).toThrow();
    expect(() => formatYml("a: 1\n---\nb: 2\n")).toThrow(/multiple documents/);

    let error: unknown;
    try {
      formatYml("key: value\n  bad: indentation\n");
    } catch (thrown) {
      error = thrown;
    }
    expect((error as { linePos?: unknown[] }).linePos?.[0]).toEqual({
      line: expect.any(Number),
      col: expect.any(Number),
    });
  });

  it("keeps the authored key order when the house order would put an alias above its anchor", () => {
    // the house order is description, bucketBy, rules, which would put *all before &all
    const source = "rules: &all [everyone]\ndescription: 'x'\nbucketBy: *all\n";
    const output = formatYml(source, layout);

    expect(output).toBe("rules: &all\n  - everyone\n\ndescription: x\n\nbucketBy: *all\n");
    expect(formatYml(output, layout)).toBe(output);
  });

  it("returns an empty document as it is", () => {
    expect(formatYml("")).toBe("");
    expect(formatYml("# only a comment\n")).toBe("# only a comment\n");
  });

  it("keeps a comment on the line of a key whose list or map is below it", () => {
    const source =
      "rules: # most specific first\n  - key: a\nsettings: # nested\n  # first\n  a: 1\n";

    expect(formatYml(source)).toBe(source);
  });
});

describe("blank lines the author wrote", () => {
  const keep: YmlLayout = { keepBlankLines: true };

  it("keeps one between entries and between items, and none above the first", () => {
    const source = [
      "settings:",
      "",
      "  a: 1",
      "",
      "",
      "  b: 2",
      "  c: 3 # three",
      "",
      "  # about d",
      "  d: 4",
      "tags:",
      "  - web",
      "",
      "  - ios",
      "",
    ].join("\n");

    expect(formatYml(source, keep)).toBe(
      [
        "settings:",
        "  a: 1",
        "",
        "  b: 2",
        "  c: 3 # three",
        "",
        "  # about d",
        "  d: 4",
        "tags:",
        "  - web",
        "",
        "  - ios",
        "",
      ].join("\n"),
    );
    expect(formatYml(source)).toBe(
      "settings:\n  a: 1\n  b: 2\n  c: 3 # three\n  # about d\n  d: 4\ntags:\n  - web\n  - ios\n",
    );
  });

  it("moves a blank line with the entry below it, and adds the layout's own", () => {
    const source = "rules:\n  - percentage: 50\n\n    key: a\n    conditions: nl\n";

    expect(formatYml(source, { ...layout, ...keep })).toBe(
      "rules:\n  - key: a\n    conditions: nl\n    percentage: 50\n",
    );
    expect(
      formatYml("zeta: 1\nalpha: 2\n\nomega: 3\n", { ...keep, orderKeys: () => ["omega"] }),
    ).toBe("omega: 3\nzeta: 1\nalpha: 2\n");
  });
});

describe("the ignore line comment", () => {
  const ignore = "# featurevisor-ignore-line";

  it("keeps the key and value on the line as written, and their place", () => {
    const source = [
      `rules: []`,
      `tags: [web,ios]  ${ignore}`,
      `bucketBy: 'userId' ${ignore}`,
      `description: 'Checkout'`,
      "",
    ].join("\n");
    const output = formatYml(source, layout);

    expect(output).toBe(
      [
        "description: Checkout",
        "",
        `tags: [web,ios] ${ignore}`,
        "",
        `bucketBy: 'userId' ${ignore}`,
        "",
        "rules: []",
        "",
      ].join("\n"),
    );
    expect(parse(output)).toEqual(parse(source));
    expect(formatYml(output, layout)).toBe(output);
  });

  it("keeps a list item as written", () => {
    const source = `tags:\n  - 'web'\n  - {name: ios} ${ignore}\n  - {name: android}\n`;

    expect(formatYml(source)).toBe(
      `tags:\n  - web\n  - {name: ios} ${ignore}\n  - name: android\n`,
    );
  });

  it("keeps a key in its place and lays out the list or map below it", () => {
    const source = `rules: ${ignore}\n  - percentage: 5\n    key: 'a'\ndescription: x\n`;
    const output = formatYml(source, layout);

    expect(output).toBe(`rules: ${ignore}\n  - key: a\n    percentage: 5\n\ndescription: x\n`);
    expect(formatYml(output, layout)).toBe(output);
  });

  it("lays out a value over several lines as usual, with the comment on its key's line", () => {
    const output = formatYml(`tags: [web,\n  ios] ${ignore}\nempty: ${ignore}\n`);

    expect(output).toBe(`tags: ${ignore}\n  - web\n  - ios\nempty: ${ignore}\n`);
    expect(formatYml(output)).toBe(output);
  });

  it("leaves the comment as text inside a quoted value", () => {
    expect(formatYml(`a: '${ignore}'\n`)).toBe(`a: "${ignore}"\n`);
  });
});

describe("listYmlComments", () => {
  it("lists every comment line, sorted", () => {
    expect(listYmlComments("# b\nkey: 1 # a\n# c\nother: 2\n")).toEqual(["a", "b", "c"]);
  });
});

describe("YAML options", () => {
  it("prefers single quotes when asked, and double around text with a single quote", () => {
    const options = { quote: "single" as const };

    expect(formatYml(`a: "*"\nb: "it's: x"\nc: "no"\n`, { options })).toBe(
      `a: '*'\nb: "it's: x"\nc: 'no'\n`,
    );
  });

  it("leaves text YAML 1.1 reads as another type bare when asked", () => {
    expect(formatYml('country: "no"\n', { options: { quoteYaml11Types: false } })).toBe(
      "country: no\n",
    );
  });

  it("folds long text at a line width", () => {
    const text = "word ".repeat(20).trim();
    const output = formatYml(`description: ${text}\n`, { options: { lineWidth: 40 } });

    expect(output.split("\n").length).toBeGreaterThan(3);
    expect(output.split("\n").every((line) => line.length <= 40)).toBe(true);
    expect(parse(output)).toEqual({ description: text });
  });

  it("writes list items level with their key when asked", () => {
    expect(formatYml("tags:\n  - web\n", { options: { indentSequences: false } })).toBe(
      "tags:\n- web\n",
    );
  });
});

describe("the YAML parser", () => {
  const layout: FormatLayout = {
    indent: 2,
    orderKeys: (path) => (path.length === 0 ? ["description", "conditions"] : undefined),
    spaceEntries: (path) => path.length === 0,
    spaceItems: () => false,
    keepBlankLines: false,
    orderValue: <T>(value: T) => value,
    options: { quote: "single" },
  };

  it("formats with the layout and its options", () => {
    expect(ymlParser.format!('conditions: "*"\ndescription: x\n', layout)).toBe(
      "description: x\n\nconditions: '*'\n",
    );
  });

  it("lists comments for Featurevisor to check", () => {
    expect(ymlParser.listComments!("# a\nkey: 1 # b\n")).toEqual(["a", "b"]);
  });
});
