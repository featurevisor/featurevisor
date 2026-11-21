import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./instance";
import type { FeaturevisorDiagnostic, FeaturevisorLogLevel } from "./diagnostics";
import type { FeaturevisorModule, FeaturevisorModuleApi } from "./modules";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

const datafile: DatafileContent = {
  schemaVersion: "4",
  revision: "1",
  segments: {},
  features: {
    checkout: { hash: "c", bucketBy: "userId", traffic: [everyone] },
    legacy: { hash: "l", bucketBy: "userId", deprecated: true, traffic: [everyone] },
  },
  variables: {
    banner: { hash: "b", type: "string", defaultValue: "Welcome" },
    oldBanner: { hash: "o", type: "string", defaultValue: "Hi", deprecated: true },
  },
};

const context = { userId: "user-1" };

/** What a list of diagnostics says, without the evaluation objects. */
function summary(diagnostics: FeaturevisorDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => {
    const details = diagnostic.details;
    const key = details.featureKey || details.variableKey || "-";
    return `${diagnostic.level} ${diagnostic.code} ${String(key)}`;
  });
}

function listening(
  name: string,
  logLevel: FeaturevisorLogLevel,
  handle: (diagnostic: FeaturevisorDiagnostic, api: FeaturevisorModuleApi) => void = () => {},
): {
  module: FeaturevisorModule;
  received: FeaturevisorDiagnostic[];
  api: () => FeaturevisorModuleApi;
} {
  const received: FeaturevisorDiagnostic[] = [];
  let moduleApi: FeaturevisorModuleApi | undefined;

  return {
    received,
    api: () => moduleApi as FeaturevisorModuleApi,
    module: {
      name,
      setup(api) {
        moduleApi = api;
        api.onDiagnostic(
          (diagnostic) => {
            received.push(diagnostic);
            handle(diagnostic, api);
          },
          { logLevel },
        );
      },
    },
  };
}

describe("diagnostics reach whoever asks for their level", () => {
  test("onDiagnostic receives evaluations at debug, and nothing below its level", () => {
    const received: FeaturevisorDiagnostic[] = [];
    const f = createFeaturevisor({
      datafile,
      logLevel: "info",
      onDiagnostic: (diagnostic) => void received.push(diagnostic),
    });
    received.length = 0;

    expect(f.isEnabled("checkout", context)).toBe(true);
    expect(f.getVariable("banner", context)).toBe("Welcome");
    expect(received).toEqual([]);

    f.setLogLevel("debug");
    expect(f.isEnabled("checkout", context)).toBe(true);
    expect(f.getVariable("banner", context)).toBe("Welcome");

    expect(summary(received)).toEqual(["debug rule checkout", "debug variable_default banner"]);
    expect(received[1].message).toBe("Global variable evaluated");
    expect(received[1].details).toMatchObject({ type: "variable", variableValue: "Welcome" });
  });

  test("module handlers receive the levels they ask for, whatever the instance's level", () => {
    const debug = listening("debug", "debug");
    const warn = listening("warn", "warn");
    const f = createFeaturevisor({
      datafile,
      logLevel: "fatal",
      modules: [debug.module, warn.module],
    });
    debug.received.length = 0;

    f.isEnabled("checkout", context);
    f.isEnabled("legacy", context);
    f.getVariable("oldBanner", context);

    expect(summary(debug.received)).toEqual([
      "debug rule checkout",
      "warn deprecated_feature legacy",
      "debug rule legacy",
      "warn deprecated_variable oldBanner",
      "debug variable_default oldBanner",
    ]);
    expect(summary(warn.received)).toEqual([
      "warn deprecated_feature legacy",
      "warn deprecated_variable oldBanner",
    ]);
  });

  test("a module never receives its own diagnostics, which still reach everyone else", () => {
    const reporter = listening("reporter", "debug");
    const other = listening("other", "debug");
    const received: FeaturevisorDiagnostic[] = [];
    const f = createFeaturevisor({
      datafile,
      logLevel: "warn",
      onDiagnostic: (diagnostic) => void received.push(diagnostic),
      modules: [reporter.module],
    });
    reporter.received.length = 0;
    const report = () =>
      reporter.api().reportDiagnostic({ level: "debug", code: "own", message: "Own" });

    report();
    expect(reporter.received).toEqual([]);
    expect(received).toEqual([]);

    f.addModule(other.module);
    report();
    expect(summary(other.received)).toEqual(["debug own -"]);
    expect(other.received[0].module).toBe("reporter");

    f.setLogLevel("debug");
    report();
    expect(summary(received)).toEqual(["debug own -"]);
    expect(reporter.received).toEqual([]);
  });

  test("the console logs what the instance's level lets through", () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const calls = () =>
      spies.flatMap((spy, index) =>
        spy.mock.calls.map((call) => `${methods[index]} ${String(call[1])}`),
      );

    try {
      const f = createFeaturevisor({ datafile, logLevel: "warn" });
      f.isEnabled("checkout", context);
      f.getVariable("banner", context);
      expect(calls()).toEqual([]);

      f.isEnabled("legacy", context);
      expect(calls()).toEqual(["warn Feature is deprecated"]);

      f.setLogLevel("debug");
      f.getVariable("banner", context);
      expect(calls()).toHaveLength(2);
      expect(calls()[1]).toMatch(/Global variable evaluated$/);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  test("errors reach error listeners at any level", () => {
    const received: FeaturevisorDiagnostic[] = [];
    const errors: string[] = [];
    const f = createFeaturevisor({
      datafile,
      logLevel: "fatal",
      onDiagnostic: (diagnostic) => void received.push(diagnostic),
    });
    f.on("error", ({ diagnostic }) => void errors.push(diagnostic.code));

    f.setDatafile("not a datafile");

    expect(errors).toEqual(["invalid_datafile"]);
    expect(received).toEqual([]);
  });

  test("a level raised by a handler during an evaluation reaches the rest of that evaluation", () => {
    const received: FeaturevisorDiagnostic[] = [];
    const raiser = listening("raiser", "warn", () => f.setLogLevel("debug"));
    const f = createFeaturevisor({
      datafile,
      logLevel: "warn",
      onDiagnostic: (diagnostic) => void received.push(diagnostic),
      modules: [raiser.module],
    });

    f.isEnabled("legacy", context);
    expect(summary(received)).toEqual(["warn deprecated_feature legacy", "debug rule legacy"]);

    received.length = 0;
    f.setLogLevel("warn");
    f.getVariable("oldBanner", context);
    expect(summary(received)).toEqual([
      "warn deprecated_variable oldBanner",
      "debug variable_default oldBanner",
    ]);
  });
});
