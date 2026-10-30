import type { FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { getFormatLayout, getKeyOrder, isSpacedList, isSpacedMap, orderValue } from "./layout";
import { HOUSE_STYLE } from "./style";

// These check where each part of the house style reaches, not what the style says, so they
// hold whatever style.ts is changed to. style.spec.ts checks the style itself.

type KeyOrderName = keyof typeof HOUSE_STYLE.keyOrder;
type BlankLineName = keyof typeof HOUSE_STYLE.blankLines;

describe("key order", () => {
  const ordered: [EntityType, FormatPath, KeyOrderName][] = [
    ["feature", [], "feature"],
    ["feature", ["rules", 0], "rule"],
    ["feature", ["rules", "production", 1], "rule"],
    ["feature", ["force", 0], "force"],
    ["feature", ["force", "staging", 0], "force"],
    ["feature", ["variations", 0], "variation"],
    ["feature", ["variablesSchema", "price"], "variableSchema"],
    ["feature", ["variablesSchema", "price", "properties", "amount"], "schema"],
    ["feature", ["variations", 0, "variableOverrides", "price", 0], "featureVariableOverride"],
    [
      "feature",
      ["rules", "production", 0, "variableOverrides", "price", 1],
      "featureVariableOverride",
    ],
    ["variable", [], "variable"],
    ["variable", ["overrides", 0], "variableOverride"],
    ["variable", ["overrides", "production", 0, "overrides", 1], "variableOverride"],
    ["variable", ["items"], "schema"],
    ["variable", ["oneOf", 1, "properties", "plan"], "schema"],
    ["segment", [], "segment"],
    ["attribute", [], "attribute"],
    ["attribute", ["properties", "plan"], "schema"],
    ["schema", [], "schema"],
    ["target", [], "target"],
    ["test", [], "test"],
    ["test", ["assertions", 0], "assertion"],
    ["test", ["assertions", 0, "children", 1], "assertion"],
    ["test", ["assertions", 0, "checks", 0], "check"],
    ["test", ["assertions", 0, "checks", 0, "not", 0, "and", 1], "check"],
    ["scenario", [], "assertion"],
    ["scenario", ["children", 0], "assertion"],
    ["scenario", ["checks", 0, "or", 1], "check"],
  ];

  it.each(ordered)("orders the %s map at %j by the %s order", (entityType, at, name) => {
    const order = HOUSE_STYLE.keyOrder[name];

    // every listed key, written in reverse, and one fmt does not know
    expect(getKeyOrder(entityType, at, ["unknown", ...[...order].reverse()])).toEqual([
      ...order,
      "unknown",
    ]);
  });

  const values: [EntityType, FormatPath][] = [
    ["feature", ["rules"]],
    ["feature", ["variablesSchema"]],
    ["feature", ["conditions", 0]],
    ["feature", ["rules", 0, "variables"]],
    ["feature", ["variations", 0, "variables"]],
    ["variable", ["compose", "enabled"]],
    ["variable", ["defaultValue"]],
    ["variable", ["overrides", 0, "value"]],
    ["attribute", ["properties"]],
    ["test", ["assertions", 0, "context"]],
    ["test", ["assertions", 0, "expectedVariables"]],
  ];

  it.each(values)("keeps the written order of the %s map at %j", (entityType, at) => {
    expect(getKeyOrder(entityType, at, ["b", "a"])).toBeUndefined();
  });

  it("orders a parsed value as it orders keys, and keeps the author's keys", () => {
    const value = {
      rules: [{ percentage: 100, key: "everyone", conditions: "*" }],
      description: "Checkout",
      variablesSchema: { b: { defaultValue: "x", type: "string" }, a: { type: "integer" } },
    };
    const ordered = orderValue("feature", value) as typeof value;

    expect(Object.keys(ordered)).toEqual(getKeyOrder("feature", [], Object.keys(value)));
    expect(Object.keys(ordered.rules[0])).toEqual(
      getKeyOrder("feature", ["rules", 0], Object.keys(value.rules[0])),
    );
    expect(Object.keys(ordered.variablesSchema)).toEqual(["b", "a"]);
    expect(Object.keys(ordered.variablesSchema.b)).toEqual(
      getKeyOrder("feature", ["variablesSchema", "b"], ["defaultValue", "type"]),
    );
  });
});

describe("blank lines", () => {
  const lists: [EntityType, FormatPath, BlankLineName][] = [
    ["feature", ["rules"], "rules"],
    ["feature", ["rules", "production"], "rules"],
    ["feature", ["force"], "force"],
    ["feature", ["force", "staging"], "force"],
    ["feature", ["variations"], "variations"],
    ["feature", ["variations", 0, "variableOverrides", "price"], "featureVariableOverrides"],
    ["feature", ["rules", 0, "variableOverrides", "price"], "featureVariableOverrides"],
    ["variable", ["overrides"], "variableOverrides"],
    ["variable", ["overrides", "production", 0, "overrides"], "variableOverrides"],
    ["test", ["assertions"], "assertions"],
    ["test", ["assertions", 0, "children"], "assertionChildren"],
    ["scenario", ["children"], "assertionChildren"],
    ["test", ["assertions", 0, "checks"], "checks"],
    ["scenario", ["checks", 0, "or"], "checks"],
  ];

  it.each(lists)("spaces the %s list at %j as %s says", (entityType, at, name) => {
    expect(isSpacedList(entityType, at)).toBe(HOUSE_STYLE.blankLines[name]);
  });

  const maps: [EntityType, FormatPath, BlankLineName][] = [
    ["attribute", [], "topLevelKeys"],
    ["schema", [], "topLevelKeys"],
    ["segment", [], "topLevelKeys"],
    ["feature", [], "topLevelKeys"],
    ["variable", [], "topLevelKeys"],
    ["target", [], "topLevelKeys"],
    ["test", [], "topLevelKeys"],
    ["scenario", [], "topLevelKeys"],
    ["feature", ["rules"], "ruleEnvironments"],
    ["feature", ["force"], "forceEnvironments"],
    ["feature", ["expose"], "exposeEnvironments"],
    ["variable", ["overrides"], "variableOverrideEnvironments"],
    ["feature", ["variablesSchema"], "variablesSchema"],
    ["attribute", ["properties"], "schemaProperties"],
  ];

  it.each(maps)("spaces the %s map at %j as %s says", (entityType, at, name) => {
    expect(isSpacedMap(entityType, at)).toBe(HOUSE_STYLE.blankLines[name]);
  });

  it("never spaces values or the maps inside lists", () => {
    expect(isSpacedList("feature", ["tags"])).toBe(false);
    expect(isSpacedList("feature", ["expose", "production"])).toBe(false);
    expect(isSpacedList("feature", ["rules", 0, "conditions"])).toBe(false);
    expect(isSpacedMap("feature", ["rules", 0])).toBe(false);
    expect(isSpacedMap("test", ["assertions", 0, "context"])).toBe(false);
  });
});

describe("getFormatLayout", () => {
  it("gives a parser the indent, the rules above, and its own format's options", () => {
    const layout = getFormatLayout("feature", "yml");

    expect(layout.indent).toBe(HOUSE_STYLE.indent);
    expect(layout.orderKeys(["rules", 0], ["percentage", "key"])).toEqual(
      getKeyOrder("feature", ["rules", 0], ["percentage", "key"]),
    );
    expect(layout.spaceItems(["rules"])).toBe(HOUSE_STYLE.blankLines.rules);
    expect(layout.keepBlankLines).toBe(HOUSE_STYLE.keepBlankLines);
    expect(layout.options).toEqual(HOUSE_STYLE.formats.yml);
    expect(getFormatLayout("feature", "yaml").options).toEqual(HOUSE_STYLE.formats.yml);
    expect(getFormatLayout("feature", "json").options).toEqual(HOUSE_STYLE.formats.json);
    expect(getFormatLayout("feature", "toml").options).toEqual({});
  });

  it("hands each parser a copy of its options", () => {
    const before = { ...HOUSE_STYLE.formats.yml };
    getFormatLayout("feature", "yml").options.lineWidth = 12;

    expect(HOUSE_STYLE.formats.yml).toEqual(before);
  });
});
