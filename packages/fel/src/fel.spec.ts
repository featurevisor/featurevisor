import type { Condition, Conditions } from "@featurevisor/types";

import {
  compile,
  containsExpression,
  createPositionResolver,
  expandConditions,
  getAmbiguousNamespaceCharacters,
  isEntityKey,
  isExpression,
  OPERATOR_SPELLINGS,
  parse,
  print,
  quoteString,
  toFel,
} from "./index";
import type { FelOptions } from "./index";

function tree(source: string, options: Parameters<typeof compile>[1] = {}) {
  const result = compile(source, options);
  expect(result.errors).toEqual([]);
  return result.conditions;
}

function leaf(source: string) {
  return tree(source, { root: false });
}

function error(source: string, options: FelOptions = {}) {
  const result = parse(source, options);
  expect(result.errors).toHaveLength(1);
  return result.errors[0];
}

function warnings(source: string) {
  const result = parse(source);
  expect(result.errors).toEqual([]);
  return result.warnings;
}

describe("keys", () => {
  it.each([
    ["netherlands", true],
    ["eu-countries", true],
    ["old_users", true],
    ["countries/nl", true],
    ["countries.netherlands", true],
    ["2fa", true],
    ["*", false],
    ["", false],
    ["plan == 'paid'", false],
    ["a b", false],
    [5, false],
  ])("isEntityKey(%p) is %p", (value, expected) => {
    expect(isEntityKey(value)).toBe(expected);
  });

  it("accepts the project's namespace character", () => {
    expect(isEntityKey("countries:nl")).toBe(false);
    expect(isEntityKey("countries:nl", { namespaceCharacter: ":" })).toBe(true);
    expect(isExpression("countries:nl", { namespaceCharacter: ":" })).toBe(false);
  });

  it.each([
    ["netherlands", false],
    ["*", false],
    ['[{"attribute":"a"}]', false],
    ['{"and":[]}', false],
    ["feature('liveChat')", true],
    ["(netherlands)", true],
    ["plan == 'paid'", true],
    ["", true],
    [null, false],
  ])("isExpression(%p) is %p", (value, expected) => {
    expect(isExpression(value)).toBe(expected);
  });

  it("names namespace characters that clash with FEL", () => {
    expect(getAmbiguousNamespaceCharacters()).toEqual([]);
    expect(getAmbiguousNamespaceCharacters({ namespaceCharacter: "=" })).toEqual(["="]);
  });

  it("spells every operator", () => {
    expect(Object.keys(OPERATOR_SPELLINGS)).toHaveLength(32);
  });
});

