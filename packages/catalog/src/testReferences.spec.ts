import type { TestScenario, TestVariable, TestFeature, TestSegment } from "@featurevisor/types";
import { getTestReferences, groupEntityTests } from "./testReferences";
import { getTestCheckPermalink } from "./testModel";

describe("catalog test references", () => {
  it("associates explicit segment checks with their exact nested and matrix cases", () => {
    const test: TestScenario = {
      scenario: "audiences",
      key: "audiences",
      assertions: [
        {
          matrix: { segment: ["nl", "de"] },
          checks: [{ segment: "${{ segment }}", matches: true }],
          children: [{ checks: [{ not: [{ segment: "nl", matches: false }] }] }],
        },
      ],
    };
    const references = getTestReferences(test);
    expect(references).toHaveLength(4);
    expect(references).toContainEqual(
      expect.objectContaining({
        type: "segment",
        key: "de",
        reason: "Segment matches",
        caseLabel: "1.2",
      }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({
        type: "segment",
        key: "nl",
        reason: "Segment does not match",
        checkLabel: "Child 1 · Check 1.1",
      }),
    );
  });
  const scenario: TestScenario = {
    key: "journeys/checkout.spec",
    scenario: "journeys/checkout.spec",
    assertions: [
      {
        matrix: { variable: ["message", "backup"] },
        stickyFeatures: { untested: { enabled: true } },
        checks: [
          {
            key: "availability",
            and: [
              { feature: "checkout", enabled: true, variation: "control" },
              {
                or: [
                  {
                    not: [
                      {
                        feature: "checkout",
                        variable: "theme",
                        operator: "equals",
                        compareTo: { variable: "${{ variable }}" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        children: [
          {
            checks: [
              {
                key: "child",
                variable: "${{ variable }}",
                operator: "equals",
                compareTo: { feature: "pricing", variable: "label" },
              },
            ],
          },
        ],
      },
    ],
  };

  it("finds both operands, feature expectations and matrix child checks with exact permalinks", () => {
    const references = getTestReferences(scenario);
    expect(references).toHaveLength(10);
    expect(references).toContainEqual({
      type: "feature",
      key: "checkout",
      reason: "Enabled state and Variation",
      caseLabel: "1.1",
      checkLabel: "Check availability.1",
      permalink: getTestCheckPermalink(scenario.key!, "1.1", [
        ["key", "availability"],
        ["index", 0],
      ]),
    });
    expect(references).toContainEqual(
      expect.objectContaining({
        type: "variable",
        key: "backup",
        reason: "Comparison operand: variable value",
        caseLabel: "1.2",
      }),
    );
    expect(references).toContainEqual({
      type: "feature",
      key: "pricing",
      reason: "Comparison operand: variable label",
      caseLabel: "1.2",
      checkLabel: "Child 1 · Check child",
      permalink: getTestCheckPermalink(scenario.key!, "1.2", [
        ["child", 0],
        ["key", "child"],
      ]),
    });
    expect(references.some((reference) => reference.key === "untested")).toBe(false);
    expect(references.some((reference) => reference.key.includes("${{"))).toBe(false);
  });

  it("resolves omitted operands to a global variable owner, but not a feature variable", () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          checks: [
            { operator: "equals", compareTo: { path: "nested" } },
            { feature: "checkout", variable: "settings", operator: "exists" },
          ],
        },
      ],
    };
    expect(getTestReferences(test).map(({ type, key }) => ({ type, key }))).toEqual([
      { type: "variable", key: "settings" },
      { type: "variable", key: "settings" },
      { type: "variable", key: "settings" },
      { type: "feature", key: "checkout" },
    ]);
  });

  it("groups own specs, scenarios and other specs without changing order or input", () => {
    const own: TestFeature = { feature: "checkout", assertions: [] };
    const other: TestVariable = { variable: "checkout", assertions: [] };
    const segment: TestSegment = { segment: "premium", assertions: [] };
    const tests = [scenario, other, own];
    expect(groupEntityTests(tests, { type: "feature", key: "checkout" })).toEqual([
      { title: "Own test specs", tests: [own] },
      { title: "Referenced by scenarios", tests: [scenario] },
      { title: "Referenced by other test specs", tests: [other] },
    ]);
    expect(tests).toEqual([scenario, other, own]);
    expect(getTestReferences(segment)).toEqual([
      { type: "segment", key: "premium", reason: "Own test spec" },
    ]);
    expect(groupEntityTests([], { type: "segment", key: "premium" })).toEqual([]);
  });

  it("preserves case sensitive feature variable keys in comparison descriptions", () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          checks: [
            { operator: "equals", compareTo: { feature: "checkout", variable: "paymentMethods" } },
          ],
        },
      ],
    };
    expect(getTestReferences(test)).toContainEqual(
      expect.objectContaining({
        type: "feature",
        key: "checkout",
        reason: "Comparison operand: variable paymentMethods",
      }),
    );
  });
});
