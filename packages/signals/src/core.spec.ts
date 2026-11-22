import { createFeaturevisor, type Evaluation, type FeaturevisorModule } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { copyValue, createSignals, sameValue } from "./index";
import { getEngine } from "./engine";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

function datafile(overrides: Partial<DatafileContent> = {}): DatafileContent {
  return {
    schemaVersion: "4",
    revision: "1",
    segments: {
      dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      pro: { conditions: { attribute: "account.plan", operator: "equals", value: "pro" } },
    },
    features: {
      checkout: { hash: "c1", bucketBy: "userId", traffic: [{ ...everyone, conditions: "dutch" }] },
      reviews: {
        hash: "r1",
        bucketBy: "userId",
        traffic: [{ key: "pro", conditions: "pro", percentage: 100000 }],
        variablesSchema: {
          settings: { type: "object", defaultValue: { currency: "EUR", limits: [1, 2] } },
        },
      },
      wishlist: { hash: "w1", bucketBy: "userId", traffic: [everyone] },
    },
    variables: {
      banner: {
        hash: "b1",
        type: "string",
        defaultValue: "Welcome",
        overrides: [{ key: "dutch", conditions: "dutch", value: "Welkom" }],
      },
    },
    ...overrides,
  };
}

/** Counts evaluations per feature or variable, as an analytics module sees them. */
function counting(): { module: FeaturevisorModule; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return {
    counts,
    module: {
      name: "counting",
      afterEvaluation: (evaluation: Evaluation, options) => {
        if (!options.dependencyOf) {
          const key = evaluation.featureKey || evaluation.variableKey || "?";
          counts[key] = (counts[key] || 0) + 1;
        }
        return evaluation;
      },
    } as FeaturevisorModule,
  };
}

function setup(context = {}) {
  const { module, counts } = counting();
  const f = createFeaturevisor({
    datafile: datafile(),
    logLevel: "fatal",
    context: { userId: "user-1", country: "nl", account: { plan: "free" }, ...context },
    modules: [module],
  });
  return { f, counts, signals: createSignals(f) };
}

describe("precise updates", () => {
  test("a value evaluates once, and again only when something it read changes", () => {
    const { f, counts, signals } = setup();
    const checkout = signals.flag("checkout");
    const changes: boolean[] = [];
    const stop = checkout.listen(() => changes.push(checkout.read()));

    expect(checkout.read()).toBe(true);
    expect(checkout.read()).toBe(true);
    expect(counts.checkout).toBe(1);

    // checkout reads country and userId, so a plan change asks nothing.
    f.setContext({ account: { plan: "pro" } });
    expect(counts.checkout).toBe(1);
    expect(changes).toEqual([]);

    f.setContext({ country: "de" });
    expect(changes).toEqual([false]);
    expect(counts.checkout).toBe(2);

    stop();
  });

  test("an equal answer tells nobody", () => {
    const { f, counts, signals } = setup();
    const wishlist = signals.flag("wishlist");
    let told = 0;
    wishlist.listen(() => told++);
    wishlist.read();

    // wishlist reads userId for bucketing, and stays enabled for every user, so
    // it answers again and tells nobody.
    f.setContext({ userId: "user-2" });
    f.setContext({ userId: "user-3" });

    expect(counts.wishlist).toBe(3);
    expect(told).toBe(0);
    expect(wishlist.read()).toBe(true);
    expect(counts.wishlist).toBe(3);
  });

  test("a datafile asks again only for what it changed", () => {
    const { f, counts, signals } = setup();
    const checkout = signals.flag("checkout");
    const wishlist = signals.flag("wishlist");
    checkout.listen(() => {});
    wishlist.listen(() => {});
    checkout.read();
    wishlist.read();

    f.setDatafile({
      schemaVersion: "4",
      revision: "2",
      segments: {},
      features: { wishlist: { bucketBy: "userId", hash: "new", traffic: [everyone] } },
    });
    checkout.read();
    wishlist.read();

    expect(counts).toEqual({ checkout: 1, wishlist: 2 });
  });

  test("a segment changed in a partial datafile asks again for what read it", () => {
    const { f, signals } = setup();
    const checkout = signals.flag("checkout");
    checkout.listen(() => {});
    expect(checkout.read()).toBe(true);

    f.setDatafile({
      schemaVersion: "4",
      revision: "2",
      segments: {
        dutch: { conditions: { attribute: "country", operator: "equals", value: "be" } },
      },
      features: {},
    });

    expect(checkout.read()).toBe(false);
  });

  test("sticky values ask again only for the features they name", () => {
    const { f, counts, signals } = setup();
    const checkout = signals.flag("checkout");
    const wishlist = signals.flag("wishlist");
    checkout.listen(() => {});
    wishlist.listen(() => {});
    checkout.read();
    wishlist.read();

    f.setStickyFeatures({ wishlist: { enabled: false } });

    expect(wishlist.read()).toBe(false);
    expect(checkout.read()).toBe(true);
    expect(counts).toEqual({ checkout: 1, wishlist: 2 });
  });

  test("a module that shapes the context makes every context change ask again", () => {
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      context: { userId: "user-1", ip: "1.1.1.1" },
      modules: [
        {
          name: "geo",
          beforeEvaluation: (options) => ({
            ...options,
            context: {
              ...options.context,
              country: options.context.ip === "1.1.1.1" ? "nl" : "de",
            },
          }),
        },
      ],
    });
    const checkout = createSignals(f).flag("checkout");
    checkout.listen(() => {});
    expect(checkout.read()).toBe(true);

    f.setContext({ ip: "2.2.2.2" });

    expect(checkout.read()).toBe(false);
  });

  test("a global variable follows the segments of its overrides", () => {
    const { f, signals } = setup();
    const banner = signals.variable("banner");
    banner.listen(() => {});
    expect(banner.read()).toBe("Welkom");

    f.setContext({ country: "de" });

    expect(banner.read()).toBe("Welcome");
  });
});

