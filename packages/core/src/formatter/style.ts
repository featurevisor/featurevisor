import type { JsonFormatOptions, YmlFormatOptions } from "@featurevisor/parsers";

/**
 * Featurevisor's house style for definitions. Every opinion `featurevisor fmt` applies lives
 * here, so a change of style is an edit to this file alone.
 *
 * Anything here is safe to change. Key order only reaches the objects layout.ts places, which
 * the builder rebuilds key by key, so no choice in this file can change a datafile. To change
 * the style:
 *
 * 1. Edit this file.
 * 2. Rebuild Core and run `make fmt-examples` to restyle the examples.
 * 3. Update the expectations in style.spec.ts and the Formatting page in the docs.
 *
 * A change fails users' `fmt --check` once they upgrade, so note it in the release notes.
 *
 * Projects often run Prettier over the same files. Prettier leaves fmt's output as it is today,
 * and the notes below say which values keep it that way.
 */

const LIFECYCLE = ["archived", "deprecated", "promotable"];

const SCHEMA_KEYS = [
  "type",
  "schema",
  "oneOf",
  "format",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
];

export const HOUSE_STYLE = {
  /** Spaces per level of nesting. Prettier's tabWidth must match. */
  indent: 2,

  /**
   * The line endings fmt writes: "auto" keeps each file's own, judged by its first line break,
   * and "lf" or "crlf" writes every file with that one, as Prettier's endOfLine does.
   */
  endOfLine: "auto" as "auto" | "lf" | "crlf",

  /**
   * Keep a blank line the author wrote between two entries or two items, besides the ones
   * blankLines asks for, as Prettier does. A run of blank lines becomes one, and a blank line
   * moves with the entry below it. false keeps only the ones blankLines asks for.
   */
  keepBlankLines: true,

  /**
   * The order of Featurevisor's own keys in each kind of object. Keys an object has that its
   * list leaves out keep their written order, after the listed ones.
   */
  keyOrder: {
    feature: [
      ...LIFECYCLE,
      "description",
      "tags",
      "bucketBy",
      "conditions",
      "disabledVariationValue",
      "variablesSchema",
      "variations",
      "force",
      "rules",
      "expose",
    ],
    rule: [
      "key",
      "description",
      "promotable",
      "conditions",
      "percentage",
      "enabled",
      "variation",
      "variationWeights",
      "variables",
      "variableOverrides",
    ],
    force: ["conditions", "enabled", "variation", "variables"],
    variation: ["value", "description", "weight", "variables", "variableOverrides"],
    /** A variable in a feature's variablesSchema */
    variableSchema: [
      "description",
      "deprecated",
      ...SCHEMA_KEYS,
      "defaultValue",
      "disabledValue",
      "useDefaultWhenDisabled",
    ],
    /** An override in a variation's or a rule's variableOverrides */
    featureVariableOverride: ["key", "description", "promotable", "conditions", "value", "mutate"],
    /** A global variable */
    variable: [
      ...LIFECYCLE,
      "description",
      "tags",
      "compose",
      ...SCHEMA_KEYS,
      "defaultValue",
      "conditions",
      "disabledValue",
      "useDefaultWhenDisabled",
      "overrides",
    ],
    /** An override of a global variable, nested ones too */
    variableOverride: [
      "key",
      "description",
      "promotable",
      "conditions",
      "continue",
      "value",
      "mutate",
      "overrides",
    ],
    segment: [...LIFECYCLE, "description", "conditions"],
    attribute: [...LIFECYCLE, "description", ...SCHEMA_KEYS],
    /** A schema file, and every schema nested in a schema, attribute or variable */
    schema: [...LIFECYCLE, "description", ...SCHEMA_KEYS],
    target: [
      "promotable",
      "description",
      "tag",
      "tags",
      "includeFeatures",
      "excludeFeatures",
      "includeVariables",
      "excludeVariables",
      "context",
      "schemaVersion",
    ],
    /** A feature, segment or variable test spec */
    test: ["feature", "segment", "variable", "promotable", "assertions"],
    /** An assertion, its children, and a scenario spec, which is one assertion */
    assertion: [
      "key",
      "description",
      "promotable",
      "matrix",
      "environment",
      "target",
      "at",
      "context",
      "stickyFeatures",
      "stickyVariables",
      "defaultVariationValue",
      "defaultVariableValues",
      "defaultVariableValue",
      "expectedToBeEnabled",
      "expectedToMatch",
      "expectedVariation",
      "expectedVariables",
      "expectedValue",
      "expectedEvaluations",
      "expectedEvaluation",
      "checks",
      "children",
    ],
    /** A check, and the checks inside its and, or and not groups */
    check: [
      "feature",
      "segment",
      "variable",
      "key",
      "description",
      "path",
      "operator",
      "value",
      "compareTo",
      "regexFlags",
      "enabled",
      "variation",
      "matches",
      "and",
      "or",
      "not",
    ],
  },

  /** Where a blank line separates the entries of a map or the items of a list */
  blankLines: {
    /** Between the top level keys of every definition and spec */
    topLevelKeys: true,
    /** Between a feature's rules, in a list or under each environment */
    rules: true,
    /** Between the environments that group a feature's rules */
    ruleEnvironments: true,
    /** Between a feature's force entries, in a list or under each environment */
    force: true,
    /** Between the environments that group a feature's force entries */
    forceEnvironments: true,
    /** Between the environments under a feature's expose */
    exposeEnvironments: true,
    variations: false,
    /** Between the variables of a feature's variablesSchema */
    variablesSchema: false,
    /** Between the overrides in a variation's or a rule's variableOverrides */
    featureVariableOverrides: false,
    /** Between a global variable's overrides, nested ones too */
    variableOverrides: true,
    /** Between the environments that group a global variable's overrides */
    variableOverrideEnvironments: true,
    /** Between the properties of a schema */
    schemaProperties: false,
    /** Between a spec's assertions */
    assertions: true,
    /** Between the children of an assertion or a scenario */
    assertionChildren: true,
    /** Between checks, and between the checks in a group */
    checks: false,
  },

  /** Choices only one file format can express, by parser extension. `yaml` uses yml's. */
  formats: {
    yml: {
      /** "single" needs Prettier's singleQuote too */
      quote: "double",
      quoteYaml11Types: true,
      lineWidth: 0,
      /** false fights Prettier, which always indents list items under their key */
      indentSequences: true,
    } satisfies YmlFormatOptions,
    json: {
      /** Prettier's printWidth must match */
      lineWidth: 80,
    } satisfies JsonFormatOptions,
  },
};
