import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Context, DatafileContent } from "@featurevisor/types";

import type { DatafileSetEventDetails } from "./events";
import { createFeaturevisor, type Featurevisor } from "./instance";
import type { FeaturevisorModuleApi } from "./modules";

interface ExpectedResult {
  method: "isEnabled" | "getVariation" | "getVariable";
  args: string[];
  value: unknown;
}

interface ExpectedCarriage {
  sections?: Record<string, string[]>;
  entryKeys?: Record<string, string[]>;
  entries?: Array<{ section: string; key: string; value: unknown }>;
}

interface EvaluationCase {
  name: string;
  datafile: DatafileContent | string;
  context: Context;
  results: ExpectedResult[];
}

interface CarriageCase {
  name: string;
  initial: { datafile: DatafileContent };
  expectInitial: ExpectedCarriage;
  operations: Array<{
    action: "setDatafile";
    replace: boolean;
    datafile: DatafileContent;
    expect: ExpectedCarriage;
  }>;
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-sections.json"), "utf8"),
) as {
  kind: string;
  schemaVersion: number;
  evaluationCases: EvaluationCase[];
  carriageCases: CarriageCase[];
};

const SDK_KEYS = new Set(["schemaVersion", "revision", "segments", "features", "variables"]);

function withoutSections(datafile: DatafileContent | string): DatafileContent {
  const parsed = typeof datafile === "string" ? JSON.parse(datafile) : datafile;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (SDK_KEYS.has(key) || key === "attributes") copy[key] = parsed[key];
  }
  return copy as unknown as DatafileContent;
}

function evaluate(f: Featurevisor, result: ExpectedResult): unknown {
  const methods = f as unknown as Record<string, (...args: string[]) => unknown>;
  return methods[result.method](...result.args);
}

/** Lists compare unordered, since platforms keep keys in different orders. */
function unordered(record: Record<string, string[]>): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const key of Object.keys(record)) copy[key] = [...record[key]].sort();
  return copy;
}

function checkCarriage(
  api: FeaturevisorModuleApi,
  expected: ExpectedCarriage,
  details?: DatafileSetEventDetails,
) {
  if (expected.sections) expect(unordered(details!.sections)).toEqual(unordered(expected.sections));
  for (const [section, keys] of Object.entries(expected.entryKeys || {})) {
    expect([...api.getEntryKeys(section)].sort()).toEqual([...keys].sort());
  }
  for (const { section, key, value } of expected.entries || []) {
    expect(api.getEntry(section, key) ?? null).toEqual(value);
  }
}

describe("SDK sections conformance", () => {
  test("uses the versioned portable envelope", () => {
    expect(fixture.kind).toBe("featurevisor.sdk-sections");
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.evaluationCases.length).toBeGreaterThan(0);
    expect(fixture.carriageCases.length).toBeGreaterThan(0);
  });

  test.each(fixture.evaluationCases)("evaluation: $name", ({ datafile, context, results }) => {
    const f = createFeaturevisor({ datafile, context, logLevel: "fatal" });
    const plain = createFeaturevisor({
      datafile: withoutSections(datafile),
      context,
      logLevel: "fatal",
    });

    for (let run = 0; run < 2; run++) {
      for (const result of results) {
        expect(evaluate(f, result)).toEqual(result.value);
        // The fixture's claim: the same datafile without sections answers the same.
        expect(evaluate(plain, result)).toEqual(result.value);
      }
    }
  });

  test.each(fixture.carriageCases)("carriage: $name", ({ initial, expectInitial, operations }) => {
    let api: FeaturevisorModuleApi | undefined;
    const f = createFeaturevisor({ datafile: initial.datafile, logLevel: "fatal" });
    f.addModule(
      Object.freeze({
        name: "conformance-reader",
        setup: (moduleApi: FeaturevisorModuleApi) => void (api = moduleApi),
      }),
    );
    const events: DatafileSetEventDetails[] = [];
    f.on("datafile_set", (details) => events.push(details));

    checkCarriage(api!, expectInitial);
    for (const operation of operations) {
      f.setDatafile(operation.datafile, operation.replace);
      checkCarriage(api!, operation.expect, events[events.length - 1]);
    }
    expect(events).toHaveLength(operations.length);
  });
});
