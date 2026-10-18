import type {
  Context,
  Condition,
  DatafileVariable,
  OrdinaryDatafileVariable,
} from "@featurevisor/types";
import { createFeaturevisor, type Featurevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";
import type { EvaluationOptions, EvaluateOptions } from "./evaluate";
import type { DependencyOf } from "./session";

const requirement = (variable: string, value: number = 1): Condition => ({
  variable,
  operator: "equals",
  value,
});
const variable = (conditions?: Condition[]): OrdinaryDatafileVariable => ({
  type: "integer",
  defaultValue: 1,
  disabledValue: 0,
  conditions,
});

describe("request evaluation sessions", () => {
  // A deterministic complexity guard: a timing ratio can hide traversal on fast
  // machines or fail under unrelated CI load. Enumeration is never necessary.
  test.each([0, 100, 1000, 5000])(
    "sticky handoffs never enumerate %i unrelated entries",
    (size) => {
      const features = Object.fromEntries(
        Array.from({ length: Math.max(1, size) }, (_, index) => [
          `feature${index}`,
          createFeature(),
        ]),
      );
      const datafile = createDatafile({
        features,
        variables: {
          root: {
            ...variable([requirement("leaf"), requirement("leaf")]),
            requiredFeatures: ["feature0"],
          },
          leaf: variable(),
        },
      });
      const server = createFeaturevisor({ datafile });
      const ownKeys = jest.fn(() => {
        throw new Error("Sticky maps must not be enumerated during evaluation");
      });
      const stickyFeatures = new Proxy(size ? server.getFeatureEvaluations() : {}, { ownKeys });
      const stickyVariables = new Proxy(
        Object.fromEntries([
          ...[...Array(size)].map((_, index) => [`unused${index}`, index]),
          ["leaf", 1],
        ]),
        { ownKeys },
      );
      for (const child of [false, true]) {
        let reads = 0;
        const f = createFeaturevisor({
          datafile,
          ...(child ? {} : { stickyFeatures, stickyVariables }),
          modules: [
            {
              afterEvaluation(e) {
                if (e.variableKey === "leaf") reads++;
                return e;
              },
            },
          ],
        });
        const consumer = child ? f.spawn({}, { stickyFeatures, stickyVariables }) : f;
        expect(consumer.getVariable("root")).toBe(1);
        expect(reads).toBe(1);
        expect(ownKeys).not.toHaveBeenCalled();
        consumer.close();
        if (child) f.close();
      }
      server.close();
    },
  );

  test("module replacement of a sticky map invalidates a completed prerequisite", () => {
    let rootOptions: EvaluateOptions;
    let reads = 0;
    const f = createFeaturevisor({
      stickyVariables: { leaf: 1 },
      datafile: createDatafile({
        features: {
          root: createFeature({
            conditions: [requirement("leaf"), requirement("mutator"), requirement("leaf", 2)],
          }),
        },
        variables: {
          leaf: variable(),
          mutator: variable(),
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if ("featureKey" in o && o.featureKey === "root") rootOptions = o;
            return o;
          },
          afterEvaluation(e) {
            if (e.variableKey === "leaf") reads++;
            if (e.variableKey === "mutator") rootOptions.stickyVariables = { leaf: 2 };
            return e;
          },
        },
      ],
    });
    expect(f.isEnabled("root")).toBe(true);
    expect(reads).toBe(2);
  });

  test.each(["flag", "variation"])(
    "shared feature %s reads honour the immediate requester",
    (type) => {
      const left =
        type === "flag"
          ? { feature: "leaf", enabled: true }
          : { feature: "leaf", variation: "left" };
      const right =
        type === "flag"
          ? { feature: "leaf", enabled: false }
          : { feature: "leaf", variation: "right" };
      const reads: string[] = [];
      const f = createFeaturevisor({
        datafile: createDatafile({
          features: {
            root: createFeature({ requiredFeatures: ["left", "right", "left", "right"] }),
            left: createFeature({ requiredFeatures: [left, left] }),
            right: createFeature({ requiredFeatures: [right, right] }),
            leaf: createFeature({
              variations: [{ value: "left" }, { value: "right" }],
              traffic: [{ key: "all", segments: "*", percentage: 100000, variation: "left" }],
            }),
          },
        }),
        modules: [
          {
            afterEvaluation(e, o) {
              if (e.featureKey === "leaf" && e.type === type && o.dependencyOf) {
                const parent = o.dependencyOf.featureKey!;
                reads.push(parent);
                return type === "flag"
                  ? { ...e, enabled: parent === "left" }
                  : { ...e, variationValue: parent };
              }
              return e;
            },
          },
        ],
      });
      expect(f.isEnabled("root")).toBe(true);
      expect(reads).toEqual(["left", "right"]);
    },
  );

  test.each([
    ["object key order", { a: 1, b: 2 }, { b: 2, a: 1 }, 1],
    ["nested arrays", { items: [1, { x: null }] }, { items: [1, { x: null }] }, 1],
    ["equal sparse arrays", { items: new Array(1) }, { items: new Array(1) }, 1],
    ["sparse and explicit undefined", { items: new Array(1) }, { items: [undefined] }, 2],
    ["explicit undefined and sparse", { items: [undefined] }, { items: new Array(1) }, 2],
    ["array contents", { items: [1, 2] }, { items: [1, 3] }, 2],
    ["array lengths", { items: [1] }, { items: [1, 2] }, 2],
    ["array and object", { items: [] }, { items: {} }, 2],
    ["missing and undefined", {}, { missing: undefined }, 2],
    ["same sized different keys", { a: 1 }, { b: 1 }, 2],
    ["null and object", { value: null }, { value: {} }, 2],
    ["negative zero", { value: 0 }, { value: -0 }, 2],
    ["host object", { value: {} }, { value: new Map() }, 3],
    ["invalid Date", { at: new Date("2026-01-01") }, { at: new Date(NaN) }, 3],
    [
      "throwing host object",
      { value: {} },
      {
        value: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("unsupported");
            },
          },
        ),
      },
      3,
    ],
  ] as [string, Context, Context, number][])(
    "compares snapshot contents safely: %s",
    (_name, first, second, expectedReads) => {
      let reads = 0;
      const f = createFeaturevisor({
        context: { payload: first },
        datafile: createDatafile({
          variables: {
            root: variable([
              requirement("leaf"),
              requirement("mutator"),
              requirement("leaf"),
              requirement("leaf"),
            ]),
            mutator: variable(),
            leaf: variable(),
          },
        }),
        modules: [
          {
            beforeEvaluation(o) {
              if (o.variableKey === "leaf") reads++;
              return o;
            },
            afterEvaluation(e, o) {
              if (e.variableKey === "mutator") o.context.payload = second;
              return e;
            },
          },
        ],
      });
      expect(f.getVariable("root")).toBe(1);
      expect(reads).toBe(expectedReads);
    },
  );

  test.each(["before", "after"])(
    "%s hooks may transform a shared leaf differently for each immediate requester",
    (phase) => {
      for (const kind of ["feature", "variable"]) {
        const leftRequirements = [requirement("leaf", 1), requirement("leaf", 1)];
        const rightRequirements = [requirement("leaf", 2), requirement("leaf", 2)];
        const markers: DependencyOf[] = [];
        const f = createFeaturevisor({
          datafile: createDatafile({
            features: {
              left: createFeature({ conditions: leftRequirements }),
              right: createFeature({ conditions: rightRequirements }),
            },
            variables: {
              root:
                kind === "feature"
                  ? { ...variable(), requiredFeatures: ["left", "right", "left", "right"] }
                  : variable([
                      requirement("left"),
                      requirement("right"),
                      requirement("left"),
                      requirement("right"),
                    ]),
              left: variable(leftRequirements),
              right: variable(rightRequirements),
              leaf: { type: "integer", defaultValue: 0 },
              one: { type: "integer", defaultValue: 1 },
              two: { type: "integer", defaultValue: 2 },
            },
          }),
          modules: [
            {
              beforeEvaluation(o) {
                if (o.variableKey === "leaf" && o.dependencyOf) {
                  markers.push(o.dependencyOf);
                  const parent = o.dependencyOf.featureKey || o.dependencyOf.variableKey;
                  if (phase === "before")
                    return { ...o, variableKey: parent === "left" ? "one" : "two" };
                }
                return o;
              },
              afterEvaluation(e, o) {
                if (phase === "after" && e.variableKey === "leaf" && o.dependencyOf) {
                  const parent = o.dependencyOf.featureKey || o.dependencyOf.variableKey;
                  return { ...e, variableValue: parent === "left" ? 1 : 2 };
                }
                return e;
              },
            },
          ],
        });
        expect(f.getVariable("root")).toBe(1);
        expect(f.getVariable("leaf")).toBe(0);
        expect(markers).toEqual(
          kind === "feature"
            ? [
                { type: "flag", featureKey: "left" },
                { type: "flag", featureKey: "right" },
              ]
            : [
                { type: "variable", variableKey: "left" },
                { type: "variable", variableKey: "right" },
              ],
        );
      }
    },
  );

  test.each(["feature", "variable"])(
    "requester aware %s diamonds are bounded by distinct edges",
    (kind) => {
      const depth = 18;
      const d = createDatafile({ variables: {}, features: {} });
      const add = (key: string, dependencies: string[]) => {
        if (kind === "feature") d.features[key] = createFeature({ requiredFeatures: dependencies });
        else
          d.variables![key] = variable(
            dependencies.length ? dependencies.map((key) => requirement(key)) : undefined,
          );
      };
      add("leafA", []);
      add("leafB", []);
      let previous = ["leafA", "leafB"];
      for (let level = 0; level < depth; level++) {
        const next = [`a${level}`, `b${level}`];
        next.forEach((key) => add(key, previous.concat(previous)));
        previous = next;
      }
      add("root", previous.concat(previous));
      const before = jest.fn((o: EvaluationOptions) => o);
      const after = jest.fn((e) => e);
      const f = createFeaturevisor({
        datafile: d,
        modules: [{ beforeEvaluation: before as never, afterEvaluation: after }],
      });
      expect(kind === "feature" ? f.isEnabled("root") : f.getVariable("root")).toBe(
        kind === "feature" ? true : 1,
      );
      const distinctEdges = 2 + 4 * depth;
      expect(before).toHaveBeenCalledTimes(1 + distinctEdges);
      expect(after).toHaveBeenCalledTimes(1 + distinctEdges);
    },
  );

  test("module context replacement is memoised using the incoming dependency context", () => {
    let reads = 0;
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([requirement("leaf", 2), requirement("leaf", 2)]),
          leaf: variable(),
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "leaf") {
              reads++;
              return { ...o, context: { value: 2 } };
            }
            return o;
          },
          afterEvaluation(e, o) {
            return e.variableKey === "leaf"
              ? { ...e, variableValue: o.context.value as number }
              : e;
          },
        },
      ],
    });
    expect(f.getVariable("root", { value: 1 })).toBe(1);
    expect(reads).toBe(1);
  });

  test("filling a sparse context slot with undefined invalidates the previous operand", () => {
    let reads = 0;
    const f = createFeaturevisor({
      context: { items: new Array(1) },
      datafile: createDatafile({
        variables: {
          root: variable([requirement("leaf", 0), requirement("mutator"), requirement("leaf", 1)]),
          leaf: variable(),
          mutator: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e, o) {
            if (e.variableKey === "mutator") (o.context.items as unknown[])[0] = undefined;
            if (e.variableKey === "leaf") {
              reads++;
              return {
                ...e,
                variableValue: Object.prototype.hasOwnProperty.call(o.context.items, 0) ? 1 : 0,
              };
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test("root and dependency key transformations preserve requester metadata and cycle checks", () => {
    const markers: (DependencyOf | undefined)[] = [];
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        variables: {
          actual: variable([requirement("alias"), requirement("alias")]),
          leaf: variable(),
          cycle: variable([requirement("alias")]),
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "root") return { ...o, variableKey: "actual" };
            if (o.variableKey === "alias") {
              markers.push(o.dependencyOf);
              return { ...o, variableKey: o.context.cycle ? "cycle" : "leaf" };
            }
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(markers).toEqual([{ type: "variable", variableKey: "actual" }]);
    expect(f.evaluateVariable("root", { cycle: true }).reason).toBe("error");
  });

  test.each([false, true])(
    "retains the original root identity through module redirects (in place: %s)",
    (inPlace) => {
      for (const kind of ["global", "flag"]) {
        const seen: string[] = [];
        const f = createFeaturevisor({
          logLevel: "fatal",
          datafile: createDatafile({
            variables: {
              a: variable(),
              b: variable([requirement("a")]),
              c: variable(),
            },
            features: {
              a: createFeature(),
              b: createFeature({ requiredFeatures: ["a"] }),
              c: createFeature(),
            },
          }),
          modules: [
            {
              beforeEvaluation(o) {
                const key = "featureKey" in o ? "featureKey" : "variableKey";
                const current = "featureKey" in o ? o.featureKey : o.variableKey;
                seen.push(current!);
                if (current !== "a") return o;
                const redirected = o.dependencyOf ? "c" : "b";
                if (inPlace) {
                  if ("featureKey" in o) o.featureKey = redirected;
                  else o.variableKey = redirected;
                  return o;
                }
                return { ...o, [key]: redirected };
              },
            },
          ],
        });
        const result = kind === "global" ? f.evaluateVariable("a") : f.evaluateFlag("a");
        expect(result.reason).toBe("error");
        expect(result.error?.message).toContain("Circular");
        expect(seen).toEqual(["a"]);
      }
    },
  );

  test.each([false, true])(
    "releases all retained module option aliases on completion (throws: %s)",
    (throws) => {
      const associations = jest.spyOn(WeakMap.prototype, "set");
      const retained: object[] = [];
      try {
        const f = createFeaturevisor({
          logLevel: "fatal",
          datafile: createDatafile({
            features: { flag: createFeature({ conditions: [requirement("root")] }) },
            variables: {
              root: variable([requirement("leaf"), requirement("leaf")]),
              leaf: variable(),
            },
          }),
          modules: [
            {
              beforeEvaluation(o) {
                retained.push(o);
                const replacement = { ...o };
                retained.push(replacement);
                if (o.type === "variable" && !("featureKey" in o)) {
                  expect(Object.keys(o).sort()).toEqual(
                    [
                      "context",
                      "defaultVariableValue",
                      ...(o.dependencyOf ? ["dependencyOf", "dependencyPurpose"] : []),
                      "type",
                      "variableKey",
                    ].sort(),
                  );
                }
                return replacement;
              },
            },
            {
              beforeEvaluation(o) {
                if (throws && o.variableKey === "leaf") throw new Error("failed");
                return o;
              },
            },
          ],
        });
        f.getVariable("root");
        f.isEnabled("flag");
        let checked = 0;
        associations.mock.calls.forEach(([key], index) => {
          if (retained.indexOf(key) !== -1) {
            expect(associations.mock.contexts[index].has(key)).toBe(false);
            checked++;
          }
        });
        expect(checked).toBeGreaterThan(0);
      } finally {
        associations.mockRestore();
      }
    },
  );

  test.each([{}, { at: new Date("2026-01-01") }])(
    "memoises variable diamonds with context %j",
    (context) => {
      const variables: Record<string, DatafileVariable> = { leaf: variable() };
      let previous = "leaf";
      for (let i = 0; i < 18; i++) {
        variables[`level${i}`] = variable([requirement(previous), requirement(previous)]);
        previous = `level${i}`;
      }
      const before = jest.fn((o: EvaluationOptions) => o);
      const after = jest.fn((e) => e);
      const f = createFeaturevisor({
        datafile: createDatafile({ variables }),
        context,
        modules: [{ beforeEvaluation: before as never, afterEvaluation: after }],
      });
      expect(f.getVariable(previous)).toBe(1);
      expect(before).toHaveBeenCalledTimes(19);
      expect(after).toHaveBeenCalledTimes(19);
      expect(f.getVariable(previous)).toBe(1);
      expect(before).toHaveBeenCalledTimes(38);
    },
  );

  test("memoises feature diamonds and exposes only the immediate requester", () => {
    const d = createDatafile({ features: { leaf: createFeature() } });
    let previous = "leaf";
    for (let i = 0; i < 18; i++) {
      d.features[`level${i}`] = createFeature({ requiredFeatures: [previous, previous] });
      previous = `level${i}`;
    }
    const seen: [string, DependencyOf | undefined][] = [];
    const f = createFeaturevisor({
      datafile: d,
      modules: [
        {
          beforeEvaluation(o) {
            seen.push(["featureKey" in o ? o.featureKey : "", o.dependencyOf]);
            return { ...o };
          },
        },
      ],
    });
    expect(f.isEnabled(previous)).toBe(true);
    expect(seen).toHaveLength(19);
    expect(seen[0]).toEqual(["level17", undefined]);
    expect(seen[1]).toEqual(["level16", { type: "flag", featureKey: "level17" }]);
    expect(seen[18]).toEqual(["leaf", { type: "flag", featureKey: "level0" }]);
  });

  test("distinguishes flags, variations, feature variables and global variables", () => {
    const seen: [string, DependencyOf | undefined][] = [];
    const f = createFeaturevisor({
      datafile: createDatafile({
        features: {
          source: createFeature({
            variations: [{ value: "on" }],
            traffic: [{ key: "all", segments: "*", percentage: 100000, variation: "on" }],
            variablesSchema: { source: { type: "integer", defaultValue: 2 } },
          }),
        },
        variables: {
          source: variable(),
          root: {
            ...variable([
              requirement("source"),
              { feature: "source", variable: "source", operator: "equals", value: 2 },
              requirement("source"),
            ]),
            requiredFeatures: [
              { feature: "source", variation: "on" },
              { feature: "source", variation: "on" },
            ],
          },
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            seen.push([
              `${o.type}/${"featureKey" in o ? o.featureKey : ""}/${o.variableKey || ""}`,
              o.dependencyOf,
            ]);
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(seen).toHaveLength(5);
    expect(seen.slice(1).map((entry) => entry[1])).toEqual(
      Array(4).fill({ type: "variable", variableKey: "root" }),
    );
    expect(new Set(seen.map((entry) => entry[0])).size).toBe(5);
  });

  test.each(["global", "flag", "variation", "featureVariable"])(
    "guards root and nested %s cycles",
    (kind) => {
      const d = createDatafile({
        variables: {
          root: variable([{ not: [{ variable: "root", operator: "isNull" }] }]),
          outer: variable([{ not: [{ variable: "root", operator: "isNull" }] }]),
        },
        features: {
          root: createFeature({
            requiredFeatures: [{ not: ["root"] }],
            variablesSchema: { value: { type: "integer", defaultValue: 1 } },
          }),
          outer: createFeature({
            requiredFeatures: [{ feature: "root", enabled: false }],
            variablesSchema: { value: { type: "integer", defaultValue: 1 } },
          }),
        },
      });
      const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
      for (const key of ["root", "outer"]) {
        const result =
          kind === "global"
            ? f.evaluateVariable(key)
            : kind === "flag"
              ? f.evaluateFlag(key)
              : kind === "variation"
                ? f.evaluateVariation(key)
                : f.evaluateVariable(key, "value");
        expect(result.reason).toBe("error");
        expect(result.error?.message).toContain("Circular");
      }
    },
  );

  test("feature variable cycles include the requested variable, not every variable in that feature", () => {
    const d = createDatafile({
      features: {
        source: createFeature({
          variablesSchema: {
            a: { type: "integer", defaultValue: 1 },
            b: { type: "integer", defaultValue: 2 },
          },
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              variableOverrides: {
                a: [
                  {
                    conditions: [
                      { feature: "source", variable: "b", operator: "equals", value: 2 },
                    ],
                    value: 3,
                  },
                ],
              },
            },
          ],
        }),
      },
    });
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.getVariable("source", "a")).toBe(3);
    d.features.source.traffic[0].variableOverrides!.b = [
      {
        conditions: [{ feature: "source", variable: "a", operator: "isNull" }],
        value: 2,
      },
    ];
    f.setDatafile(d);
    expect(f.evaluateVariable("source", "a").reason).toBe("error");
  });

  test("reentrant public calls have independent sessions and no dependency marker", () => {
    let f: Featurevisor;
    let reentrant = false;
    let reads = 0;
    const markers: (DependencyOf | undefined)[] = [];
    f = createFeaturevisor({
      datafile: createDatafile({
        variables: { root: variable([requirement("leaf"), requirement("leaf")]), leaf: variable() },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "root") markers.push(o.dependencyOf);
            if (o.variableKey === "leaf") {
              reads++;
              if (!reentrant) {
                reentrant = true;
                expect(f.getVariable("root")).toBe(1);
                reentrant = false;
              }
            }
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
    expect(markers).toEqual([undefined, undefined]);
  });

  test("memoises genuine getter nulls and false results from failing modules", () => {
    const before = jest.fn((o: EvaluationOptions) => {
      if (("featureKey" in o && o.featureKey === "broken") || o.variableKey === "broken")
        throw new Error("module failed");
      return o;
    });
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        variables: {
          root: {
            ...variable([
              { variable: "broken", operator: "isNull" },
              { variable: "broken", operator: "isNull" },
            ]),
            requiredFeatures: [{ feature: "broken", enabled: false }, { not: ["broken"] }],
          },
        },
      }),
      modules: [{ beforeEvaluation: before as never }],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(before).toHaveBeenCalledTimes(3);
  });

  test("keeps missing getters, null and missing paths distinct without leaking outer defaults", () => {
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          nil: { type: "object", defaultValue: null },
          object: { type: "object", defaultValue: {} },
          root: variable([
            { variable: "missing", operator: "isNull" },
            { variable: "nil", operator: "isNull" },
            { variable: "object", path: ["missing"], operator: "notExists" },
            { variable: "missing", operator: "isNull" },
          ]),
        },
      }),
    });
    expect(f.getVariable("root", {}, { defaultVariableValue: "outer" })).toBe(1);
  });

  test.each(["__proto__", "constructor", "prototype"])(
    "nested unsafe path %s cannot pass NOT",
    (part) => {
      const f = createFeaturevisor({
        logLevel: "fatal",
        datafile: createDatafile({
          variables: {
            root: variable([{ not: [{ variable: "invalid", operator: "notNull" }] }]),
            invalid: variable([{ variable: "leaf", path: [part], operator: "notExists" }]),
            leaf: { type: "object", defaultValue: {} },
          },
        }),
      });
      expect(f.evaluateVariable("root").reason).toBe("error");
    },
  );

  test.each([false, true])(
    "does not conflate transformed nested contexts (in place: %s)",
    (inPlace) => {
      let leafReads = 0;
      const f = createFeaturevisor({
        context: { original: "must disappear" },
        datafile: createDatafile({
          variables: {
            leaf: variable(),
            a: variable([requirement("leaf", 1)]),
            b: variable([requirement("leaf", 2)]),
            root: variable([requirement("a"), requirement("b")]),
          },
        }),
        modules: [
          {
            beforeEvaluation(o) {
              if (o.variableKey === "root") return { ...o, context: { nested: { value: 0 } } };
              if (o.variableKey === "a" || o.variableKey === "b") {
                const value = o.variableKey === "a" ? 1 : 2;
                if (inPlace) (o.context.nested as { value: number }).value = value;
                else return { ...o, context: { nested: { value } } };
              }
              return o;
            },
            afterEvaluation(e, o) {
              if (o.variableKey === "leaf") {
                leafReads++;
                expect(o.context.original).toBeUndefined();
                return { ...e, variableValue: (o.context.nested as { value: number }).value };
              }
              return e;
            },
          },
        ],
      });
      expect(f.getVariable("root")).toBe(1);
      expect(leafReads).toBe(2);
    },
  );

  test("snapshots results so a later module cannot mutate an earlier memo entry", () => {
    const result = { nested: { value: 1 } };
    let reads = 0;
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([
            { variable: "leaf", path: ["nested", "value"], operator: "equals", value: 1 },
            requirement("mutator"),
            { variable: "leaf", path: ["nested", "value"], operator: "equals", value: 1 },
          ]),
          leaf: { type: "object", defaultValue: {} },
          mutator: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e) {
            if (e.variableKey === "leaf") {
              reads++;
              return { ...e, variableValue: result };
            }
            if (e.variableKey === "mutator") result.nested.value = 2;
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(1);
    expect(result.nested.value).toBe(2);
  });

  test.each(["datafile", "sticky", "childSticky", "modules", "context"])(
    "state changes during hooks invalidate %s memo entries",
    (state) => {
      let f: Featurevisor;
      let child: ReturnType<Featurevisor["spawn"]>;
      let reads = 0;
      const d = createDatafile({
        variables: {
          root: variable([requirement("leaf"), requirement("mutator"), requirement("leaf", 2)]),
          leaf: variable(),
          mutator: variable(),
        },
      });
      f = createFeaturevisor({
        datafile: d,
        modules: [
          {
            afterEvaluation(e) {
              if (e.variableKey === "leaf") {
                reads++;
                if (state === "context")
                  return { ...e, variableValue: f.getContext().changed ? 2 : 1 };
              }
              if (e.variableKey === "mutator") {
                if (state === "datafile")
                  f.setDatafile(
                    createDatafile({ variables: { leaf: { type: "integer", defaultValue: 2 } } }),
                  );
                if (state === "sticky") f.setStickyVariables({ leaf: 2 });
                if (state === "childSticky") child.setStickyVariables({ leaf: 2 });
                if (state === "context") f.setContext({ changed: true });
                if (state === "modules")
                  f.addModule({
                    afterEvaluation(result) {
                      return result.variableKey === "leaf"
                        ? { ...result, variableValue: 2 }
                        : result;
                    },
                  });
              }
              return e;
            },
          },
        ],
      });
      child = f.spawn();
      expect((state === "childSticky" ? child : f).getVariable("root")).toBe(1);
      expect(reads).toBe(2);
    },
  );

  test("does not reuse a dependency whose hook changed state while it was running", () => {
    let f: Featurevisor;
    let reads = 0;
    f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([requirement("leaf"), requirement("leaf", 2)]),
          leaf: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e) {
            if (e.variableKey === "leaf") {
              reads++;
              if (reads === 1) f.setStickyVariables({ leaf: 2 });
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test("preserves the global getter's sticky lookup after its before hook", () => {
    let f: Featurevisor;
    f = createFeaturevisor({
      datafile: createDatafile({ variables: { root: variable() } }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "root") f.setStickyVariables({ root: 2 });
            return o;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(2);
  });

  test("child sticky values stay isolated from reentrant parent getters", () => {
    const seen: unknown[] = [];
    let f: Featurevisor;
    f = createFeaturevisor({
      stickyVariables: { leaf: 0 },
      datafile: createDatafile({
        variables: { root: variable([requirement("leaf"), requirement("leaf")]), leaf: variable() },
      }),
      modules: [
        {
          afterEvaluation(e, o) {
            if (e.variableKey === "leaf" && o.dependencyOf) seen.push(f.getVariable("leaf"));
            return e;
          },
        },
      ],
    });
    const child = f.spawn({}, { stickyVariables: { leaf: 1 } });
    expect(child.getVariable("root")).toBe(1);
    expect(seen).toEqual([0]);
    expect(f.getVariable("root")).toBe(0);
  });

  test("child state changes and restoration during hooks cannot resurrect a stale memo", () => {
    let child: ReturnType<Featurevisor["spawn"]>;
    let reads = 0;
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([requirement("leaf", 2), requirement("restore"), requirement("leaf", 1)]),
          leaf: variable(),
          restore: variable(),
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "leaf" && ++reads === 1) child.setStickyVariables({ leaf: 2 });
            if (o.variableKey === "restore") child.setStickyVariables({ leaf: 1 }, true);
            return o;
          },
        },
      ],
    });
    child = f.spawn({}, { stickyVariables: { leaf: 1 } });
    expect(child.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test.each(["global", "program", "rule", "variation"])(
    "cheap selectors avoid prerequisite callbacks in %s overrides",
    (kind) => {
      const override = {
        key: "skip",
        conditions: [
          { attribute: "country", operator: "equals" as const, value: "nl" },
          "allowed",
          { feature: "leaf" },
          requirement("leaf"),
        ],
        value: 2,
      };
      const d = createDatafile({
        segments: {
          allowed: { conditions: { attribute: "allowed", operator: "equals", value: true } },
        },
        features: {
          leaf: createFeature(),
          root: createFeature({
            variablesSchema: { value: { type: "integer", defaultValue: 1 } },
            traffic: [
              {
                key: "all",
                segments: "*",
                percentage: 100000,
                variation: "on",
                ...(kind === "rule" && { variableOverrides: { value: [override] } }),
              },
            ],
            variations: [
              {
                value: "on",
                ...(kind === "variation" && { variableOverrides: { value: [override] } }),
              },
            ],
          }),
        },
        variables: {
          leaf: variable(),
          root: {
            ...variable(),
            ...(kind === "program"
              ? {
                  overrideProgram: [
                    {
                      ...override,
                      operations: [{ op: "set" as const, path: [], value: 2 }],
                      onMatch: 1,
                      onMiss: 1,
                    },
                  ],
                }
              : { overrides: [override] }),
          },
        },
      });
      const before = jest.fn((o: EvaluationOptions) => o);
      const f = createFeaturevisor({
        datafile: d,
        modules: [{ beforeEvaluation: before as never }],
      });
      for (const context of [
        { country: "de", allowed: true },
        { country: "nl", allowed: false },
      ]) {
        before.mockClear();
        expect(
          kind === "rule" || kind === "variation"
            ? f.getVariable("root", "value", context)
            : f.getVariable("root", context),
        ).toBe(1);
        expect(before).toHaveBeenCalledTimes(1);
      }
    },
  );

  test("Date input and ISO text have different memo identities", () => {
    let reads = 0;
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([requirement("a"), requirement("b")]),
          a: variable([requirement("leaf", 1)]),
          b: variable([requirement("leaf", 2)]),
          leaf: variable(),
        },
      }),
      modules: [
        {
          beforeEvaluation(o) {
            if (o.variableKey === "a" || o.variableKey === "b")
              return {
                ...o,
                context: {
                  at: o.variableKey === "a" ? new Date("2026-01-01") : "2026-01-01T00:00:00.000Z",
                },
              };
            return o;
          },
          afterEvaluation(e, o) {
            if (e.variableKey === "leaf") {
              reads++;
              return { ...e, variableValue: o.context.at instanceof Date ? 1 : 2 };
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test("mutable Dates are snapshotted across a reentrant public call", () => {
    const at = new Date("2026-01-01");
    let f: Featurevisor;
    let reads = 0;
    f = createFeaturevisor({
      context: { at },
      datafile: createDatafile({
        variables: {
          root: variable([requirement("leaf"), requirement("mutator"), requirement("leaf", 2)]),
          leaf: variable(),
          mutator: variable(),
          unrelated: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e, o) {
            if (e.variableKey === "leaf") {
              reads++;
              return { ...e, variableValue: (o.context.at as Date).getUTCDate() };
            }
            if (e.variableKey === "mutator") {
              expect(f.getVariable("unrelated")).toBe(1);
              at.setUTCDate(2);
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test("unsupported module supplied values keep ordinary behaviour without memoisation", () => {
    let reads = 0;
    const value = new Map([["value", 1]]);
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([
            { variable: "leaf", operator: "exists" },
            { variable: "leaf", operator: "exists" },
          ]),
          leaf: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e) {
            if (e.variableKey === "leaf") {
              reads++;
              return { ...e, variableValue: value as never };
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test("memo results protect arrays and Dates supplied by modules", () => {
    let reads = 0;
    const f = createFeaturevisor({
      datafile: createDatafile({
        variables: {
          root: variable([
            { variable: "array", path: [0], operator: "equals", value: 1 },
            { variable: "array", path: [0], operator: "equals", value: 1 },
            { variable: "date", operator: "before", value: "2026-02-01T00:00:00Z" },
            { variable: "date", operator: "before", value: "2026-02-01T00:00:00Z" },
          ]),
          array: variable(),
          date: variable(),
        },
      }),
      modules: [
        {
          afterEvaluation(e) {
            if (e.variableKey === "array") {
              reads++;
              return { ...e, variableValue: [1] };
            }
            if (e.variableKey === "date") {
              reads++;
              return { ...e, variableValue: new Date("2026-01-01") as never };
            }
            return e;
          },
        },
      ],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(reads).toBe(2);
  });

  test.each([
    new Map(),
    () => 1,
    (() => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    })(),
  ])("unsupported contexts safely skip memoisation", (value) => {
    const before = jest.fn((o: EvaluationOptions) => o);
    const f = createFeaturevisor({
      context: { value } as Context,
      datafile: createDatafile({
        variables: { root: variable([requirement("leaf"), requirement("leaf")]), leaf: variable() },
      }),
      modules: [{ beforeEvaluation: before as never }],
    });
    expect(f.getVariable("root")).toBe(1);
    expect(before).toHaveBeenCalledTimes(3);
  });
});
