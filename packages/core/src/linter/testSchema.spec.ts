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
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    siteExportDirectoryPath: "",
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
  return getTestsZodSchema(projectConfig, ["checkout"], ["desktop"], ["web"]);
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
            flag: { reason: "rule" },
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
