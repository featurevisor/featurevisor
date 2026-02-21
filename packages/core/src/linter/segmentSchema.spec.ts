/**
 * Unit tests for segment schema validation (segments/*.yml).
 * Covers getSegmentZodSchema: description, conditions (plain, and/or/not, array, *),
 * optional archived, and strict (no extra keys).
 */
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getSegmentZodSchema } from "./segmentSchema";

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

const TEST_ATTRIBUTES: [string, ...string[]] = ["userId", "country", "device"];

function getSegmentSchema() {
  const projectConfig = minimalProjectConfig();
  const conditionsZodSchema = getConditionsZodSchema(projectConfig, TEST_ATTRIBUTES);
  return getSegmentZodSchema(projectConfig, conditionsZodSchema);
}

function parseSegment(input: unknown): z.SafeParseReturnType<unknown, unknown> {
  return getSegmentSchema().safeParse(input);
}

function expectSegmentSuccess(input: unknown): void {
  const result = parseSegment(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const err = (result as z.SafeParseError<unknown>).error;
    const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Expected segment to pass: ${msg}`);
  }
}

function expectSegmentFailure(input: unknown, messageSubstring?: string): z.ZodError {
  const result = parseSegment(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected segment to fail");
  const err = (result as z.SafeParseError<unknown>).error;
  if (messageSubstring) {
    const messages = err.issues.map((i) => (typeof i.message === "string" ? i.message : "")).join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

/** Assert that an intentional mistake produces an error at the expected path with expected message. */
function expectSegmentErrorSurfaces(
  input: unknown,
  opts: { pathContains: string[]; messageContains: string },
): void {
  const err = expectSegmentFailure(input, opts.messageContains);
  const pathStrings = err.issues.map((i) => i.path.join("."));
  const hasMatchingPath = pathStrings.some((p) =>
    opts.pathContains.every((seg) => p.includes(seg)),
  );
  expect(hasMatchingPath).toBe(true);
}

describe("segmentSchema.ts :: getSegmentZodSchema", () => {
  describe("required fields", () => {
    it("accepts segment with description and conditions (plain condition)", () => {
      expectSegmentSuccess({
        description: "Users in Germany",
        conditions: {
          attribute: "country",
          operator: "equals",
          value: "de",
        },
      });
    });

    it("rejects segment without description", () => {
      const result = parseSegment({
        conditions: { attribute: "country", operator: "equals", value: "de" },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const err = (result as z.SafeParseError<unknown>).error;
        const path = err.issues.map((i) => i.path.join(".")).join(" ");
        expect(path).toContain("description");
      }
    });

    it("rejects segment without conditions", () => {
      const result = parseSegment({
        description: "A segment",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("conditions: everyone (*)", () => {
    it("accepts segment with conditions *", () => {
      expectSegmentSuccess({
        description: "Everyone",
        conditions: "*",
      });
    });
  });

  describe("conditions: array of conditions", () => {
    it("accepts segment with conditions as array", () => {
      expectSegmentSuccess({
        description: "Germany or France",
        conditions: [
          { attribute: "country", operator: "equals", value: "de" },
          { attribute: "country", operator: "equals", value: "fr" },
        ],
      });
    });
  });

  describe("conditions: and / or / not", () => {
    it("accepts segment with and conditions", () => {
      expectSegmentSuccess({
        description: "Germany and mobile",
        conditions: {
          and: [
            { attribute: "country", operator: "equals", value: "de" },
            { attribute: "device", operator: "equals", value: "mobile" },
          ],
        },
      });
    });

    it("accepts segment with or conditions", () => {
      expectSegmentSuccess({
        description: "Germany or France",
        conditions: {
          or: [
            { attribute: "country", operator: "equals", value: "de" },
            { attribute: "country", operator: "equals", value: "fr" },
          ],
        },
      });
    });

    it("accepts segment with not conditions", () => {
      expectSegmentSuccess({
        description: "Not US",
        conditions: {
          not: [{ attribute: "country", operator: "equals", value: "us" }],
        },
      });
    });

    it("rejects segment when nested condition has unknown attribute", () => {
      expectSegmentFailure(
        {
          description: "Bad attr",
          conditions: {
            and: [
              { attribute: "userId", operator: "equals", value: "u1" },
              { attribute: "unknownAttr", operator: "equals", value: "x" },
            ],
          },
        },
        "Unknown attribute",
      );
    });
  });

  describe("optional archived", () => {
    it("accepts segment with archived true", () => {
      expectSegmentSuccess({
        description: "Old segment",
        conditions: "*",
        archived: true,
      });
    });

    it("accepts segment with archived false", () => {
      expectSegmentSuccess({
        description: "Active segment",
        conditions: "*",
        archived: false,
      });
    });

    it("accepts segment without archived", () => {
      expectSegmentSuccess({
        description: "Segment",
        conditions: "*",
      });
    });
  });

  describe("strict: no extra keys", () => {
    it("rejects segment with extra key at root", () => {
      const result = parseSegment({
        description: "Segment",
        conditions: "*",
        extraKey: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("description type", () => {
    it("rejects description that is not a string", () => {
      const result = parseSegment({
        description: 123,
        conditions: "*",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("errors surface properly: intentional mistakes produce correct path and message", () => {
    it("missing description: error path includes description", () => {
      expectSegmentErrorSurfaces(
        { conditions: { attribute: "country", operator: "equals", value: "de" } },
        { pathContains: ["description"], messageContains: "Required" },
      );
    });

    it("conditions with unknown attribute: error path goes into conditions", () => {
      expectSegmentErrorSurfaces(
        {
          description: "Segment",
          conditions: {
            and: [
              { attribute: "country", operator: "equals", value: "de" },
              { attribute: "typoAttr", operator: "equals", value: "x" },
            ],
          },
        },
        { pathContains: ["conditions", "attribute"], messageContains: "Unknown attribute" },
      );
    });

    it("extra key at root: parse fails and message mentions unrecognized key", () => {
      const result = parseSegment({
        description: "Segment",
        conditions: "*",
        extraKey: true,
      });
      expect(result.success).toBe(false);
      const err = (result as z.SafeParseError<unknown>).error;
      const messages = err.issues.map((i) => (typeof i.message === "string" ? i.message : "")).join(" ");
      expect(messages).toMatch(/unrecognized|extraKey/i);
    });
  });
});
