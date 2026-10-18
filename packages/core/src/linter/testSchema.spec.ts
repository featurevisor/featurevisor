import { z } from "zod";

import type { ProjectConfig } from "../config";
import {
  getChecksZodSchema,
  getScenariosZodSchema,
  getTestAuthoringShapes,
  getTestsZodSchema,
} from "./testSchema";

function minimalProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    schemasDirectoryPath: "",
    targetsDirectoryPath: "",
    variablesDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    catalogDirectoryPath: "",
    setsDirectoryPath: "",
    environments: ["staging", "production"],
    sets: false,
    namespaceCharacter: ".",
    tags: ["all", "beta"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
    ...overrides,
  };
}

describe("segment checks", () => {
  it("exposes recursive check leaves to the editor schema without losing inherited owners", () => {
    const checks = getChecksZodSchema();
    expect(checks.safeParse([{ operator: "exists" }]).success).toBe(true);
    expect(
      checks.safeParse([
        {
          not: [
            { feature: "checkout", enabled: true },
            { segment: "desktop", matches: false },
          ],
        },
      ]).success,
    ).toBe(true);
    expect(checks.safeParse([{ operator: "exists", value: null }]).success).toBe(false);
    expect(
      checks.safeParse([
        { operator: "equals", compareTo: { variable: "settings", path: "nested.value" } },
      ]).success,
    ).toBe(true);
    const shapes = getTestAuthoringShapes(
      minimalProjectConfig(),
      ["checkout"],
      ["desktop"],
      ["web"],
      ["settings"],
    );
    const json = z.toJSONSchema(shapes.variableTestZodSchema, {
      target: "draft-07",
      io: "input",
      unrepresentable: "any",
    });
    expect(JSON.stringify(json)).toContain('"compareTo"');
    expect(JSON.stringify(json)).toContain('"segment"');
    expect(JSON.stringify(json)).toContain('"and"');
  });
  it("rejects restricted operators in nested CLI checks with an exact path", () => {
    const error = expectScenarioFailure(
      {
        environment: "production",
        checks: [{ not: [{ variable: "settings", operator: "equals", value: 1 }] }],
      },
      'Operator "equals" is disallowed',
      minimalProjectConfig({ disallowOperators: ["equals"] }),
    );
    expect(error.issues.some((issue) => issue.path.join(".") === "checks.0.not.0.operator")).toBe(
      true,
    );
  });

  it("suggests a misspelt root owner", () => {
    const result = getSchema().safeParse({ featur: "checkout", assertions: [] });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["featur"],
            message: expect.stringContaining('Did you mean "feature"'),
          }),
        ]),
      );
  });
  it("validates matrix segment references and boolean expectations for scenarios and variables", () => {
    const situation = {
      environment: "production",
      target: "web",
      matrix: { segment: ["desktop"], matches: [true, false] },
      checks: [{ segment: "${{ segment }}", matches: "${{ matches }}" }],
      children: [{ checks: [{ segment: "desktop", matches: false }] }],
    };
    expectScenarioSuccess(situation);
    expectTestSuccess({ variable: "settings", assertions: [situation] });
  });
  it("rejects unknown segments in skipped branches and children, and authored internal definitions", () => {
    expectScenarioFailure(
      {
        environment: "production",
        checks: [
          {
            or: [
              { feature: "checkout", enabled: true },
              { segment: "missing", matches: false },
            ],
          },
        ],
      },
      'Unknown segment "missing"',
    );
    expectScenarioFailure(
      {
        environment: "production",
        checks: [{ segment: "desktop", matches: true }],
        children: [{ checks: [{ segment: "missing", matches: false }] }],
      },
      'Unknown segment "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        _segments: {},
        assertions: [
          { environment: "production", checks: [{ segment: "desktop", matches: true }] },
        ],
      },
      "Unrecognized key",
    );
  });
});

function getSchema(projectConfig = minimalProjectConfig()) {
  return getTestsZodSchema(projectConfig, ["checkout"], ["desktop"], ["web"], ["settings"], {
    checkout: {
      key: "checkout",
      description: "Checkout",
      bucketBy: "userId",
      variations: [{ value: "control" }, { value: "treatment" }],
      variablesSchema: { copy: { type: "string", defaultValue: "Checkout" } },
    },
  });
}

function parseTest(input: unknown): z.ZodSafeParseResult<unknown> {
  return getSchema().safeParse(input);
}

