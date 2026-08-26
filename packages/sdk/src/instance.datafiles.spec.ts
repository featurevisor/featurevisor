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
    expect(Object.keys(sdk.getFeatureEvaluations()).sort()).toEqual(["mobile", "server", "web"]);
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
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "info",
      onDiagnostic: (item) => diagnostics.push(item),
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
        variables: [],
        replaced: false,
      },
    ]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        level: "info",
        code: "datafile_set",
        details: {
          revision: "two",
          previousRevision: "one",
          revisionChanged: true,
          features: ["changed", "added"],
          variables: [],
          replaced: false,
        },
      }),
    );
  });

  it("does not report merged-away entities as removed, but replacement does", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        features: {
          a: createFeature({ hash: "a" }),
          b: createFeature({ hash: "b" }),
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({ revision: "merged", features: { a: createFeature({ hash: "a" }) } }),
    );
    sdk.setDatafile(
      createDatafile({ revision: "replaced", features: { a: createFeature({ hash: "a" }) } }),
      true,
    );

    expect(events[0].features).toEqual([]);
    expect(events[0].replaced).toBe(false);
    expect(events[1].features).toEqual(["b"]);
    expect(events[1].replaced).toBe(true);
  });

  it("reports transitive feature and global variable dependencies after a partial segment merge", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        segments: {
          audience: {
            conditions: { attribute: "country", operator: "equals", value: "nl" },
          },
          unrelated: { conditions: "*" },
        },
        features: {
          direct: createFeature({
            hash: "direct",
            traffic: [
              {
                key: "direct",
                segments: JSON.stringify({ and: ["audience"] }) as never,
                percentage: 100000,
                allocation: [],
              },
            ],
          }),
          indirect: createFeature({ hash: "indirect", required: ["direct"] }),
          transitive: createFeature({ hash: "transitive", required: ["indirect"] }),
          unrelated: createFeature({ hash: "unrelated" }),
        },
        variables: {
          bySegment: {
            hash: "by-segment",
            type: "string",
            defaultValue: "default",
            overrides: [
              {
                key: "audience",
                segments: JSON.stringify({ or: ["audience"] }),
                value: "matched",
              },
            ],
          },
          byFeature: {
            hash: "by-feature",
            type: "string",
            defaultValue: "default",
            requiredFeatures: ["transitive"],
          },
          unrelated: { hash: "unrelated", type: "string", defaultValue: "default" },
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({
        revision: "segment-update",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "de" } },
        },
      }),
    );

    expect(events[0]).toEqual({
      revision: "segment-update",
      previousRevision: "revision-1",
      revisionChanged: true,
      features: ["direct", "indirect", "transitive"],
      variables: ["bySegment", "byFeature"],
      replaced: false,
    });
  });

  it("indexes segment dependencies in traffic and variation variable overrides", () => {
    const events: any[] = [];
    const segmentOverride = { segments: "audience", value: "matched" };
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        segments: { audience: { conditions: "*" } },
        features: {
          trafficOverride: createFeature({
            hash: "traffic",
            variablesSchema: { copy: { type: "string", defaultValue: "default" } },
            traffic: [
              {
                key: "all",
                segments: "*",
                percentage: 100000,
                allocation: [],
                variableOverrides: { copy: [segmentOverride] },
              },
            ],
          }),
          variationOverride: createFeature({
            hash: "variation",
            variations: [
              {
                value: "control",
                variableOverrides: { copy: [segmentOverride] },
              },
            ],
          }),
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({
        revision: "changed",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        },
      }),
    );

    expect(events[0].features).toEqual(["trafficOverride", "variationOverride"]);
  });

  it("propagates a partial feature change through required features and variables", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        features: {
          prerequisite: createFeature({ hash: "old" }),
          dependent: createFeature({ hash: "dependent", required: ["prerequisite"] }),
          transitive: createFeature({ hash: "transitive", required: ["dependent"] }),
        },
        variables: {
          message: {
            hash: "message",
            type: "string",
            defaultValue: "default",
            overrides: [
              {
                key: "required",
                requiredFeatures: ["transitive"],
                value: "matched",
              },
            ],
          },
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({
        revision: "feature-update",
        features: { prerequisite: createFeature({ hash: "new" }) },
      }),
    );

    expect(events[0].features).toEqual(["prerequisite", "dependent", "transitive"]);
    expect(events[0].variables).toEqual(["message"]);
  });

  it("terminates dependency propagation defensively when datafile requirements are cyclic", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        features: {
          a: createFeature({ hash: "a", required: ["b"] }),
          b: createFeature({ hash: "b", required: ["a"] }),
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    sdk.setDatafile(
      createDatafile({ revision: "changed", features: { a: createFeature({ hash: "new" }) } }),
    );

    expect(events[0].features).toEqual(["a", "b"]);
  });

  it("rebuilds a cached index after a variable dependency definition changes", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        segments: { audience: { conditions: "*" } },
        features: {
          checkout: createFeature({
            hash: "checkout",
            traffic: [
              {
                key: "audience",
                segments: "audience",
                percentage: 100000,
                allocation: [],
              },
            ],
          }),
        },
        variables: {
          message: { hash: "message-1", type: "string", defaultValue: "default" },
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    // Populate the lazy index.
    sdk.setDatafile(
      createDatafile({
        revision: "segment-1",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        },
      }),
    );
    // Change only the variable dependency definition, which invalidates the index.
    sdk.setDatafile(
      createDatafile({
        revision: "variable",
        variables: {
          message: {
            hash: "message-2",
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "audience", segments: "audience", value: "matched" }],
          },
        },
      }),
    );
    sdk.setDatafile(
      createDatafile({
        revision: "segment-2",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "de" } },
        },
      }),
    );

    expect(events[2].features).toEqual(["checkout"]);
    expect(events[2].variables).toEqual(["message"]);
  });

  it("does not retain dependency entries across a complete replacement", () => {
    const events: any[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        segments: { audience: { conditions: "*" } },
        features: {
          old: createFeature({
            hash: "old",
            traffic: [
              {
                key: "audience",
                segments: "audience",
                percentage: 100000,
                allocation: [],
              },
            ],
          }),
        },
      }),
    });
    sdk.on("datafile_set", (event) => events.push(event));

    // Populate the lazy index, then replace the complete datafile.
    sdk.setDatafile(
      createDatafile({
        revision: "segment",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        },
      }),
    );
    sdk.setDatafile(
      createDatafile({
        revision: "replacement",
        segments: { audience: { conditions: "*" } },
        features: { next: createFeature({ hash: "next" }) },
      }),
      true,
    );
    sdk.setDatafile(
      createDatafile({
        revision: "after-replacement",
        segments: {
          audience: { conditions: { attribute: "country", operator: "equals", value: "de" } },
        },
      }),
    );

    expect(events[2].features).toEqual([]);
    expect(events[2].variables).toEqual([]);
  });
});
