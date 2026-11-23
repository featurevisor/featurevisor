/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { createSchemas } from "./index";

interface PortableIssue {
  readonly code: string;
  readonly path: ReadonlyArray<string | number>;
  readonly params: Readonly<Record<string, unknown>>;
}

interface ValidationCase {
  name: string;
  schemas: DatafileContent["schemas"];
  schema: string;
  value: unknown;
  issues: PortableIssue[];
}

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../conformance/schemas-validation.json"), "utf8"),
) as { kind: string; schemaVersion: number; cases: ValidationCase[] };

/** Issues compare as an unordered list, since platforms walk keys in different orders. */
function sorted(issues: ReadonlyArray<PortableIssue>): PortableIssue[] {
  return issues
    .map(({ code, path, params }) => ({ code, path, params }))
    .sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
}

describe("schemas validation conformance", () => {
  test("is the version this runner knows", () => {
    expect(fixture.kind).toBe("featurevisor.schemas-validation");
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  test.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    (_name, testCase) => {
      const f = createFeaturevisor({
        datafile: {
          schemaVersion: "4",
          revision: "1",
          segments: {},
          features: {},
          variables: {},
          schemas: testCase.schemas,
        } as DatafileContent,
        logLevel: "fatal",
      });
      const s = createSchemas(f);

      // Twice, so a compiled schema answers as a fresh one does.
      for (let run = 0; run < 2; run++) {
        const result = s.validate(testCase.schema, testCase.value);
        expect(sorted(result.issues || [])).toEqual(sorted(testCase.issues));
      }
    },
  );
});
