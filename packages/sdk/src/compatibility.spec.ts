import { createFeaturevisor, type FeaturevisorModule } from "./index";
// @ts-expect-error The legacy requirement type is no longer exported.
import type { Required } from "./index";
// @ts-expect-error The legacy requirement object type is no longer exported.
import type { RequiredWithVariation } from "./index";
// @ts-expect-error The combined sticky event type is no longer exported.
import type { StickySetEventDetails } from "./index";

describe("major SDK compatibility cleanup", () => {
  it("exposes only canonical aliases and metadata on parent and child instances", () => {
    const f = createFeaturevisor({
      logLevel: "fatal",
      stickyFeatures: { flag: { enabled: true } },
    });
    const child = f.spawn({}, { stickyFeatures: { flag: { enabled: false } } });
    for (const instance of [f, child]) {
      expect("setSticky" in instance).toBe(false);
      expect("getAllEvaluations" in instance).toBe(false);
      expect(instance.evaluateFlag("flag")).not.toHaveProperty("sticky");
      expect(instance.evaluateFlag("flag")).not.toHaveProperty("required");
    }
    if (false) {
      // These references also ensure each rejected import above remains checked.
      const removed: [Required, RequiredWithVariation, StickySetEventDetails] = [] as never;
      void removed;
      // @ts-expect-error Old module callbacks are not part of the public API.
      const before: FeaturevisorModule = { before: (options: unknown) => options };
      // @ts-expect-error Old module callbacks are not part of the public API.
      const after: FeaturevisorModule = { after: (evaluation: unknown) => evaluation };
      void before;
      void after;
      // @ts-expect-error Child creation uses stickyFeatures.
      f.spawn({}, { sticky: { flag: { enabled: true } } });
      // @ts-expect-error Legacy evaluation metadata is removed.
      void f.evaluateFlag("flag").required;
      // @ts-expect-error Legacy evaluation metadata is removed.
      void f.evaluateFlag("flag").sticky;
      const array = f.getVariableArray("global");
      // @ts-expect-error Unconstrained array items have type unknown.
      const strings: string[] | null = array;
      void strings;
      const explicit: string[] | null = f.getVariableArray<string>("global");
      void explicit;
    }
    child.close();
    f.close();
  });
});
