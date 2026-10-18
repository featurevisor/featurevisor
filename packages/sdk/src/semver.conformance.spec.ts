import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlainCondition, Condition } from "@featurevisor/types";

import { compareVersions } from "./compareVersions";
import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/semver.json"), "utf8"),
);
const operators = [
  "semverEquals",
  "semverNotEquals",
  "semverGreaterThan",
  "semverGreaterThanOrEquals",
  "semverLessThan",
  "semverLessThanOrEquals",
] as const;

describe("portable version comparisons", () => {
  test.each(["conditions", "segments"] as const)(
    "unmatched %s skip override prerequisites and their callbacks",
    async (selector) => {
      for (const program of [false, true]) {
        const visited: string[] = [];
        const condition: PlainCondition = {
          attribute: "selected",
          operator: "equals",
          value: true,
        };
        const override = {
          key: "version",
          conditions: [
            selector === "conditions" ? condition : "selected",
            { feature: "prerequisite" },
            { variable: "source", operator: "semverEquals" as const, value: "1.0.0" },
          ],
        };
        const f = createFeaturevisor({
          logLevel: "fatal",
          modules: [
            {
              name: "observe",
              beforeEvaluation(options) {
                const key = "featureKey" in options ? options.featureKey : options.variableKey;
                if (key) visited.push(key);
                if (key === "prerequisite" || key === "source")
                  throw new Error("Skipped dependency was evaluated");
                return options;
              },
            },
          ],
          datafile: createDatafile({
            segments: { selected: { conditions: condition } },
            features: { prerequisite: createFeature() },
            variables: {
              source: { type: "string", defaultValue: "not a version" },
              subject: {
                type: "string",
                defaultValue: "unchanged",
                ...(program
                  ? {
                      overrideProgram: [
                        {
                          ...override,
                          operations: [{ op: "set", path: [], value: "matched" }],
                          onMatch: 1,
                          onMiss: 1,
                        },
                      ],
                    }
                  : { overrides: [{ ...override, value: "matched" }] }),
              },
            },
          }),
        });
        expect(f.getVariable("subject", { selected: false })).toBe("unchanged");
        expect(visited).toEqual(["subject"]);
        await f.close();
      }
    },
  );

  test("identifies the complete contract", () => {
    expect(fixture.kind).toBe("featurevisor.semver");
    expect(fixture.version).toBe(1);
    expect(fixture.cases).toHaveLength(44);
  });

  for (const { name, left, right, order } of fixture.cases) {
    for (const reverse of [false, true]) {
      const a = reverse ? right : left;
      const b = reverse ? left : right;
      const comparison = order === null ? null : reverse ? -order : order;
      test(`${name}: ${reverse ? "reverse" : "forward"} helper`, () => {
        if (comparison === null) expect(() => compareVersions(a, b)).toThrow();
        else expect(compareVersions(a, b)).toBe(comparison === 0 ? 0 : comparison);
      });
      operators.forEach((operator, index) => {
        const expected =
          comparison !== null &&
          [
            comparison === 0,
            comparison !== 0,
            comparison > 0,
            comparison >= 0,
            comparison < 0,
            comparison <= 0,
          ][index];
        test(`${name}: ${reverse ? "reverse" : "forward"} ${operator}`, async () => {
          const condition: PlainCondition = { attribute: "version", operator, value: b };
          for (const featureSource of [false, true]) {
            const requirement: Condition = {
              ...(featureSource ? { feature: "sourceFeature" } : {}),
              variable: "source",
              operator,
              value: b,
            };
            const f = createFeaturevisor({
              logLevel: "fatal",
              datafile: createDatafile({
                segments: { version: { conditions: condition } },
                features: {
                  condition: createFeature({
                    traffic: [
                      { key: "version", segments: ["version"], percentage: 100000, allocation: [] },
                    ],
                  }),
                  sourceFeature: createFeature({
                    variablesSchema: { source: { type: "string", defaultValue: a } },
                  }),
                  required: createFeature({ conditions: [requirement] }),
                },
                variables: {
                  source: { type: "string", defaultValue: a },
                  subject: {
                    type: "boolean",
                    defaultValue: true,
                    disabledValue: false,
                    conditions: [requirement],
                  },
                  negated: {
                    type: "boolean",
                    defaultValue: true,
                    disabledValue: false,
                    conditions: [{ not: [requirement] }],
                  },
                },
              }),
            });
            expect(f.isEnabled("condition", { version: a })).toBe(expected);
            expect(f.isEnabled("required")).toBe(expected);
            expect(f.getVariable("subject")).toBe(comparison === null ? null : expected);
            expect(f.getVariable("negated")).toBe(comparison === null ? null : !expected);
            if (comparison === null) expect(f.evaluateVariable("subject").reason).toBe("error");
            await f.close();
          }
        });
      });
    }
  }
});