describe("operators", () => {
  it.each<[string, Record<string, unknown>]>([
    ["country == 'nl'", { attribute: "country", operator: "equals", value: "nl" }],
    ["country != 'nl'", { attribute: "country", operator: "notEquals", value: "nl" }],
    ["seats > 10", { attribute: "seats", operator: "greaterThan", value: 10 }],
    ["seats >= 10", { attribute: "seats", operator: "greaterThanOrEquals", value: 10 }],
    ["seats < 10", { attribute: "seats", operator: "lessThan", value: 10 }],
    ["seats <= 10", { attribute: "seats", operator: "lessThanOrEquals", value: 10 }],
    ["email contains 'example'", { attribute: "email", operator: "contains", value: "example" }],
    ["email notContains 'x'", { attribute: "email", operator: "notContains", value: "x" }],
    ["email startsWith 'admin'", { attribute: "email", operator: "startsWith", value: "admin" }],
    ["email endsWith '.nl'", { attribute: "email", operator: "endsWith", value: ".nl" }],
    [
      "plan in ['paid', 'enterprise']",
      { attribute: "plan", operator: "in", value: ["paid", "enterprise"] },
    ],
    ["seats in [1, 5, 10]", { attribute: "seats", operator: "in", value: [1, 5, 10] }],
    ["plan notIn ['free']", { attribute: "plan", operator: "notIn", value: ["free"] }],
    [
      "permissions includes 'write'",
      { attribute: "permissions", operator: "includes", value: "write" },
    ],
    [
      "permissions notIncludes 'admin'",
      { attribute: "permissions", operator: "notIncludes", value: "admin" },
    ],
    [
      "permissions includesAny ['write', 'admin']",
      { attribute: "permissions", operator: "includesAny", value: ["write", "admin"] },
    ],
    [
      "permissions notIncludesAny ['write']",
      { attribute: "permissions", operator: "notIncludesAny", value: ["write"] },
    ],
    [
      "email matches /^[a-z]+@example\\.com$/i",
      { attribute: "email", operator: "matches", value: "^[a-z]+@example\\.com$", regexFlags: "i" },
    ],
    [
      "email notMatches /^admin@/",
      { attribute: "email", operator: "notMatches", value: "^admin@" },
    ],
    [
      "signupDate before '2026-01-01T00:00:00Z'",
      { attribute: "signupDate", operator: "before", value: "2026-01-01T00:00:00Z" },
    ],
    [
      "signupDate after '2026-01-01T00:00:00Z'",
      { attribute: "signupDate", operator: "after", value: "2026-01-01T00:00:00Z" },
    ],
    [
      "version == semver('5.5.0')",
      { attribute: "version", operator: "semverEquals", value: "5.5.0" },
    ],
    [
      "version != semver('5.4.1')",
      { attribute: "version", operator: "semverNotEquals", value: "5.4.1" },
    ],
    [
      "version > semver('5.0')",
      { attribute: "version", operator: "semverGreaterThan", value: "5.0" },
    ],
    [
      "version >= semver('5.0')",
      { attribute: "version", operator: "semverGreaterThanOrEquals", value: "5.0" },
    ],
    ["version < semver('6')", { attribute: "version", operator: "semverLessThan", value: "6" }],
    [
      "version <= semver('6')",
      { attribute: "version", operator: "semverLessThanOrEquals", value: "6" },
    ],
    ["userId exists", { attribute: "userId", operator: "exists" }],
    ["userId notExists", { attribute: "userId", operator: "notExists" }],
    ["account isNull", { attribute: "account", operator: "isNull" }],
    ["account notNull", { attribute: "account", operator: "notNull" }],
    ["permissions empty", { attribute: "permissions", operator: "empty" }],
    ["permissions notEmpty", { attribute: "permissions", operator: "notEmpty" }],
  ])("%s", (source, expected) => {
    expect(tree(source)).toEqual(expected);
  });

  it("reads operators without spaces around them", () => {
    expect(tree("country=='nl'")).toEqual({
      attribute: "country",
      operator: "equals",
      value: "nl",
    });
    expect(tree("email matches/^a/")).toEqual({
      attribute: "email",
      operator: "matches",
      value: "^a",
    });
    expect(tree("plan in['a']")).toEqual({ attribute: "plan", operator: "in", value: ["a"] });
  });
});

describe("values", () => {
  it.each<[string, unknown]>([
    ["x == 'it\\'s'", "it's"],
    ["x == 'back\\\\slash'", "back\\slash"],
    ["x == 'line\\nbreak'", "line\nbreak"],
    ["x == 'tab\\there'", "tab\there"],
    ["x == 'caf\\u00e9'", "café"],
    ["x == ''", ""],
    ["x == 'a #hash'", "a #hash"],
    ["x == 0", 0],
    ["x == -5", -5],
    ["x == 2.5", 2.5],
    ["x == 1e3", 1000],
    ["x == -1.5E-2", -0.015],
    ["x == true", true],
    ["x == false", false],
    ["x == null", null],
  ])("%s", (source, expected) => {
    expect((tree(source) as { value: unknown }).value).toEqual(expected);
  });

  it("reads lists", () => {
    expect((tree("x in []") as { value: unknown }).value).toEqual([]);
    expect((tree("x in [ 'a' , null ]") as { value: unknown }).value).toEqual(["a", null]);
    expect((tree("x in [1, '2', true]") as { value: unknown }).value).toEqual([1, "2", true]);
  });

  it("reads regular expressions with escaped slashes and every flag", () => {
    expect(tree("x matches /a\\/b\\d/gims")).toEqual({
      attribute: "x",
      operator: "matches",
      value: "a/b\\d",
      regexFlags: "gims",
    });
  });
});

describe("groups", () => {
  it.each<[string, Conditions]>([
    ["a and b", ["a", "b"]],
    ["a and b and c", ["a", "b", "c"]],
    ["a or b", { or: ["a", "b"] }],
    ["not a", { not: ["a"] }],
    ["not (a and b)", { not: ["a", "b"] }],
    ["not (a or b)", { not: [{ or: ["a", "b"] }] }],
    ["not not a", { not: [{ not: ["a"] }] }],
    ["(a and b) or c", { or: [{ and: ["a", "b"] }, "c"] }],
    ["a and (b or c)", ["a", { or: ["b", "c"] }]],
    ["a and (b and c)", ["a", { and: ["b", "c"] }]],
    ["a or (b or c)", { or: ["a", { or: ["b", "c"] }] }],
    ["(a)", "a"],
    ["((a and b))", ["a", "b"]],
  ])("%s", (source, expected) => {
    expect(tree(source)).toEqual(expected);
  });

  it("makes an `and` inside a list item a group", () => {
    expect(leaf("a and b")).toEqual({ and: ["a", "b"] });
  });

  it("binds not tighter than and, and and tighter than or", () => {
    expect(tree("not a and b or c")).toEqual({ or: [{ and: [{ not: ["a"] }, "b"] }, "c"] });
  });
});

