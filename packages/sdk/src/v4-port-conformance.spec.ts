import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Context, DatafileContent } from "@featurevisor/types";

import { createFeaturevisor, type FeaturevisorOptions } from "./instance";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v4-cases.json"), "utf8"),
) as {
  version: number;
  cases: Array<{
    name: string;
    datafile: DatafileContent;
    context: Context;
    options: FeaturevisorOptions;
    expected: { value: unknown; reason: string; [key: string]: unknown };
  }>;
};

describe("portable v4 SDK cases", () => {
  test("covers the complete supplemental contract", () => {
    expect(fixture.version).toBe(1);
    expect(fixture.cases).toHaveLength(255);
  });

  test.each(fixture.cases)("$name", async ({ datafile, context, options, expected }) => {
    const input = JSON.parse(JSON.stringify(datafile)) as DatafileContent;
    const f = createFeaturevisor({ datafile: input, logLevel: "fatal", ...options });
    for (let repetition = 0; repetition < 2; repetition++) {
      const evaluation = f.evaluateVariable("subject", context);
      const { value, ...metadata } = expected;
      expect(f.getVariable("subject", context)).toEqual(value);
      expect(evaluation).toMatchObject(metadata);
      // Segment expressions are deliberately parsed and cached in place. The
      // cached representation may change, but never its meaning or any values.
      const normalizeSegments = (source: DatafileContent) => ({
        ...source,
        segments: Object.fromEntries(
          Object.entries(source.segments).map(([key, segment]) => [
            key,
            {
              ...segment,
              conditions:
                typeof segment.conditions === "string" && segment.conditions !== "*"
                  ? JSON.parse(segment.conditions)
                  : segment.conditions,
            },
          ]),
        ),
      });
      expect(normalizeSegments(input)).toEqual(normalizeSegments(datafile));
    }
    await f.close();
  });

  test("compares the ordinary getter null when a dependency module fails", async () => {
    const f = createFeaturevisor({
      logLevel: "fatal",
      modules: [
        {
          name: "source-error",
          beforeEvaluation(options) {
            if (options.variableKey === "source") throw new Error("source failed");
            return options;
          },
        },
      ],
      datafile: {
        schemaVersion: "2",
        revision: "module-error",
        features: {},
        segments: {},
        variables: {
          source: { type: "string", defaultValue: "value" },
          subject: {
            type: "boolean",
            defaultValue: true,
            disabledValue: false,
            conditions: [{ variable: "source", operator: "isNull" }],
          },
        },
      },
    });
    expect(f.getVariable("subject")).toBe(true);
    expect(f.evaluateVariable("subject").reason).toBe("variable_default");
    await f.close();
  });

  test.each(["disabled", "negated"])(
    "honours a required feature's ordinary false result after a module error: %s",
    async (form) => {
      const f = createFeaturevisor({
        logLevel: "fatal",
        modules: [
          {
            name: "source-error",
            beforeEvaluation(options) {
              if ("featureKey" in options && options.featureKey === "source")
                throw new Error("source failed");
              return options;
            },
          },
        ],
        datafile: {
          schemaVersion: "2",
          revision: "feature-module-error",
          segments: {},
          features: {
            source: { bucketBy: "userId", traffic: [] },
            subject: {
              bucketBy: "userId",
              requiredFeatures:
                form === "disabled"
                  ? [{ feature: "source", enabled: false }]
                  : [{ not: ["source"] }],
              traffic: [{ key: "all", segments: "*", percentage: 100000 }],
            },
          },
        },
      });
      expect(f.isEnabled("source")).toBe(false);
      expect(f.isEnabled("subject")).toBe(true);
      await f.close();
    },
  );
});
