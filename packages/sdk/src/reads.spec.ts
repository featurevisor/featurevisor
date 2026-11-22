import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./instance";
import type { FeaturevisorModule, FeaturevisorModuleApi } from "./modules";
import { createDatafile, createFeature } from "./instance.test-fixtures";

function datafile(overrides: Partial<DatafileContent> = {}): DatafileContent {
  return createDatafile({
    schemaVersion: "4",
    segments: {
      dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      paying: { conditions: { attribute: "account.plan", operator: "equals", value: "pro" } },
      dutchPaying: { conditions: ["dutch", "paying"] },
    },
    features: {
      payments: createFeature({
        traffic: [{ key: "dutch", conditions: "dutch", percentage: 100000 }],
      }),
      checkout: createFeature({
        conditions: { feature: "payments" },
        traffic: [{ key: "paying", conditions: "dutchPaying", percentage: 100000 }],
        variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
      }),
      simple: createFeature(),
    },
    variables: {
      limit: { type: "integer", defaultValue: 10 },
      banner: {
        type: "string",
        defaultValue: "Welcome",
        overrides: [{ key: "dutch", conditions: "dutch", value: "Welkom" }],
      },
      composed: { type: "integer", compose: "limit" },
    },
    ...overrides,
  });
}

function moduleApi(f: ReturnType<typeof createFeaturevisor>): FeaturevisorModuleApi {
  let api: FeaturevisorModuleApi | undefined;
  f.addModule({ name: "reads-test", setup: (moduleApi) => (api = moduleApi) });
  if (!api) throw new Error("module api missing");
  return api;
}

describe("track", () => {
  test("records attributes, segments, features and their dependencies", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);
    const context = { userId: "user-1", country: "nl", account: { plan: "pro" } };

    const { result, reads } = api.track(() => f.isEnabled("checkout", context));

    expect(result).toBe(true);
    expect(reads.features.sort()).toEqual(["checkout", "payments"]);
    expect(reads.segments.sort()).toEqual(["dutch", "dutchPaying", "paying"]);
    expect(reads.attributes.sort()).toEqual(["account.plan", "country", "userId"]);
    expect(reads.variables).toEqual([]);
  });

  test("records only what the branch taken read", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);

    // payments is disabled outside the Netherlands, so checkout stops at its own
    // condition and never reads its traffic's segments or the account's plan.
    const { result, reads } = api.track(() => f.isEnabled("checkout", { country: "de" }));

    expect(result).toBe(false);
    expect(reads.features.sort()).toEqual(["checkout", "payments"]);
    expect(reads.segments).toEqual(["dutch"]);
    expect(reads.attributes.sort()).toEqual(["country", "userId"]);
  });

  test("records global variables, their overrides and compositions", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);

    const banner = api.track(() => f.getVariable("banner", { country: "nl" }));
    expect(banner.result).toBe("Welkom");
    expect(banner.reads.variables).toEqual(["banner"]);
    expect(banner.reads.segments).toEqual(["dutch"]);
    expect(banner.reads.attributes).toEqual(["country"]);

    const composed = api.track(() => f.getVariable("composed"));
    expect(composed.result).toBe(10);
    expect(composed.reads.variables.sort()).toEqual(["composed", "limit"]);
  });

  test("records a feature variable as a read of its feature", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);

    const { reads } = api.track(() => f.getVariable("checkout", "label", { country: "de" }));

    expect(reads.features.sort()).toEqual(["checkout", "payments"]);
    expect(reads.variables).toEqual([]);
  });

  test("records the bucketing attribute", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);

    const { reads } = api.track(() => f.isEnabled("simple", { userId: "user-1" }));

    expect(reads.features).toEqual(["simple"]);
    expect(reads.attributes).toEqual(["userId"]);
  });

  test("records a missing feature, so its first datafile asks again", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const api = moduleApi(f);

    const { result, reads } = api.track(() => f.isEnabled("later"));

    expect(result).toBe(false);
    expect(reads.features).toEqual(["later"]);
  });

  test("records every attribute when a module could read the context", () => {
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      modules: [{ name: "enrich", beforeEvaluation: (options) => options }],
    });
    const api = moduleApi(f);

    const { reads } = api.track(() => f.isEnabled("simple", { userId: "user-1" }));

    expect(reads.attributes).toContain("*");
  });

  test("does not mark every attribute for modules that only follow evaluations", () => {
    const seen: string[] = [];
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      modules: [
        {
          name: "analytics",
          afterEvaluation: (evaluation) => {
            seen.push(evaluation.featureKey || "");
            return evaluation;
          },
        },
      ],
    });
    const api = moduleApi(f);

    const { reads } = api.track(() => f.isEnabled("simple", { userId: "user-1" }));

    expect(seen).toEqual(["simple"]);
    expect(reads.attributes).toEqual(["userId"]);
  });

  test("an inner track records into the outer one, even when it throws", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);

    const outer = api.track(() => {
      const inner = api.track(() => f.isEnabled("payments", { country: "nl" }));
      expect(inner.reads.features).toEqual(["payments"]);
      expect(() =>
        api.track(() => {
          f.getVariable("limit");
          throw new Error("inner failure");
        }),
      ).toThrow("inner failure");
      return f.isEnabled("simple", { userId: "user-1" });
    });

    expect(outer.reads.features.sort()).toEqual(["payments", "simple"]);
    expect(outer.reads.variables).toEqual(["limit"]);
    expect(outer.reads.attributes.sort()).toEqual(["country", "userId"]);
  });

  test("records nothing outside track", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);
    f.isEnabled("checkout", { country: "nl", account: { plan: "pro" } });

    const { reads } = api.track(() => 1);

    expect(reads).toEqual({ attributes: [], segments: [], features: [], variables: [] });
  });

  test("records reads through child instances", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const api = moduleApi(f);
    const child = f.spawn({ country: "nl" });

    const { result, reads } = api.track(() => child.isEnabled("payments"));

    expect(result).toBe(true);
    expect(reads.features).toEqual(["payments"]);
    expect(reads.attributes.sort()).toEqual(["country", "userId"]);
  });
});

