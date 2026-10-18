import {
  FeaturevisorCLIError,
  formatFeaturevisorCLIError,
  getFeaturevisorCLIErrorMessage,
} from "./error";

describe("core: CLI errors", function () {
  test("includes parser stacks only in verbose text output", function () {
    const cause = new Error("parser failed");
    const error = Object.assign(new Error("features/broken.yml: parser failed"), { cause });
    expect(formatFeaturevisorCLIError(error, { verbose: true })).toContain(cause.stack);
    expect(formatFeaturevisorCLIError(error)).not.toContain("Caused by:");
    expect(
      JSON.parse(formatFeaturevisorCLIError(error, { json: true, verbose: true })).error,
    ).toEqual({ code: "unexpected_error", message: error.message, details: {} });
  });
  test("formats regular errors without exposing a stack", function () {
    expect(formatFeaturevisorCLIError(new Error("failed"))).toBe("failed");
    expect(getFeaturevisorCLIErrorMessage("failed")).toBe("failed");
  });

  test("formats structured JSON errors", function () {
    const error = new FeaturevisorCLIError("Invalid option", {
      code: "invalid_option",
      details: { option: "context" },
    });

    expect(JSON.parse(formatFeaturevisorCLIError(error, { json: true }))).toEqual({
      error: {
        code: "invalid_option",
        message: "Invalid option",
        details: { option: "context" },
      },
    });
  });
});
