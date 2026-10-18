import { findExponentialBacktracking } from "./regexSafety";

describe("findExponentialBacktracking", () => {
  test.each([
    ["^(a+)+$", "(a+)+"],
    ["^(a*)*$", "(a*)*"],
    ["(\\w+\\s?)+$", "(\\w+\\s?)+"],
    ["^((ab)+)+$", "((ab)+)+"],
    ["^(a|aa)+$", "(a|aa)+"],
    ["^(\\w|\\d)*x", "(\\w|\\d)*"],
    ["^([\\w.-]+)+@example\\.com$", "([\\w.-]+)+"],
    ["^(.*)*x", "(.*)*"],
    ["^(\\d+-?){10,}$", "(\\d+-?){10,}"],
    ["^x((a+)+)y", "(a+)+"],
  ])("reports %s", (pattern, group) => {
    expect(findExponentialBacktracking(pattern)).toBe(group);
  });

  test.each([
    "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$",
    "Chrome\\/(\\d+\\.)+\\d+",
    "^([a-z0-9-]+\\.)+[a-z]{2,}$",
    "^(ab+)+$",
    "^(a|b)+$",
    "^(a|ab)+$",
    "^(a+){2}$",
    "^[a-z]+$",
    ".*",
    "^\\d{3}-\\d{4}$",
    "^(foo|bar)$",
    "[(]+",
    "\\(a+\\)+",
    "^[^/]+/(?<!x)",
  ])("accepts %s", (pattern) => {
    expect(findExponentialBacktracking(pattern)).toBeUndefined();
  });

  test("reported patterns really backtrack and accepted ones do not", () => {
    const time = (pattern: string, input: string) => {
      const start = process.hrtime.bigint();
      new RegExp(pattern).test(input);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    expect(time("^(a+)+$", "a".repeat(22) + "!")).toBeGreaterThan(5);
    expect(time("^(ab+)+$", "ab".repeat(5000) + "!")).toBeLessThan(50);
    expect(time("^([a-z0-9-]+\\.)+[a-z]{2,}$", "a".repeat(5000) + "!")).toBeLessThan(500);
  });
});
