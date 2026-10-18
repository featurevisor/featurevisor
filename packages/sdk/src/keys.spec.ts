import { getStickyChangeKeys } from "./keys";

describe("sticky change keys", () => {
  it("preserves first occurrence order and includes removed keys", () => {
    expect(getStickyChangeKeys({ b: true, a: false }, { a: true, c: true })).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(getStickyChangeKeys({ old: true }, {})).toEqual(["old"]);
    expect(getStickyChangeKeys({}, {})).toEqual([]);
  });

  it("collects own keys without treating special names as bookkeeping", () => {
    const value = JSON.parse('{"__proto__":true,"constructor":false,"0":1}');
    expect(getStickyChangeKeys(value, value)).toEqual(["0", "__proto__", "constructor"]);
    expect(getStickyChangeKeys(Object.create({ inherited: true }), { own: true })).toEqual(["own"]);
  });
});