describe("context_set keys", () => {
  function keysFor(initial: Record<string, unknown>, change: (f: any) => void): string[][] {
    const f = createFeaturevisor({ logLevel: "fatal", context: initial as never });
    const keys: string[][] = [];
    f.on("context_set", (details) => keys.push(details.keys));
    change(f);
    return keys;
  }

  test("a merge reports the keys it changes, by value", () => {
    expect(
      keysFor({ country: "nl", plan: "free", tags: ["a"] }, (f) => {
        f.setContext({ country: "nl" });
        f.setContext({ plan: "pro" });
        f.setContext({ tags: ["a"] });
        f.setContext({ tags: ["a", "b"], locale: "nl-NL" });
      }),
    ).toEqual([[], ["plan"], [], ["tags", "locale"]]);
  });

  test("a replace reports keys of either context that differ", () => {
    expect(
      keysFor({ country: "nl", plan: "free" }, (f) => {
        f.setContext({ country: "nl", plan: "free" }, true);
        f.setContext({ country: "de" }, true);
      }),
    ).toEqual([[], ["country", "plan"]]);
  });

  test("dates and nested objects compare by value", () => {
    expect(
      keysFor({ since: new Date(1000), account: { plan: "pro" } }, (f) => {
        f.setContext({ since: new Date(1000), account: { plan: "pro" } });
        f.setContext({ since: new Date(2000), account: { plan: "free" } });
      }),
    ).toEqual([[], ["since", "account"]]);
  });

  test("an object given again by reference counts as changed", () => {
    const account = { plan: "free" };
    expect(
      keysFor({ account }, (f) => {
        account.plan = "pro";
        f.setContext({ account });
      }),
    ).toEqual([["account"]]);
  });

  test("the stored context given back counts as changed in full", () => {
    for (const replace of [false, true]) {
      expect(
        keysFor({ country: "nl", plan: "free" }, (f) => {
          const stored = f.getContext();
          stored.country = "de";
          f.setContext(stored, replace);
        }),
      ).toEqual([["country", "plan"]]);
    }
  });

  test("an absent key and an undefined value are the same", () => {
    expect(
      keysFor({ country: "nl" }, (f) => {
        f.setContext({ plan: undefined });
      }),
    ).toEqual([[]]);
  });

  test("the diagnostic carries the keys too", () => {
    const keys: unknown[] = [];
    const f = createFeaturevisor({
      logLevel: "debug",
      context: { country: "nl" },
      onDiagnostic: (diagnostic) => {
        if (diagnostic.code === "context_set") keys.push(diagnostic.details.keys);
      },
    });
    f.setContext({ country: "de" });

    expect(keys).toEqual([["country"]]);
  });
});

