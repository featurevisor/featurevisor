import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./instance";

function chain(length: number): DatafileContent {
  const features: DatafileContent["features"] = {};
  for (let index = 0; index < length; index++) {
    features[`f${index}`] = {
      bucketBy: "userId",
      variations: [{ value: "control" }],
      variablesSchema: { title: { key: "title", type: "string", defaultValue: "Title" } },
      traffic: [
        {
          key: "everyone",
          conditions: index === 0 ? "*" : JSON.stringify([{ feature: `f${index - 1}` }]),
          percentage: 100000,
          allocation: [{ variation: "control", range: [0, 100000] }],
        },
      ],
    } as DatafileContent["features"][string];
  }
  return { schemaVersion: "4", revision: "1", segments: {}, features };
}

function errorsDuring(datafile: DatafileContent, evaluate: (f: any) => unknown) {
  const errors: string[] = [];
  const f = createFeaturevisor({
    datafile,
    logLevel: "error",
    onDiagnostic: (diagnostic) => {
      if (diagnostic.level === "error") errors.push(diagnostic.code);
    },
  });
  const result = evaluate(f);
  f.close();
  return { result, errors };
}

describe("evaluation error diagnostics", () => {
  const deep = chain(300);
  const context = { userId: "u" };

  test.each([
    ["flag", (f: any) => f.isEnabled("f299", context), false],
    ["variation", (f: any) => f.getVariation("f299", context), null],
    ["variable", (f: any) => f.getVariable("f299", "title", context), null],
  ])("reports exhausted depth once for a %s", (_type, evaluate, expected) => {
    const { result, errors } = errorsDuring(deep, evaluate);
    expect(result).toBe(expected);
    expect(errors).toEqual(["evaluation_error"]);
  });

  test("keeps the 256 handoff boundary", () => {
    expect(errorsDuring(deep, (f) => f.isEnabled("f256", context))).toEqual({
      result: true,
      errors: [],
    });
    expect(errorsDuring(deep, (f) => f.isEnabled("f257", context)).errors).toEqual([
      "evaluation_error",
    ]);
  });

  test("reports a runtime cycle once", () => {
    const datafile: DatafileContent = {
      schemaVersion: "4",
      revision: "1",
      segments: {},
      features: {
        a: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              conditions: JSON.stringify([{ feature: "b" }]),
              percentage: 100000,
            },
          ],
        },
        b: {
          bucketBy: "userId",
          traffic: [
            {
              key: "all",
              conditions: JSON.stringify([{ feature: "a" }]),
              percentage: 100000,
            },
          ],
        },
      } as DatafileContent["features"],
    };
    const { result, errors } = errorsDuring(datafile, (f) => f.isEnabled("a", context));
    expect(result).toBe(false);
    expect(errors).toEqual(["evaluation_error"]);
  });

  test.each([
    ["alias", (index: number) => `v${index + 1}`],
    ["map", (index: number) => [{ key: "next", variable: `v${index + 1}` }]],
  ])("reports an exhausted %s composition chain once at the 256 boundary", (_form, compose) => {
    const variables: Record<string, unknown> = {};
    for (let index = 0; index < 300; index++)
      variables[`v${index}`] = { type: "object", compose: compose(index) };
    variables.v300 = { type: "integer", defaultValue: 1 };
    const datafile = { schemaVersion: "4", revision: "1", segments: {}, features: {}, variables };
    const deep = errorsDuring(datafile as unknown as DatafileContent, (f) =>
      f.getVariable("v0", context),
    );
    expect(deep).toEqual({ result: null, errors: ["evaluation_error"] });
    expect(
      errorsDuring(datafile as unknown as DatafileContent, (f) => f.getVariable("v44", context))
        .errors,
    ).toEqual([]);
  });

  test("reports each failing public call", () => {
    const errors: string[] = [];
    const f = createFeaturevisor({
      datafile: deep,
      logLevel: "error",
      onDiagnostic: (diagnostic) => {
        if (diagnostic.level === "error") errors.push(diagnostic.code);
      },
    });
    f.isEnabled("f299", context);
    f.isEnabled("f299", context);
    expect(errors).toEqual(["evaluation_error", "evaluation_error"]);
    f.close();
  });
});
