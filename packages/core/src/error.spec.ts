import {
  FeaturevisorCLIError,
  formatFeaturevisorCLIError,
  getFeaturevisorCLIErrorMessage,
} from "./error";

describe("core: CLI errors", function () {
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
