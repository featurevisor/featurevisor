import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getTestsZodSchema } from "./testSchema";

function minimalProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    groupsDirectoryPath: "",
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

function expectTestSuccess(input: unknown): void {
  const result = parseTest(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const error = (result as z.ZodSafeParseError<unknown>).error;
    throw new Error(error.issues.map((issue) => issue.message).join("; "));
  }
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
      "Expected at least one of expectedValue, expectedEvaluation, or children",
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
          expectedEvaluation: { reason: "required_features_unmet" },
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
      "Expected at least one of expectedValue or expectedEvaluation",
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
          sticky: {
            flag: { checkout: "cached" },
          },
          context: {
            userId: "user-1",
          },
          defaultVariableValues: {
            title: "Fallback",
          },
          expectedToBeEnabled: true,
          expectedVariation: "control",
          expectedVariables: {
            title: "Checkout",
          },
          expectedEvaluations: {
            flag: {
              reason: "required",
              requiredFeatures: [{ feature: "checkout", enabled: true }],
            },
            variation: { reason: "bucketed" },
            variables: { title: { reason: "default" } },
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
