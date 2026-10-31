import type { Condition, Conditions } from "@featurevisor/types";

import { compile } from "./compile";
import { formatExpression } from "./format";
import { print, sameBuilt } from "./print";

const tree = (source: string, root = true) => compile(source, { root }).conditions;

describe("formatExpression", () => {
  it("writes operators, values and lists one way", () => {
    expect(formatExpression("country=='nl'   and  plan in ['a','b']")).toBe(
      "country == 'nl' and plan in ['a', 'b']",
    );
    expect(formatExpression("seats >= 1e1 and version > semver('5.5')")).toBe(
      "seats >= 10 and version > semver('5.5')",
    );
  });

  it("joins a short expression onto one line", () => {
    expect(formatExpression("markets.europe\nand not audiences.anonymous\n")).toBe(
      "markets.europe and not audiences.anonymous",
    );
  });

  it("breaks a long expression before each top level and or or", () => {
    const source =
      "device == 'mobile' and osVersion >= semver('17.0.0') and osVersion < semver('19.0.0')";
    expect(formatExpression(source)).toBe(
      "device == 'mobile'\nand osVersion >= semver('17.0.0')\nand osVersion < semver('19.0.0')",
    );
    expect(formatExpression("a or (b and c)", { width: 5 })).toBe("a\nor (b and c)");
  });

  it("puts parentheses where and and or mix, and drops ones that change nothing", () => {
    expect(formatExpression("a and b or c")).toBe("(a and b) or c");
    expect(formatExpression("(version == 5.5 or version == '5.5')")).toBe(
      "version == 5.5 or version == '5.5'",
    );
    expect(formatExpression("not (plan in ['free'])")).toBe("not plan in ['free']");
  });

  it("keeps comments above the operand below them, with the blank lines before them", () => {
    const source = [
      "# Everyone with a company address",
      "email   endsWith '@featurevisor.com'",
      "",
      "",
      "  # QA inboxes",
      "or email matches /^qa\\+[a-z]+@example\\.com$/i",
      "",
    ].join("\n");
    expect(formatExpression(source)).toBe(
      [
        "# Everyone with a company address",
        "email endsWith '@featurevisor.com'",
        "",
        "# QA inboxes",
        "or email matches /^qa\\+[a-z]+@example\\.com$/i",
      ].join("\n"),
    );
    expect(formatExpression("# only one\nnetherlands")).toBe("# only one\nnetherlands");
    expect(formatExpression("a and\n# between the word and the operand\nb")).toBe(
      "a\n# between the word and the operand\nand b",
    );
  });

  it("leaves an expression as written when a comment sits inside an operand or at the end", () => {
    expect(formatExpression("a and (b and\n# inside\nc)")).toBeUndefined();
    expect(formatExpression("a and b\n# after the last operand")).toBeUndefined();
  });

  it("leaves an expression with an error as written", () => {
    expect(formatExpression("plan = 'paid'")).toBeUndefined();
    expect(formatExpression("")).toBeUndefined();
  });

  it("formats an item of a list or a group, where `a and b` is a group", () => {
    const formatted = formatExpression("a  and   b", { root: false });
    expect(formatted).toBe("a and b");
    expect(tree(formatted!, false)).toEqual({ and: ["a", "b"] });
  });

  it("reads the project's namespace character", () => {
    expect(formatExpression("countries:nl   and x == 1", { namespaceCharacter: ":" })).toBe(
      "countries:nl and x == 1",
    );
  });
});

/** A small deterministic generator, so failures reproduce. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("formatExpression on generated expressions", () => {
  it("never changes the tree, keeps every comment, and a second pass changes nothing", () => {
    const next = random(7);
    const pick = <T>(values: T[]) => values[Math.floor(next() * values.length)];
    const leafOf = (): Condition =>
      pick<() => Condition>([
        () => pick(["netherlands", "countries/nl", "a.b"]),
        () =>
          ({
            attribute: "country",
            operator: pick(["equals", "notEquals"]),
            value: pick(["nl", 1, true, null]),
          }) as Condition,
        () => ({ attribute: "plan", operator: "notIn", value: ["a", "b'c"] }) as Condition,
        () =>
          ({
            attribute: "email",
            operator: "matches",
            value: "^[a-z]+$",
            regexFlags: "i",
          }) as Condition,
        () => ({ attribute: "v", operator: "semverLessThan", value: "2.0.0" }) as Condition,
        () => ({ attribute: "x", operator: "exists" }) as Condition,
        () =>
          ({ feature: "f", ...pick([{}, { enabled: false }, { variation: "v" }]) }) as Condition,
        () => ({ variable: "g", path: ["a", 0], operator: "notEquals", value: "x" }) as Condition,
      ])();
    const groupOf = (depth: number): Condition => {
      if (depth > 2 || next() < 0.45) return leafOf();
      const children = Array.from({ length: 1 + Math.floor(next() * 3) }, () => groupOf(depth + 1));
      return { [pick(["and", "or", "not"])]: children } as unknown as Condition;
    };

    let checked = 0;
    for (let run = 0; run < 300; run++) {
      const value = Array.from({ length: 1 + Math.floor(next() * 4) }, () => groupOf(0));
      const operands = value.map((item) => print([item] as Conditions, { width: Infinity }));
      if (operands.some((text) => text === undefined)) continue;
      // each operand as an item of the top level chain, in parentheses when it is a group
      const items = value.map((item, index) =>
        typeof item === "object" && ("and" in item || "or" in item)
          ? `(${operands[index]})`
          : operands[index]!,
      );
      const width = pick([Infinity, 60, 20]);
      const withComments = next() < 0.5;
      const source = items
        .map((text, index) => {
          const comment = withComments ? `  # note ${index}\n` : "";
          const lead = index === 0 ? "" : pick(["and ", "\n  and   ", "\nand\n"]);
          return `${index > 0 && withComments ? "\n" : ""}${comment}${lead}${text}`;
        })
        .join(pick([" ", "\n"]));
      const expected = tree(source);
      if (expected === undefined) continue;

      const formatted = formatExpression(source, { width });
      expect(formatted).toBeDefined();
      expect(sameBuilt(tree(formatted!), expected)).toBe(true);
      expect(formatExpression(formatted!, { width })).toBe(formatted);
      if (withComments) {
        items.forEach((_, index) => expect(formatted).toContain(`# note ${index}`));
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});