describe("without precision", () => {
  test("precise false follows every context change, as the hooks did", () => {
    const { f, counts } = setup();
    const checkout = createSignals(f, { precise: false }).flag("checkout");
    checkout.listen(() => {});
    checkout.read();

    f.setContext({ account: { plan: "pro" } });
    checkout.read();

    expect(counts.checkout).toBe(2);
  });

  test("a flag follows datafiles naming it, and no others", () => {
    const { f, counts } = setup();
    const checkout = createSignals(f, { precise: false }).flag("checkout");
    checkout.listen(() => {});
    checkout.read();

    f.setDatafile({
      schemaVersion: "4",
      revision: "2",
      segments: {},
      features: { wishlist: { bucketBy: "userId", hash: "new", traffic: [everyone] } },
    });
    checkout.read();
    expect(counts.checkout).toBe(1);

    f.setDatafile({
      schemaVersion: "4",
      revision: "3",
      segments: {},
      features: { checkout: { bucketBy: "userId", hash: "new", traffic: [everyone] } },
    });
    checkout.read();
    expect(counts.checkout).toBe(2);
  });
});

describe("values", () => {
  test("equal objects keep the previous one", () => {
    const { f, signals } = setup({ account: { plan: "pro" } });
    const settings = signals.variable("reviews", "settings");
    settings.listen(() => {});
    const first = settings.read();

    f.setContext({ userId: "user-2" });

    expect(settings.read()).toBe(first);
  });

  test("copies give each value its own object", () => {
    const { f } = setup({ account: { plan: "pro" } });
    const settings = createSignals(f, { copy: true }).variable<{ currency: string }>(
      "reviews",
      "settings",
    );
    const value = settings.read()!;
    value.currency = "USD";

    expect(f.getVariable("reviews", "settings")).toEqual({ currency: "EUR", limits: [1, 2] });
  });

  test("frozen values throw when changed in place", () => {
    const { f } = setup({ account: { plan: "pro" } });
    const settings = createSignals(f, { freeze: true }).variable<{ limits: number[] }>(
      "reviews",
      "settings",
    );

    expect(() => {
      "use strict";
      settings.read()!.limits.push(3);
    }).toThrow();
    expect(f.getVariable("reviews", "settings")).toEqual({ currency: "EUR", limits: [1, 2] });
  });

  test("a context getter asks again when its value changes, compared by value", () => {
    const { counts, signals } = setup();
    let country = "nl";
    const checkout = signals.flag("checkout", () => ({ country }));

    expect(checkout.read()).toBe(true);
    expect(checkout.read()).toBe(true);
    expect(counts.checkout).toBe(1);

    country = "de";
    expect(checkout.read()).toBe(false);
    expect(counts.checkout).toBe(2);
  });

  test("scopes merge from the outermost, under the value's own context", () => {
    const { signals } = setup();
    const outer = signals.scope({ country: "de" });
    const inner = outer.scope({ country: "nl" });

    expect(outer.flag("checkout").read()).toBe(false);
    expect(inner.flag("checkout").read()).toBe(true);
    expect(inner.flag("checkout", { country: "be" }).read()).toBe(false);
  });

  test("from makes any getter precise", () => {
    const { f, signals } = setup();
    let computed = 0;
    const summary = signals.from((context) => {
      computed++;
      return {
        checkout: f.isEnabled("checkout", context),
        banner: f.getVariable("banner", context),
      };
    });
    summary.listen(() => {});

    expect(summary.read()).toEqual({ checkout: true, banner: "Welkom" });
    f.setContext({ account: { plan: "pro" } });
    summary.read();
    expect(computed).toBe(1);

    f.setContext({ country: "de" });
    expect(summary.read()).toEqual({ checkout: false, banner: "Welcome" });
    expect(computed).toBe(2);
  });

  test("everyFlag and someFlag stop at the first answer that decides", () => {
    const { counts, signals } = setup({ country: "de" });

    expect(signals.everyFlag(["checkout", "wishlist"]).read()).toBe(false);
    expect(counts).toEqual({ checkout: 1 });
    expect(signals.someFlag(["wishlist", "checkout"]).read()).toBe(true);
    expect(counts).toEqual({ checkout: 1, wishlist: 1 });
  });

  test("revision follows datafiles that bring another", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const signals = createSignals(f);
    const told: string[] = [];
    signals.revision.listen(() => told.push(`revision ${signals.revision.read()}`));

    expect(signals.revision.read()).toBe("unknown");

    f.setDatafile(datafile());
    f.setDatafile(datafile());

    expect(told).toEqual(["revision 1"]);
  });
});

