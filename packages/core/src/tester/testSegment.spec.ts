import type { DatafileContent, Segment, TestSegment, TestScenario } from "@featurevisor/types";
import { testSegment } from "./testSegment";
import { testVariable } from "./testVariable";
import { getTestDatafileKey } from "./datafileKey";
import { prepareSegmentEvaluations } from "./segments";

const datafile = (): DatafileContent => ({
  schemaVersion: "4",
  revision: "conditions",
  segments: {},
  features: {
    rollout: {
      bucketBy: "userId",
      traffic: [{ key: "half", conditions: "*", percentage: 50000 }],
    },
  },
  variables: { permission: { type: "boolean", defaultValue: true } },
});
const segments: Record<string, Segment> = {
  audience: { conditions: ["member", { variable: "permission", operator: "equals", value: true }] },
  member: { conditions: { feature: "rollout" } },
};
const datasource = {
  segmentExists: async (key: string) => Object.prototype.hasOwnProperty.call(segments, key),
  listSegments: async () => Object.keys(segments),
  readSegment: async (key: string) => segments[key],
} as any;

describe("SDK segment assertion evaluation", () => {
  test.each([
    [
      {},
      "No datafile without an environment. When the project configures environments, add environment to the assertion.",
    ],
    [{ environment: "production" }, 'datafile not found for environment "production"'],
    [
      { environment: "production", target: "web" },
      'datafile not found for environment "production" and target "web"',
    ],
    [{ target: "web" }, 'datafile not found for target "web"'],
  ] as Array<[{ environment?: string; target?: string }, string]>)(
    "fails an unavailable selected datafile instead of fabricating empty contents: %j",
    async (selection, message) => {
      const definitions = { audience: { conditions: { feature: "excluded", enabled: false } } };
      const result = await testSegment(
        {
          segmentExists: async () => true,
          listSegments: async () => ["audience"],
          readSegment: async () => definitions.audience,
        } as any,
        { segment: "audience", assertions: [{ ...selection, context: {}, expectedToMatch: true }] },
        { quiet: true },
        new Map([[getTestDatafileKey("other", "other"), datafile()]]),
      );
      expect(result.passed).toBe(false);
      expect(result.assertions[0].errors).toEqual([
        expect.objectContaining({
          expected: "datafile",
          message,
        }),
      ]);
    },
  );

  test.each([undefined, new Map(), new Map([[getTestDatafileKey("production"), datafile()]])])(
    "allows unscoped attribute segment tests without a matching datafile: %p",
    async (files) => {
      const ds = {
        segmentExists: async () => true,
        listSegments: async () => ["audience", "nested"],
        readSegment: async (key) =>
          key === "audience"
            ? { conditions: "nested" }
            : { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      } as any;
      const result = await testSegment(
        ds,
        {
          segment: "audience",
          assertions: [{ context: { country: "nl" }, expectedToMatch: true }],
        },
        { quiet: true },
        files,
      );
      expect(result.passed).toBe(true);
      for (const selection of [{ target: "web" }, { environment: "missing" }]) {
        const selected = await testSegment(
          ds,
          {
            segment: "audience",
            assertions: [{ ...selection, context: { country: "nl" }, expectedToMatch: true }],
          },
          { quiet: true },
          files,
        );
        expect(selected.passed).toBe(false);
        expect(selected.assertions[0].errors![0].expected).toBe("datafile");
      }
    },
  );

  test.each(["feature", "variable", "feature variable"])(
    "requires a selected datafile for a transitive %s dependency without an environment",
    async (kind) => {
      const definitions: Record<string, Segment> = {
        audience: { conditions: "nested" },
        nested: {
          conditions:
            kind === "feature"
              ? { feature: "rollout", enabled: false }
              : {
                  variable: "permission",
                  operator: "isNull",
                  ...(kind === "feature variable" ? { feature: "rollout" } : {}),
                },
        },
      };
      const result = await testSegment(
        {
          segmentExists: async () => true,
          listSegments: async () => Object.keys(definitions),
          readSegment: async (key) => definitions[key],
        } as any,
        { segment: "audience", assertions: [{ context: {}, expectedToMatch: true }] },
        { quiet: true },
        new Map(),
      );
      expect(result.passed).toBe(false);
      expect(result.assertions[0].errors![0]).toMatchObject({ expected: "datafile" });
    },
  );

  test.each(["feature", "variable", "feature variable", "through variable", "through composition"])(
    "rejects a missing transitive %s even for negative expectations and sticky assignments",
    async (kind) => {
      const definitions: Record<string, Segment> = {
        audience: { conditions: "nested" },
        nested: { conditions: "*" },
      };
      const selected = datafile();
      if (kind === "feature")
        definitions.nested.conditions = { feature: "excluded", enabled: false };
      if (kind === "variable")
        definitions.nested.conditions = { variable: "excluded", operator: "isNull" };
      if (kind === "feature variable")
        definitions.nested.conditions = {
          feature: "rollout",
          variable: "excluded",
          operator: "isNull",
        };
      if (kind === "through variable" || kind === "through composition") {
        definitions.nested.conditions = { variable: "permission", operator: "exists" };
        selected.variables!.permission =
          kind === "through variable"
            ? {
                type: "boolean",
                defaultValue: true,
                conditions: { feature: "excluded", enabled: false },
              }
            : { type: "boolean", compose: "excluded" };
      }
      const files = new Map([
        [getTestDatafileKey("production", "web"), selected],
        [
          getTestDatafileKey("production"),
          {
            ...datafile(),
            features: { ...datafile().features, excluded: datafile().features.rollout },
            variables: { excluded: { type: "boolean" as const, defaultValue: true } },
          },
        ],
      ]);
      const settings = {
        environment: "production",
        target: "web",
        context: {},
        at: 25,
        stickyFeatures: { excluded: { enabled: false } },
        stickyVariables: { excluded: null },
      };
      for (const expected of [true, false]) {
        const spec: TestScenario = {
          scenario: "target audience",
          _segments: definitions,
          assertions: [
            {
              ...settings,
              checks: [
                {
                  key: "audience",
                  or: [
                    { variable: "permission", operator: "exists" },
                    { segment: "audience", matches: expected },
                  ],
                },
              ],
            },
          ],
        };
        const observed = jest.fn();
        const result = await testVariable(spec, { quiet: true, onEvaluation: observed }, files);
        expect(result.passed).toBe(false);
        expect(result.assertions[0].errors![0]).toMatchObject({
          type: "check",
          details: { checkKey: "audience" },
        });
        expect(result.assertions[0].errors![0].message).toContain(
          "absent from the selected datafile",
        );
        expect(observed).not.toHaveBeenCalled();
        const segment = await testSegment(
          {
            segmentExists: async () => true,
            listSegments: async () => Object.keys(definitions),
            readSegment: async (key) => definitions[key],
          } as any,
          { segment: "audience", assertions: [{ ...settings, expectedToMatch: expected }] },
          { quiet: true },
          files,
        );
        expect(segment.passed).toBe(false);
        expect(segment.assertions[0].errors![0].message).toContain(
          "absent from the selected datafile",
        );
      }
    },
  );
  test("does not clone or augment a datafile without segment checks", () => {
    const original = datafile();
    expect(prepareSegmentEvaluations(original).datafile).toBe(original);
  });

  test("compiles authored variable paths for namespaced segment assertions and checks without mutation", async () => {
    const authored: Record<string, Segment> = {
      "audiences/checkout": {
        conditions: [
          "audiences/member",
          { variable: "policies/checkout", path: "object.limit", operator: "equals", value: 5 },
          {
            feature: "experiments/rollout",
            variable: "settings",
            path: "nested.limit",
            operator: "equals",
            value: 5,
          },
        ],
      },
      "audiences/member": { conditions: { feature: "experiments/rollout" } },
    };
    const original = datafile();
    original.features["experiments/rollout"] = {
      ...original.features.rollout,
      variablesSchema: { settings: { type: "object", defaultValue: { nested: { limit: 5 } } } },
    };
    original.variables!["policies/checkout"] = {
      type: "object",
      defaultValue: { object: { limit: 5 } },
    };
    const before = JSON.stringify({ authored, original });
    const assertion = { environment: "production", target: "web", context: {} };
    const assertions: TestSegment["assertions"] = [
      { ...assertion, at: 25, expectedToMatch: true },
      { ...assertion, at: 75, expectedToMatch: false },
      {
        ...assertion,
        at: 75,
        stickyFeatures: { "experiments/rollout": { enabled: true } },
        expectedToMatch: true,
      },
      {
        ...assertion,
        at: 25,
        stickyVariables: { "policies/checkout": { object: { limit: 9 } } },
        expectedToMatch: false,
      },
    ];
    const files = new Map([[getTestDatafileKey("production", "web"), original]]);
    const result = await testSegment(
      {
        listSegments: async () => Object.keys(authored),
        segmentExists: async () => true,
        readSegment: async (key) => authored[key],
      } as any,
      { segment: "audiences/checkout", assertions },
      { quiet: true },
      files,
    );
    expect(result.assertions.flatMap((entry) => entry.errors || [])).toEqual([]);
    expect(result.passed).toBe(true);
    const scenario: TestScenario = {
      scenario: "journeys/checkout",
      _segments: authored,
      assertions: assertions.map(({ expectedToMatch, ...settings }) => ({
        ...settings,
        checks: [{ segment: "audiences/checkout", matches: expectedToMatch }],
      })),
    };
    const checked = await testVariable(scenario, { quiet: true }, files);
    expect(checked.assertions.flatMap((entry) => entry.errors || [])).toEqual([]);
    expect(checked.passed).toBe(true);
    expect(JSON.stringify({ authored, original })).toBe(before);
    const compiled = prepareSegmentEvaluations(original, authored).datafile.segments[
      "audiences/checkout"
    ].conditions;
    expect(compiled).toMatchObject([
      "audiences/member",
      { path: ["object", "limit"] },
      { path: ["nested", "limit"] },
    ]);
  });
  test("uses environment datafiles and inherited bucket modules before dependency reads", async () => {
    const onEvaluation = jest.fn();
    const original = datafile();
    const before = JSON.stringify(original);
    const spec: TestSegment = {
      segment: "audience",
      assertions: [
        { environment: "production", at: 25, expectedToMatch: true, context: {} },
        { environment: "production", at: 75, expectedToMatch: false, context: {} },
        {
          environment: "production",
          at: 75,
          stickyFeatures: { rollout: { enabled: true } },
          expectedToMatch: true,
          context: {},
        },
        {
          environment: "production",
          at: 25,
          stickyVariables: { permission: false },
          expectedToMatch: false,
          context: {},
        },
      ],
    };
    const result = await testSegment(
      datasource,
      spec,
      { quiet: true, onEvaluation },
      new Map([[getTestDatafileKey("production"), original]]),
    );
    expect(result.passed).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    expect(onEvaluation.mock.calls.length).toBeGreaterThan(0);
    expect(
      onEvaluation.mock.calls.every(
        ([evaluation]) => !evaluation.featureKey?.startsWith("__featurevisor_segment_test__"),
      ),
    ).toBe(true);
    expect(result.key).toBe("audience");
  });

  test("preserves compiled segments while restoring missing authored segments", async () => {
    const original = datafile();
    original.segments.member = {
      conditions: { attribute: "country", operator: "equals", value: "never" },
    };
    const result = await testSegment(
      datasource,
      {
        segment: "audience",
        assertions: [{ at: 25, context: {}, expectedToMatch: false }],
      },
      { quiet: true },
      new Map([[getTestDatafileKey(), original]]),
    );
    expect(result.passed).toBe(true);
    expect(original.segments.member.conditions).toHaveProperty("attribute", "country");
  });

  test.each([true, false])(
    "keeps Target segment specialization authoritative: %s",
    async (matched) => {
      const authored: Record<string, Segment> = {
        audience: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      };
      const selected = datafile();
      selected.segments.audience = { conditions: matched ? "*" : [] };
      const before = JSON.stringify({ authored, selected });
      const files = new Map([[getTestDatafileKey("production", "web"), selected]]);
      const assertions: TestSegment["assertions"] = [{}, { country: "us" }].map((context) => ({
        environment: "production",
        target: "web",
        context,
        expectedToMatch: matched,
      }));
      const result = await testSegment(
        {
          segmentExists: async () => true,
          listSegments: async () => Object.keys(authored),
          readSegment: async (key) => authored[key],
        } as any,
        { segment: "audience", assertions },
        { quiet: true },
        files,
      );
      expect(result.assertions.flatMap((entry) => entry.errors || [])).toEqual([]);
      expect(result.passed).toBe(true);
      const checked = await testVariable(
        {
          scenario: "target context",
          _segments: authored,
          assertions: assertions.map(({ expectedToMatch, ...settings }) => ({
            ...settings,
            checks: [{ segment: "audience", matches: expectedToMatch }],
          })),
        },
        { quiet: true },
        files,
      );
      expect(checked.assertions.flatMap((entry) => entry.errors || [])).toEqual([]);
      expect(checked.passed).toBe(true);
      expect(prepareSegmentEvaluations(selected, authored).datafile.segments.audience).toBe(
        selected.segments.audience,
      );
      expect(JSON.stringify({ authored, selected })).toBe(before);
    },
  );

  test("a runtime cycle is an assertion error even when false was expected", async () => {
    const cyclic = { loop: { conditions: "loop" } };
    const result = await testSegment(
      {
        segmentExists: async () => true,
        listSegments: async () => ["loop"],
        readSegment: async () => cyclic.loop,
      } as any,
      { segment: "loop", assertions: [{ context: {}, expectedToMatch: false }] },
      { quiet: true },
    );
    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors?.[0].message).toMatch(/evaluation/i);
  });

  test("segment checks inherit parent and child stickies, environment and at", async () => {
    const spec: TestScenario = {
      scenario: "audience",
      _segments: segments,
      assertions: [
        {
          environment: "production",
          at: 75,
          stickyFeatures: { rollout: { enabled: true } },
          checks: [{ segment: "audience", matches: true }],
          children: [
            {
              stickyVariables: { permission: false },
              checks: [{ segment: "audience", matches: false }],
            },
            {
              stickyFeatures: { rollout: { enabled: false } },
              checks: [{ segment: "audience", matches: false }],
            },
            { context: {}, checks: [{ segment: "audience", matches: false }] },
            {
              stickyFeatures: { rollout: { enabled: true } },
              checks: [{ segment: "audience", matches: true }],
            },
          ],
        },
      ],
    };
    const result = await testVariable(
      spec,
      { quiet: true },
      new Map([[getTestDatafileKey("production"), datafile()]]),
    );
    expect(result.assertions[0].errors).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
