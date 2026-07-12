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

  it("removes named modules through both removeModule and addModule unsubscribe", async () => {
    let calls = 0;
    const closed: string[] = [];
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile });
    const unsubscribe = sdk.addModule({
      name: "dynamic",
      before: (options) => {
        calls += 1;
        return options;
      },
      close: () => {
        closed.push("dynamic");
      },
    });

    sdk.isEnabled("experiment", { userId: "one" });
    await unsubscribe?.();
    sdk.isEnabled("experiment", { userId: "two" });
    sdk.addModule({
      name: "dynamic",
      before: (options) => ((calls += 10), options),
      close: () => {
        closed.push("dynamic-again");
      },
    });
    await sdk.removeModule("dynamic");
    sdk.isEnabled("experiment", { userId: "three" });

    expect(calls).toBe(1);
    expect(closed).toEqual(["dynamic", "dynamic-again"]);
  });

  it("awaits async close when unsubscribing modules returned by addModule", async () => {
    let calls = 0;
    const closed: string[] = [];
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile });
    const unsubscribe = sdk.addModule({
      before: (options) => {
        calls += 1;
        return options;
      },
      close: async () => {
        await Promise.resolve();
        closed.push("closed");
      },
    });

    sdk.isEnabled("experiment", { userId: "one" });
    const unsubscribed = unsubscribe?.();
    expect(closed).toEqual([]);
    await unsubscribed;
    await unsubscribe?.();
    sdk.isEnabled("experiment", { userId: "two" });

    expect(calls).toBe(1);
    expect(closed).toEqual(["closed"]);
  });

  it("reports diagnostics when dynamically removed module close fails", async () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const errorEvents: FeaturevisorDiagnostic[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      datafile,
    });
    sdk.on("error", (event) => errorEvents.push(event.diagnostic));

    sdk.addModule({
      name: "broken-close",
      close: () => {
        throw new Error("broken-close");
      },
    });

    await sdk.removeModule("broken-close");

    expect(diagnostics[diagnostics.length - 1]).toEqual(
      expect.objectContaining({
        code: "module_close_error",
        moduleName: "broken-close",
        originalError: expect.any(Error),
      }),
    );
    expect(errorEvents[errorEvents.length - 1]).toEqual(diagnostics[diagnostics.length - 1]);
  });

  it("reports diagnostics when unsubscribe close fails", async () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      datafile,
    });

    const unsubscribe = sdk.addModule({
      name: "broken-unsubscribe",
      close: async () => {
        await Promise.resolve();
        throw new Error("broken-unsubscribe");
      },
    });

    await unsubscribe?.();

    expect(diagnostics[diagnostics.length - 1]).toEqual(
      expect.objectContaining({
        code: "module_close_error",
        moduleName: "broken-unsubscribe",
        originalError: expect.any(Error),
      }),
    );
  });

  it("does not add or close rejected duplicate named modules", async () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const closed: string[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      datafile,
    });

    sdk.addModule({
      name: "same",
      close: () => {
        closed.push("first");
        throw new Error("first-close");
      },
    });
    sdk.addModule({
      close: () => {
        closed.push("anonymous");
      },
    });
    sdk.addModule({
      name: "same",
      close: () => {
        closed.push("duplicate");
      },
    });

    await sdk.removeModule("same");

    expect(closed).toEqual(["first"]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "duplicate_module",
        moduleName: "same",
      }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "module_close_error",
        moduleName: "same",
      }),
    );
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
    expect(diagnostics[diagnostics.length - 1]).toEqual(
      expect.objectContaining({ code: "duplicate_module", moduleName: "same" }),
    );
  });

  it("reports setup failures and leaves the failed module unregistered", async () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const closed: string[] = [];
    const sdk = createFeaturevisor({
      datafile,
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
    });

    const result = sdk.addModule({
      name: "broken-setup",
      setup: ({ onDiagnostic }) => {
        onDiagnostic(() => undefined);
        throw new Error("broken-setup");
      },
      before: (options) => {
        throw new Error(`should not run ${options.featureKey}`);
      },
      close: () => {
        closed.push("broken-setup");
      },
    });

    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(sdk.isEnabled("experiment", { userId: "user" })).toBe(true);
    expect(closed).toEqual(["broken-setup"]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "module_setup_error",
        moduleName: "broken-setup",
        originalError: expect.any(Error),
      }),
    );
  });

  it("isolates throwing root and module diagnostic handlers", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const observed: string[] = [];
    const sdk = createFeaturevisor({
      datafile,
      logLevel: "debug",
      onDiagnostic: () => {
        throw new Error("broken-root-handler");
      },
      modules: [
        {
          name: "broken-observer",
          setup: ({ onDiagnostic }) =>
            onDiagnostic(
              () => {
                throw new Error("broken-module-handler");
              },
              { logLevel: "debug" },
            ),
        },
        {
          name: "working-observer",
          setup: ({ onDiagnostic }) =>
            onDiagnostic((diagnostic) => observed.push(diagnostic.code), { logLevel: "debug" }),
        },
      ],
    });

    expect(sdk.isEnabled("experiment", { userId: "user" })).toBe(true);
    expect(observed).toContain("sdk_initialized");
    expect(consoleError).toHaveBeenCalledWith(
      "[Featurevisor]",
      "Diagnostic handler failed",
      expect.any(Error),
    );

    consoleError.mockRestore();
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
            reportDiagnostic({
              level: "warn",
              code: "custom",
              message: "Custom",
              details: { payload: 42 },
            });
          },
        },
      ],
    });

    expect(source).not.toContain("custom");
    expect(observer).toContainEqual(
      expect.objectContaining({ code: "custom", module: "source", details: { payload: 42 } }),
    );
  });

  it("unsubscribes diagnostic handlers explicitly and when a module is removed", async () => {
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
    await sdk.removeModule("observer-two");
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
    expect(diagnostics[diagnostics.length - 1]).toEqual(
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

  it("reports close diagnostics and continues closing remaining modules on instance close", async () => {
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const calls: string[] = [];
    const sdk = createFeaturevisor({
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
      modules: [
        {
          name: "broken",
          close: async () => {
            await Promise.resolve();
            calls.push("broken");
            throw new Error("broken-close");
          },
        },
        {
          name: "after",
          close: () => {
            calls.push("after");
          },
        },
      ],
    });

    await sdk.close();

    expect(calls).toEqual(["broken", "after"]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "module_close_error",
        moduleName: "broken",
        originalError: expect.any(Error),
      }),
    );
  });
});
