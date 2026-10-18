import { classifyTestSpec, isScenarioSpec } from "./testSpecs";

describe("test spec classification", () => {
  it.each(["feature", "segment", "variable"] as const)("classifies a root %s owner", (owner) => {
    expect(classifyTestSpec({ [owner]: "example", assertions: [] })).toBe(owner);
    expect(isScenarioSpec({ [owner]: "example", checks: [] })).toBe(false);
    expect(() => classifyTestSpec({ [owner]: "example", checks: [] })).toThrow("root checks");
  });

  it("classifies markerless checks without inspecting nested payloads", () => {
    const value = { checks: [], context: { feature: "literal", scenario: "literal" } };
    expect(isScenarioSpec(value)).toBe(true);
    expect(classifyTestSpec(value)).toBe("scenario");
    expect(isScenarioSpec({ checks: null })).toBe(true);
  });

  it.each([null, [], "text", 1, {}, { assertions: [] }, { scenario: "legacy" }])(
    "rejects missing ownership in %p",
    (value) => {
      expect(isScenarioSpec(value)).toBe(false);
      expect(() => classifyTestSpec(value)).toThrow();
    },
  );

  it("rejects multiple owners even when their values are empty", () => {
    expect(() => classifyTestSpec({ feature: null, variable: undefined })).toThrow(
      "exactly one root owner",
    );
  });

  it("uses only own root fields", () => {
    expect(
      isScenarioSpec(Object.assign(Object.create({ feature: "inherited" }), { checks: [] })),
    ).toBe(true);
    expect(isScenarioSpec(Object.create({ checks: [] }))).toBe(false);
    expect(() => classifyTestSpec(Object.create({ feature: "inherited" }))).toThrow();
  });
});
