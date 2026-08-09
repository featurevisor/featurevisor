import { FeaturevisorCLIError } from "../error";
import {
  parseJsonObjectOption,
  parseJsonOption,
  parsePositiveIntegerOption,
  parseRegexOption,
} from "./validation";

describe("core: CLI validation", function () {
  test("parses JSON options", function () {
    expect(parseJsonOption("--context", '{"country":"nl"}')).toEqual({ country: "nl" });
  });

  test("reports invalid JSON options", function () {
    expect(() => parseJsonOption("--context", "{")).toThrow(FeaturevisorCLIError);
    expect(() => parseJsonOption("--context", "{")).toThrow("Invalid --context");
  });

  test("requires targeting context to be a JSON object", function () {
    expect(parseJsonObjectOption("--context", '{"country":"nl"}')).toEqual({ country: "nl" });
    expect(() => parseJsonObjectOption("--context", "[]")).toThrow(
      "--context must contain a JSON object",
    );
  });

  test("parses positive integer options", function () {
    expect(parsePositiveIntegerOption("--n", 100, 1)).toBe(100);
    expect(parsePositiveIntegerOption("--n", undefined, 1)).toBe(1);
    expect(() => parsePositiveIntegerOption("--n", 0, 1)).toThrow("--n must be a positive integer");
    expect(() => parsePositiveIntegerOption("--n", 1.5, 1)).toThrow(
      "--n must be a positive integer",
    );
  });

  test("parses regular expression options", function () {
    expect(parseRegexOption("--keyPattern", "checkout", "i").test("CHECKOUT")).toBe(true);
  });

  test("reports invalid regular expression options", function () {
    expect(() => parseRegexOption("--keyPattern", "[")).toThrow(FeaturevisorCLIError);
    expect(() => parseRegexOption("--keyPattern", "[")).toThrow("Invalid --keyPattern");
  });
});