function getScenarioSchema(projectConfig = minimalProjectConfig()) {
  return getScenariosZodSchema(projectConfig, ["checkout"], ["desktop"], ["web"], ["settings"], {
    checkout: {
      key: "checkout",
      description: "Checkout",
      bucketBy: "userId",
      variations: [{ value: "control" }, { value: "treatment" }],
      variablesSchema: { copy: { type: "string", defaultValue: "Checkout" } },
    },
  });
}

function parseScenario(
  input: unknown,
  projectConfig = minimalProjectConfig(),
): z.ZodSafeParseResult<unknown> {
  return getScenarioSchema(projectConfig).safeParse(input);
}

function expectScenarioSuccess(input: unknown, projectConfig?: ProjectConfig): void {
  const result = parseScenario(input, projectConfig);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; "),
    );
  }
  expect(result.success).toBe(true);
}

function expectScenarioFailure(
  input: unknown,
  messageSubstring: string,
  projectConfig?: ProjectConfig,
): z.ZodError {
  const result = parseScenario(input, projectConfig);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected scenario schema to fail");
  }

  expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain(messageSubstring);
  return result.error;
}

function expectTestSuccess(input: unknown): void {
  const result = parseTest(input);
  if (!result.success) {
    const error = (result as z.ZodSafeParseError<unknown>).error;
    throw new Error(error.issues.map((issue) => issue.message).join("; "));
  }
  expect(result.success).toBe(true);
}

function expectTestFailure(input: unknown, messageSubstring: string): z.ZodError {
  const result = parseTest(input);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected test schema to fail");
  }

  const error = (result as z.ZodSafeParseError<unknown>).error;
  expect(error.issues.map((issue) => issue.message).join(" ")).toContain(messageSubstring);

  return error;
}

