import { parsers } from "@featurevisor/parsers";

import { formatDefinition } from "./formatDefinition";

// The house style as files show it. These are the expectations to update after changing
// style.ts. Every other test holds whatever the style is.

describe("the house style", () => {
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
