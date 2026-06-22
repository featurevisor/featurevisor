import { createFeaturevisor, type FeaturevisorDiagnostic } from "./index";
import { createDatafile, createFeature } from "./instance.test-fixtures";

describe("Featurevisor public API: datafiles", () => {
  it("starts with a usable empty datafile", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createFeaturevisor({
      logLevel: "warn",
      onDiagnostic: (item) => diagnostics.push(item),
    });

    expect(sdk.getRevision()).toBe("unknown");
    expect(sdk.getFeature("missing")).toBeUndefined();
    expect(sdk.isEnabled("missing")).toBe(false);
    expect(diagnostics.map((item) => item.code)).toEqual(["feature_not_found"]);
  });

  it.each(["object", "JSON string"])("accepts a datafile supplied as an %s", (kind) => {
    const datafile = createDatafile({
      revision: "constructor",
      features: { checkout: createFeature({ hash: "hash-1" }) },
    });
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: kind === "object" ? datafile : JSON.stringify(datafile),
    });

    expect(sdk.getRevision()).toBe("constructor");
    expect(sdk.getFeature("checkout")?.hash).toBe("hash-1");
  });

  it("shallow-merges features and segments while incoming metadata wins", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        revision: "one",
        segments: {
          retained: { conditions: "*" },
          changed: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        },
        features: {
          retained: createFeature({ hash: "retained" }),
          changed: createFeature({ hash: "old", variations: [{ value: "old" }] }),
        },
      }),
    });

    sdk.setDatafile(
      createDatafile({
        schemaVersion: "3",
        revision: "two",
        featurevisorVersion: "next",
        segments: {
          changed: { conditions: { attribute: "country", operator: "equals", value: "de" } },
          added: { conditions: "*" },
        },
        features: {
          changed: createFeature({ hash: "new" }),
          added: createFeature({ hash: "added" }),
        },
      }),
    );

    expect(sdk.getRevision()).toBe("two");
    expect(sdk.getFeature("retained")?.hash).toBe("retained");
    expect(sdk.getFeature("changed")).toEqual(createFeature({ hash: "new" }));
    expect(sdk.getFeature("added")?.hash).toBe("added");
  });

  it("accumulates independent target datafiles over repeated default merges", () => {
    const sdk = createFeaturevisor({ logLevel: "fatal" });

    for (const key of ["web", "mobile", "server"]) {
      sdk.setDatafile(
        createDatafile({
          revision: key,
          features: { [key]: createFeature({ hash: key }) },
        }),
      );
    }

    expect(sdk.getRevision()).toBe("server");
    expect(Object.keys(sdk.getAllEvaluations()).sort()).toEqual(["mobile", "server", "web"]);
  });

  it("fully replaces existing entities only when replace is true", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ features: { old: createFeature(), shared: createFeature() } }),
    });

    sdk.setDatafile(
      createDatafile({ revision: "replacement", features: { next: createFeature() } }),
      true,
    );

    expect(sdk.getFeature("old")).toBeUndefined();
    expect(sdk.getFeature("shared")).toBeUndefined();
    expect(sdk.getFeature("next")).toBeDefined();
  });

  it.each([
    ["invalid JSON", "{"],
    ["null", null],
    ["array", []],
    ["missing revision", { schemaVersion: "2", segments: {}, features: {} }],
    ["null segments", { schemaVersion: "2", revision: "x", segments: null, features: {} }],
    ["null features", { schemaVersion: "2", revision: "x", segments: {}, features: null }],
  ])("rejects %s without changing state or emitting datafile_set", (_, input) => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const events: unknown[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      datafile: createDatafile({ revision: "stable", features: { stable: createFeature() } }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(input as never);

    expect(sdk.getRevision()).toBe("stable");
    expect(sdk.getFeature("stable")).toBeDefined();
    expect(events).toEqual([]);
    expect(diagnostics[diagnostics.length - 1]).toEqual(
      expect.objectContaining({ level: "error", code: "invalid_datafile" }),
    );
  });

  it("reports exact changed keys and replacement state, and supports unsubscribe", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        revision: "one",
        features: {
          unchanged: createFeature({ hash: "same" }),
          changed: createFeature({ hash: "old" }),
        },
      }),
    });
    const unsubscribe = sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({
        revision: "two",
        features: {
          unchanged: createFeature({ hash: "same" }),
          changed: createFeature({ hash: "new" }),
          added: createFeature({ hash: "added" }),
        },
      }),
    );
    unsubscribe();
    unsubscribe();
    sdk.setDatafile(createDatafile({ revision: "three" }));

    expect(events).toEqual([
      {
        revision: "two",
        previousRevision: "one",
        revisionChanged: true,
        features: ["changed", "added"],
        replaced: false,
      },
    ]);
  });

  it("does not report merged-away entities as removed, but replacement does", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({ features: { a: createFeature(), b: createFeature() } }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(createDatafile({ revision: "merged", features: { a: createFeature() } }));
    sdk.setDatafile(
      createDatafile({ revision: "replaced", features: { a: createFeature() } }),
      true,
    );

    expect(events[0].features).toEqual([]);
    expect(events[0].replaced).toBe(false);
    expect(events[1].features).toEqual(["b"]);
    expect(events[1].replaced).toBe(true);
  });
});
