import type { Condition, Conditions } from "@featurevisor/types";

import { compile } from "./compile";
import { formatExpression } from "./format";
import { print, sameBuilt } from "./print";

const tree = (source: string, root = true) => compile(source, { root }).conditions;

describe("formatExpression", () => {
  it("writes operators, values and lists one way", () => {
    expect(formatExpression("country=='nl'   and  plan in ['a','b']")).toBe(
      "country == 'nl'\nand plan in ['a', 'b']",
    );
    expect(formatExpression("seats >= 1e1")).toBe("seats >= 10");
  });

  it("puts each condition on its own line, however short", () => {
    expect(formatExpression("a and b")).toBe("a\nand b");
    expect(
      formatExpression("audiences.workspaceAdmins and permissions includesAny ['write', 'admin']"),
    ).toBe("audiences.workspaceAdmins\nand permissions includesAny ['write', 'admin']");
  });

  it("keeps a single condition on one line", () => {
    expect(formatExpression("roles   notEmpty")).toBe("roles notEmpty");
    expect(formatExpression("not (plan in ['free'])")).toBe("not plan in ['free']");
    expect(formatExpression("(netherlands)")).toBe("netherlands");
  });

  it("puts a group's conditions between its parentheses, indented a level", () => {
    expect(
      formatExpression(
        "roles includes 'owner' or (roles includesAny ['billing', 'editor'] and roles notIncludes 'viewer')",
      ),
    ).toBe(
      [
        "roles includes 'owner'",
        "or (",
        "  roles includesAny ['billing', 'editor']",
        "  and roles notIncludes 'viewer'",
        ")",
      ].join("\n"),
    );
    expect(formatExpression("not (a and b)", { indent: 4 })).toBe("not (\n    a\n    and b\n)");
    expect(formatExpression("a and (b or not (c and d))")).toBe(
      ["a", "and (", "  b", "  or not (", "    c", "    and d", "  )", ")"].join("\n"),
    );
  });

  it("puts parentheses where and and or mix, and drops ones that change nothing", () => {
    expect(formatExpression("a and b or c")).toBe("(\n  a\n  and b\n)\nor c");
    expect(formatExpression("(version == 5.5 or version == '5.5')")).toBe(
      "version == 5.5\nor version == '5.5'",
    );
  });

  it("keeps comments above the condition below them, with the blank lines before them", () => {
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
    expect(formatExpression("a and\n# between the word and the condition\nb")).toBe(
      "a\n# between the word and the condition\nand b",
    );
    expect(formatExpression("a or (\n# inside a group\nb and c)")).toBe(
      "a\nor (\n  # inside a group\n  b\n  and c\n)",
    );
  });

  it("leaves an expression as written when a comment is not above a condition", () => {
    expect(formatExpression("a and (b and c\n# after a group's last condition\n)")).toBeUndefined();
    expect(formatExpression("a and b\n# after the last condition")).toBeUndefined();
    expect(formatExpression("plan in [\n# inside one condition\n'a']")).toBeUndefined();
    expect(formatExpression("not\n# between not and its group\n(a and b)")).toBeUndefined();
  });

  it("leaves an expression with an error as written", () => {
    expect(formatExpression("plan = 'paid'")).toBeUndefined();
    expect(formatExpression("")).toBeUndefined();
  });

  it("formats an item of a list or a group, where `a and b` is a group", () => {
    const formatted = formatExpression("a  and   b", { root: false });
    expect(formatted).toBe("a\nand b");
    expect(tree(formatted!, false)).toEqual({ and: ["a", "b"] });
  });

  it("reads the project's namespace character", () => {
    expect(formatExpression("countries:nl   and x == 1", { namespaceCharacter: ":" })).toBe(
      "countries:nl\nand x == 1",
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

/** Whether a formatted line holds at most one condition */
function oneCondition(line: string): boolean {
  const text = line.trim().replace(/^(?:(?:and|or|not) )+/, "");
  return text.startsWith("#") || !/ (?:and|or) /.test(text);
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

      const formatted = formatExpression(source);
      expect(formatted).toBeDefined();
      expect(sameBuilt(tree(formatted!), expected)).toBe(true);
      expect(formatExpression(formatted!)).toBe(formatted);
      expect(formatted!.split("\n").every(oneCondition)).toBe(true);
      if (withComments) {
        items.forEach((_, index) => expect(formatted).toContain(`# note ${index}`));
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});
