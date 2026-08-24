import { getBuiltinCLIOptions, getCompatibilityCLIOptions } from "./options";

describe("core: CLI options", function () {
  test("declares repeatable target and tag options as arrays", function () {
    expect(getBuiltinCLIOptions("build")?.target.type).toBe("array");
    expect(getBuiltinCLIOptions("generate-code")?.target.type).toBe("array");
    expect(getBuiltinCLIOptions("generate-code")?.tag.type).toBe("array");
    expect(getBuiltinCLIOptions("promote")?.target.type).toBe("array");
  });

  test("allows top-level variables without requiring feature selectors", function () {
    expect(getBuiltinCLIOptions("benchmark")?.feature.demandOption).toBeUndefined();
    expect(getBuiltinCLIOptions("benchmark")?.variable.type).toBe("string");
    expect(getBuiltinCLIOptions("evaluate")?.variable.type).toBe("string");
    expect(getBuiltinCLIOptions("build")?.variable.type).toBe("string");
    expect(getBuiltinCLIOptions("list")?.variables.type).toBe("boolean");
  });

  test("declares hidden TypeScript import path overrides", function () {
    expect(getBuiltinCLIOptions("generate-code")?.importSdkPath).toEqual({
      type: "string",
      hidden: true,
    });
    expect(getBuiltinCLIOptions("generate-code")?.importReactPath).toEqual({
      type: "string",
      hidden: true,
    });
  });

  test("keeps obsolete compatibility options hidden", function () {
    expect(getBuiltinCLIOptions("test")?.withScopes).toEqual(
      expect.objectContaining({ type: "boolean", hidden: true }),
    );
    expect(getBuiltinCLIOptions("test")?.schemaVersion).toEqual(
      expect.objectContaining({ type: "string", hidden: true }),
    );
  });

  test("returns undefined for custom commands", function () {
    expect(getBuiltinCLIOptions("custom")).toBeUndefined();
    expect(getCompatibilityCLIOptions().schemaVersion.hidden).toBe(true);
  });
});
