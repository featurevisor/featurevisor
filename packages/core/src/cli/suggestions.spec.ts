import { suggestCLIName, suggestUnknownOptions } from "./suggestions";

describe("CLI spelling suggestions", () => {
  test("suggests only a close and unambiguous name", () => {
    expect(suggestCLIName("lnt", ["lint", "list", "build"])).toBe("lint");
    expect(suggestCLIName("buidl", ["build", "list"])).toBe("build");
    expect(suggestCLIName("lit", ["lint", "list"])).toBeUndefined();
    expect(suggestCLIName("unrelated", ["lint", "build"])).toBeUndefined();
  });

  test("bounds input length and candidate count", () => {
    expect(suggestCLIName("l", ["lint"])).toBeUndefined();
    expect(suggestCLIName("a".repeat(65), ["a".repeat(65)])).toBeUndefined();
    const candidates = Array.from({ length: 256 }, (_, index) => `unrelated${index}`);
    expect(suggestCLIName("lnt", [...candidates, "lint"])).toBeUndefined();
  });

  test("suggests the canonical flag spelling without exposing hidden options", () => {
    const options = {
      entityType: { type: "string" as const },
      legacy: { type: "boolean" as const, hidden: true },
    };
    expect(suggestUnknownOptions("Unknown argument: entitytype", options)).toBe(
      'Unknown argument: entitytype. Did you mean "--entity-type"?',
    );
    expect(suggestUnknownOptions("Unknown argument: legcy", options)).toBe(
      "Unknown argument: legcy",
    );
    expect(suggestUnknownOptions("Invalid --context", options)).toBe("Invalid --context");
  });
});