describe("names and reads", () => {
  it("reads a name alone as a segment, in every key shape", () => {
    expect(tree("eu-countries and countries/nl and countries.netherlands and 2fa")).toEqual([
      "eu-countries",
      "countries/nl",
      "countries.netherlands",
      "2fa",
    ]);
  });

  it("reads names shaped like operators, calls and keywords where they cannot be either", () => {
    expect(tree("contains == 'x'")).toEqual({
      attribute: "contains",
      operator: "equals",
      value: "x",
    });
    expect(tree("exists exists")).toEqual({ attribute: "exists", operator: "exists" });
    expect(tree("feature and variable and semver")).toEqual(["feature", "variable", "semver"]);
    expect(tree("orders == 1 and andrew")).toEqual([
      { attribute: "orders", operator: "equals", value: 1 },
      "andrew",
    ]);
  });

  it("reads dotted attribute paths", () => {
    expect(tree("account.seats >= 10")).toEqual({
      attribute: "account.seats",
      operator: "greaterThanOrEquals",
      value: 10,
    });
  });

  it("reads features", () => {
    expect(tree("feature('liveChat')")).toEqual({ feature: "liveChat" });
    expect(tree("feature('liveChat') == true")).toEqual({ feature: "liveChat", enabled: true });
    expect(tree("feature('liveChat') == false")).toEqual({ feature: "liveChat", enabled: false });
    expect(tree("feature('liveChat') != true")).toEqual({ feature: "liveChat", enabled: false });
    expect(tree("feature('liveChat') != false")).toEqual({ feature: "liveChat", enabled: true });
    expect(tree("feature( 'checkout.flow' )")).toEqual({ feature: "checkout.flow" });
    expect(tree("feature('pricing').variation == 'control'")).toEqual({
      feature: "pricing",
      variation: "control",
    });
  });

  it("reads feature variables with paths", () => {
    expect(tree("feature('buyButton').label == 'Buy now'")).toEqual({
      feature: "buyButton",
      variable: "label",
      operator: "equals",
      value: "Buy now",
    });
    expect(tree("feature('buyButton').settings.currency == 'EUR'")).toEqual({
      feature: "buyButton",
      variable: "settings",
      path: ["currency"],
      operator: "equals",
      value: "EUR",
    });
    expect(tree("feature('buyButton')['label.v2'] exists")).toEqual({
      feature: "buyButton",
      variable: "label.v2",
      operator: "exists",
    });
    expect(tree("feature('x')['variation'] == 'a'")).toEqual({
      feature: "x",
      variable: "variation",
      operator: "equals",
      value: "a",
    });
  });

  it("reads global variables with paths", () => {
    expect(tree("variable('maintenanceMode') == false")).toEqual({
      variable: "maintenanceMode",
      operator: "equals",
      value: false,
    });
    expect(tree("variable('checkoutSettings')['limits.v2'][0].quota > 5")).toEqual({
      variable: "checkoutSettings",
      path: ["limits.v2", 0, "quota"],
      operator: "greaterThan",
      value: 5,
    });
    expect(tree("variable('list').items.0 == 'a'")).toEqual({
      variable: "list",
      path: ["items", 0],
      operator: "equals",
      value: "a",
    });
  });
});

