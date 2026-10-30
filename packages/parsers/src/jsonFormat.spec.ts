import { jsonParser } from "./json";
import { formatJson } from "./jsonFormat";
import type { FormatLayout } from "./layout";

describe("formatJson", () => {
  it("lays out JSON as Prettier does at its default width", async () => {
    // Prettier's standalone build, since its main entry loads plugins in a way Jest refuses
    const prettier = require("prettier/standalone");
    const plugins = [require("prettier/plugins/babel"), require("prettier/plugins/estree")];
    const word = (length: number) => "x".repeat(length);
    const shapes: unknown[] = [
      { description: "x", conditions: ["nl", "de"] },
      { tags: Array.from({ length: 12 }, (_, index) => `tag-${index}`) },
      // the 80th column, with and without a comma after the list
      { conditions: [word(62)], z: 1 },
      { conditions: [word(63)], z: 1 },
      { conditions: [word(64)] },
      { conditions: [word(65)] },
      { value: [["a", "b"]] },
      { value: [["a"], ["b"]] },
      {
        value: [
          ["a", "b"],
          ["c", "d"],
        ],
      },
      { value: [["a", "b"], "c"] },
      { value: Array.from({ length: 30 }, (_, index) => index * 1000) },
      { value: [-1, 2.5, 1e21, 0] },
      { value: [{}], other: [[]], empty: {}, none: [] },
      { value: [{ a: 1 }], mixed: [1, "a", null, true] },
      { description: "caf\u00e9 \u2028 \u0007" },
      { a: { b: { c: { d: { e: ["one", "two", "three", "four", "five", "six", "seven"] } } } } },
      [1, 2, 3],
    ];

    for (const shape of shapes) {
      const output = `${formatJson(shape, 2, { lineWidth: 80 })}\n`;
      expect(output).toBe(await prettier.format(output, { parser: "json", plugins }));
    }
  });

  it("keeps the blank lines written between members and items as Prettier does", async () => {
    const prettier = require("prettier/standalone");
    const plugins = [require("prettier/plugins/babel"), require("prettier/plugins/estree")];
    const sources = [
      '{\n\n  "a": 1,\n\n\n  "b": {\n\n    "c": 1,\n\n    "d": 2\n  }\n}',
      '{\n  "a": [1,\n\n 2],\n  "b": ["x",\n\n "y"],\n  "c": [\n    {\n      "d": 1\n    },\n\n    {\n      "e": 2\n    }\n  ]\n}',
      `{\n  "a": [${Array.from({ length: 40 }, (_, index) => index * 100).join(", ")},\n\n 1, 2]\n}`,
      `{\n  "a": ["${"x".repeat(40)}",\n\n "${"y".repeat(40)}"],\n  "b": "a\\"\\n\\n,b"\n}`,
      "[\n  [1, 2],\n\n  [3, 4]\n]",
    ];

    for (const source of sources) {
      const output = formatJson(JSON.parse(source), 2, { lineWidth: 80 }, { source });
      expect(`${output}\n`).toBe(await prettier.format(source, { parser: "json", plugins }));
    }
  });

  it("writes no blank lines without the source or a layout", () => {
    expect(formatJson({ a: 1, b: 2 })).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("puts blank lines where the layout asks, which Prettier keeps", async () => {
    const prettier = require("prettier/standalone");
    const plugins = [require("prettier/plugins/babel"), require("prettier/plugins/estree")];
    const layout = {
      spaceEntries: (path: (string | number)[]) => path.length === 0,
      spaceItems: (path: (string | number)[]) => path[0] === "rules" || path[0] === "tags",
    };
    const output = formatJson(
      { description: "x", tags: ["web", "ios"], rules: [{ key: "a" }, { key: "b" }] },
      2,
      { lineWidth: 80 },
      layout,
    );

    expect(output).toBe(
      [
        "{",
        '  "description": "x",',
        "",
        '  "tags": ["web", "ios"],',
        "",
        '  "rules": [',
        "    {",
        '      "key": "a"',
        "    },",
        "",
        "    {",
        '      "key": "b"',
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    );
    expect(`${output}\n`).toBe(await prettier.format(output, { parser: "json", plugins }));
  });

  it("gives every list item its own line at a line width of 0", () => {
    expect(formatJson({ tags: ["web", "ios"] }, 2, { lineWidth: 0 })).toBe(
      '{\n  "tags": [\n    "web",\n    "ios"\n  ]\n}',
    );
  });
});

describe("the JSON parser", () => {
  it("orders keys with the layout and indents by its width", () => {
    const layout: FormatLayout = {
      indent: 4,
      orderKeys: () => undefined,
      spaceEntries: () => false,
      spaceItems: () => false,
      keepBlankLines: true,
      orderValue: <T>(value: T) => {
        const record = value as Record<string, unknown>;
        return { description: record.description, conditions: record.conditions } as T;
      },
      options: {},
    };

    expect(jsonParser.format!('{"conditions":["nl"],"description":"x"}', layout)).toBe(
      '{\n    "description": "x",\n    "conditions": ["nl"]\n}',
    );
    expect(jsonParser.format!('{\n"conditions":["nl"],\n\n"description":"x"}', layout)).toBe(
      '{\n    "description": "x",\n    "conditions": ["nl"]\n}',
    );
    expect(
      jsonParser.format!('{"conditions":["nl"],"description":"x"}', {
        ...layout,
        spaceEntries: (path) => path.length === 0,
      }),
    ).toBe('{\n    "description": "x",\n\n    "conditions": ["nl"]\n}');
  });
});