describe("datafile_set segments", () => {
  test("the first datafile reports every segment", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const segments: string[][] = [];
    f.on("datafile_set", (details) => segments.push(details.segments));

    f.setDatafile(datafile());

    expect(segments[0].sort()).toEqual(["dutch", "dutchPaying", "paying"]);
  });

  test("a partial datafile reports the segments it changes", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const segments: string[][] = [];
    f.on("datafile_set", (details) => segments.push(details.segments));

    f.setDatafile({
      schemaVersion: "4",
      revision: "revision-2",
      segments: {
        dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        paying: { conditions: { attribute: "account.plan", operator: "in", value: ["pro"] } },
      },
      features: {},
    });

    expect(segments).toEqual([["paying"]]);
  });

  test("a replace reports changed and removed segments once each", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const segments: string[][] = [];
    f.on("datafile_set", (details) => segments.push(details.segments));

    f.setDatafile(
      datafile({
        revision: "revision-2",
        segments: {
          dutch: { conditions: { attribute: "country", operator: "equals", value: "be" } },
          paying: { conditions: { attribute: "account.plan", operator: "equals", value: "pro" } },
        },
      }),
      true,
    );

    expect(segments[0].sort()).toEqual(["dutch", "dutchPaying"]);
  });
});

describe("frozen modules without evaluation hooks", () => {
  test("take no part in evaluations", () => {
    const seen: string[] = [];
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    f.addModule(Object.freeze({ name: "package", setup: () => {} }));
    f.addModule({
      name: "analytics",
      afterEvaluation: (evaluation, options) => {
        seen.push(`${evaluation.type}:${evaluation.featureKey || evaluation.variableKey}`);
        expect(options.dependencyOf).toBeUndefined();
        return evaluation;
      },
    });

    expect(f.getVariable("banner", { country: "nl" })).toBe("Welkom");
    expect(f.isEnabled("simple", { userId: "user-1" })).toBe(true);
    expect(seen).toEqual(["variable:banner", "flag:simple"]);
    // Evaluations iterate only the analytics module.
    expect((f as unknown as { modules: unknown[] }).modules).toHaveLength(1);
  });

  test("a module that is not frozen may set a hook after it is added", () => {
    const seen: string[] = [];
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });
    const module: FeaturevisorModule = { name: "later" };
    f.addModule(module);
    expect(f.isEnabled("simple", { userId: "user-1" })).toBe(true);

    module.afterEvaluation = (evaluation) => {
      seen.push(evaluation.featureKey || "?");
      return { ...evaluation, enabled: false };
    };

    expect(f.isEnabled("simple", { userId: "user-1" })).toBe(false);
    expect(seen).toEqual(["simple"]);
  });

  test("still count for duplicate names, removal and closing", async () => {
    const closed: string[] = [];
    const diagnostics: string[] = [];
    const f = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });
    const remove = f.addModule({ name: "package", close: () => void closed.push("first") });
    expect(f.addModule({ name: "package" })).toBeUndefined();
    expect(diagnostics).toContain("duplicate_module");

    await remove?.();
    expect(closed).toEqual(["first"]);

    f.addModule({ name: "package", close: () => void closed.push("second") });
    await f.removeModule("package");
    f.addModule({ name: "package", close: () => void closed.push("third") });
    await f.close();
    expect(closed).toEqual(["first", "second", "third"]);
  });

  test("a module that only listens to diagnostics still sees sticky changes made in its handler", () => {
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      stickyFeatures: { simple: { enabled: true } },
    });
    let changed = false;
    f.addModule(
      Object.freeze({
        name: "listener",
        setup: (api: FeaturevisorModuleApi) => {
          api.onDiagnostic(
            () => {
              if (changed) return;
              changed = true;
              f.setStickyFeatures({ simple: { enabled: false } }, true);
            },
            { logLevel: "debug" },
          );
        },
      }),
    );

    // The handler runs during the first evaluation and changes sticky values,
    // with the same answers the SDK gave before modules without hooks were set apart.
    expect(f.isEnabled("simple", { userId: "user-1" })).toBe(true);
    expect(changed).toBe(true);
    expect(f.isEnabled("simple", { userId: "user-1" })).toBe(false);
  });
});
