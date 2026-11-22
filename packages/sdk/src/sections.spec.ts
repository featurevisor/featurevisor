import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./index";
import type { DatafileSetEventDetails } from "./events";
import type { FeaturevisorModuleApi } from "./modules";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

function datafile(
  revision: string,
  sections: Record<string, unknown> = {},
  features: DatafileContent["features"] = {
    checkout: { hash: "c1", bucketBy: "userId", traffic: [everyone] },
  },
): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {},
    features,
    variables: {},
    ...sections,
  } as DatafileContent;
}

function setup(initial?: DatafileContent) {
  let api: FeaturevisorModuleApi | undefined;
  const f = createFeaturevisor({ datafile: initial, logLevel: "fatal" });
  f.addModule(
    Object.freeze({
      name: "reader",
      setup: (moduleApi: FeaturevisorModuleApi) => void (api = moduleApi),
    }),
  );
  const changes: DatafileSetEventDetails[] = [];
  f.on("datafile_set", (details) => changes.push(details));
  return { f, api: api!, changes };
}

describe("sections", () => {
  test("entries are read through the module API, as stored", () => {
    const signUp = { hash: "s1", type: "object" };
    const { api } = setup(datafile("1", { schemas: { signUp } }));

    expect(api.getEntry("schemas", "signUp")).toBe(signUp);
    expect(api.getEntry("schemas", "missing")).toBeUndefined();
    expect(api.getEntry("flows", "onboarding")).toBeUndefined();
    expect(api.getEntryKeys("schemas")).toEqual(["signUp"]);
    expect(api.getEntryKeys("flows")).toEqual([]);
  });

  test("the SDK's own keys are never sections", () => {
    const { api } = setup(datafile("1"));

    expect(api.getEntry("features", "checkout")).toBeUndefined();
    expect(api.getEntryKeys("segments")).toEqual([]);
  });

  test("a merge keeps every section and merges it by entry", () => {
    const { f, api } = setup(
      datafile("1", { schemas: { signUp: { hash: "s1" }, address: { hash: "a1" } } }),
    );

    f.setDatafile(datafile("2", { schemas: { signUp: { hash: "s2" } } }));
    expect(api.getEntry("schemas", "signUp")).toEqual({ hash: "s2" });
    expect(api.getEntry("schemas", "address")).toEqual({ hash: "a1" });

    // A datafile without the section keeps what was there.
    f.setDatafile(datafile("3"));
    expect(api.getEntryKeys("schemas")).toEqual(["signUp", "address"]);
  });

  test("a replace keeps exactly what came", () => {
    const { f, api } = setup(
      datafile("1", { schemas: { signUp: { hash: "s1" }, address: { hash: "a1" } } }),
    );

    f.setDatafile(datafile("2", { schemas: { signUp: { hash: "s2" } } }), true);
    expect(api.getEntryKeys("schemas")).toEqual(["signUp"]);

    f.setDatafile(datafile("3"), true);
    expect(api.getEntryKeys("schemas")).toEqual([]);
  });

  test("a top level value that is not an object is carried, and offered as no section", () => {
    const { f, api } = setup(datafile("1", { note: "kept", list: [1, 2] }));

    f.setDatafile(datafile("2", { schemas: { signUp: { hash: "s1" } } }));
    expect(api.getEntryKeys("note")).toEqual([]);
    expect(api.getEntryKeys("list")).toEqual([]);
    expect(api.getEntryKeys("schemas")).toEqual(["signUp"]);
  });

  test("datafile_set reports changed entries by hash, for every section in either datafile", () => {
    const { f, changes } = setup();

    f.setDatafile(datafile("1", { schemas: { signUp: { hash: "s1" }, address: { hash: "a1" } } }));
    expect(changes[0].sections).toEqual({ schemas: ["signUp", "address"] });

    f.setDatafile(datafile("2", { schemas: { signUp: { hash: "s2" }, address: { hash: "a1" } } }));
    expect(changes[1].sections).toEqual({ schemas: ["signUp"] });

    f.setDatafile(datafile("3", { schemas: { coupon: { hash: "c1" } } }));
    expect(changes[2].sections).toEqual({ schemas: ["coupon"] });

    f.setDatafile(datafile("4", { schemas: { coupon: { hash: "c1" } } }), true);
    expect(changes[3].sections).toEqual({ schemas: ["signUp", "address"] });

    f.setDatafile(datafile("5"), true);
    expect(changes[4].sections).toEqual({ schemas: ["coupon"] });

    f.setDatafile(datafile("6"));
    expect(changes[5].sections).toEqual({});
  });

  test("flags evaluate exactly as they do without sections", () => {
    const plain = createFeaturevisor({ datafile: datafile("1"), logLevel: "fatal" });
    const { f } = setup(datafile("1", { schemas: { signUp: { hash: "s1" } }, note: "x" }));

    expect(f.isEnabled("checkout", { userId: "user-1" })).toBe(
      plain.isEnabled("checkout", { userId: "user-1" }),
    );
    expect(f.getRevision()).toBe("1");
  });

  test("a schema 2 datafile keeps its sections", () => {
    const { api } = setup({
      schemaVersion: "2",
      revision: "1",
      attributes: [],
      segments: [],
      features: [],
      schemas: { signUp: { hash: "s1" } },
    } as unknown as DatafileContent);

    expect(api.getEntryKeys("schemas")).toEqual(["signUp"]);
  });
});
