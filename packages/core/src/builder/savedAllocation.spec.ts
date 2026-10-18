import type { ExistingFeature, Variation } from "@featurevisor/types";
import { getTraffic } from "./traffic";

const variations: Variation[] = [
  { value: "a", weight: 50 },
  { value: "b", weight: 50 },
];
const rules = [{ key: "rollout", conditions: "*" as const, percentage: 100 }];
function saved(allocation: unknown, percentage = 50000): ExistingFeature {
  return { variations, traffic: [{ key: "rollout", percentage, allocation }] } as ExistingFeature;
}
describe("saved variation allocation validation", () => {
  test.each([
    [[{ variation: "a", range: [10000, 50000] }]],
    [
      [
        { variation: "a", range: [0, 30000] },
        { variation: "b", range: [20000, 50000] },
      ],
    ],
    [[{ variation: "a", range: [0, 20000] }]],
    [[{ variation: "missing", range: [0, 50000] }]],
    [[{ variation: "a", range: [0, Infinity] }]],
    [[{ variation: "a", range: [50000, 0] }]],
    [[null]],
    [[{ variation: "a", range: [0] }]],
    [[{ variation: "a", range: [0, "50000"] }]],
    [[{ variation: "a", range: [-1, 50000] }]],
    [[{ variation: "a", range: [0, 100001] }]],
    [{ a: [0, 50000] }],
    [[]],
  ])("rejects unusable allocations without changing saved state: %j", (allocation) => {
    const state = saved(allocation);
    const before = structuredClone(state);
    expect(() => getTraffic(variations, rules, state, "checkout")).toThrow(
      'feature "checkout", rule "rollout"',
    );
    expect(state).toEqual(before);
  });
  test("preserves shared endpoints and extends valid allocations", () => {
    const allocation = [
      { variation: "a", range: [0, 25000] },
      { variation: "b", range: [25000, 50000] },
    ];
    const result = getTraffic(variations, rules, saved(allocation), "checkout");
    expect(result[0].allocation?.slice(0, 2)).toEqual(allocation);
    const updated = result[0].allocation!;
    expect(updated[updated.length - 1].range[1]).toBe(100000);
  });
  test("includes the state source and recovery guide in allocation errors", () => {
    try {
      getTraffic(variations, rules, saved([]), "checkout", ".featurevisor/existing-state.json");
      throw new Error("Expected allocation failure");
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid_saved_allocation",
        details: {
          feature: "checkout",
          rule: "rollout",
          stateFile: ".featurevisor/existing-state.json",
        },
      });
      expect((error as Error).message).toContain("State file: .featurevisor/existing-state.json.");
      expect((error as Error).message).toContain(
        "https://featurevisor.com/docs/state-files/#traffic-allocation",
      );
    }
  });
  test("allows zero rollout state to grow and a deliberate new rule to allocate", () => {
    expect(getTraffic(variations, rules, saved([], 0), "checkout")[0].allocation).toHaveLength(2);
    expect(
      getTraffic(variations, [{ ...rules[0], key: "new" }], saved([]), "checkout")[0].allocation,
    ).toHaveLength(2);
  });
  test.each([NaN, -1])("rejects invalid saved percentages on reuse: %s", (percentage) => {
    expect(() => getTraffic(variations, rules, saved([], percentage), "checkout")).toThrow();
  });
  test("accepts fractional endpoints and does not change their order", () => {
    const allocation = [
      { variation: "a", range: [0, 16666.666666666668] },
      { variation: "b", range: [16666.666666666668, 50000] },
    ];
    expect(getTraffic(variations, rules, saved(allocation))[0].allocation?.slice(0, 2)).toEqual(
      allocation,
    );
  });
  test("does not prevent an intentional reduction from allocating again", () => {
    const result = getTraffic(variations, [{ ...rules[0], percentage: 25 }], saved([]));
    expect(result[0].allocation).toEqual([
      { variation: "a", range: [0, 12500] },
      { variation: "b", range: [12500, 25000] },
    ]);
  });
});