describe("testSchema.ts :: getTestsZodSchema", () => {
  describe("feature expectation references", () => {
    it("accepts variation assertions on a standalone disabled variation fallback", () => {
      const schema = getTestsZodSchema(
        minimalProjectConfig(),
        ["flag"],
        ["desktop"],
        ["web"],
        ["settings"],
        {
          flag: {
            key: "flag",
            description: "Flag",
            bucketBy: "userId",
            disabledVariationValue: "off",
          },
        },
      );
      expect(
        schema.safeParse({
          feature: "flag",
          assertions: [
            {
              environment: "production",
              at: 50,
              expectedVariation: "off",
              children: [{ expectedVariation: null }],
            },
          ],
        }).success,
      ).toBe(true);
    });
    const flagSchema = () =>
      getTestsZodSchema(minimalProjectConfig(), ["flag"], ["desktop"], ["web"], ["settings"], {
        flag: { key: "flag", description: "Flag", bucketBy: "userId" },
      });

    it.each([null, "control"])("rejects variation expectation %p on a flag", (value) => {
      for (const child of [false, true]) {
        const expectation = { expectedVariation: value };
        const result = flagSchema().safeParse({
          feature: "flag",
          assertions: [
            {
              environment: "production",
              at: 50,
              ...(child ? { children: [expectation] } : expectation),
            },
          ],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: child
                  ? ["assertions", 0, "children", 0, "expectedVariation"]
                  : ["assertions", 0, "expectedVariation"],
                message: expect.stringContaining("has no variations"),
              }),
            ]),
          );
        }
      }
    });

    it("rejects unknown variable names in parent and child matrix assertions", () => {
      const result = getSchema().safeParse({
        feature: "checkout",
        assertions: [
          {
            environment: "production",
            at: 50,
            matrix: { value: [null, "fallback"] },
            defaultVariableValues: { typo: "fallback" },
            expectedVariables: { typo: "${{ value }}" },
            children: [{ expectedVariables: { toString: null } }],
          },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path)).toEqual([
          ["assertions", 0, "expectedVariables", "typo"],
          ["assertions", 0, "children", 0, "expectedVariables", "toString"],
        ]);
      }
    });

    it("accepts declared variables, nullable variations and custom fallbacks", () => {
      expect(
        getSchema().safeParse({
          feature: "checkout",
          assertions: [
            {
              environment: "production",
              at: 50,
              expectedVariation: null,
              expectedVariables: { copy: null },
              children: [
                {
                  defaultVariationValue: "fallback",
                  expectedVariation: "fallback",
                  expectedVariables: { copy: "Checkout" },
                },
              ],
            },
          ],
        }).success,
      ).toBe(true);
    });

    it("rejects variable expectations when no schema is declared", () => {
      const result = flagSchema().safeParse({
        feature: "flag",
        assertions: [{ environment: "production", at: 50, expectedVariables: { copy: null } }],
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues[0].message).toContain('Unknown variable "copy"');
    });

    it("accepts flag expectations without variable or variation expectations", () => {
      expect(
        flagSchema().safeParse({
          feature: "flag",
          assertions: [
            {
              environment: "production",
              at: 50,
              expectedToBeEnabled: true,
              expectedVariables: {},
            },
          ],
        }).success,
      ).toBe(true);
    });

    it("can generate structural schemas without definition metadata", () => {
      const schema = getTestsZodSchema(minimalProjectConfig(), ["flag"], ["desktop"], ["web"]);
      expect(
        schema.safeParse({
          feature: "flag",
          assertions: [
            {
              environment: "production",
              at: 50,
              expectedVariation: null,
              expectedVariables: { anything: null },
            },
          ],
        }).success,
      ).toBe(true);
    });
  });

  it("rejects empty test assertions and matrices that cannot produce a case", () => {
    expectTestFailure(
      { variable: "settings", assertions: [] },
      "Test spec must contain at least one assertion",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", matrix: {}, expectedValue: "configured" }],
      },
      "Matrix must contain at least one key",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { value: [] },
            expectedValue: "${{ value }}",
          },
        ],
      },
      "Matrix values cannot be empty",
    );
  });

  it("rejects unknown matrix placeholders anywhere in a variable assertion", () => {
    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { value: ["configured"] },
            expectedValue: "${{ missing }}",
          },
        ],
      },
      'Unknown matrix value "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { value: ["configured"] },
            children: [{ expectedValue: { nested: "${{ missing }}" } }],
          },
        ],
      },
      'Unknown matrix value "missing"',
    );
  });

  it("validates matrix environments and targets after expansion", () => {
    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            matrix: { environment: ["unknown"] },
            environment: "${{ environment }}",
            expectedValue: "configured",
          },
        ],
      },
      'Unknown environment "unknown"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { target: ["unknown"] },
            target: "${{ target }}",
            expectedValue: "configured",
          },
        ],
      },
      'Unknown target "unknown"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { target: ["web"] },
            target: "${{ target }}-suffix",
            expectedValue: "configured",
          },
        ],
      },
      "Expected a complete matrix placeholder",
    );
  });

  it("accepts structured matrix values without converting their types", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          matrix: {
            value: [["one", "two"], { enabled: true, nested: { count: 2 } }],
          },
          expectedValue: "${{ value }}",
        },
      ],
    });
  });

  it("requires at least one global variable expectation", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          expectedEvaluation: { reason: "variable_default" },
        },
      ],
    });

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production" }],
      },
      "Expected at least one of expectedValue, expectedEvaluation, checks, or children",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedEvaluation: { unknownField: true },
          },
        ],
      },
      "Unrecognized key",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedEvaluation: { required: ["checkout"] },
          },
        ],
      },
      "Unrecognized key",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedEvaluation: { sticky: { checkout: true } },
          },
        ],
      },
      "Unrecognized key",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", expectedEvaluation: {} }],
      },
      "Expected evaluation must contain at least one field",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            children: [{ expectedEvaluation: {} }],
          },
        ],
      },
      "Expected evaluation must contain at least one field",
    );
  });

  it("allows global variable assertions without an environment in projects without environments", () => {
    const result = getTestsZodSchema(
      minimalProjectConfig({ environments: undefined }),
      ["checkout"],
      ["desktop"],
      ["web"],
      ["settings"],
      {},
    ).safeParse({
      variable: "settings",
      assertions: [{ expectedValue: "enabled" }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts bucket positions and sticky features in global variable assertions", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          at: 37.5,
          stickyFeatures: {
            checkout: { enabled: true, variation: "treatment" },
          },
          expectedValue: "configured",
        },
        {
          environment: "production",
          matrix: { at: [25, 75] },
          at: "${{ at }}",
          expectedEvaluation: { reason: "conditions_unmet" },
        },
      ],
    });

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", at: -1, expectedValue: "configured" }],
      },
      "Too small",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", at: 100.001, expectedValue: "configured" }],
      },
      "Too big",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", at: "banana", expectedValue: "configured" }],
      },
      "Expected a matrix placeholder",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { other: [25] },
            at: "${{ at }}",
            expectedValue: "configured",
          },
        ],
      },
      'Unknown matrix value "at"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { at: [25, 101] },
            at: "${{ at }}",
            expectedValue: "configured",
          },
        ],
      },
      "Bucket positions must be numbers from 0 to 100",
    );
  });

  it("validates sticky feature and variable references", () => {
    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            stickyFeatures: { unknown: { enabled: true } },
            expectedValue: "configured",
          },
        ],
      },
      'Unknown feature "unknown"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            stickyFeatures: { checkout: { variation: "treatment" } },
            expectedValue: "configured",
          },
        ],
      },
      "Invalid input",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            stickyVariables: { unknown: "configured" },
            expectedValue: "configured",
          },
        ],
      },
      'Unknown variable "unknown"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            stickyFeatures: { checkout: { enabled: true, variation: "unknown" } },
            expectedValue: "configured",
          },
        ],
      },
      'Unknown variation "unknown" in feature "checkout"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            stickyFeatures: {
              checkout: { enabled: true, variables: { unknown: "configured" } },
            },
            expectedValue: "configured",
          },
        ],
      },
      'Unknown variable "unknown" in feature "checkout"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { enabled: [true, "yes"] },
            stickyFeatures: { checkout: { enabled: "${{ enabled }}" } },
            expectedValue: "configured",
          },
        ],
      },
      "Sticky feature enabled values must be booleans",
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { variation: ["unknown"] },
            stickyFeatures: {
              checkout: { enabled: true, variation: "${{ variation }}" },
            },
            expectedValue: "configured",
          },
        ],
      },
      'Unknown variation "unknown" in feature "checkout"',
    );
  });

  it("supports child assertions with their own context, sticky values, and expectations", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          at: 75,
          children: [
            {
              context: { country: "nl" },
              stickyFeatures: { checkout: { enabled: true, variation: "treatment" } },
              stickyVariables: { settings: "child" },
              defaultVariableValue: "fallback",
              expectedValue: "child",
              expectedEvaluation: { reason: "sticky" },
            },
          ],
        },
      ],
    });

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            children: [{ context: { country: "nl" } }],
          },
        ],
      },
      "Expected at least one of expectedValue, expectedEvaluation, or checks",
    );
  });

  it("accepts checks as variable parent and child expectations", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          checks: [
            {
              path: ["nested", "dot.key"],
              operator: "equals",
              value: 7,
            },
            {
              feature: "checkout",
              variable: "copy",
              operator: "startsWith",
              value: "Check",
            },
          ],
        },
        {
          environment: "production",
          expectedValue: "configured",
          checks: [{ operator: "notNull" }],
          children: [
            {
              checks: [
                {
                  operator: "equals",
                  compareTo: { variable: "settings" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("accepts feature checks in variable owners, nested groups, children, and matrices", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          matrix: {
            feature: ["checkout"],
            variation: ["control"],
          },
          checks: [
            {
              and: [
                {
                  feature: "${{ feature }}",
                  enabled: false,
                  variation: "${{ variation }}",
                },
              ],
            },
          ],
          children: [
            {
              checks: [{ feature: "checkout", variation: null }],
            },
          ],
        },
      ],
    });

    expectScenarioSuccess({
      environment: "production",
      checks: [
        {
          or: [
            { feature: "checkout", enabled: true },
            { feature: "checkout", variation: "treatment" },
          ],
        },
      ],
    });
  });

  it("accepts named and unkeyed sibling checks and rejects duplicate sibling keys", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          checks: [
            {
              key: "configured",
              description: "Settings exist",
              operator: "exists",
            },
            { operator: "notNull" },
            {
              key: "feature-state",
              or: [
                { key: "enabled", feature: "checkout", enabled: true },
                { feature: "checkout", variation: "treatment" },
              ],
            },
          ],
        },
      ],
    });

    const error = expectScenarioFailure(
      {
        environment: "production",
        checks: [
          {
            and: [
              { key: "state", feature: "checkout", enabled: true },
              { key: "state", feature: "checkout", variation: "treatment" },
            ],
          },
        ],
      },
      'Duplicate sibling check key "state"',
    );
    expect(error.issues.some((issue) => issue.path.join(".") === "checks")).toBe(true);
  });

  it("rejects normalized execution metadata in authored tests and scenarios", () => {
    expectTestFailure(
      {
        _test: { source: "tests/variables/settings.spec.yml", set: null, entityType: "variable" },
        variable: "settings",
        assertions: [{ _case: {}, checks: [{ operator: "exists" }] }],
      },
      "Unrecognized key",
    );
    expectScenarioFailure(
      {
        _test: { source: "tests/scenarios/metadata.spec.yml" },
        _case: {},
        checks: [{ variable: "settings", operator: "exists" }],
      },
      "Unrecognized key",
    );
  });

  it("validates check references against global and feature variables", () => {
    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [{ feature: "missing", enabled: false }],
          },
        ],
      },
      'Unknown feature "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [{ variable: "missing", operator: "isNull" }],
          },
        ],
      },
      'Unknown global variable "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [{ feature: "missing", variable: "copy", operator: "exists" }],
          },
        ],
      },
      'Unknown feature "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [{ feature: "checkout", variable: "missing", operator: "exists" }],
          },
        ],
      },
      'Unknown variable "missing" in feature "checkout"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [
              {
                operator: "equals",
                compareTo: { feature: "checkout", path: "copy" },
              },
            ],
          },
        ],
      },
      "An explicit variable is required in a scenario or feature reference",
    );
  });

  it.each([
    ["empty checks", [], "nonempty arrays"],
    ["empty logical group", [{ and: [] }], "nonempty arrays"],
    ["mixed logical group", [{ and: [], or: [] }], "exactly one operator"],
    ["unknown operator", [{ operator: "future", value: true }], "Unknown check operator"],
    ["both operands", [{ operator: "equals", value: true, compareTo: {} }], "Provide exactly one"],
    ["operand on unary operator", [{ operator: "exists", value: true }], "Provide exactly one"],
    ["wildcard path", [{ path: "items.*.limit", operator: "exists" }], "wildcard"],
    [
      "selector path",
      [{ path: ["items", { first: true }], operator: "exists" }],
      "Path components",
    ],
    ["structured equality", [{ operator: "equals", value: { enabled: true } }], "primitive value"],
    [
      "nonportable regular expression",
      [{ operator: "matches", value: "(?=value)" }],
      "Unsupported portable regular expression",
    ],
    [
      "invalid regular expression flags",
      [{ operator: "matches", value: "value", regexFlags: "u" }],
      "Invalid portable regex flags",
    ],
  ])("rejects %s in authored checks", (_name, checks, message) => {
    expectTestFailure(
      {
        variable: "settings",
        assertions: [{ environment: "production", checks }],
      },
      message,
    );
  });

  it("validates checks after matrix expansion", () => {
    expectTestSuccess({
      variable: "settings",
      assertions: [
        {
          environment: "production",
          matrix: {
            variable: ["settings"],
            path: ["nested.nullable"],
            operator: ["isNull"],
          },
          checks: [
            {
              variable: "${{ variable }}",
              path: "${{ path }}",
              operator: "${{ operator }}",
            },
          ],
        },
      ],
    });

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { variable: ["settings", "missing"] },
            checks: [{ variable: "${{ variable }}", operator: "exists" }],
          },
        ],
      },
      'Unknown global variable "missing"',
    );

    expectTestFailure(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            matrix: { variable: ["settings"] },
            checks: [{ variable: "${{ absent }}", operator: "exists" }],
          },
        ],
      },
      'Unknown matrix value "absent"',
    );
  });

  it("recognizes scenarios without an entity owner or a marker", () => {
    expectTestFailure(
      {
        assertions: [{ checks: [{ variable: "settings", operator: "exists" }] }],
      },
      "Test spec must have",
    );
    expectTestSuccess({
      environment: "production",
      checks: [{ variable: "settings", operator: "exists" }],
    });
    for (const owner of ["feature", "segment", "variable"]) {
      expectTestFailure(
        { [owner]: "settings", checks: [{ variable: "settings", operator: "exists" }] },
        "root",
      );
    }
    expectTestFailure({ feature: "checkout", variable: "settings", assertions: [] }, "root");
    expectTestFailure({}, "Test spec must have");
    expectTestFailure({ checks: [], assertions: [] }, "without assertions");
  });

  it("accepts the authored scenario root and optional children", () => {
    expectScenarioSuccess({
      description: "Checkout is configured for Dutch customers",
      promotable: false,
      environment: "production",
      target: "web",
      at: 75,
      context: { country: "nl", checks: "preserved context value" },
      stickyFeatures: {
        checkout: { enabled: true, variation: "treatment" },
      },
      stickyVariables: { settings: "configured" },
      checks: [
        { variable: "settings", operator: "equals", value: "configured" },
        {
          feature: "checkout",
          variable: "copy",
          operator: "equals",
          value: "Checkout",
        },
      ],
      children: [
        {
          context: { country: "gb", checks: "preserved child context value" },
          stickyFeatures: { checkout: { enabled: true, variation: "control" } },
          stickyVariables: { settings: "child" },
          checks: [{ variable: "settings", operator: "notNull" }],
        },
      ],
    });

    expectScenarioSuccess({
      promotable: false,
      environment: "production",
      checks: [{ feature: "checkout", enabled: true }],
    });
  });

  it("rejects malformed scenario roots, assertions, children-only roots, and mixed expectations", () => {
    expectScenarioFailure(
      {
        key: "unused",
        checks: [{ feature: "checkout", enabled: true }],
      },
      "identified by its filename",
    );
    expectScenarioFailure(null, "Scenario must be an object");
    expectScenarioFailure([], "Scenario must be an object");
    expectScenarioSuccess({
      environment: "production",
      checks: [{ variable: "settings", operator: "exists" }],
    });
    expectScenarioFailure(
      { unexpectedProperty: "", checks: [{ variable: "settings", operator: "exists" }] },
      "Unrecognized key",
    );

    const assertionsError = expectScenarioFailure(
      {
        assertions: [{ checks: [{ variable: "settings", operator: "exists" }] }],
      },
      "Scenarios use checks at the root",
    );
    expect(assertionsError.issues.some((issue) => issue.path.join(".") === "assertions")).toBe(
      true,
    );

    const childrenOnlyError = expectScenarioFailure(
      {
        children: [{ checks: [{ variable: "settings", operator: "exists" }] }],
      },
      "Scenarios require nonempty checks at the root",
    );
    expect(childrenOnlyError.issues.some((issue) => issue.path.join(".") === "checks")).toBe(true);

    const missingChecksError = expectScenarioFailure(
      {},
      "Scenarios require nonempty checks at the root",
    );
    expect(missingChecksError.issues.some((issue) => issue.path.join(".") === "checks")).toBe(true);

    const childError = expectScenarioFailure(
      {
        checks: [{ variable: "settings", operator: "exists" }],
        children: [{ context: { country: "nl" } }],
      },
      "Scenario children require nonempty checks",
    );
    expect(childError.issues.some((issue) => issue.path.join(".") === "children.0.checks")).toBe(
      true,
    );

    for (const extra of [
      { unexpectedProperty: true },
      {
        children: [{ checks: [{ feature: "checkout", enabled: true }], unexpectedProperty: true }],
      },
    ]) {
      expectScenarioFailure(
        {
          checks: [{ feature: "checkout", enabled: true }],
          ...extra,
        },
        "Unrecognized key",
      );
    }

    for (const field of ["defaultVariableValue", "expectedValue", "expectedEvaluation"] as const) {
      const error = expectScenarioFailure(
        {
          checks: [{ variable: "settings", operator: "exists" }],
          [field]: field === "expectedEvaluation" ? { reason: "default" } : "not allowed",
        },
        "Unrecognized key",
      );
      expect(error.issues.every((issue) => issue.path[0] !== "assertions")).toBe(true);
    }
  });

  it("supports environmentless scenario sets and rejects an authored environment there", () => {
    const environmentlessConfig = minimalProjectConfig({ environments: undefined });
    expectScenarioSuccess(
      {
        checks: [{ variable: "settings", operator: "exists" }],
      },
      environmentlessConfig,
    );

    const error = expectScenarioFailure(
      {
        environment: "staging",
        checks: [{ variable: "settings", operator: "exists" }],
      },
      "Remove environment. This project does not configure environments.",
      environmentlessConfig,
    );
    expect(error.issues.some((issue) => issue.path.join(".") === "environment")).toBe(true);
  });

  it("validates scenario matrices, selectors, positions, check references, and children at root paths", () => {
    expectScenarioSuccess({
      matrix: {
        environment: ["staging", "production"],
        target: ["web"],
        at: [0, 100],
        variable: ["settings"],
        feature: ["checkout"],
      },
      environment: "${{ environment }}",
      target: "${{ target }}",
      at: "${{ at }}",
      checks: [
        { variable: "${{ variable }}", operator: "exists" },
        { feature: "${{ feature }}", enabled: true },
      ],
      children: [
        {
          context: { inherited: true },
          checks: [{ feature: "${{ feature }}", variable: "copy", operator: "notNull" }],
        },
      ],
    });

    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        {
          matrix: { environment: ["unknown"] },
          environment: "${{ environment }}",
        },
        'Unknown environment "unknown"',
        "matrix.environment.0",
      ],
      [
        { matrix: { target: ["unknown"] }, target: "${{ target }}" },
        'Unknown target "unknown"',
        "matrix.target.0",
      ],
      [
        { matrix: { at: [0, 101] }, at: "${{ at }}" },
        "Bucket positions must be numbers from 0 to 100",
        "matrix.at.1",
      ],
      [
        { checks: [{ variable: "missing", operator: "exists" }] },
        'Unknown global variable "missing"',
        "checks",
      ],
      [
        {
          children: [{ checks: [{ feature: "missing", enabled: true }] }],
        },
        'Unknown feature "missing"',
        "children.0.checks",
      ],
    ];

    for (const [overrides, message, path] of cases) {
      const error = expectScenarioFailure(
        {
          environment: "production",
          checks: [{ variable: "settings", operator: "exists" }],
          ...overrides,
        },
        message,
      );
      expect(error.issues.some((issue) => issue.path.join(".") === path)).toBe(true);
    }
  });

  it("rewrites structural check paths without changing entity names in messages", () => {
    const rootError = expectScenarioFailure(
      {
        environment: "production",
        checks: [{ variable: "checks", operator: "exists" }],
      },
      'Unknown global variable "checks"',
    );
    expect(rootError.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["checks"],
          message: 'Unknown global variable "checks"',
        }),
      ]),
    );

    const childError = expectScenarioFailure(
      {
        environment: "production",
        checks: [{ variable: "settings", operator: "exists" }],
        children: [{ checks: [{ variable: "checks", operator: "exists" }] }],
      },
      'Unknown global variable "checks"',
    );
    expect(childError.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["children", 0, "checks"],
          message: 'Unknown global variable "checks"',
        }),
      ]),
    );
  });

  it("accepts a valid feature test with matrix, context, sticky, and expected evaluations", () => {
    expectTestSuccess({
      feature: "checkout",
      assertions: [
        {
          matrix: {
            country: ["nl", "de"],
            loggedIn: [true, false],
            score: [1, 2],
            empty: [null],
          },
          description: "feature assertion",
          at: "${{ score }}",
          environment: "staging",
          target: "web",
          stickyFeatures: {
            checkout: { enabled: true, variation: "control" },
          },
          context: {
            userId: "user-1",
          },
          defaultVariableValues: {
            copy: "Fallback",
          },
          expectedToBeEnabled: true,
          expectedVariation: "control",
          expectedVariables: {
            copy: "Checkout",
          },
          expectedEvaluations: {
            flag: {
              reason: "conditions_unmet",
              conditions: [{ feature: "checkout", enabled: true }],
            },
            variation: { reason: "allocated" },
            variables: { copy: { reason: "variable_default" } },
          },
          children: [
            {
              context: {
                userId: "child-1",
              },
              expectedToBeEnabled: false,
              expectedVariation: null,
            },
          ],
        },
      ],
    });
  });

  it.each([
    [{ flag: { reason: "required" } }, '"required" was removed in v4'],
    [
      { flag: { reason: "required_features_unmet" } },
      '"required_features_unmet" was removed in v4',
    ],
    [{ flag: { reason: "bucketed" } }, 'Unknown evaluation reason "bucketed"'],
    [{ flag: { requiredFeatures: [{ feature: "checkout" }] } }, "`requiredFeatures` was removed"],
  ])("explains invalid or removed evaluation expectations: %j", (expectedEvaluations, message) => {
    expectTestFailure(
      {
        feature: "checkout",
        assertions: [{ at: 50, environment: "staging", context: {}, expectedEvaluations }],
      },
      message,
    );
  });

  it("accepts stable assertion keys and promotion protection", () => {
    expectTestSuccess({
      feature: "checkout",
      assertions: [
        {
          key: "production-rollout",
          promotable: false,
          at: 50,
          environment: "production",
        },
      ],
    });

    expectTestSuccess({
      segment: "desktop",
      assertions: [
        {
          key: "desktop-user",
          promotable: false,
          context: { device: "desktop" },
          expectedToMatch: true,
        },
      ],
    });
  });

  it("requires every assertion to have a unique key when keys are used", () => {
    const missingKeyError = expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          { key: "first", at: 10, environment: "staging" },
          { at: 20, environment: "staging" },
        ],
      },
      "All assertions in a test spec must have a key",
    );
    expect(
      missingKeyError.issues.some((issue) => issue.path.join(".") === "assertions.1.key"),
    ).toBe(true);

    const duplicateKeyError = expectTestFailure(
      {
        segment: "desktop",
        assertions: [
          { key: "same", context: {}, expectedToMatch: true },
          { key: "same", context: {}, expectedToMatch: false },
        ],
      },
      'Duplicate assertion key "same"',
    );
    expect(
      duplicateKeyError.issues.some((issue) => issue.path.join(".") === "assertions.1.key"),
    ).toBe(true);
  });

  it("requires a key when promotable is set on an assertion", () => {
    const error = expectTestFailure(
      {
        segment: "desktop",
        assertions: [
          {
            promotable: false,
            context: {},
            expectedToMatch: true,
          },
        ],
      },
      "Assertion key is required when promotable is set",
    );

    expect(error.issues.some((issue) => issue.path.join(".") === "assertions.0.key")).toBe(true);
  });

  it("rejects non-boolean assertion promotable values", () => {
    expectTestFailure(
      {
        segment: "desktop",
        assertions: [
          {
            key: "desktop-user",
            promotable: "no",
            context: {},
            expectedToMatch: true,
          },
        ],
      },
      "Invalid input",
    );
  });

  it("accepts matrix placeholders for environment values", () => {
    expectTestSuccess({
      feature: "checkout",
      assertions: [
        {
          matrix: {
            environment: ["staging", "production"],
          },
          at: 1,
          environment: "${{ environment }}",
        },
      ],
    });
  });

  it("accepts matrix placeholders for target values", () => {
    expectTestSuccess({
      feature: "checkout",
      assertions: [
        {
          matrix: {
            target: ["web"],
          },
          at: 1,
          environment: "staging",
          target: "${{ target }}",
        },
      ],
    });
  });

  it("rejects unknown targets", () => {
    expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          {
            at: 1,
            environment: "staging",
            target: "mobile",
          },
        ],
      },
      'Unknown target "mobile"',
    );
  });

  it("names stickyFeatures as the replacement for the removed sticky", () => {
    const error = expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          {
            environment: "production",
            at: 50,
            sticky: { checkout: { enabled: true } },
            children: [{ sticky: { checkout: { enabled: false } } }],
          },
        ],
      },
      "Replace `sticky` with `stickyFeatures`",
    );
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["assertions.0.sticky", "assertions.0.children.0.sticky"]),
    );
    expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          { environment: "production", at: 50, stickyFeatures: { missing: { enabled: true } } },
        ],
      },
      "missing",
    );
  });

  it("accepts sticky global variables and child descriptions in feature assertions", () => {
    expectTestSuccess({
      feature: "checkout",
      assertions: [
        {
          environment: "production",
          at: 50,
          stickyVariables: { settings: true },
          expectedToBeEnabled: false,
          children: [
            {
              description: "settings off",
              stickyVariables: { settings: false },
              expectedToBeEnabled: true,
            },
          ],
        },
      ],
    });
    expectTestFailure(
      {
        feature: "checkout",
        assertions: [{ environment: "production", at: 50, stickyVariables: { missing: true } }],
      },
      "missing",
    );
    expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          { environment: "production", at: 50, children: [{ expectedToBeEnabld: true }] },
        ],
      },
      "Unrecognized key",
    );
    expectScenarioSuccess({
      environment: "production",
      checks: [{ feature: "checkout", enabled: true }],
      children: [{ description: "documented", checks: [{ feature: "checkout", enabled: true }] }],
    });
  });

  it("says to add environment when the project configures environments", () => {
    const error = expectTestFailure(
      { feature: "checkout", assertions: [{ at: 1, expectedToBeEnabled: true }] },
      "Add environment. This project configures environments: staging, production.",
    );
    expect(error.issues.map((issue) => issue.path.join("."))).toContain("assertions.0.environment");
    expectScenarioFailure(
      { checks: [{ feature: "checkout", enabled: true }] },
      "Add environment. This project configures environments: staging, production.",
    );
  });

  it("rejects unknown environments with a precise path", () => {
    const error = expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          {
            at: 1,
            environment: "qa",
          },
        ],
      },
      'Unknown environment "qa"',
    );

    expect(error.issues.some((issue) => issue.path.join(".") === "assertions.0.environment")).toBe(
      true,
    );
  });

  it("rejects environment in assertions when environments are omitted", () => {
    const schema = getSchema(minimalProjectConfig({ environments: undefined }));
    const testSpec = {
      feature: "checkout",
      assertions: [
        {
          at: 1,
          expectedToBeEnabled: true,
        },
      ],
    };

    expect(schema.safeParse(testSpec).success).toBe(true);

    const result = schema.safeParse({
      feature: "checkout",
      assertions: [
        {
          at: 1,
          environment: "staging",
          expectedToBeEnabled: true,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown feature and segment keys", () => {
    expectTestFailure(
      {
        feature: "not-real",
        assertions: [{ at: 1, environment: "staging" }],
      },
      'Unknown feature "not-real"',
    );

    expectTestFailure(
      {
        segment: "not-real",
        assertions: [
          {
            context: {},
            expectedToMatch: true,
          },
        ],
      },
      'Unknown segment "not-real"',
    );
  });
});
