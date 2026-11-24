import * as fs from "fs";
import * as path from "path";
import type { Schema } from "@featurevisor/types";

import { superRefineVariableValue, valueMatchesSchema } from "./featureSchema";

interface ValidationCase {
  name: string;
  schemas: Record<string, Schema & { hash?: string }>;
  schema: string;
  value: unknown;
  issues: unknown[];
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../../conformance/schemas-validation.json"),
    "utf8",
  ),
) as { cases: ValidationCase[] };

describe("lint against the shared schemas validation fixture", () => {
  // Lint checks a value against a schema's base rules, so cases whose rules change under
  // conditions, or that report issue entries, are the package's alone.
  const cases = fixture.cases.filter(
    (testCase) =>
      testCase.schemas[testCase.schema] &&
      !/"(mutations|issues)":/.test(JSON.stringify(testCase.schemas)),
  );

  test.each(cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    (_name, testCase) => {
      const schemas: Record<string, Schema> = {};
      // A datafile's entries carry a hash, which lint's schemas never have.
      for (const [key, entry] of Object.entries(testCase.schemas)) {
        const schema = { ...entry };
        delete schema.hash;
        schemas[key] = schema;
      }

      const accepted = valueMatchesSchema(
        schemas[testCase.schema] as Record<string, unknown>,
        testCase.value,
        schemas,
      );
      const expected = testCase.issues.length === 0;

      expect(accepted).toBe(expected);
    },
  );

  test.each(cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s, as a variable's value",
    (_name, testCase) => {
      const schemas: Record<string, Schema> = {};
      for (const [key, entry] of Object.entries(testCase.schemas)) {
        const schema = { ...entry };
        delete schema.hash;
        schemas[key] = schema;
      }
      const issues: unknown[] = [];
      superRefineVariableValue(
        {} as never,
        schemas[testCase.schema] as never,
        testCase.value,
        [],
        { addIssue: (issue: unknown) => issues.push(issue) } as never,
        "subject",
        schemas,
      );

      // Lint's own wording for variables, which must still pass and fail what the package does.
      expect(issues.length === 0).toBe(testCase.issues.length === 0);
    },
  );
});
