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
      orderValue: <T>(value: T) => {
        const record = value as Record<string, unknown>;
        return { description: record.description, conditions: record.conditions } as T;
      },
      options: {},
    };

    expect(jsonParser.format!('{"conditions":["nl"],"description":"x"}', layout)).toBe(
      '{\n    "description": "x",\n    "conditions": ["nl"]\n}',
    );
  });
});
