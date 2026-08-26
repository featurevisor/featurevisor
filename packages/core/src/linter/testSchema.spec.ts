import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getLintIssuesFromZodError } from "./printError";
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
  return getTestsZodSchema(projectConfig, ["checkout"], ["desktop"], ["web"], ["settings"]);
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
      "Expected at least one of expectedValue or expectedEvaluation",
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
            target: ["web", "mobile"],
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

  it("rejects invalid matrix values", () => {
    const error = expectTestFailure(
      {
        feature: "checkout",
        assertions: [
          {
            matrix: {
              country: [{ code: "nl" }],
            },
            at: 1,
            environment: "staging",
          },
        ],
      },
      "Invalid input",
    );

    const lintIssues = getLintIssuesFromZodError(error);
    expect(lintIssues.some((issue) => issue.path.join(".").includes("matrix.country.0"))).toBe(
      true,
    );
  });
});
