import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatafileContent } from "@featurevisor/types";
import { createFeaturevisor, type Featurevisor } from "./instance";

interface Diagnostic {
  code: string;
  level: string;
  details: { conditions: unknown; entityType: string; entityKey: string };
  revision: string;
}

interface Operation {
  action: "setDatafile" | "isEnabled";
  datafile: DatafileContent;
  replace: boolean;
  feature: string;
  expectedResult: boolean;
  diagnostics: Diagnostic[];
}

const fixture: {
  kind: string;
  version: number;
  cases: { name: string; operations: Operation[] }[];
} = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-diagnostics.json"), "utf8"),
);

describe("portable selector diagnostics", () => {
  test("has an executable diagnostic contract", () => {
    expect(fixture.kind).toBe("featurevisor.sdk-diagnostics");
    expect(fixture.version).toBe(1);
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  test.each(fixture.cases)("$name", (testCase: { operations: Operation[] }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const diagnostics: Diagnostic[] = [];
      const reentries: boolean[] = [];
      let insideCallback = false;
      let f: Featurevisor;
      f = createFeaturevisor({
        logLevel: "error",
        onDiagnostic(diagnostic) {
          if (diagnostic.code !== "conditions_parse_error") return;
          const details = diagnostic.details as Diagnostic["details"];
          diagnostics.push({
            code: diagnostic.code,
            level: diagnostic.level,
            details,
            revision: f.getRevision(),
          });
          if (details.entityType === "feature" && !insideCallback) {
            insideCallback = true;
            try {
              reentries.push(f.isEnabled(details.entityKey, { userId: "u" }));
            } finally {
              insideCallback = false;
            }
          }
        },
      });
      try {
        for (const operation of testCase.operations) {
          diagnostics.length = 0;
          const result =
            operation.action === "setDatafile"
              ? f.setDatafile(operation.datafile, operation.replace)
              : f.isEnabled(operation.feature, { userId: "u" });
          expect(result).toBe(operation.expectedResult);
          const ordered = (items: Diagnostic[]) =>
            [...items].sort((a, b) =>
              `${a.details.entityType}:${a.details.entityKey}`.localeCompare(
                `${b.details.entityType}:${b.details.entityKey}`,
              ),
            );
          expect(ordered(diagnostics)).toEqual(ordered(operation.diagnostics));
        }
        expect(reentries).toEqual([true, true, true]);
      } finally {
        f.close();
      }
    }
  });
});
