/**
 * Unit tests for condition schema validation (segment conditions, feature rules, etc.).
 * Covers getConditionsZodSchema: attribute ref, operators, value type per operator,
 * regexFlags, and/or/not nesting, and "*" (everyone).
 */
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";

function minimalProjectConfig(): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    groupsDirectoryPath: "",
    schemasDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    siteExportDirectoryPath: "",
    environments: ["staging", "production"],
    tags: ["all"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
  };
}

const TEST_ATTRIBUTES: [string, ...string[]] = ["userId", "country", "device", "email"];

function getConditionsSchema() {
  return getConditionsZodSchema(minimalProjectConfig(), TEST_ATTRIBUTES);
}

function parseConditions(input: unknown): z.SafeParseReturnType<unknown, unknown> {
  return getConditionsSchema().safeParse(input);
}

function expectConditionsSuccess(input: unknown): void {
  const result = parseConditions(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const err = (result as z.SafeParseError<unknown>).error;
    const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Expected conditions to pass: ${msg}`);
  }
}

function expectConditionsFailure(input: unknown, messageSubstring?: string): z.ZodError {
  const result = parseConditions(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected conditions to fail");
  const err = (result as z.SafeParseError<unknown>).error;
  if (messageSubstring) {
    const messages = err.issues.map((i) => (typeof i.message === "string" ? i.message : "")).join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

/** Assert that an intentional mistake produces an error at the expected path with expected message. */
function expectConditionErrorSurfaces(
  input: unknown,
  opts: { pathContains: string[]; messageContains: string },
): void {
  const err = expectConditionsFailure(input, opts.messageContains);
  const pathStrings = err.issues.map((i) => i.path.join("."));
  const hasMatchingPath = pathStrings.some((p) =>
    opts.pathContains.every((seg) => p.includes(seg)),
  );
  expect(hasMatchingPath).toBe(true);
}

describe("conditionSchema.ts :: getConditionsZodSchema", () => {
  describe("attribute", () => {
    it("accepts condition when attribute is in available list", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "equals",
        value: "u1",
      });
    });

    it("rejects condition when attribute is unknown", () => {
      expectConditionsFailure(
        {
          attribute: "unknownAttr",
          operator: "equals",
          value: "x",
        },
        "Unknown attribute",
      );
    });
  });

  describe("operator and value: common (equals, notEquals)", () => {
    it("accepts string value with equals", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "equals", value: "u1" });
    });

    it("accepts number value with equals", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "equals", value: 42 });
    });

    it("accepts boolean value with equals", () => {
      expectConditionsSuccess({ attribute: "device", operator: "equals", value: true });
    });

    it("accepts null value with equals", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "equals", value: null });
    });

    it("rejects array value with equals", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "equals", value: ["a", "b"] },
        "value has to be",
      );
    });
  });

  describe("operator and value: numeric", () => {
    it("accepts number value with greaterThan", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "greaterThan",
        value: 10,
      });
    });

    it("rejects string value with greaterThan", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "greaterThan", value: "10" },
        "value must be a number",
      );
    });

    it("rejects missing value with lessThan", () => {
      const result = parseConditions({
        attribute: "userId",
        operator: "lessThan",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("operator and value: string", () => {
    it("accepts string value with contains", () => {
      expectConditionsSuccess({
        attribute: "email",
        operator: "contains",
        value: "@",
      });
    });

    it("rejects number value with startsWith", () => {
      expectConditionsFailure(
        { attribute: "country", operator: "startsWith", value: 123 },
        "value must be a string",
      );
    });
  });

  describe("operator and value: date", () => {
    it("accepts ISO 8601 string with before", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "before",
        value: "2025-12-31T23:59:59Z",
      });
    });

    it("rejects non-ISO string with after", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "after", value: "not-a-date" },
        "ISO 8601",
      );
    });

    it("rejects missing value with before", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "before" },
        "value must be provided",
      );
    });
  });

  describe("operator and value: array (in, notIn)", () => {
    it("accepts array of strings with in", () => {
      expectConditionsSuccess({
        attribute: "country",
        operator: "in",
        value: ["de", "fr", "nl"],
      });
    });

    it("rejects non-array value with notIn", () => {
      expectConditionsFailure(
        { attribute: "country", operator: "notIn", value: "de" },
        "value must be an array",
      );
    });
  });

  describe("operator and value: regex (matches, notMatches)", () => {
    it("accepts string value with matches", () => {
      expectConditionsSuccess({
        attribute: "email",
        operator: "matches",
        value: "^[a-z]+@",
      });
    });

    it("accepts regexFlags with matches", () => {
      expectConditionsSuccess({
        attribute: "email",
        operator: "matches",
        value: "hello",
        regexFlags: "i",
      });
    });

    it("rejects invalid regexFlags", () => {
      expectConditionsFailure(
        {
          attribute: "email",
          operator: "matches",
          value: "x",
          regexFlags: "invalid",
        },
        "regexFlags",
      );
    });

    it("rejects regexFlags when operator is not matches/notMatches", () => {
      expectConditionsFailure(
        {
          attribute: "userId",
          operator: "equals",
          value: "u1",
          regexFlags: "i",
        },
        "not needed",
      );
    });
  });

  describe("operator: exists, notExists (no value)", () => {
    it("accepts condition without value for exists", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "exists",
      });
    });

    it("rejects value when operator is exists", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "exists", value: "x" },
        "value is not needed",
      );
    });
  });

  describe("structure: and / or / not", () => {
    it("accepts and array of conditions", () => {
      expectConditionsSuccess({
        and: [
          { attribute: "userId", operator: "equals", value: "u1" },
          { attribute: "country", operator: "equals", value: "de" },
        ],
      });
    });

    it("accepts or array of conditions", () => {
      expectConditionsSuccess({
        or: [
          { attribute: "country", operator: "equals", value: "de" },
          { attribute: "country", operator: "equals", value: "fr" },
        ],
      });
    });

    it("accepts not array of conditions", () => {
      expectConditionsSuccess({
        not: [{ attribute: "country", operator: "equals", value: "us" }],
      });
    });

    it("accepts nested and inside or", () => {
      expectConditionsSuccess({
        or: [
          {
            and: [
              { attribute: "userId", operator: "equals", value: "u1" },
              { attribute: "device", operator: "equals", value: "mobile" },
            ],
          },
          { attribute: "country", operator: "equals", value: "de" },
        ],
      });
    });

    it("rejects unknown attribute inside nested condition", () => {
      expectConditionsFailure(
        {
          and: [
            { attribute: "userId", operator: "equals", value: "u1" },
            { attribute: "badAttr", operator: "equals", value: "x" },
          ],
        },
        "Unknown attribute",
      );
    });

    it("rejects invalid value type inside nested condition", () => {
      expectConditionsFailure(
        {
          or: [
            { attribute: "country", operator: "greaterThan", value: "string" },
          ],
        },
        "value must be a number",
      );
    });
  });

  describe("everyone (*)", () => {
    it("accepts literal * as conditions", () => {
      expectConditionsSuccess("*");
    });
  });

  describe("conditions as array", () => {
    it("accepts array of plain conditions", () => {
      expectConditionsSuccess([
        { attribute: "userId", operator: "equals", value: "u1" },
        { attribute: "country", operator: "equals", value: "de" },
      ]);
    });

    it("rejects array containing invalid condition", () => {
      expectConditionsFailure(
        [
          { attribute: "userId", operator: "equals", value: "u1" },
          { attribute: "unknown", operator: "equals", value: "x" },
        ],
        "Unknown attribute",
      );
    });
  });

  describe("strict: no extra keys on and/or/not", () => {
    it("rejects and/or/not with extra key", () => {
      const result = parseConditions({
        and: [{ attribute: "userId", operator: "equals", value: "u1" }],
        extraKey: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("operator enum", () => {
    it("rejects unknown operator", () => {
      const result = parseConditions({
        attribute: "userId",
        operator: "unknownOp",
        value: "x",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all common and numeric operators", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "notEquals", value: "x" });
      expectConditionsSuccess({ attribute: "userId", operator: "greaterThanOrEquals", value: 0 });
      expectConditionsSuccess({ attribute: "userId", operator: "lessThanOrEquals", value: 100 });
    });

    it("accepts semver operators with string value", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "semverEquals",
        value: "1.0.0",
      });
    });
  });

  describe("errors surface properly: intentional mistakes produce correct path and message", () => {
    it("unknown attribute: error path includes attribute, message says Unknown attribute", () => {
      expectConditionErrorSurfaces(
        { attribute: "typoAttr", operator: "equals", value: "x" },
        { pathContains: ["attribute"], messageContains: "Unknown attribute" },
      );
    });

    it("numeric operator with string value: error path points to value, message says number", () => {
      expectConditionErrorSurfaces(
        { attribute: "userId", operator: "greaterThan", value: "10" },
        { pathContains: ["value"], messageContains: "number" },
      );
    });

    it("date operator with invalid string: error path points to value, message mentions ISO", () => {
      expectConditionErrorSurfaces(
        { attribute: "userId", operator: "before", value: "not-a-date" },
        { pathContains: ["value"], messageContains: "ISO" },
      );
    });

    it("exists operator with value set: error path points to value, message says not needed", () => {
      expectConditionErrorSurfaces(
        { attribute: "userId", operator: "exists", value: "x" },
        { pathContains: ["value"], messageContains: "not needed" },
      );
    });

    it("regexFlags when operator is not matches: error path points to regexFlags", () => {
      expectConditionErrorSurfaces(
        {
          attribute: "userId",
          operator: "equals",
          value: "u1",
          regexFlags: "i",
        },
        { pathContains: ["regexFlags"], messageContains: "not needed" },
      );
    });

    it("nested condition with unknown attribute: error path goes into and.*.attribute", () => {
      expectConditionErrorSurfaces(
        {
          and: [
            { attribute: "userId", operator: "equals", value: "u1" },
            { attribute: "badAttr", operator: "equals", value: "x" },
          ],
        },
        { pathContains: ["attribute"], messageContains: "Unknown attribute" },
      );
    });
  });
});