describe("listening", () => {
  test("listens to the instance only while something listens, and stops a microtask later", async () => {
    const { f, signals } = setup();
    const engine = getEngine(f);
    const checkout = signals.flag("checkout");
    const stop = checkout.listen(() => {});
    expect(engine.attached).toBe(true);

    stop();
    const again = checkout.listen(() => {});
    again();
    expect(engine.attached).toBe(true);
    await Promise.resolve();
    expect(engine.attached).toBe(false);
  });

  test("a change made while nothing listened is told once listening starts", async () => {
    const { f, signals } = setup();
    const engine = getEngine(f);
    const checkout = signals.flag("checkout");
    const stop = checkout.listen(() => {});
    checkout.read();
    stop();
    await Promise.resolve();
    expect(engine.attached).toBe(false);

    f.setContext({ country: "de" });
    let told = 0;
    checkout.listen(() => told++);
    await Promise.resolve();

    expect(told).toBe(1);
    expect(checkout.read()).toBe(false);
  });

  test("paths sharing a top level key are indexed once, and leave nothing behind", () => {
    const f = createFeaturevisor({
      datafile: datafile({
        segments: {
          proOne: {
            conditions: {
              and: [
                { attribute: "account.plan", operator: "equals", value: "pro" },
                { attribute: "account.id", operator: "equals", value: "1" },
              ],
            },
          },
        },
        features: {
          checkout: {
            hash: "c1",
            bucketBy: "userId",
            traffic: [{ ...everyone, conditions: "proOne" }],
          },
        },
      }),
      logLevel: "fatal",
      context: { userId: "user-1", account: { plan: "pro", id: "1" } },
    });
    const engine = getEngine(f) as unknown as Record<string, Map<string, Set<unknown>>>;
    const filed = () => {
      const names = ["attributes", "segments", "features", "variables"];
      return names.map((name) =>
        [...engine[name].entries()].map(([key, nodes]) => [key, nodes.size]).sort(),
      );
    };
    const checkout = createSignals(f).flag("checkout");
    const stop = checkout.listen(() => {});
    expect(checkout.read()).toBe(true);
    const listening = [
      [
        ["account", 1],
        ["userId", 1],
      ],
      [["proOne", 1]],
      [["checkout", 1]],
      [],
    ];
    expect(filed()).toEqual(listening);

    f.setContext({ account: { plan: "free", id: "1" } });
    expect(checkout.read()).toBe(false);
    f.setContext({ account: { plan: "pro", id: "1" } });
    expect(checkout.read()).toBe(true);
    expect(filed()).toEqual(listening);

    stop();
    expect(filed()).toEqual([[], [], [], []]);
  });

  test("one instance has one engine, whatever reads it", () => {
    const { f } = setup();

    expect(getEngine(f)).toBe(getEngine(f));
    createSignals(f).flag("checkout").read();
    createSignals(f).flag("wishlist").read();
    expect(getEngine(f)).toBe(getEngine(f));
    // The engine's own module is frozen and has no hooks, so evaluations skip it.
    expect((f as unknown as { modules: unknown[] }).modules).toHaveLength(1);
  });
});

describe("comparing and copying", () => {
  test("values compare by what they hold, whatever the key order", () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameValue({ a: undefined }, {})).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue(new Date(1), new Date(1))).toBe(true);
    expect(sameValue(new Date(1), { getTime: () => 1 })).toBe(false);
    expect(sameValue(NaN, NaN)).toBe(true);
    expect(sameValue(0, -0)).toBe(false);
    expect(sameValue(new Map(), new Map())).toBe(false);
  });

  test("values that contain themselves end, and the comparison after them starts afresh", () => {
    const first: Record<string, unknown> = { a: 1 };
    first.self = first;
    const second: Record<string, unknown> = { a: 1 };
    second.self = second;

    expect(sameValue(first, second)).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(copyValue(first)).toBe(first);
  });
});
