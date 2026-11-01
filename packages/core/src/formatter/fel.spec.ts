import { parse } from "yaml";

import { parsers, type CustomParser } from "@featurevisor/parsers";

import { getFelTexts, getFormatFelOptions } from "./fel";
import { formatDefinition, FormatGuardError } from "./formatDefinition";

// How fmt writes FEL expressions, in projects that allow FEL

const yml = parsers.yml;
const fel = { namespaceCharacter: "." };

describe("formatting FEL", () => {
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
    const { output, changed } = formatDefinition("feature", source, yml, undefined, { fel });

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
    expect(formatDefinition("feature", output, yml, undefined, { fel }).changed).toBe(false);
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
    const { output } = formatDefinition("segment", source, yml, undefined, { fel });

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

  it("leaves expressions as written without the project's FEL options", () => {
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
    const { output } = formatDefinition("segment", source, yml, undefined, { fel });

    expect(parse(output).conditions).toEqual(["country = 'nl'", "plan  ==  'pro'", "seats > 5"]);
  });

  it("formats FEL in global variables, overrides included, and in JSON files", () => {
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
        fel,
      },
    );

    expect(JSON.parse(output)).toEqual({
      ...variable,
      conditions: "plan == 'pro'",
      overrides: [{ key: "nl", conditions: "country == 'nl'", value: "b" }],
    });
  });

  it("finds nothing to format outside features, segments and global variables", () => {
    expect(getFelTexts("attribute", { conditions: "a==1" }, fel).size).toBe(0);
    expect(getFelTexts("segment", { conditions: "a == 1" }, fel).size).toBe(0);
  });

  it("guards against a parser that changes an expression's text", () => {
    const changing = {
      ...yml,
      format: (source: string) => source.replace("country == 'nl'", "country == 'de'"),
    } as CustomParser;
    expect(() =>
      formatDefinition("segment", "conditions: country == 'nl'\n", changing, undefined, { fel }),
    ).toThrow(FormatGuardError);
  });

  it("formats FEL only in projects that allow it", () => {
    const config = (allowFEL?: boolean) => ({ allowFEL, namespaceCharacter: ":" }) as never;
    expect(getFormatFelOptions(config(true))).toEqual({ namespaceCharacter: ":" });
    expect(getFormatFelOptions(config(false))).toBeUndefined();
  });
});
