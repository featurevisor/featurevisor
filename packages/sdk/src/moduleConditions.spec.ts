import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./index";
import type { FeaturevisorModule, FeaturevisorModuleApi } from "./modules";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

const datafile = {
  schemaVersion: "4",
  revision: "1",
  segments: {
    dutch: { hash: "d1", conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
    payingDutch: { hash: "p1", conditions: { and: ["dutch", { feature: "paid" }] } },
  },
  features: {
    paid: { hash: "f1", bucketBy: "userId", traffic: [everyone] },
  },
  variables: {},
} as unknown as DatafileContent;

function setup(modules: FeaturevisorModule[] = []) {
  let api: FeaturevisorModuleApi | undefined;
  const diagnostics: string[] = [];
  const f = createFeaturevisor({
    datafile,
    // Errors reach onDiagnostic only at their own level or below.
    logLevel: "error",
    context: { country: "nl" },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
  });
  for (const module of modules) f.addModule(module);
  f.addModule(
    Object.freeze({
      name: "@featurevisor/schemas",
      setup: (moduleApi: FeaturevisorModuleApi) => void (api = moduleApi),
    }),
  );
  return { f, api: api!, diagnostics };
}

describe("matchConditions on the module API", () => {
  test("answers attributes, segments and feature leaves with the instance's engine", () => {
    const { api } = setup();

    expect(api.matchConditions("*", {})).toBe(true);
    expect(
      api.matchConditions([{ attribute: "country", operator: "equals", value: "nl" }], {}),
    ).toBe(true);
    expect(api.matchConditions("dutch", { country: "de" })).toBe(false);
    // A segment that reads a feature runs it through the getters, in one session.
    expect(api.matchConditions("payingDutch", {})).toBe(true);
    expect(api.matchConditions({ not: [{ feature: "paid" }] }, {})).toBe(false);
  });

  test("reads leaves only the package knows through its readers, and compares two reads", () => {
    const { api } = setup();
    const value: Record<string, unknown> = { accountType: "business", password: "a", confirm: "a" };
    const readers = { input: (path: string) => value[path] };

    expect(
      api.matchConditions(
        {
          and: ["dutch", { input: "accountType", operator: "equals", value: "business" }],
        } as never,
        {},
        { readers },
      ),
    ).toBe(true);
    const same = { input: "confirm", operator: "equals", valueFrom: { input: "password" } };
    expect(api.matchConditions(same as never, {}, { readers })).toBe(true);
    value.confirm = "b";
    expect(api.matchConditions(same as never, {}, { readers })).toBe(false);
    // `value` is always a value, even an object naming a reader.
    value.confirm = "a";
    expect(
      api.matchConditions(
        { input: "confirm", operator: "equals", value: { input: "password" } } as never,
        {},
        { readers },
      ),
    ).toBe(false);
    // A pattern read from a value never runs, nor a source no reader answers.
    expect(
      api.matchConditions(
        { input: "confirm", operator: "matches", valueFrom: { input: "password" } } as never,
        {},
        { readers },
      ),
    ).toBe(false);
    expect(
      api.matchConditions(
        { input: "confirm", operator: "equals", valueFrom: { attribute: "country" } } as never,
        {},
        { readers },
      ),
    ).toBe(false);
    // Without a reader for its kind, a leaf does not match.
    expect(
      api.matchConditions(
        { input: "accountType", operator: "equals", value: "business" } as never,
        {},
      ),
    ).toBe(false);
  });

  test("feature leaves reach modules as dependencies of the package's entry", () => {
    const seen: unknown[] = [];
    const { api } = setup([
      {
        name: "observer",
        afterEvaluation: (evaluation, options) => {
          seen.push({ featureKey: evaluation.featureKey, dependencyOf: options.dependencyOf });
          return evaluation;
        },
      },
    ]);

    expect(api.matchConditions([{ feature: "paid" }], {}, { type: "schema", key: "signUp" })).toBe(
      true,
    );
    expect(seen).toEqual([{ featureKey: "paid", dependencyOf: { type: "schema", key: "signUp" } }]);
  });

  test("a condition that cannot be answered reports evaluation_error and does not match", () => {
    const { api, diagnostics } = setup();
    const readers = {
      input: () => {
        throw new Error("broken reader");
      },
    };

    expect(
      api.matchConditions({ input: "x", operator: "equals", value: 1 } as never, {}, { readers }),
    ).toBe(false);
    expect(diagnostics).toEqual(["evaluation_error"]);
  });
});
