import { parse } from "yaml";

import { parsers, type CustomParser } from "@featurevisor/parsers";

import { getExpressionTexts, getFormatExpressionOptions } from "./expressions";
import { formatDefinition, FormatGuardError } from "./formatDefinition";

// How fmt writes expressions, in projects that allow them

const yml = parsers.yml;
const expressions = { namespaceCharacter: "." };

describe("formatting expressions", () => {
  it("writes each expression in the house style, wherever conditions go", () => {
    const source = [
      "description: Checkout",
      "conditions: loggedIn==true   and country exists",
      "rules:",
      "  - key: all",
      "    conditions:",
      "      - plan  in ['pro','enterprise']",
      "      - or:",
      "          - country=='nl'",
      "          - netherlands",
      "    percentage: 100",
      "",
    ].join("\n");
    const { output, changed } = formatDefinition("feature", source, yml, undefined, {
      expressions,
    });

    expect(changed).toBe(true);
    expect(parse(output)).toEqual({
      description: "Checkout",
      conditions: "loggedIn == true\nand country exists\n",
      rules: [
        {
          key: "all",
          conditions: ["plan in ['pro', 'enterprise']", { or: ["country == 'nl'", "netherlands"] }],
          percentage: 100,
        },
      ],
    });
    expect(formatDefinition("feature", output, yml, undefined, { expressions }).changed).toBe(
      false,
    );
  });

  it("writes a long expression, or one with comments, as a literal block", () => {
    const source = [
      "description: Staff",
      "conditions: |-",
      "  # company addresses",
      "  email endsWith '@featurevisor.com'",
      "  # QA inboxes",
      "  or email endsWith '@qa.example.com'",
      "",
    ].join("\n");
    const { output } = formatDefinition("segment", source, yml, undefined, { expressions });

    expect(output).toBe(
      [
        "description: Staff",
        "",
        "conditions: |",
        "  # company addresses",
        "  email endsWith '@featurevisor.com'",
        "  # QA inboxes",
        "  or email endsWith '@qa.example.com'",
        "",
      ].join("\n"),
    );
  });

  it("leaves expressions as written without the project's expression options", () => {
    const source = "description: x\n\nconditions: country=='nl'\n";
    expect(formatDefinition("segment", source, yml).changed).toBe(false);
  });

  it("leaves an expression with an error, or marked with the ignore comment, as written", () => {
    const source = [
      "description: x",
      "",
      "conditions:",
      "  - country = 'nl'",
      "  - plan  ==  'pro' # featurevisor-ignore-line",
      "  - seats>5",
      "",
    ].join("\n");
    const { output } = formatDefinition("segment", source, yml, undefined, { expressions });

    expect(parse(output).conditions).toEqual(["country = 'nl'", "plan  ==  'pro'", "seats > 5"]);
  });

  it("formats expressions in global variables, overrides included, and in JSON files", () => {
    const variable = {
      description: "x",
      type: "string",
      defaultValue: "a",
      conditions: "plan=='pro'",
      overrides: [{ key: "nl", conditions: "country=='nl'", value: "b" }],
    };
    const { output } = formatDefinition(
      "variable",
      JSON.stringify(variable),
      parsers.json,
      undefined,
      {
        expressions,
      },
    );

    expect(JSON.parse(output)).toEqual({
      ...variable,
      conditions: "plan == 'pro'",
      overrides: [{ key: "nl", conditions: "country == 'nl'", value: "b" }],
    });
  });

  it("finds nothing to format outside features, segments and global variables", () => {
    expect(getExpressionTexts("attribute", { conditions: "a==1" }, expressions).size).toBe(0);
    expect(getExpressionTexts("segment", { conditions: "a == 1" }, expressions).size).toBe(0);
  });

  it("guards against a parser that changes an expression's text", () => {
    const changing = {
      ...yml,
      format: (source: string) => source.replace("country == 'nl'", "country == 'de'"),
    } as CustomParser;
    expect(() =>
      formatDefinition("segment", "conditions: country == 'nl'\n", changing, undefined, {
        expressions,
      }),
    ).toThrow(FormatGuardError);
  });

  it("formats expressions only in projects that allow them", () => {
    const config = (allowConditionExpressions?: boolean) =>
      ({ allowConditionExpressions, namespaceCharacter: ":" }) as never;
    expect(getFormatExpressionOptions(config(true))).toEqual({ namespaceCharacter: ":" });
    expect(getFormatExpressionOptions(config(false))).toBeUndefined();
  });
});
