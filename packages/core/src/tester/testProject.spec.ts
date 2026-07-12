import type { Test, TestFeature } from "@featurevisor/types";

import { filterTestForTargets } from "./testProject";

describe("core: test target selection", () => {
  const featureTest = {
    key: "checkout",
    feature: "checkout",
    assertions: [
      { description: "base", context: {}, expectedToBeEnabled: true },
      { description: "web", target: "web", context: {}, expectedToBeEnabled: true },
      { description: "mobile", target: "mobile", context: {}, expectedToBeEnabled: true },
    ],
  } as TestFeature;

  it("keeps untargeted assertions and assertions for all selected targets", () => {
    const filtered = filterTestForTargets(featureTest, ["web", "mobile"]) as TestFeature;

    expect(filtered.assertions.map((assertion) => assertion.description)).toEqual([
      "base",
      "web",
      "mobile",
    ]);
  });

  it("removes assertions for targets that were not selected", () => {
    const filtered = filterTestForTargets(featureTest, ["web"]) as TestFeature;

    expect(filtered.assertions.map((assertion) => assertion.description)).toEqual(["base", "web"]);
  });

  it("skips a feature test when none of its targeted assertions were selected", () => {
    const targetedOnly = {
      ...featureTest,
      assertions: featureTest.assertions.slice(1),
    } as TestFeature;

    expect(filterTestForTargets(targetedOnly, ["api"])).toBeUndefined();
  });

  it("does not filter segment tests", () => {
    const segmentTest = {
      key: "everyone",
      segment: "everyone",
      assertions: [],
    } as unknown as Test;

    expect(filterTestForTargets(segmentTest, ["web"])).toBe(segmentTest);
  });
});
