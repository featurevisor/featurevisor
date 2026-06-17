import { createFeaturevisor } from "./index";
import {
  createComplexDatafile,
  createDatafile,
  createFeature,
  deterministicBucketModule,
} from "./instance.test-fixtures";

describe("Featurevisor public API: child instances", () => {
  it("layers parent, child, and call context without mutating any layer", () => {
    const parent = createFeaturevisor({
      context: { parentOnly: true, shared: "parent" },
      logLevel: "fatal",
    });
    const child = parent.spawn({ childOnly: true, shared: "child" });

    expect(child.getContext()).toEqual({ parentOnly: true, childOnly: true, shared: "child" });
    expect(child.getContext({ callOnly: true, shared: "call" })).toEqual({
      parentOnly: true,
      childOnly: true,
      callOnly: true,
      shared: "call",
    });
    expect(parent.getContext()).toEqual({ parentOnly: true, shared: "parent" });
    expect(child.getContext()).toEqual({ parentOnly: true, childOnly: true, shared: "child" });
  });

  it("snapshots existing parent context while inheriting newly introduced parent keys", () => {
    const parent = createFeaturevisor({ context: { country: "nl", plan: "free" } });
    const child = parent.spawn({ country: "de" });

    parent.setContext({ plan: "pro", locale: "de-DE" });

    expect(child.getContext()).toEqual({ country: "de", plan: "free", locale: "de-DE" });
  });

  it("merges and replaces child context with local events only", () => {
    const parentEvents: unknown[] = [];
    const childEvents: unknown[] = [];
    const parent = createFeaturevisor({ logLevel: "fatal" });
    const child = parent.spawn({ a: 1 });
    parent.on("context_set", (event) => parentEvents.push(event));
    child.on("context_set", (event) => childEvents.push(event));

    child.setContext({ b: 2 });
    child.setContext({ c: 3 }, true);

    expect(parentEvents).toEqual([]);
    expect(childEvents).toEqual([
      { context: { a: 1, b: 2 }, replaced: false },
      { context: { c: 3 }, replaced: true },
    ]);
  });

  it("isolates sticky state between siblings and supports per-call overrides", () => {
    const parent = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ features: { flag: createFeature() } }),
      sticky: { flag: { enabled: true } },
    });
    const offChild = parent.spawn({}, { sticky: { flag: { enabled: false } } });
    const inheritedChild = parent.spawn();

    expect(parent.isEnabled("flag")).toBe(true);
    expect(offChild.isEnabled("flag")).toBe(false);
    expect(inheritedChild.isEnabled("flag")).toBe(true);
    expect(offChild.isEnabled("flag", {}, { sticky: { flag: { enabled: true } } })).toBe(true);
    expect(offChild.isEnabled("flag")).toBe(false);
  });

  it("emits child sticky events with merge and replacement semantics", () => {
    const events: any[] = [];
    const child = createFeaturevisor({ logLevel: "fatal" }).spawn(
      {},
      {
        sticky: { a: { enabled: true } },
      },
    );
    child.on("sticky_set", (event) => events.push(event));

    child.setSticky({ b: { enabled: false } });
    child.setSticky({ c: { enabled: true } }, true);

    expect(events).toEqual([
      { features: ["a", "b"], replaced: false },
      { features: ["a", "b", "c"], replaced: true },
    ]);
  });

  it("forwards parent datafile and error events but keeps local events local", () => {
    const parent = createFeaturevisor({ logLevel: "fatal" });
    const child = parent.spawn();
    const datafiles: any[] = [];
    const errors: any[] = [];
    child.on("datafile_set", (event) => datafiles.push(event));
    child.on("error", (event) => errors.push(event));

    parent.setDatafile(createDatafile({ revision: "child-visible" }));
    parent.setDatafile("{");

    expect(datafiles).toHaveLength(1);
    expect(datafiles[0].revision).toBe("child-visible");
    expect(errors[0].diagnostic.code).toBe("invalid_datafile");
  });

  it("closing a child clears local listeners without closing its parent", () => {
    const local: unknown[] = [];
    const forwarded: unknown[] = [];
    const parent = createFeaturevisor({ logLevel: "fatal" });
    const child = parent.spawn();
    child.on("context_set", (event) => local.push(event));
    child.on("datafile_set", (event) => forwarded.push(event));

    child.close();
    child.setContext({ afterClose: true });
    parent.setDatafile(createDatafile({ revision: "still-open" }));

    expect(local).toEqual([]);
    expect(forwarded).toHaveLength(1);
    expect(parent.getRevision()).toBe("still-open");
  });

  it("delegates every typed getter and getAllEvaluations with child context", () => {
    const parent = createFeaturevisor({
      logLevel: "fatal",
      datafile: createComplexDatafile(),
      modules: [deterministicBucketModule()],
    });
    const child = parent.spawn({ userId: "child", bucket: 75000 });

    expect(child.isEnabled("experiment")).toBe(true);
    expect(child.getVariation("experiment")).toBe("treatment");
    expect(child.getVariable("experiment", "greeting")).toBe("Welcome");
    expect(child.getVariableString("experiment", "greeting")).toBe("Welcome");
    expect(child.getVariableInteger("experiment", "count")).toBe(2);
    expect(child.getVariableDouble("experiment", "ratio")).toBe(2.5);
    expect(child.getVariableBoolean("experiment", "enabledCopy")).toBe(true);
    expect(child.getVariableArray("experiment", "items")).toEqual(["default"]);
    expect(child.getVariableObject("experiment", "config")).toEqual({ source: "default" });
    expect(child.getVariableJSON("experiment", "jsonConfig")).toEqual({ source: "json" });
    expect(child.getAllEvaluations({}, ["experiment"]).experiment).toEqual(
      expect.objectContaining({ enabled: true, variation: "treatment" }),
    );
  });

  it("uses parent datafile updates immediately", () => {
    const parent = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ features: { flag: createFeature() } }),
    });
    const child = parent.spawn();

    expect(child.isEnabled("flag")).toBe(true);
    parent.setDatafile(
      createDatafile({
        revision: "off",
        features: {
          flag: createFeature({
            traffic: [{ key: "off", segments: "*", percentage: 0, allocation: [] }],
          }),
        },
      }),
    );
    expect(child.isEnabled("flag")).toBe(false);
  });
});