describe("comments and positions", () => {
  it("skips whole line comments", () => {
    expect(tree("# Dutch accounts only\n  netherlands\n  # paid\n  and plan == 'paid'")).toEqual([
      "netherlands",
      { attribute: "plan", operator: "equals", value: "paid" },
    ]);
  });

  it("does not treat a # inside a line as a comment", () => {
    expect(error("netherlands # note").code).toBe("fel_comment");
    expect((tree("tag == ' #sale'") as { value: unknown }).value).toBe(" #sale");
  });

  it("reports lines and columns inside multi line expressions", () => {
    const result = error("netherlands\nand (plan == 'paid'\n  or seats = 10)");
    expect(result.code).toBe("fel_single_equals");
    expect(result.start).toEqual({ offset: 43, line: 3, column: 12 });
    expect(result.end).toEqual({ offset: 44, line: 3, column: 13 });
  });

  it("resolves positions at every boundary", () => {
    const at = createPositionResolver("ab\ncd");
    expect(at(0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(at(3)).toEqual({ offset: 3, line: 2, column: 1 });
    expect(at(99)).toEqual({ offset: 5, line: 2, column: 3 });
    expect(at(-1)).toEqual({ offset: 0, line: 1, column: 1 });
  });

  it("records where each compiled leaf came from", () => {
    const { spans } = compile("netherlands and plan == 'paid'");
    expect(spans).toHaveLength(2);
    expect(spans[0].path).toEqual([0]);
    expect(spans[0].subject.start.column).toBe(1);
    expect(spans[1].path).toEqual([1]);
    expect(spans[1].subject).toEqual({
      start: { offset: 16, line: 1, column: 17 },
      end: { offset: 20, line: 1, column: 21 },
    });
    expect(spans[1].operator?.start.column).toBe(22);
    expect(spans[1].value?.start.column).toBe(25);
  });

  it("records spans inside groups", () => {
    const { spans } = compile("not (a or b == 1)");
    expect(spans.map((span) => span.path)).toEqual([
      ["not", 0, "or", 0],
      ["not", 0, "or", 1],
    ]);
  });
});

describe("errors", () => {
  it.each<[string, string, string?]>(
    [
      ["", "fel_empty"],
      ["   \n # only a comment", "fel_empty"],
      ["country = 'nl'", "fel_single_equals", "=="],
      ["country === 'nl'", "fel_triple_equals"],
      ["country <> 'nl'", "fel_unknown_operator"],
      ["country => 1", "fel_unknown_operator"],
      ["plan in 'paid'", "fel_list_required", "['paid']"],
      ["plan == ['a']", "fel_list_value", "in"],
      ["plan != ['a']", "fel_list_value", "notIn"],
      ["tags includes ['a']", "fel_list_value", "includesAny"],
      ["email contains ['a']", "fel_list_value"],
      ["country == nl", "fel_unquoted_value", "'nl'"],
      ["country == True", "fel_keyword_case"],
      ['country == "nl"', "fel_double_quotes", "'nl'"],
      ['country == "nl', "fel_double_quotes"],
      ["country == 'nl", "fel_unterminated_string"],
      ["country == 'n\\x'", "fel_string_escape"],
      ["country ==", "fel_missing_value"],
      ["country == )", "fel_missing_value"],
      ["a && b", "fel_symbol_logic", undefined],
      ["a || b", "fel_symbol_logic"],
      ["!a", "fel_symbol_logic"],
      ["a AND b", "fel_keyword_case"],
      ["NOT a", "fel_keyword_case"],
      ["a and", "fel_missing_condition"],
      ["a or", "fel_missing_condition"],
      ["not", "fel_missing_condition"],
      ["and a", "fel_missing_condition"],
      ["()", "fel_empty_group"],
      ["(a or b", "fel_unclosed_parenthesis"],
      ["(a or b c", "fel_missing_operator"],
      ["a)", "fel_unmatched_parenthesis"],
      [")", "fel_missing_condition"],
      ["a, b", "fel_comma"],
      ["'nl' == country", "fel_value_first"],
      ["true", "fel_literal_condition", "'*'"],
      ["false", "fel_literal_condition"],
      ["foo bar", "fel_missing_operator", "foo == 'bar'"],
      ["foo 'bar'", "fel_missing_operator"],
      ["x == 1 y", "fel_missing_logic"],
      ["x == 1 = 2", "fel_single_equals"],
      ["plan not in ['a']", "fel_spaced_negative", "notIn"],
      ["x not exists", "fel_spaced_negative", "notExists"],
      ["x IN ['a']", "fel_operator_case", "in"],
      ["x equals 'a'", "fel_tree_operator", "=="],
      ["v semverGreaterThan '1'", "fel_tree_operator", "semver"],
      ["x is null", "fel_unknown_operator", "isNull"],
      ["x like 'a%'", "fel_unknown_operator", "startsWith"],
      ["version > '5.5.0'", "fel_number_comparison", "semver('5.5.0')"],
      ["date > '2026-01-01'", "fel_number_comparison", "after"],
      ["date < '2026-01-01'", "fel_number_comparison", "before"],
      ["seats > '5'", "fel_number_comparison", "without quotes"],
      ["seats > true", "fel_number_comparison"],
      ["x == 5.5.0", "fel_version_number", "semver('5.5.0')"],
      ["x == 01", "fel_number"],
      ["x == 10px", "fel_number", "'10px'"],
      ["x == -", "fel_number"],
      ["x == 1e999", "fel_number"],
      ["x in ['a',]", "fel_trailing_comma"],
      ["x in ['a' 'b']", "fel_list_separator"],
      ["x in ['a'", "fel_unclosed_list"],
      ["x in [/a/]", "fel_regex_operator"],
      ["x in [semver('1')]", "fel_list_item"],
      ["x == /a/", "fel_regex_operator"],
      ["x matches 'a/b'", "fel_regex_required", "/a\\/b/"],
      ["x matches /a", "fel_unterminated_regex"],
      ["x matches /a\\", "fel_unterminated_regex"],
      ["x matches //", "fel_empty_regex"],
      ["x matches /a/gg", "fel_regex_flags"],
      ["x matches /a/x", "fel_regex_flags"],
      ["x contains 5", "fel_text_required"],
      ["x before 5", "fel_text_required"],
      ["x in semver('1')", "fel_semver_operator"],
      ["x == semver(1)", "fel_semver_argument"],
      ["x == semver('1'", "fel_read_close"],
      ["semver('1') == x", "fel_semver_subject"],
      ["custom('x')", "fel_unknown_call"],
      ["feature(liveChat)", "fel_read_key"],
      ["feature('')", "fel_read_key"],
      ["feature('a'", "fel_read_close"],
      ["feature('a') exists", "fel_feature_comparison"],
      ["feature('a') == 'b'", "fel_feature_comparison"],
      ["feature('a').variation", "fel_variation_comparison"],
      ["feature('a').variation != 'b'", "fel_variation_comparison", "not ("],
      ["feature('a').variation in ['b']", "fel_variation_comparison", " or "],
      ["feature('a').variation > 1", "fel_variation_comparison"],
      ["feature('a').variation.x == 1", "fel_variation_path"],
      ["feature('a').label", "fel_variable_comparison", "== true"],
      ["feature('a')[0] == 1", "fel_path"],
      ["variable('a')", "fel_variable_comparison", "variable('a') == true"],
      ["variable('a'). == 1", "fel_path"],
      ["variable('a')[x] == 1", "fel_path"],
      ["variable('a')[01] == 1", "fel_path"],
      ["variable('a')['b' == 1", "fel_path"],
      ["a @ b", "fel_unexpected"],
    ].map(([source, code, hint]) => [source, code, hint ?? ""] as [string, string, string]),
  )("%s gives %s", (source, code, hint) => {
    const result = error(source);
    expect(result.code).toBe(code);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/\.$/);
    if (hint) expect(result.hint).toContain(hint);
  });

  it("stops at the length limit", () => {
    expect(error("a and b", { maxLength: 3 }).code).toBe("fel_too_long");
  });

  it("stops deep nesting without exhausting the stack", () => {
    expect(error(`${"(".repeat(100)}a${")".repeat(100)}`).code).toBe("fel_too_deep");
    expect(error(`${"not ".repeat(5000)}a`, { maxLength: 100000 }).code).toBe("fel_too_deep");
    expect(parse(`${"(".repeat(10)}a${")".repeat(10)}`, { maxDepth: 64 }).errors).toEqual([]);
  });

  it("reads long chains without recursion", () => {
    const source = Array.from({ length: 2000 }, (_, index) => `s${index}`).join(" and ");
    expect((tree(source, { maxLength: 100000 }) as string[]).length).toBe(2000);
  });

  it("explains a namespace character FEL also uses", () => {
    const result = error("a=b and c", { namespaceCharacter: "=" });
    expect(result.hint).toContain('namespace character "="');
  });
});

describe("warnings", () => {
  it("warns when and and or mix without parentheses", () => {
    const [warning] = warnings("a and b or c");
    expect(warning.code).toBe("fel_mixed_logic");
    expect(warning.severity).toBe("warning");
    expect(warning.hint).toContain("(a and b) or c");
    expect(warnings("(a and b) or c")).toEqual([]);
    expect(warnings("a and (b or c)")).toEqual([]);
  });

  it.each([
    ["not (plan in ['free'])", "plan notIn ['free']"],
    ["not (email contains 'x')", "email notContains 'x'"],
    ["not (tags includes 'x')", "tags notIncludes 'x'"],
    ["not (tags includesAny ['x'])", "tags notIncludesAny ['x']"],
    ["not (email matches /x/)", "email notMatches /x/"],
    ["not (account isNull)", "account notNull"],
    ["not (tags empty)", "tags notEmpty"],
    ["not (v == semver('1.0'))", "v != semver('1.0')"],
    ["not variable('a') in ['x']", "variable('a') notIn ['x']"],
  ])("warns about missing values for %s", (source, positive) => {
    const [warning] = warnings(source);
    expect(warning.code).toBe("fel_negation_intent");
    expect(warning.hint).toContain(positive);
  });

  it.each(["not (country == 'nl')", "not (userId exists)", "not netherlands", "not (a and b)"])(
    "does not warn for %s",
    (source) => {
      expect(warnings(source)).toEqual([]);
    },
  );
});

describe("expandConditions", () => {
  it("compiles the whole value, list items and group children", () => {
    const input: Conditions = [
      "netherlands",
      "plan == 'paid' and seats > 1",
      { or: ["mobile", "device == 'tablet'"] },
      { attribute: "x", operator: "exists" },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const result = expandConditions(input);
    expect(result.hasErrors).toBe(false);
    expect(result.conditions).toEqual([
      "netherlands",
      {
        and: [
          { attribute: "plan", operator: "equals", value: "paid" },
          { attribute: "seats", operator: "greaterThan", value: 1 },
        ],
      },
      { or: ["mobile", { attribute: "device", operator: "equals", value: "tablet" }] },
      { attribute: "x", operator: "exists" },
    ]);
    expect(input).toEqual(copy);
    expect(result.expressions.map((expression) => expression.path)).toEqual([[1], [2, "or", 1]]);
    expect(result.expressions[0].spans.map((span) => span.path)).toEqual([
      [1, "and", 0],
      [1, "and", 1],
    ]);
  });

  it("compiles a whole string value as the root", () => {
    expect(expandConditions("a == 1 and b").conditions).toEqual([
      { attribute: "a", operator: "equals", value: 1 },
      "b",
    ]);
  });

  it("keeps values without FEL as they are", () => {
    const value: Conditions = ["a", { not: ["b"] }];
    expect(expandConditions(value).conditions).toBe(value);
    expect(expandConditions("*").conditions).toBe("*");
    expect(expandConditions("netherlands").expressions).toEqual([]);
  });

  it("keeps a string with errors in place and reports it", () => {
    const result = expandConditions(["a", "b = 1"]);
    expect(result.hasErrors).toBe(true);
    expect(result.conditions).toEqual(["a", "b = 1"]);
    expect(result.expressions[0].errors[0].code).toBe("fel_single_equals");
  });

  it("finds expressions without compiling", () => {
    expect(containsExpression("a == 1")).toBe(true);
    expect(containsExpression(["a", { and: ["b", { not: ["c == 1"] }] }])).toBe(true);
    expect(containsExpression(["a", { attribute: "x", operator: "exists" }])).toBe(false);
    expect(containsExpression(5)).toBe(false);
  });
});

describe("print", () => {
  const leaves: Condition[] = [
    "netherlands",
    { attribute: "country", operator: "equals", value: "nl" },
    { attribute: "country", operator: "notEquals", value: "it's" },
    { attribute: "seats", operator: "greaterThan", value: 10 },
    { attribute: "seats", operator: "lessThanOrEquals", value: -2.5 },
    { attribute: "beta", operator: "equals", value: true },
    { attribute: "beta", operator: "equals", value: null },
    { attribute: "plan", operator: "in", value: ["paid", "enterprise"] },
    { attribute: "seats", operator: "notIn", value: [1, 2] },
    { attribute: "email", operator: "contains", value: "a\nb\tc\u0001" },
    { attribute: "email", operator: "startsWith", value: "admin" },
    { attribute: "tags", operator: "includes", value: "x" },
    { attribute: "tags", operator: "notIncludesAny", value: ["x", null] },
    { attribute: "email", operator: "matches", value: "^a/b$", regexFlags: "i" },
    { attribute: "email", operator: "notMatches", value: "^x" },
    { attribute: "date", operator: "after", value: "2026-01-01T00:00:00Z" },
    { attribute: "version", operator: "semverEquals", value: "5.5" },
    { attribute: "version", operator: "semverGreaterThanOrEquals", value: "5.5.0" },
    { attribute: "userId", operator: "exists" },
    { attribute: "tags", operator: "notEmpty" },
    { feature: "liveChat" },
    { feature: "liveChat", enabled: true },
    { feature: "liveChat", enabled: false },
    { feature: "pricing", variation: "control" },
    { variable: "maintenanceMode", operator: "equals", value: false },
    { variable: "settings", path: ["limits.v2", 0, "quota"], operator: "greaterThan", value: 5 },
    { feature: "buyButton", variable: "label", operator: "equals", value: "Buy" },
    { feature: "buyButton", variable: "label.v2", operator: "exists" },
    { feature: "buyButton", variable: "variation", operator: "equals", value: "a" },
    { feature: "x", variable: "0", operator: "equals", value: "a" },
  ];

  it.each(leaves.map((value) => [JSON.stringify(value), value]))(
    "round trips %s exactly",
    (_name, value) => {
      const converted = toFel([value, "z"] as Conditions);
      expect(expandConditions(converted).conditions).toEqual([value, "z"]);
      expect(typeof converted).toBe("string");
    },
  );

  it("prints groups with the parentheses they need", () => {
    expect(print({ or: [{ and: ["a", "b"] }, "c"] })).toBe("(a and b) or c");
    expect(print(["a", { or: ["b", "c"] }])).toBe("a and (b or c)");
    expect(print({ or: ["a", { or: ["b", "c"] }] })).toBe("a or (b or c)");
    expect(print({ not: ["a"] })).toBe("not a");
    expect(print({ not: ["a", "b"] })).toBe("not (a and b)");
    expect(print({ not: [{ or: ["a", "b"] }] })).toBe("not (a or b)");
    expect(print({ not: [{ not: ["a"] }] })).toBe("not not a");
  });

  it("breaks long expressions before each top level operator", () => {
    const value = [
      "countries.netherlands",
      "segmentNumberTwo",
      "anotherVeryLongSegmentName",
      "fourthSegment",
    ];
    expect(print(value)).toBe(
      "countries.netherlands\nand segmentNumberTwo\nand anotherVeryLongSegmentName\nand fourthSegment",
    );
    expect(print(value, { width: 200 })).toBe(value.join(" and "));
    expect(print({ or: value }, { width: 10 })).toBe(value.join("\nor "));
  });

  it.each<[string, unknown]>([
    [
      "a disabled feature's variation",
      { feature: "pricing", enabled: false, variation: "control" },
    ],
    ["a regular expression holding \\/", { attribute: "x", operator: "matches", value: "a\\/b" }],
    ["a regular expression across lines", { attribute: "x", operator: "matches", value: "a\nb" }],
    ["an empty regular expression", { attribute: "x", operator: "matches", value: "" }],
    ["invalid flags", { attribute: "x", operator: "matches", value: "a", regexFlags: "x" }],
    [
      "flags on another operator",
      { attribute: "x", operator: "equals", value: "a", regexFlags: "i" },
    ],
    ["a keyword segment", "and"],
    ["an uppercase keyword segment", "NOT"],
    ["an attribute name with a space", { attribute: "a b", operator: "exists" }],
    ["an unknown operator", { attribute: "x", operator: "like", value: "a" }],
    ["a missing value", { attribute: "x", operator: "equals" }],
    ["a value on a presence operator", { attribute: "x", operator: "exists", value: 1 }],
    ["a list after equals", { attribute: "x", operator: "equals", value: ["a"] }],
    ["a scalar after in", { attribute: "x", operator: "in", value: "a" }],
    ["text after a number comparison", { attribute: "x", operator: "greaterThan", value: "1" }],
    ["a number after contains", { attribute: "x", operator: "contains", value: 1 }],
    ["a version that is not text", { attribute: "x", operator: "semverEquals", value: 1 }],
    ["NaN", { attribute: "x", operator: "equals", value: NaN }],
    ["an object value", { attribute: "x", operator: "equals", value: { a: 1 } }],
    ["a nested list", { attribute: "x", operator: "in", value: [["a"]] }],
    ["an extra key", { attribute: "x", operator: "exists", note: "y" }],
    ["an empty group", { and: [] }],
    ["two group keys", { and: ["a"], or: ["b"] }],
    ["a group beside other keys", { and: ["a"], x: 1 }],
    ["an empty not", { not: [] }],
    ["an unknown leaf", { something: true }],
    ["a negative index", { variable: "v", path: [-1], operator: "exists" }],
    ["a path of the wrong type", { variable: "v", path: 5, operator: "exists" }],
    ["a path holding an object", { variable: "v", path: [{}], operator: "exists" }],
    ["an empty variable key", { variable: "", operator: "exists" }],
    ["an empty feature key", { feature: "", variable: "v", operator: "exists" }],
    ["a feature key of the wrong type", { feature: 1, variable: "v", operator: "exists" }],
    ["an empty feature", { feature: "" }],
    ["a feature with a key it does not have", { feature: "a", operator: "equals" }],
    ["enabled that is not a boolean", { feature: "a", enabled: "yes" }],
    ["a variation that is not text", { feature: "a", variation: 1 }],
    ["everyone inside a group", { or: ["*", "a"] }],
  ])("keeps %s as a tree", (_name, value) => {
    expect(print(value as Conditions)).toBeUndefined();
    expect(toFel(["z", value] as Conditions)).toEqual(["z", value]);
  });

  it("prints a dotted string path as the built array path", () => {
    expect(print({ variable: "v", path: "a.0.b", operator: "exists" } as Condition)).toBe(
      "variable('v').a[0].b exists",
    );
  });

  it("quotes every special character", () => {
    expect(quoteString("a'b\\c\nd\te\u007f")).toBe("'a\\'b\\\\c\\nd\\te\\u007f'");
  });
});

describe("toFel", () => {
  it("converts a whole list to one expression", () => {
    expect(
      toFel([
        "netherlands",
        { attribute: "plan", operator: "equals", value: "paid" },
      ] as Conditions),
    ).toBe("netherlands and plan == 'paid'");
  });

  it("keeps strings, and a list of one leaf", () => {
    expect(toFel("netherlands")).toBe("netherlands");
    expect(toFel("*")).toBe("*");
    expect(toFel([{ attribute: "x", operator: "exists" }] as Conditions)).toEqual(["x exists"]);
    expect(toFel(["netherlands"])).toEqual(["netherlands"]);
  });

  it("converts the children of a whole value written as a group", () => {
    expect(toFel({ and: ["a", { attribute: "x", operator: "exists" }] } as Conditions)).toEqual({
      and: ["a", "x exists"],
    });
    expect(
      toFel({ or: ["a", { feature: "p", enabled: false, variation: "c" }] } as Conditions),
    ).toEqual({ or: ["a", { feature: "p", enabled: false, variation: "c" }] });
  });

  it("converts what it can around a leaf without a FEL form", () => {
    const disabled = { feature: "p", enabled: false, variation: "c" };
    expect(toFel(["a", { or: ["b", disabled] }, "x == 1"] as Conditions)).toEqual([
      "a",
      { or: ["b", disabled] },
      "x == 1",
    ]);
  });

  it("keeps a leaf whose keys are in another order, in exact mode", () => {
    const reordered = { operator: "equals", value: 1, attribute: "x" } as unknown as Condition;
    expect(toFel(["a", reordered] as Conditions)).toEqual(["a", reordered]);
    expect(toFel(["a", reordered] as Conditions, { exact: false })).toBe("a and x == 1");
  });

  it("converts by meaning when asked", () => {
    expect(toFel({ and: ["a", "b"] }, { exact: false })).toBe("a and b");
    expect(toFel([{ attribute: "x", operator: "exists" }] as Conditions, { exact: false })).toBe(
      "x exists",
    );
    expect(toFel({ not: [{ and: ["a", "b"] }] }, { exact: false })).toBe("not (a and b)");
    expect(
      toFel({ feature: "p", enabled: true, variation: "t" } as Conditions, { exact: false }),
    ).toBe("feature('p').variation == 't'");
    expect(toFel({ feature: "p", enabled: true, variation: "t" } as Conditions)).toEqual({
      feature: "p",
      enabled: true,
      variation: "t",
    });
    expect(
      toFel({ feature: "p", enabled: false, variation: "c" } as Conditions, { exact: false }),
    ).toEqual({
      feature: "p",
      enabled: false,
      variation: "c",
    });
  });
});

/** A small deterministic generator, so round trip failures reproduce. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("round trips", () => {
  it("reads back every generated tree exactly", () => {
    const next = random(42);
    const pick = <T>(values: T[]) => values[Math.floor(next() * values.length)];
    const leafOf = (): Condition =>
      pick<() => Condition>([
        () => pick(["netherlands", "eu-countries", "countries/nl", "a.b"]),
        () =>
          ({
            attribute: pick(["country", "account.seats"]),
            operator: "equals",
            value: pick(["nl", 1, true, null]),
          }) as Condition,
        () =>
          ({
            attribute: "seats",
            operator: pick(["greaterThan", "lessThan"]),
            value: Math.round(next() * 100),
          }) as Condition,
        () =>
          ({
            attribute: "plan",
            operator: pick(["in", "notIn"]),
            value: ["a", "b'c"],
          }) as Condition,
        () =>
          ({
            attribute: "email",
            operator: "matches",
            value: "^[a-z]+$",
            regexFlags: "i",
          }) as Condition,
        () => ({ attribute: "v", operator: "semverLessThan", value: "2.0.0" }) as Condition,
        () => ({ attribute: "x", operator: pick(["exists", "notEmpty"]) }) as Condition,
        () =>
          ({ feature: "f", ...pick([{}, { enabled: false }, { variation: "v" }]) }) as Condition,
        () => ({ variable: "g", path: ["a", 0], operator: "notEquals", value: "x" }) as Condition,
        () => ({ feature: "f", variable: "k", operator: "equals", value: 2 }) as Condition,
      ])();
    const groupOf = (depth: number): Condition => {
      if (depth > 3 || next() < 0.4) return leafOf();
      const children = Array.from({ length: 1 + Math.floor(next() * 3) }, () => groupOf(depth + 1));
      return { [pick(["and", "or", "not"])]: children } as unknown as Condition;
    };
    for (let run = 0; run < 300; run++) {
      const value = Array.from({ length: 1 + Math.floor(next() * 3) }, () => groupOf(0));
      const converted = toFel(value);
      expect(expandConditions(converted).conditions).toEqual(value);
      const meaningConverted = toFel(value, { exact: false });
      expect(expandConditions(meaningConverted).hasErrors).toBe(false);
    }
  });
});
