import { assertFindUsageOptions } from "./index";

describe("core: find usage CLI options", function () {
  test("requires exactly one usage query", function () {
    expect(() => assertFindUsageOptions({})).toThrow("Specify one usage query");
    expect(() => assertFindUsageOptions({ feature: "checkout", unusedSegments: true })).toThrow(
      "Specify only one usage query",
    );
    expect(() => assertFindUsageOptions({ segment: "mobile", authors: true })).not.toThrow();
  });
});
