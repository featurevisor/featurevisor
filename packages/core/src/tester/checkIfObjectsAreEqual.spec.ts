import { checkIfObjectsAreEqual } from "./checkIfObjectsAreEqual";

describe("core :: tester :: checkIfObjectsAreEqual", function () {
  test("should return true if objects are equal", function () {
    const a = { a: 1, b: 2 };
    const b = { a: 1, b: 2 };

    expect(checkIfObjectsAreEqual(a, b)).toBe(true);
  });

  test("should return false if objects are not equal", function () {
    const a = { a: 1, b: 2 };
    const b = { a: 1, b: 3 };

    expect(checkIfObjectsAreEqual(a, b)).toBe(false);
  });

  test("should return true if nested objects are equal", function () {
    const a = { a: 1, b: { c: 3 } };
    const b = { a: 1, b: { c: 3 } };

    expect(checkIfObjectsAreEqual(a, b)).toBe(true);
  });

  test("should return false if nested objects are not equal", function () {
    const a = { a: 1, b: { c: 3 } };
    const b = { a: 5, b: { c: 4 } };

    expect(checkIfObjectsAreEqual(a, b)).toBe(false);
  });
});
