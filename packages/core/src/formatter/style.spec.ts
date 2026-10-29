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

  it("lays out JSON as Prettier writes it", () => {
    const source = '{"conditions":["nl","de"],"description":"Everyone"}';

    expect(formatDefinition("segment", source, parsers.json).output).toBe(
      '{\n  "description": "Everyone",\n  "conditions": ["nl", "de"]\n}\n',
    );
  });
});
