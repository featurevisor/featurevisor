import {
  createCatalogDefinitionCache,
  createCatalogSnapshot,
  invalidateCatalogDefinitions,
  mapLimit,
} from "./snapshot";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Copies come from the host realm, so match the message rather than Jest's TypeError class.
const frozen = /read only|not extensible/;

describe("createCatalogSnapshot", () => {
  it("reuses Catalog definition reads across target and environment builds", async () => {
    const source = {
      listFeatures: jest.fn(async () => ["a", "b"]),
      readFeature: jest.fn(async (key: string) => ({ key, rules: ["authored"] })),
      readState: jest.fn(async (environment: string | false) => ({ environment, revision: 0 })),
    };
    const snapshot = createCatalogSnapshot(source);
    const definitions = await mapLimit(await snapshot.listFeatures(), snapshot.readFeature);
    // Definitions are shared and frozen, so a mutation fails loudly instead of leaking.
    expect(() => definitions[0].rules.push("Catalog annotation")).toThrow(frozen);
    // Two Targets, each built for two environments.
    for (let target = 0; target < 2; target++) {
      for (const environment of [false, "production"] as const) {
        // State is updated in memory by the builder, so each caller gets its own copy.
        const state = await snapshot.readState(environment);
        expect(state.revision).toBe(0);
        state.revision++;
        for (const key of await snapshot.listFeatures()) {
          const feature = await snapshot.readFeature(key);
          expect(feature).toBe(definitions[key === "a" ? 0 : 1]);
          expect(feature.rules).toEqual(["authored"]);
        }
      }
    }
    expect(source.listFeatures).toHaveBeenCalledTimes(1);
    expect(source.readFeature).toHaveBeenCalledTimes(2);
    expect(source.readState).toHaveBeenCalledTimes(2);
  });

  it("shares pending reads and one frozen copy that later source changes cannot reach", async () => {
    const pending = deferred<{ rules: { enabled: boolean }[] }>();
    const datasource = { readFeature: jest.fn(() => pending.promise) };
    const snapshot = createCatalogSnapshot(datasource);
    const first = snapshot.readFeature();
    const second = snapshot.readFeature();
    expect(datasource.readFeature).toHaveBeenCalledTimes(1);
    const source = { rules: [{ enabled: true }] };
    pending.resolve(source);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(Object.isFrozen(a.rules[0])).toBe(true);
    expect(() => {
      a.rules[0].enabled = false;
    }).toThrow(frozen);
    source.rules[0].enabled = false;
    expect((await snapshot.readFeature()).rules[0].enabled).toBe(true);
  });

  it("preserves class receivers while internal derived reads bypass the cache", async () => {
    class Datasource {
      prefix = "feature";
      calls = 0;
      get label() {
        return this.prefix;
      }
      async readFeature(key: string) {
        this.calls++;
        return { key: `${this.label}:${key}`, rules: [] as string[] };
      }
      async getRequiredFeaturesChain(key: string) {
        const feature = await this.readFeature(key);
        feature.rules.push("derived");
        return feature;
      }
    }
    const source = new Datasource();
    const snapshot = createCatalogSnapshot(source);
    expect(snapshot).toBeInstanceOf(Datasource);
    expect(await snapshot.readFeature("a")).toEqual({ key: "feature:a", rules: [] });
    expect((await snapshot.getRequiredFeaturesChain("a")).rules).toEqual(["derived"]);
    expect((await snapshot.getRequiredFeaturesChain("a")).rules).toEqual(["derived"]);
    expect((await snapshot.readFeature("a")).rules).toEqual([]);
    expect(source.calls).toBe(3);
    expect(snapshot.label).toBe("feature");
  });

  it.each([
    "listSets",
    "listFeatures",
    "listSegments",
    "listAttributes",
    "listFlattenedAttributes",
    "listSchemas",
    "listVariables",
    "listTargets",
    "listTests",
    "listScenarios",
    "listDatafiles",
    "listHistoryEntries",
    "readFeature",
    "readSegment",
    "readAttribute",
    "readSchema",
    "readVariable",
    "readTarget",
    "readTest",
    "readScenario",
    "readState",
    "readRevision",
    "readCommit",
    "featureExists",
    "segmentExists",
    "attributeExists",
    "schemaExists",
    "variableExists",
    "targetExists",
    "scenarioExists",
  ])("caches the known operation %s", async (name) => {
    const method = jest.fn(async () => [{ nested: { value: true } }]);
    const snapshot = createCatalogSnapshot({ [name]: method });
    const first = await snapshot[name]();
    // Definitions and key lists are shared frozen values. Everything else is a copy per caller.
    const shared = /^(list(?!Datafiles|HistoryEntries)|read(?!State|Revision|Commit))/.test(name);
    if (shared) expect(() => (first[0].nested.value = false)).toThrow(frozen);
    else first[0].nested.value = false;
    expect(await snapshot[name]()).toEqual([{ nested: { value: true } }]);
    expect((await snapshot[name]()) === first).toBe(shared);
    expect(method).toHaveBeenCalledTimes(1);
  });

  it("separates methods, primitive types, argument counts and prototype shaped keys", async () => {
    const method = jest.fn(async (...args: unknown[]) => args);
    const snapshot = createCatalogSnapshot({ readFeature: method, readSegment: method });
    const argumentsList = [
      ["__proto__"],
      ["constructor"],
      ["toString"],
      [false],
      ["false"],
      [null],
      [undefined],
      [],
      ["a", "b"],
      ["a,b"],
      ["a"],
      ["a", undefined],
    ];
    for (const args of argumentsList) {
      expect(await snapshot.readFeature(...args)).toEqual(args);
      expect(await snapshot.readFeature(...args)).toEqual(args);
      expect(await snapshot.readSegment(...args)).toEqual(args);
    }
    expect(method).toHaveBeenCalledTimes(argumentsList.length * 2);
  });

  it("preserves prototype shaped object keys when cloning", async () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
    const snapshot = createCatalogSnapshot({ readFeature: async () => value });
    const first = await snapshot.readFeature();
    expect(() => (first.__proto__.polluted = false)).toThrow(frozen);
    expect((await snapshot.readFeature()).__proto__.polluted).toBe(true);
    expect(Object.getPrototypeOf(first)).not.toHaveProperty("polluted");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("retains a rejection, including concurrent requests, without retries", async () => {
    const pending = deferred<string>();
    const source = { readFeature: jest.fn(() => pending.promise) };
    const snapshot = createCatalogSnapshot(source);
    const first = snapshot.readFeature();
    const second = snapshot.readFeature();
    const error = new Error("missing");
    const expectations = [expect(first).rejects.toBe(error), expect(second).rejects.toBe(error)];
    pending.reject(error);
    await Promise.all(expectations);
    await expect(snapshot.readFeature()).rejects.toBe(error);
    expect(source.readFeature).toHaveBeenCalledTimes(1);
  });

  it("does not leak rejected reads into another export", async () => {
    const source = {
      readFeature: jest
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValue({ key: "a" }),
    };
    const first = createCatalogSnapshot(source);
    await expect(first.readFeature("a")).rejects.toThrow("temporary");
    await expect(createCatalogSnapshot(source).readFeature("a")).resolves.toEqual({ key: "a" });
    await expect(first.readFeature("a")).rejects.toThrow("temporary");
    expect(source.readFeature).toHaveBeenCalledTimes(2);
  });

  it("preserves and caches synchronous results and thrown errors", () => {
    const error = new Error("read failed");
    const source = {
      listFeatures: jest.fn(() => ["a"]),
      readFeature: jest.fn(() => {
        throw error;
      }),
    };
    const snapshot = createCatalogSnapshot(source);
    expect(() => snapshot.listFeatures().push("b")).toThrow(frozen);
    expect(snapshot.listFeatures()).toEqual(["a"]);
    expect(() => snapshot.readFeature()).toThrow(error);
    expect(() => snapshot.readFeature()).toThrow(error);
    expect(source.listFeatures).toHaveBeenCalledTimes(1);
    expect(source.readFeature).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, false, 0, ""])("caches falsy result %p", async (value) => {
    const source = { readState: jest.fn(async () => value) };
    const snapshot = createCatalogSnapshot(source);
    expect(await snapshot.readState()).toBe(value);
    expect(await snapshot.readState()).toBe(value);
    expect(source.readState).toHaveBeenCalledTimes(1);
  });

  it("copies Dates, Sets, Maps, undefined and cyclic values for each caller, since freezing cannot protect them", () => {
    const source: any = {
      date: new Date(0),
      keys: new Set(["a"]),
      map: new Map([["a", { n: 1 }]]),
      missing: undefined,
    };
    source.self = source;
    const snapshot = createCatalogSnapshot({ readFeature: () => source });
    const first = snapshot.readFeature();
    first.date.setTime(1);
    first.keys.add("b");
    first.map.get("a").n = 2;
    const second = snapshot.readFeature();
    expect(second.date.getTime()).toBe(0);
    expect([...second.keys]).toEqual(["a"]);
    expect(second.map.get("a")).toEqual({ n: 1 });
    expect(second).toHaveProperty("missing", undefined);
    expect(second.self).toBe(second);
  });

  it("does not cache writes, custom read/list methods or configuration", async () => {
    const symbol = Symbol("custom");
    const source = {
      value: 0,
      readFeature: jest.fn(async (): Promise<{ value: number }> => ({ value: source.value })),
      writeFeature() {
        return ++this.value;
      },
      deleteFeature() {
        return ++this.value;
      },
      readCustom() {
        return ++this.value;
      },
      listCustom() {
        return ++this.value;
      },
      getConfig() {
        return { value: ++this.value, callback: () => true };
      },
      [symbol]() {
        return ++this.value;
      },
    };
    const snapshot = createCatalogSnapshot(source);
    await snapshot.readFeature();
    expect(snapshot.writeFeature()).toBe(1);
    expect(snapshot.writeFeature()).toBe(2);
    expect(snapshot.deleteFeature()).toBe(3);
    expect(snapshot.deleteFeature()).toBe(4);
    expect(snapshot.readCustom()).toBe(5);
    expect(snapshot.readCustom()).toBe(6);
    expect(snapshot.listCustom()).toBe(7);
    expect(snapshot.listCustom()).toBe(8);
    expect(snapshot.getConfig().value).toBe(9);
    expect(snapshot.getConfig().value).toBe(10);
    expect(snapshot[symbol]()).toBe(11);
    expect(snapshot[symbol]()).toBe(12);
    expect(await snapshot.readFeature()).toEqual({ value: 0 });
    expect(source.value).toBe(12);
  });

  it("isolates exports and sets without altering the original methods", async () => {
    let version = 1;
    const source = {
      readFeature: jest.fn(async () => ({ version })),
      forSet: jest.fn((set: string) => ({ readFeature: async () => ({ set }) })),
    };
    const original = source.readFeature;
    const first = createCatalogSnapshot(source);
    await first.readFeature();
    version = 2;
    const second = createCatalogSnapshot(source);
    expect(await first.readFeature()).toEqual({ version: 1 });
    expect(await second.readFeature()).toEqual({ version: 2 });
    expect(await source.readFeature()).toEqual({ version: 2 });
    const a = createCatalogSnapshot(first.forSet("a"));
    const b = createCatalogSnapshot(first.forSet("b"));
    expect(await a.readFeature()).toEqual({ set: "a" });
    expect(await b.readFeature()).toEqual({ set: "b" });
    expect(source.readFeature).toBe(original);
    expect(first.readFeature).toBe(first.readFeature);
  });

  it("leaves absent methods absent and bypasses unsupported object arguments", async () => {
    const source = { readFeature: jest.fn(async (options: { key: string }) => options.key) };
    const snapshot = createCatalogSnapshot(source);
    expect("listTests" in snapshot).toBe(false);
    const options = { key: "a" };
    expect(await snapshot.readFeature(options)).toBe("a");
    options.key = "b";
    expect(await snapshot.readFeature(options)).toBe("b");
    expect(source.readFeature).toHaveBeenCalledTimes(2);
  });

  it("caches frozen own methods without proxy invariant violations", () => {
    const readFeature = jest.fn(() => ({ rules: ["authored"] }));
    const source = Object.freeze({ readFeature, label: "frozen" });
    const snapshot = createCatalogSnapshot(source);
    expect(() => snapshot.readFeature().rules.push("changed")).toThrow(frozen);
    expect(snapshot.readFeature()).toEqual({ rules: ["authored"] });
    expect(readFeature).toHaveBeenCalledTimes(1);
    expect(snapshot.readFeature).toBe(snapshot.readFeature);
    expect(snapshot.label).toBe("frozen");
    expect(Object.keys(snapshot)).toEqual(Object.keys(source));
    expect("readFeature" in snapshot).toBe(true);
    expect(Reflect.set(snapshot, "label", "changed")).toBe(false);
    expect(Reflect.deleteProperty(snapshot, "label")).toBe(false);
  });

  it("supports private fields in reads, getters, setters and uncached detached methods", async () => {
    const symbol = Symbol("custom");
    class Datasource {
      #value = 1;
      calls = 0;
      get value() {
        return this.#value;
      }
      set value(value: number) {
        this.#value = value;
      }
      async readFeature() {
        this.calls++;
        return { value: this.#value };
      }
      writeFeature(value: number) {
        this.#value = value;
        return this;
      }
      readCustom() {
        return this.#value++;
      }
      [symbol]() {
        return this.#value;
      }
    }
    const source = new Datasource();
    const snapshot = createCatalogSnapshot(source);
    expect(snapshot).toBeInstanceOf(Datasource);
    expect(snapshot.value).toBe(1);
    expect(await snapshot.readFeature()).toEqual({ value: 1 });
    snapshot.value = 2;
    const write = snapshot.writeFeature;
    expect(write).toBe(snapshot.writeFeature);
    expect(write(3)).toBe(source);
    const custom = snapshot.readCustom;
    expect(custom).toBe(snapshot.readCustom);
    expect(custom()).toBe(3);
    expect(custom()).toBe(4);
    expect(snapshot[symbol]()).toBe(5);
    expect(snapshot[symbol]).toBe(snapshot[symbol]);
    expect(snapshot.value).toBe(5);
    const read = snapshot.readFeature;
    expect(await read()).toEqual({ value: 1 });
    expect(source.calls).toBe(1);
  });

  it("preserves readonly getters and live properties without evaluating getters eagerly", () => {
    const getter = jest.fn(() => "readonly");
    const source = Object.defineProperty({ mutable: 1 }, "label", {
      get: getter,
      enumerable: true,
    });
    const snapshot = createCatalogSnapshot(source);
    expect(getter).not.toHaveBeenCalled();
    expect(Object.keys(snapshot)).toEqual(["mutable", "label"]);
    expect(getter).not.toHaveBeenCalled();
    expect(Reflect.get(snapshot, "label")).toBe("readonly");
    expect(Reflect.set(snapshot, "label", "changed")).toBe(false);
    snapshot.mutable = 2;
    expect(source.mutable).toBe(2);
    source.mutable = 3;
    expect(snapshot.mutable).toBe(3);
    expect(Reflect.defineProperty(snapshot, "extra", { value: true })).toBe(false);
    expect(Reflect.preventExtensions(snapshot)).toBe(false);
    expect(Reflect.setPrototypeOf(snapshot, null)).toBe(false);
    expect(Reflect.deleteProperty(snapshot, "mutable")).toBe(true);
    expect("mutable" in source).toBe(false);
  });

  it("refreshes uncached wrappers when their original methods change", () => {
    const source = {
      value: 1,
      custom() {
        return this.value;
      },
    };
    const snapshot = createCatalogSnapshot(source);
    const first = snapshot.custom;
    source.custom = function () {
      return this.value + 1;
    };
    expect(snapshot.custom).not.toBe(first);
    expect(snapshot.custom).toBe(snapshot.custom);
    expect(snapshot.custom()).toBe(2);
    expect(first()).toBe(1);
  });

  it("caches a derived list result but does not intercept its internal reads", async () => {
    const source = {
      listAttributes: jest.fn(async () => ["plan"]),
      readAttribute: jest.fn(async (key: string) => ({ key, type: "string" })),
      async listFlattenedAttributes() {
        const keys = await this.listAttributes();
        for (const key of keys) await this.readAttribute(key);
        return keys;
      },
    };
    const snapshot = createCatalogSnapshot(source);
    await snapshot.listAttributes();
    await snapshot.readAttribute("plan");
    expect(Object.isFrozen(await snapshot.listFlattenedAttributes())).toBe(true);
    expect(await snapshot.listFlattenedAttributes()).toEqual(["plan"]);
    expect(source.listAttributes).toHaveBeenCalledTimes(2);
    expect(source.readAttribute).toHaveBeenCalledTimes(2);
  });

  it("retains cloning failures without rereading the source", async () => {
    const source = { readFeature: jest.fn(async () => ({ callback: () => true })) };
    const snapshot = createCatalogSnapshot(source);
    await expect(snapshot.readFeature()).rejects.toThrow();
    await expect(snapshot.readFeature()).rejects.toThrow();
    expect(source.readFeature).toHaveBeenCalledTimes(1);
  });

  it("optionally counts hits and misses including pending and failed reads", async () => {
    const pending = deferred<string>();
    const source = {
      readFeature: jest.fn(() => pending.promise),
      writeFeature: jest.fn(),
      readCustom: jest.fn(),
    };
    const stats = { hits: 0, misses: 0 };
    const snapshot = createCatalogSnapshot(source, stats);
    const first = snapshot.readFeature();
    const second = snapshot.readFeature();
    expect(stats).toEqual({ hits: 1, misses: 1 });
    const error = new Error("missing");
    const expectations = [expect(first).rejects.toBe(error), expect(second).rejects.toBe(error)];
    pending.reject(error);
    await Promise.all(expectations);
    await expect(snapshot.readFeature()).rejects.toBe(error);
    snapshot.writeFeature();
    snapshot.readCustom();
    expect(stats).toEqual({ hits: 2, misses: 1 });
    const otherStats = { hits: 0, misses: 0 };
    await expect(createCatalogSnapshot(source, otherStats).readFeature()).rejects.toBe(error);
    expect(otherStats).toEqual({ hits: 0, misses: 1 });
    expect(stats).toEqual({ hits: 2, misses: 1 });
  });
});

describe("mapLimit", () => {
  it.each([1, 3, 16, 100])("caps concurrency %i at sixteen and preserves order", async (limit) => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 40 }, (_, index) => index);
    const gates = items.map(() => deferred<number>());
    const started: number[] = [];
    const result = mapLimit(
      items,
      async (index) => {
        started.push(index);
        peak = Math.max(peak, ++active);
        const value = await gates[index].promise;
        active--;
        return value;
      },
      limit,
    );
    expect(started).toHaveLength(Math.min(limit, 16));
    for (let index = gates.length - 1; index >= 0; index--) gates[index].resolve(index * 2);
    expect(await result).toEqual(items.map((item) => item * 2));
    expect(peak).toBe(Math.min(limit, 16));
    expect(active).toBe(0);
  });

  it("defaults to sixteen and accepts readonly input and synchronous callbacks", async () => {
    const items = Object.freeze(Array.from({ length: 20 }, (_, i) => i));
    const gate = deferred<number>();
    const mapper = jest.fn(() => gate.promise);
    const result = mapLimit(items, mapper);
    expect(mapper).toHaveBeenCalledTimes(16);
    gate.resolve(1);
    expect(await result).toEqual(items.map(() => 1));
    expect(await mapLimit([1, 2], (n) => n * 2)).toEqual([2, 4]);
  });

  it("does not invoke the mapper for empty input", async () => {
    const mapper = jest.fn();
    expect(await mapLimit([], mapper)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid concurrency %p", async (limit) => {
    const mapper = jest.fn();
    await expect(mapLimit([1], mapper, limit)).rejects.toThrow(RangeError);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("stops scheduling on rejection and observes failures from active callbacks", async () => {
    const gates = [deferred<number>(), deferred<number>()];
    const error = new Error("failed");
    const mapper = jest.fn((index: number) => gates[index].promise);
    const result = mapLimit([0, 1, 2, 3], mapper, 2);
    gates[0].reject(error);
    await expect(result).rejects.toBe(error);
    gates[1].reject(new Error("also failed"));
    await Promise.resolve();
    expect(mapper).toHaveBeenCalledTimes(2);
  });

  it("stops immediately when a callback throws synchronously", async () => {
    const error = new Error("failed");
    const mapper = jest.fn(() => {
      throw error;
    });
    await expect(mapLimit([0, 1, 2], mapper)).rejects.toBe(error);
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  describe("definitions kept across a watch session", () => {
    function source() {
      const fingerprints: Record<string, string | undefined> = { a: "/p/a.yml\u00001:1" };
      return {
        fingerprints,
        readFeature: jest.fn(async (key: string) => ({ key, rules: [] as string[] })),
        getEntityFingerprint: jest.fn(async (_type: string, key: string) => fingerprints[key]),
      };
    }

    it("reuses a definition while its fingerprint is unchanged and rereads it after an edit", async () => {
      const datasource = source();
      const cache = createCatalogDefinitionCache();
      const read = () =>
        createCatalogSnapshot(datasource, undefined, { cache, scope: "" }).readFeature("a");
      const first = await read();
      expect(await read()).toBe(first);
      expect(datasource.readFeature).toHaveBeenCalledTimes(1);
      expect(datasource.getEntityFingerprint).toHaveBeenCalledWith("feature", "a");

      datasource.fingerprints.a = "/p/a.yml\u00002:2";
      expect(await read()).not.toBe(first);
      expect(datasource.readFeature).toHaveBeenCalledTimes(2);
    });

    it("rereads paths the watcher reported, and never reuses without a fingerprint", async () => {
      const datasource = source();
      const cache = createCatalogDefinitionCache();
      const read = (key: string, scope = "") =>
        createCatalogSnapshot(datasource, undefined, { cache, scope }).readFeature(key);
      await read("a");
      invalidateCatalogDefinitions(cache, ["/p/a.yml"]);
      await read("a");
      expect(datasource.readFeature).toHaveBeenCalledTimes(2);

      // Custom adapters and parsers report no fingerprint, so nothing is kept for them.
      await read("b");
      await read("b");
      expect(datasource.readFeature).toHaveBeenCalledTimes(4);
      expect(cache.entries.size).toBe(1);

      // Sets keep separate entries even for the same key.
      await read("a", "dev");
      expect(datasource.readFeature).toHaveBeenCalledTimes(5);
    });
  });
});
