import {
  findInheritedPropertyNames,
  getInheritedPropertyNameError,
  INHERITED_PROPERTY_NAMES,
} from "./reservedNames";

describe("inherited property names", () => {
  test("covers every name a plain JavaScript object inherits", () => {
    for (const name of Object.getOwnPropertyNames(Object.prototype))
      expect(INHERITED_PROPERTY_NAMES.has(name)).toBe(true);
  });

  test("rejects reserved attribute names", () => {
    expect(getInheritedPropertyNameError("constructor", "Attribute name")).toBe(
      'Attribute name "constructor" is reserved because JavaScript objects inherit it. Choose another name.',
    );
    expect(getInheritedPropertyNameError("country", "Attribute name")).toBeNull();
  });

  test("finds reserved property names at every depth, including an own __proto__ key", () => {
    const attribute = JSON.parse(
      JSON.stringify({
        type: "object",
        properties: {
          toString: { type: "string" },
          profile: {
            type: "object",
            properties: { name: { type: "string" }, valueOf: { type: "string" } },
          },
          tags: { type: "array", items: { type: "object", properties: { constructor: {} } } },
        },
      }).replace('"name"', '"__proto__"'),
    );
    expect(findInheritedPropertyNames(attribute)).toEqual([
      { name: "toString", path: ["properties", "toString"] },
      { name: "__proto__", path: ["properties", "profile", "properties", "__proto__"] },
      { name: "valueOf", path: ["properties", "profile", "properties", "valueOf"] },
      { name: "constructor", path: ["properties", "tags", "items", "properties", "constructor"] },
    ]);
  });
});
