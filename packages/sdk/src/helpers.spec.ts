import { getValueByType, ValueType } from "./helpers";

describe("sdk: helpers", function () {
  it("should return null for type mismatch", function () {
    expect(getValueByType(1, "string")).toEqual(null);
  });

  it("should return the value as is if it is a string", function () {
    expect(getValueByType("1", "string")).toEqual("1");
  });

  it("should return the value as is if it is a boolean", function () {
    expect(getValueByType(true, "boolean")).toEqual(true);
  });

  it("should return the value as is if it is an object", function () {
    expect(getValueByType({ a: 1, b: 2 }, "object")).toEqual({ a: 1, b: 2 });
  });

  it("should return the value as is if it is a json", function () {
    expect(getValueByType(JSON.stringify({ a: 1, b: 2 }), "json")).toEqual(
      JSON.stringify({ a: 1, b: 2 }),
    );
  });

  it("should return array if the value is an array", function () {
    expect(getValueByType(["1", "2", "3"], "array")).toEqual(["1", "2", "3"]);
  });

  it("should return integer if the value is an integer", function () {
    expect(getValueByType("1", "integer")).toEqual(1);
  });

  it("should return double if the value is a double", function () {
    expect(getValueByType("1.1", "double")).toEqual(1.1);
  });

  it("should return null if the value is undefined", function () {
    expect(getValueByType(undefined, "string")).toEqual(null);
  });

  it("should return null if the value is null", function () {
    expect(getValueByType(null, "string")).toEqual(null);
  });

  it("should return null when a function is passed", function () {
    expect(getValueByType(function () {} as unknown as ValueType, "string")).toEqual(null);
  });
});
