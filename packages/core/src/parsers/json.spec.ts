import { jsonParser } from "./json";

describe("core :: parser :: jsonParser", () => {
  it("should parse JSON string into object", () => {
    const jsonString = '{"foo":1,"bar":"baz","arr":[1,2]}';
    const result = jsonParser.parse<{ foo: number; bar: string; arr: number[] }>(jsonString);
    expect(result).toEqual({ foo: 1, bar: "baz", arr: [1, 2] });
  });

  it("should stringify object into JSON string (pretty-printed)", () => {
    const obj = { foo: 1, bar: "baz", arr: [1, 2] };
    const jsonString = jsonParser.stringify(obj);
    const expectedString = `{
  "foo": 1,
  "bar": "baz",
  "arr": [
    1,
    2
  ]
}`;
    expect(jsonString).toBe(expectedString);
  });

  it("should parse and then stringify to preserve content", () => {
    const original = { alpha: "a", num: 42, bool: true, nullish: null, nested: { z: "x" } };
    const str = jsonParser.stringify(original);
    const reparsed = jsonParser.parse<typeof original>(str);
    expect(reparsed).toEqual(original);
  });

  it("should throw if invalid JSON string is provided to parse", () => {
    expect(() => {
      jsonParser.parse("this is not json");
    }).toThrow();
  });
});
