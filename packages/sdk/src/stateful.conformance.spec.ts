import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Context,
  DatafileContent,
  StickyFeatures,
  StickyVariables,
} from "@featurevisor/types";

import type { FeaturevisorChildInstance } from "./child";
import type { EventName } from "./events";
import { createFeaturevisor, type Featurevisor, type SpawnOptions } from "./instance";

type StatefulInstance = Featurevisor | FeaturevisorChildInstance;

interface ExpectedEvent {
  target: string;
  name: EventName;
  details: object;
}

interface ExpectedResult {
  target: string;
  method: "getRevision" | "isEnabled" | "getVariable";
  args: unknown[];
  value: unknown;
}

interface Operation {
  action: "spawn" | "setDatafile" | "setStickyFeatures" | "setStickyVariables";
  target: string;
  parent?: string;
  context?: Context;
  options?: SpawnOptions;
  datafile?: DatafileContent | string;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  replace?: boolean;
  expect: {
    error?: { code: string };
    events?: ExpectedEvent[];
    results?: ExpectedResult[];
  };
}

interface StatefulCase {
  name: string;
  initial: {
    datafile: DatafileContent | string;
    context?: Context;
    stickyFeatures?: StickyFeatures;
    stickyVariables?: StickyVariables;
  };
  operations: Operation[];
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-stateful.json"), "utf8"),
) as {
  kind: string;
  schemaVersion: number;
  cases: StatefulCase[];
};

function subscribe(target: string, instance: StatefulInstance, events: ExpectedEvent[]): void {
  instance.on("datafile_set", (details) => events.push({ target, name: "datafile_set", details }));
  instance.on("context_set", (details) => events.push({ target, name: "context_set", details }));
  instance.on("sticky_features_set", (details) =>
    events.push({ target, name: "sticky_features_set", details }),
  );
  instance.on("sticky_variables_set", (details) =>
    events.push({ target, name: "sticky_variables_set", details }),
  );
}

function evaluateResult(instance: StatefulInstance, result: ExpectedResult): unknown {
  const methods = instance as unknown as Record<string, (...args: never[]) => unknown>;
  return methods[result.method](...(result.args as never[]));
}

describe("stateful SDK conformance", () => {
  test("uses the versioned portable envelope", () => {
    expect(fixture.kind).toBe("featurevisor.sdk-stateful");
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
  });

  test.each(fixture.cases)("$name", async ({ initial, operations }) => {
    const root = createFeaturevisor({ ...initial, logLevel: "fatal" });
    const instances = new Map<string, StatefulInstance>([["root", root]]);
    const events: ExpectedEvent[] = [];
    const errors: Array<{ code: string }> = [];
    subscribe("root", root, events);
    root.on("error", ({ diagnostic }) => errors.push({ code: diagnostic.code }));

    for (const operation of operations) {
      if (operation.action === "spawn") {
        const parent = instances.get(operation.parent || "root");
        if (!parent || !("spawn" in parent)) throw new Error("Stateful fixture parent not found");
        const child = parent.spawn(operation.context || {}, operation.options || {});
        instances.set(operation.target, child);
        subscribe(operation.target, child, events);
      } else {
        const instance = instances.get(operation.target);
        if (!instance) throw new Error("Stateful fixture target not found");

        if (operation.action === "setDatafile") {
          if (!("setDatafile" in instance) || operation.datafile === undefined)
            throw new Error("Invalid stateful setDatafile operation");
          instance.setDatafile(operation.datafile, operation.replace);
        } else if (operation.action === "setStickyFeatures") {
          if (!operation.stickyFeatures)
            throw new Error("Invalid stateful setStickyFeatures operation");
          instance.setStickyFeatures(operation.stickyFeatures, operation.replace);
        } else if (operation.action === "setStickyVariables") {
          if (!operation.stickyVariables)
            throw new Error("Invalid stateful setStickyVariables operation");
          instance.setStickyVariables(operation.stickyVariables, operation.replace);
        } else {
          throw new Error("Unknown stateful fixture action");
        }
      }

      if (operation.expect.events) {
        expect(events).toHaveLength(operation.expect.events.length);
        operation.expect.events.forEach((expected, index) => {
          const ordered = (event: ExpectedEvent) =>
            event.name !== "datafile_set"
              ? event
              : {
                  ...event,
                  details: {
                    ...event.details,
                    features: [
                      ...((event.details as Record<string, unknown>).features as string[]),
                    ].sort(),
                    variables: [
                      ...((event.details as Record<string, unknown>).variables as string[]),
                    ].sort(),
                  },
                };
          expect(ordered(events[index])).toEqual(ordered(expected));
        });
      }
      events.length = 0;
      expect(errors).toEqual(operation.expect.error ? [operation.expect.error] : []);
      errors.length = 0;

      for (const result of operation.expect.results || []) {
        const instance = instances.get(result.target);
        if (!instance) throw new Error("Stateful fixture result target not found");
        expect(evaluateResult(instance, result)).toEqual(result.value);
      }
    }

    for (const [target, instance] of instances) {
      if (target !== "root") instance.close();
    }
    await root.close();
  });
});
