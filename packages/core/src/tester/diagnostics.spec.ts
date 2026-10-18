import type { DatafileContent } from "@featurevisor/types";

import { createTestDiagnosticHandler } from "./diagnostics";
import { getTestDatafileKey } from "./datafileKey";
import { testFeature } from "./testFeature";
import { testVariable } from "./testVariable";

describe("tester diagnostics", () => {
  const methods = ["log", "warn", "error", "info", "debug"] as const;
  beforeEach(() => {
    for (const method of methods) jest.spyOn(console, method).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function datafiles() {
    const datafile: DatafileContent = {
      schemaVersion: "2",
      revision: "test",
      segments: {},
      features: {
        checkout: {
          key: "checkout",
          bucketBy: "userId",
          traffic: [{ key: "all", segments: "*", percentage: 100000 }],
        },
      },
      variables: { malformed: { type: "json", defaultValue: "{" } },
    };
    return new Map([[getTestDatafileKey(false), datafile]]);
  }

  it.each([null, "control"])(
    "keeps warnings for passing and failing variation assertions (%s)",
    async (expectedVariation) => {
      const result = await testFeature(
        { readFeature: async () => ({ key: "checkout" }) } as any,
        {} as any,
        { feature: "checkout", assertions: [{ expectedVariation }] } as any,
        {},
        datafiles(),
      );
      expect(result.passed).toBe(expectedVariation === null);
      expect(console.warn).toHaveBeenCalledWith(
        '[Featurevisor] warn: No variations (feature "checkout")',
      );
      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { quiet: true }, { verbose: true }, { json: true }, { json: true, verbose: true }])(
    "formats parent and child feature warnings with options %j",
    async (options) => {
      const result = await testFeature(
        { readFeature: async () => ({ key: "checkout" }) } as any,
        {} as any,
        {
          feature: "checkout",
          assertions: [{ expectedVariation: null, children: [{ expectedVariation: null }] }],
        } as any,
        options,
        datafiles(),
      );
      expect(result.passed).toBe(true);
      expect(console.log).not.toHaveBeenCalled();
      if ("quiet" in options) {
        for (const method of methods) expect(console[method]).not.toHaveBeenCalled();
      } else {
        const output = "json" in options ? console.error : console.warn;
        const warnings = jest
          .mocked(output)
          .mock.calls.filter((call) =>
            call.some((value) => typeof value === "string" && value.includes("No variations")),
          );
        expect(warnings).toHaveLength(2);
        if ("verbose" in options) {
          expect(warnings[0]).toEqual([
            "[Featurevisor]",
            "No variations",
            expect.objectContaining({ code: "no_variations", level: "warn" }),
          ]);
        } else {
          expect(warnings[0]).toEqual(['[Featurevisor] warn: No variations (feature "checkout")']);
          expect(console.debug).not.toHaveBeenCalled();
          expect(console.info).not.toHaveBeenCalled();
        }
      }
      if ("json" in options) {
        expect(console.warn).not.toHaveBeenCalled();
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
      }
    },
  );

  it.each([{}, { quiet: true }, { verbose: true }, { json: true }, { json: true, verbose: true }])(
    "preserves root and child error failures with options %j",
    async (options) => {
      const checks = [{ variable: "malformed", operator: "isNull" as const }];
      const result = await testVariable(
        { scenario: "errors", assertions: [{ checks, children: [{ checks }] }] },
        options,
        datafiles(),
      );
      expect(result.passed).toBe(false);
      expect(result.assertions[0].errors).toHaveLength(2);
      expect(result.assertions[0].errors).toEqual([
        expect.objectContaining({
          expected: "successful comparison",
          actual: expect.stringContaining("getVariable failed"),
        }),
        expect.objectContaining({
          expected: "successful comparison",
          actual: expect.stringContaining("getVariable failed"),
          details: expect.objectContaining({ childIndex: 0 }),
        }),
      ]);
      expect(console.log).not.toHaveBeenCalled();
      if ("quiet" in options) {
        for (const method of methods) expect(console[method]).not.toHaveBeenCalled();
      } else if (!("verbose" in options)) {
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("getVariable failed"));
        for (const call of jest.mocked(console.error).mock.calls) {
          expect(call).toHaveLength(1);
          expect(typeof call[0]).toBe("string");
        }
      } else {
        expect(console.error).toHaveBeenCalledWith(
          "[Featurevisor]",
          expect.stringContaining("getVariable failed"),
          expect.objectContaining({ level: "error" }),
        );
      }
      if ("json" in options) {
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps error causes in concise output without stacks or multiline objects", () => {
    createTestDiagnosticHandler({})({
      level: "error",
      code: "evaluation_error",
      message: "Error during evaluation",
      originalError: new Error("Invalid value\nat input"),
      details: { featureKey: "checkout", variableKey: "limit", context: { userId: "private" } },
    });
    expect(console.error).toHaveBeenCalledWith(
      '[Featurevisor] error: Error during evaluation: Invalid value at input (feature "checkout", variable "limit")',
    );
  });
});
