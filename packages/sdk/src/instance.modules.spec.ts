import { createFeaturevisor, type FeaturevisorDiagnostic, type FeaturevisorModule } from "./index";
import { createDatafile, createFeature } from "./instance.test-fixtures";

describe("Featurevisor public API: modules and diagnostics", () => {
  const datafile = createDatafile({
    revision: "modules",
    features: {
      experiment: createFeature({
        variations: [{ value: "control" }, { value: "treatment" }],
        traffic: [
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
            allocation: [
              { variation: "control", range: [0, 50000] },
              { variation: "treatment", range: [50000, 100000] },
            ],
          },
        ],
      }),
    },
  });

  it("runs setup and evaluation callbacks in registration order", () => {
    const calls: string[] = [];
    const makeModule = (name: string): FeaturevisorModule => ({
      name,
      setup: () => calls.push(`${name}:setup`),
      before: (options) => {
        calls.push(`${name}:before`);
        return options;
      },
      bucketKey: ({ bucketKey }) => {
        calls.push(`${name}:bucketKey`);
        return `${bucketKey}.${name}`;
      },
      bucketValue: ({ bucketValue }) => {
        calls.push(`${name}:bucketValue`);
        return bucketValue;
      },
      after: (evaluation) => {
        calls.push(`${name}:after`);
        return evaluation;
      },
    });
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile,
      modules: [makeModule("first"), makeModule("second")],
    });

    sdk.getVariation("experiment", { userId: "user" });

    expect(calls).toEqual([
      "first:setup",
      "second:setup",
      "first:before",
      "second:before",
      "first:bucketKey",
      "second:bucketKey",
      "first:bucketValue",
      "second:bucketValue",
      "first:bucketKey",
      "second:bucketKey",
      "first:bucketValue",
      "second:bucketValue",
      "first:after",
      "second:after",
    ]);
  });

  it("chains bucket transformations and allows final evaluation transformation", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile,
      modules: [
        { name: "bucket-a", bucketValue: () => 10000 },
        { name: "bucket-b", bucketValue: ({ bucketValue }) => bucketValue + 50000 },
        {
          name: "after",
          after: (evaluation) => ({ ...evaluation, variationValue: `${evaluation.type}-override` }),
        },
      ],
    });

    expect(sdk.getVariation("experiment", { userId: "user" })).toBe("variation-override");
  });

  it("passes current revision to setup APIs", () => {
    let getRevision: (() => string) | undefined;
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile,
      modules: [{ name: "revision", setup: (api) => (getRevision = api.getRevision) }],
    });

    expect(getRevision?.()).toBe("modules");
    sdk.setDatafile(createDatafile({ revision: "next" }));
    expect(getRevision?.()).toBe("next");
  });

  it("removes named modules through both removeModule and addModule unsubscribe", () => {
    let calls = 0;
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile });
    const unsubscribe = sdk.addModule({
      name: "dynamic",
      before: (options) => {
        calls += 1;
        return options;
      },
    });

    sdk.isEnabled("experiment", { userId: "one" });
    unsubscribe?.();
    sdk.isEnabled("experiment", { userId: "two" });
    sdk.addModule({ name: "dynamic", before: (options) => ((calls += 10), options) });
    sdk.removeModule("dynamic");
    sdk.isEnabled("experiment", { userId: "three" });

    expect(calls).toBe(1);
  });

  it("unsubscribes anonymous modules returned by addModule", () => {
    let calls = 0;
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile });
    const unsubscribe = sdk.addModule({
      before: (options) => {
        calls += 1;
        return options;
      },
    });

    sdk.isEnabled("experiment", { userId: "one" });
    unsubscribe?.();
    sdk.isEnabled("experiment", { userId: "two" });

    expect(calls).toBe(1);
  });

  it("rejects duplicate names without running duplicate setup", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const setups: string[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      modules: [{ name: "same", setup: () => setups.push("first") }],
    });

    const result = sdk.addModule({ name: "same", setup: () => setups.push("second") });

    expect(result).toBeUndefined();
    expect(setups).toEqual(["first"]);
    expect(diagnostics.at(-1)).toEqual(
      expect.objectContaining({ code: "duplicate_module", moduleName: "same" }),
    );
  });

  it("gives module subscriptions independent log levels", () => {
    const root: string[] = [];
    const info: string[] = [];
    const debug: string[] = [];
    createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => root.push(item.code),
      modules: [
        {
          name: "info",
          setup: ({ onDiagnostic }) => onDiagnostic((item) => info.push(item.code)),
        },
        {
          name: "debug",
          setup: ({ onDiagnostic }) =>
            onDiagnostic((item) => debug.push(item.code), { logLevel: "debug" }),
        },
      ],
    });

    expect(root).toEqual([]);
    expect(info).toEqual(["sdk_initialized"]);
    expect(debug).toEqual(["sdk_initialized"]);
  });

  it("does not echo a module diagnostic to its source subscription", () => {
    const source: string[] = [];
    const observer: FeaturevisorDiagnostic[] = [];
    createFeaturevisor({
      logLevel: "fatal",
      modules: [
        {
          name: "observer",
          setup: ({ onDiagnostic }) =>
            onDiagnostic((item) => observer.push(item), { logLevel: "debug" }),
        },
        {
          name: "source",
          setup: ({ onDiagnostic, reportDiagnostic }) => {
            onDiagnostic((item) => source.push(item.code), { logLevel: "debug" });
            reportDiagnostic({ level: "warn", code: "custom", message: "Custom", payload: 42 });
          },
        },
      ],
    });

    expect(source).not.toContain("custom");
    expect(observer).toContainEqual(
      expect.objectContaining({ code: "custom", module: "source", payload: 42 }),
    );
  });

  it("unsubscribes diagnostic handlers explicitly and when a module is removed", () => {
    const seen: string[] = [];
    let unsubscribe: (() => void) | undefined;
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      modules: [
        {
          name: "observer",
          setup: ({ onDiagnostic }) => {
            unsubscribe = onDiagnostic((item) => seen.push(item.code), { logLevel: "debug" });
          },
        },
      ],
    });

    unsubscribe?.();
    sdk.setContext({ one: true });
    sdk.addModule({
      name: "observer-two",
      setup: ({ onDiagnostic }) =>
        onDiagnostic((item) => seen.push(item.code), { logLevel: "debug" }),
    });
    sdk.removeModule("observer-two");
    sdk.setContext({ two: true });

    expect(seen).toEqual(["sdk_initialized"]);
  });

  it("turns module evaluation exceptions into error diagnostics and safe results", () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createFeaturevisor({
      datafile,
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      modules: [
        {
          name: "broken",
          before: () => {
            throw new Error("broken-before");
          },
        },
      ],
    });

    expect(sdk.isEnabled("experiment", { userId: "user" })).toBe(false);
    expect(diagnostics.at(-1)).toEqual(
      expect.objectContaining({ code: "evaluation_error", originalError: expect.any(Error) }),
    );
  });

  it("awaits module close callbacks in registration order", async () => {
    const calls: string[] = [];
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      modules: [
        {
          name: "one",
          close: async () => {
            await Promise.resolve();
            calls.push("one");
          },
        },
        {
          name: "two",
          close: () => {
            calls.push("two");
          },
        },
      ],
    });

    const closing = sdk.close();
    expect(calls).toEqual([]);
    await closing;
    expect(calls).toEqual(["one", "two"]);
  });
});
