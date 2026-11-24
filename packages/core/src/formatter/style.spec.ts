import { parsers } from "@featurevisor/parsers";

import { formatDefinition } from "./formatDefinition";

// The house style as files show it. These are the expectations to update after changing
// style.ts. Every other test holds whatever the style is.

describe("the house style", () => {
  it("places metadata after a definition's description and tags, and orders each deadline", () => {
    const source = [
      "bucketBy: userId",
      "metadata:",
      "  jira: CHECKOUT-1",
      "  owner: checkout-team",
      "  deadlines:",
      "    remove:",
      "      ticket: CHECKOUT-2",
      "      description: Later",
      "      by: 2027-03-01T09:00:00Z",
      "    review:",
      "      done: true",
      "      by: 2027-01-15T09:00:00+01:00",
      "description: Checkout",
      "tags: [web]",
      "",
    ].join("\n");

    expect(formatDefinition("feature", source, parsers.yml).output).toBe(
      [
        "description: Checkout",
        "",
        "tags:",
        "  - web",
        "",
        "metadata:",
        // the rest of metadata keeps the order it was written in
        "  jira: CHECKOUT-1",
        "  owner: checkout-team",
        "  deadlines:",
        "    remove:",
        '      by: "2027-03-01T09:00:00Z"',
        "      description: Later",
        "      ticket: CHECKOUT-2",
        "",
        "    review:",
        '      by: "2027-01-15T09:00:00+01:00"',
        "      done: true",
        "",
        "bucketBy: userId",
        "",
      ].join("\n"),
    );

    for (const [entityType, before] of [
      ["segment", 'conditions: "*"\nmetadata:\n  owner: a\ndescription: x\n'],
      ["attribute", "type: string\nmetadata:\n  owner: a\ndescription: x\n"],
      ["schema", "type: string\nmetadata:\n  owner: a\ndescription: x\n"],
      ["target", "tags:\n  - all\nmetadata:\n  owner: a\ndescription: x\n"],
    ] as const) {
      const output = formatDefinition(entityType, before, parsers.yml).output;
      expect(output.startsWith("description: x\n\nmetadata:\n  owner: a\n\n")).toBe(true);
    }
  });

  it("lays out a YAML feature", () => {
    const source = [
      "bucketBy: userId",
      "description: 'Checkout'",
      "tags: [web, ios]",
      "rules:",
      "  staging:",
      "    - percentage: 100",
      "      key: everyone",
      "      conditions: '*'",
      "  production:",
      "    - key: netherlands",
      "      percentage: 100",
      "      conditions: netherlands",
      "    - key: everyone",
      "      conditions: '*'",
      "      percentage: 25",
      "",
    ].join("\n");

    expect(formatDefinition("feature", source, parsers.yml).output).toBe(
      [
        "description: Checkout",
        "",
        "tags:",
        "  - web",
        "  - ios",
        "",
        "bucketBy: userId",
        "",
        "rules:",
        "  staging:",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 100",
        "",
        "  production:",
        "    - key: netherlands",
        "      conditions: netherlands",
        "      percentage: 100",
        "",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 25",
        "",
      ].join("\n"),
    );
  });

  it("lays out a YAML schema, with tags after its description and changes after its rules", () => {
    const source = [
      "mutations:",
      "  - mutate:",
      "      required:appendUnique: taxId",
      "    conditions:",
      "      value: business",
      "      operator: equals",
      "      input: accountType",
      "    key: business",
      "environments:",
      "  dev:",
      "    mutate:",
      "      properties.accountType.enum:append: trial",
      "annotations:",
      "  title: Sign up",
      "messages:",
      "  taxId:",
      "    required: Enter your VAT number",
      "required: [accountType]",
      "properties:",
      "  taxId:",
      "    annotations:",
      "      title: VAT number",
      "    type: string",
      "  accountType:",
      "    enum: [personal, business]",
      "    type: string",
      "type: object",
      "optionSchema:",
      "  schema: accountOption",
      "annotationsSchema:",
      "  schema: formAnnotations",
      "tags: [web]",
      "description: A sign up form",
      "",
    ].join("\n");

    expect(formatDefinition("schema", source, parsers.yml).output).toBe(
      [
        "description: A sign up form",
        "",
        "tags:",
        "  - web",
        "",
        "annotationsSchema:",
        "  schema: formAnnotations",
        "",
        "optionSchema:",
        "  schema: accountOption",
        "",
        "type: object",
        "",
        "properties:",
        "  taxId:",
        "    type: string",
        "    annotations:",
        "      title: VAT number",
        "  accountType:",
        "    type: string",
        "    enum:",
        "      - personal",
        "      - business",
        "",
        "required:",
        "  - accountType",
        "",
        "messages:",
        "  taxId:",
        "    required: Enter your VAT number",
        "",
        "annotations:",
        "  title: Sign up",
        "",
        "environments:",
        "  dev:",
        "    mutate:",
        "      properties.accountType.enum:append: trial",
        "",
        "mutations:",
        "  - key: business",
        "    conditions:",
        "      value: business",
        "      operator: equals",
        "      input: accountType",
        "    mutate:",
        "      required:appendUnique: taxId",
        "",
      ].join("\n"),
    );
  });

  it("orders a schema's issue entries, after its mutations", () => {
    const source = [
      "issues:",
      "  - message: The passwords do not match",
      "    path: confirmPassword",
      "    conditions: input('confirmPassword') != input('password')",
      "    key: passwordsDiffer",
      "mutations:",
      "  - key: paid",
      "    conditions: paying",
      "    mutate:",
      "      properties.seats.maximum: 10",
      "type: object",
      "description: A form",
      "",
    ].join("\n");

    expect(formatDefinition("schema", source, parsers.yml).output).toBe(
      [
        "description: A form",
        "",
        "type: object",
        "",
        "mutations:",
        "  - key: paid",
        "    conditions: paying",
        "    mutate:",
        "      properties.seats.maximum: 10",
        "",
        "issues:",
        "  - key: passwordsDiffer",
        "    conditions: input('confirmPassword') != input('password')",
        "    path: confirmPassword",
        "    message: The passwords do not match",
        "",
      ].join("\n"),
    );
  });

  it("orders a target's schema selectors after its feature and variable ones", () => {
    const source = [
      "includeAnnotations: false",
      "excludeSchemas: [legacy]",
      "includeSchemas: [signUp]",
      "excludeVariables: [old]",
      "tag: web",
      "description: Web",
      "",
    ].join("\n");

    expect(formatDefinition("target", source, parsers.yml).output).toBe(
      [
        "description: Web",
        "",
        "tag: web",
        "",
        "excludeVariables:",
        "  - old",
        "",
        "includeSchemas:",
        "  - signUp",
        "",
        "excludeSchemas:",
        "  - legacy",
        "",
        "includeAnnotations: false",
        "",
      ].join("\n"),
    );
  });

  it("lays out a YAML test spec", () => {
    const source = [
      "assertions:",
      "  - at: 10",
      "    description: Netherlands",
      "    context: { country: nl }",
      "    expectedToBeEnabled: true",
      "  - description: Everyone else",
      "    checks:",
      "      - matches: true",
      "        segment: everyone",
      "feature: checkout",
      "",
    ].join("\n");

    expect(formatDefinition("test", source, parsers.yml).output).toBe(
      [
        "feature: checkout",
        "",
        "assertions:",
        "  - description: Netherlands",
        "    at: 10",
        "    context:",
        "      country: nl",
        "    expectedToBeEnabled: true",
        "",
        "  - description: Everyone else",
        "    checks:",
        "      - segment: everyone",
        "        matches: true",
        "",
      ].join("\n"),
    );
  });

  it("quotes only where YAML needs it, and text YAML 1.1 reads as another type", () => {
    const source = "description: 'Checkout'\n\nconditions: 'no'\n";

    expect(formatDefinition("segment", source, parsers.yml).output).toBe(
      'description: Checkout\n\nconditions: "no"\n',
    );
  });

  it("keeps a blank line the author wrote, as one", () => {
    const source = "conditions:\n  - attribute: country\n\n\n    operator: equals\n    value: nl\n";

    expect(formatDefinition("segment", source, parsers.yml).output).toBe(
      "conditions:\n  - attribute: country\n\n    operator: equals\n    value: nl\n",
    );
    expect(
      formatDefinition(
        "segment",
        '{"conditions": ["nl",\n\n"de", "be", "fr", "es", "it", "pt", "at", "ch", "dk", "se"]}',
        parsers.json,
      ).output,
    ).toBe(
      '{\n  "conditions": [\n    "nl",\n\n    "de",\n    "be",\n    "fr",\n    "es",\n    "it",\n    "pt",\n    "at",\n    "ch",\n    "dk",\n    "se"\n  ]\n}\n',
    );
  });

  it("spaces force entries, global variable overrides and expose as rules", () => {
    const feature = [
      "bucketBy: userId",
      "force:",
      "  staging:",
      "    - conditions: qa",
      "      enabled: true",
      "    - conditions: testers",
      "      enabled: true",
      "  production:",
      "    - conditions: qa",
      "      enabled: true",
      "expose:",
      "  staging: true",
      "  production: false",
      "",
    ].join("\n");
    const variable = [
      "type: string",
      "defaultValue: Buy now",
      "overrides:",
      "  - key: nl",
      "    conditions: netherlands",
      "    value: Nu kopen",
      "  - key: de",
      "    conditions: germany",
      "    value: Jetzt kaufen",
      "",
    ].join("\n");

    expect(formatDefinition("feature", feature, parsers.yml).output).toBe(
      [
        "bucketBy: userId",
        "",
        "force:",
        "  staging:",
        "    - conditions: qa",
        "      enabled: true",
        "",
        "    - conditions: testers",
        "      enabled: true",
        "",
        "  production:",
        "    - conditions: qa",
        "      enabled: true",
        "",
        "expose:",
        "  staging: true",
        "",
        "  production: false",
        "",
      ].join("\n"),
    );
    expect(formatDefinition("variable", variable, parsers.yml).output).toBe(
      [
        "type: string",
        "",
        "defaultValue: Buy now",
        "",
        "overrides:",
        "  - key: nl",
        "    conditions: netherlands",
        "    value: Nu kopen",
        "",
        "  - key: de",
        "    conditions: germany",
        "    value: Jetzt kaufen",
        "",
      ].join("\n"),
    );
  });

  it("spaces variations, and packs what each one holds", () => {
    const feature = [
      "bucketBy: userId",
      "variations:",
      "  - value: control",
      "    weight: 50",
      "  - weight: 50",
      "    value: treatment",
      "    variables:",
      "      label: Buy now",
      "",
    ].join("\n");

    expect(formatDefinition("feature", feature, parsers.yml).output).toBe(
      [
        "bucketBy: userId",
        "",
        "variations:",
        "  - value: control",
        "    weight: 50",
        "",
        "  - value: treatment",
        "    weight: 50",
        "    variables:",
        "      label: Buy now",
        "",
      ].join("\n"),
    );
  });

  it("writes YAML aliases out in full, without anchors", () => {
    const feature = [
      "bucketBy: userId",
      "rules:",
      "  staging: &rules",
      "    - key: everyone",
      "      conditions: '*'",
      "      percentage: 100",
      "  production: *rules",
      "",
    ].join("\n");

    expect(formatDefinition("feature", feature, parsers.yml).output).toBe(
      [
        "bucketBy: userId",
        "",
        "rules:",
        "  staging:",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 100",
        "",
        "  production:",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 100",
        "",
      ].join("\n"),
    );
  });

  it("keeps each file's line endings", () => {
    expect(formatDefinition("segment", "conditions: '*'\r\n", parsers.yml).output).toBe(
      'conditions: "*"\r\n',
    );
  });

  it("lays out JSON as Prettier writes it, with the YAML's blank lines", () => {
    const source = '{"conditions":["nl","de"],"description":"Everyone"}';

    expect(formatDefinition("segment", source, parsers.json).output).toBe(
      '{\n  "description": "Everyone",\n\n  "conditions": ["nl", "de"]\n}\n',
    );
  });
});
