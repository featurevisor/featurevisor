import { getTestDatafileKey } from "./datafileKey";

describe("test datafile identity", () => {
  it("distinguishes every selection without reserving naming delimiters", () => {
    const selections: Array<[string | null, string | null]> = [
      ["prod", "web"],
      ["prod-target-web", null],
      ["prod", "web-target-mobile"],
      ["prod-target-web", "mobile"],
      [null, "web"],
      ["false", "web"],
      ['prod"東京', "web\\quoted"],
      ['[null,"web"]', null],
      [null, null],
    ];
    const keys = selections.map(([environment, target]) => getTestDatafileKey(environment, target));
    expect(new Set(keys).size).toBe(selections.length);
    expect(keys.map((key) => JSON.parse(key))).toEqual(selections);
  });
  it("normalizes only absent environments and targets", () => {
    expect(getTestDatafileKey(false)).toBe(getTestDatafileKey(null, null));
    expect(getTestDatafileKey()).toBe(getTestDatafileKey(null, null));
    expect(getTestDatafileKey("false")).not.toBe(getTestDatafileKey(false));
  });
});
