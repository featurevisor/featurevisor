import * as fs from "fs";
import * as path from "path";
import type { Schema } from "@featurevisor/types";

import { valueMatchesSchema } from "./featureSchema";

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

/**
 * Where lint's boolean value path still answers otherwise than the shared
 * fixture. Lint moves onto the schemas package's engine later, which removes
 * these, and then this list empties.
 */
const KNOWN_DIFFERENCES = new Set(["a flat object rejects a nested value"]);

describe("lint against the shared schemas validation fixture", () => {
  const cases = fixture.cases.filter((testCase) => testCase.schemas[testCase.schema]);

  test.each(cases.map((testCase) => [testCase.name, testCase] as const))("%s", (name, testCase) => {
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

    // A known difference that no longer differs should leave the list.
    expect(accepted === expected).toBe(!KNOWN_DIFFERENCES.has(name));
  });
});
