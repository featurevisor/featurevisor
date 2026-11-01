import { locateYamlString } from "./locate";

describe("locateYamlString", () => {
  const content = [
    "description: Example",
    "conditions: netherlands and plan == 'paid'",
    "rules:",
    "  staging: &rules",
    "    - key: one",
    "      conditions: |",
    "        # Dutch",
    "        netherlands",
    "        and plan = 'paid'",
    "  production: *rules",
    "quoted: 'it''s here'",
    'double: "a \\"b\\" c"',
    "folded: >",
    "  first line",
    "  second line",
    "plain: first",
    "  second",
    "number: 5",
    "",
  ].join("\n");

  it("maps a plain value exactly", () => {
    const located = locateYamlString(content, ["conditions"])!;
    expect(located.positionAt(0)).toEqual({ line: 2, column: 13 });
    expect(located.positionAt(16)).toEqual({ line: 2, column: 29 });
    expect(located.lineText(2)).toBe("conditions: netherlands and plan == 'paid'");
  });

  it("maps a block literal line by line", () => {
    const located = locateYamlString(content, ["rules", "staging", 0, "conditions"])!;
    const value = "# Dutch\nnetherlands\nand plan = 'paid'\n";
    expect(located.positionAt(value.indexOf("netherlands"))).toEqual({ line: 8, column: 9 });
    expect(located.positionAt(value.indexOf("="))).toEqual({ line: 9, column: 18 });
  });

  it("follows aliases to where the value is written", () => {
    const located = locateYamlString(content, ["rules", "production", 0, "conditions"])!;
    expect(located.positionAt(0)).toEqual({ line: 7, column: 9 });
  });

  it("maps quoted and folded values", () => {
    expect(locateYamlString(content, ["quoted"])!.positionAt(0)).toEqual({ line: 11, column: 10 });
    expect(locateYamlString(content, ["double"])!.positionAt(0)).toEqual({ line: 12, column: 10 });
    const folded = locateYamlString(content, ["folded"])!;
    expect(folded.positionAt("first line ".length)).toEqual({ line: 15, column: 3 });
    const plain = locateYamlString(content, ["plain"])!;
    expect(plain.positionAt("first ".length)).toEqual({ line: 17, column: 3 });
  });

  it("clamps offsets beyond the value", () => {
    const located = locateYamlString(content, ["conditions"])!;
    expect(located.positionAt(999)).toEqual({ line: 2, column: 43 });
    expect(located.positionAt(-5)).toEqual({ line: 2, column: 13 });
    expect(located.lineText(999)).toBe("");
  });

  it("finds nothing where there is no string", () => {
    expect(locateYamlString(content, ["missing"])).toBeUndefined();
    expect(locateYamlString(content, ["number"])).toBeUndefined();
    expect(locateYamlString(content, ["rules", "staging", "key"])).toBeUndefined();
    expect(locateYamlString(content, ["description", "nested"])).toBeUndefined();
    expect(locateYamlString(content, ["rules", "staging", 5, "conditions"])).toBeUndefined();
  });
});
