import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VariableCheck } from "@featurevisor/types";
import { runVariableChecks } from "./checks";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../conformance/semver.json"), "utf8"),
);
const operators = [
  "semverEquals",
  "semverNotEquals",
  "semverGreaterThan",
  "semverGreaterThanOrEquals",
  "semverLessThan",
  "semverLessThanOrEquals",
] as const;

describe("portable version checks", () => {
  for (const { name, left, right, order } of fixture.cases) {
    for (const reverse of [false, true]) {
      const a = reverse ? right : left;
      const b = reverse ? left : right;
      const comparison = order === null ? null : reverse ? -order : order;
      operators.forEach((operator, index) => {
        test(`${name}: ${reverse ? "reverse" : "forward"} ${operator}`, () => {
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
          for (const compareTo of [false, true]) {
            const check: VariableCheck = {
              variable: "source",
              operator,
              ...(compareTo ? { compareTo: { variable: "other" } } : { value: b }),
            };
            const getter = (reference: { variable: string }) =>
              reference.variable === "source" ? a : b;
            const errors = runVariableChecks([check], getter);
            expect(errors.length === 0).toBe(expected);
            if (comparison === null) {
              expect(errors[0].expected).toMatch(/valid checks|successful comparison/);
              const negated = runVariableChecks([{ not: [check] }], getter);
              expect(negated).toHaveLength(1);
              expect(negated[0].expected).toMatch(/valid checks|successful comparison/);
            }
          }
        });
      });
    }
  }
});
