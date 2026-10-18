import { matchGroup } from "./groups";

describe("matchGroup", () => {
  it.each<[boolean[] | { and?: boolean[]; or?: boolean[]; not?: boolean[] }, boolean]>([
    [[], false],
    [{ and: [] }, false],
    [{ or: [] }, false],
    [{ not: [] }, false],
    [[true, true], true],
    [[true, false], false],
    [{ and: [true, false] }, false],
    [{ and: [true, true] }, true],
    [{ or: [false, true] }, true],
    [{ or: [false, false] }, false],
    [{ not: [true, true] }, false],
    [{ not: [true, false] }, true],
    [{ not: [false, false] }, true],
    [{}, false],
  ])("matches %j as %s", (expression, expected) => {
    expect(matchGroup(expression, (value) => value)).toBe(expected);
  });

  it.each([
    ["and", false],
    ["or", true],
    ["not", false],
  ] as const)("short circuits %s without observing later children", (operator, first) => {
    const match = jest.fn((value: boolean) => value);
    expect(matchGroup({ [operator]: [first, !first] }, match)).toBe(operator !== "and");
    expect(match.mock.calls.map((call) => call[0])).toEqual([first]);
  });

  it("short circuits implicit AND arrays", () => {
    const match = jest.fn((value: boolean) => value);
    expect(matchGroup([false, true], match)).toBe(false);
    expect(match.mock.calls.map((call) => call[0])).toEqual([false]);
  });

  it("leaves error reporting to the caller", () => {
    const error = new Error("comparison failed");
    expect(() =>
      matchGroup({ or: [true] }, () => {
        throw error;
      }),
    ).toThrow(error);
  });
});
