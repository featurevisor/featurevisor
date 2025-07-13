import { checkIfObjectsAreEqual, checkIfArraysAreEqual } from "./helpers";

describe("helpers", function () {
  describe("checkIfObjectsAreEqual", function () {
    it("should return true for two empty objects", () => {
      expect(checkIfObjectsAreEqual({}, {})).toBe(true);
    });

    it("should return true for objects with same keys and values", () => {
      expect(checkIfObjectsAreEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it("should return false for objects with different keys", () => {
      expect(checkIfObjectsAreEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it("should return false for objects with same keys but different values", () => {
      expect(checkIfObjectsAreEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it("should return false if one object has extra keys", () => {
      expect(checkIfObjectsAreEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
      expect(checkIfObjectsAreEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it("should return true for nested objects that are deeply equal", () => {
      expect(checkIfObjectsAreEqual({ a: { b: 2 }, c: 3 }, { a: { b: 2 }, c: 3 })).toBe(true);
    });

    it("should return false for nested objects that are not deeply equal", () => {
      expect(checkIfObjectsAreEqual({ a: { b: 2 }, c: 3 }, { a: { b: 3 }, c: 3 })).toBe(false);
    });

    // it("should return false if types differ", () => {
    //   expect(checkIfObjectsAreEqual({ a: 1 }, null as any)).toBe(false);
    //   expect(checkIfObjectsAreEqual(null as any, { a: 1 })).toBe(false);
    //   expect(checkIfObjectsAreEqual([], {})).toBe(false);
    // });

    it("should return true for objects with array values that are equal", () => {
      expect(checkIfObjectsAreEqual({ a: [1, 2, 3] }, { a: [1, 2, 3] })).toBe(true);
    });

    it("should return false for objects with array values that are not equal", () => {
      expect(checkIfObjectsAreEqual({ a: [1, 2, 3] }, { a: [1, 2, 4] })).toBe(false);
    });

    it("should return true for objects with different key order", () => {
      expect(checkIfObjectsAreEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it("should return true for objects with undefined values if both have them", () => {
      expect(checkIfObjectsAreEqual({ a: undefined }, { a: undefined })).toBe(true);
    });

    it("should return false for objects with one undefined and one missing key", () => {
      expect(checkIfObjectsAreEqual({ a: undefined }, {})).toBe(false);
    });
  });

  describe("checkIfArraysAreEqual", function () {
    it("should return true for two empty arrays", () => {
      expect(checkIfArraysAreEqual([], [])).toBe(true);
    });

    it("should return true for arrays with same elements in same order", () => {
      expect(checkIfArraysAreEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("should return false for arrays with same elements in different order", () => {
      expect(checkIfArraysAreEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });

    it("should return false for arrays of different lengths", () => {
      expect(checkIfArraysAreEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(checkIfArraysAreEqual([1, 2, 3], [1, 2])).toBe(false);
    });

    it("should return false for arrays with different elements", () => {
      expect(checkIfArraysAreEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it("should return true for nested arrays that are deeply equal", () => {
      expect(checkIfArraysAreEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
    });

    it("should return false for nested arrays that are not deeply equal", () => {
      expect(checkIfArraysAreEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
    });

    it("should return true for arrays with objects that are deeply equal", () => {
      expect(checkIfArraysAreEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(true);
    });

    it("should return false for arrays with objects that are not deeply equal", () => {
      expect(checkIfArraysAreEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }])).toBe(false);
    });

    it("should return false if types differ", () => {
      expect(checkIfArraysAreEqual([1, 2, 3], null as any)).toBe(false);
      expect(checkIfArraysAreEqual(null as any, [1, 2, 3])).toBe(false);
      expect(checkIfArraysAreEqual({} as any, [])).toBe(false);
    });

    it("should return true for arrays with undefined values if both have them in same positions", () => {
      expect(checkIfArraysAreEqual([1, undefined, 3], [1, undefined, 3])).toBe(true);
    });

    it("should return false for arrays with undefined values in different positions", () => {
      expect(checkIfArraysAreEqual([1, undefined, 3], [1, 3, undefined])).toBe(false);
    });

    it("should return true for arrays with different reference but same primitive values", () => {
      expect(checkIfArraysAreEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("should return true for arrays with nested objects and arrays that are deeply equal", () => {
      expect(
        checkIfArraysAreEqual([{ a: [1, 2], b: { c: 3 } }], [{ a: [1, 2], b: { c: 3 } }]),
      ).toBe(true);
    });

    it("should return false for arrays with nested objects and arrays that are not deeply equal", () => {
      expect(
        checkIfArraysAreEqual([{ a: [1, 2], b: { c: 3 } }], [{ a: [1, 2], b: { c: 4 } }]),
      ).toBe(false);
    });

    it("should return false for arrays with extra undefined at the end", () => {
      expect(checkIfArraysAreEqual([1, 2], [1, 2, undefined])).toBe(false);
    });

    // it("should return true for arrays with NaN values in same positions", () => {
    //   expect(checkIfArraysAreEqual([NaN, 2], [NaN, 2])).toBe(true);
    // });

    // it("should return false for arrays with NaN values in different positions", () => {
    //   expect(checkIfArraysAreEqual([2, NaN], [NaN, 2])).toBe(false);
    // });

    it("should return true for arrays with null values in same positions", () => {
      expect(checkIfArraysAreEqual([null, 2], [null, 2])).toBe(true);
    });

    it("should return false for arrays with null values in different positions", () => {
      expect(checkIfArraysAreEqual([2, null], [null, 2])).toBe(false);
    });
  });
});
