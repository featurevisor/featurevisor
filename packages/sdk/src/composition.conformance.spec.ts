import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DatafileContent,
  Context,
  StickyFeatures,
  StickyVariables,
} from "@featurevisor/types";
import type { Evaluation } from "./evaluate";
import { createFeaturevisor } from "./instance";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-composition.json"), "utf8"),
) as {
  version: number;
  capability: string;
  datafile: DatafileContent;
  cases: Array<{
    name: string;
    variable: string;
    context: Context;
    stickyFeatures?: StickyFeatures;
    stickyVariables?: StickyVariables;
    expectedValue: unknown;
    expectedEvaluation: Partial<Evaluation>;
  }>;
};
describe("portable composition capability", () => {
  it("executes every named case in the versioned capability fixture", () => {
    expect(fixture.version).toBe(2);
    expect(fixture.capability).toBe("composition-and-overrides");
    expect(fixture.cases).toHaveLength(26);
    expect(new Set(fixture.cases.map((test) => test.name)).size).toBe(26);
  });
  it.each(fixture.cases)("$name", (test) => {
    const datafile = JSON.parse(JSON.stringify(fixture.datafile));
    const before = JSON.stringify(datafile);
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile,
      stickyFeatures: test.stickyFeatures,
      stickyVariables: test.stickyVariables,
    });
    expect(f.getVariable(test.variable, test.context)).toEqual(test.expectedValue);
    expect(f.evaluateVariable(test.variable, test.context)).toMatchObject(test.expectedEvaluation);
    expect(f.getVariable("policy")).toEqual(
      test.stickyVariables?.policy === null ? null : { limit: 50, methods: ["card"] },
    );
    if (
      !["error", "sticky"].includes(test.expectedEvaluation.reason!) &&
      Array.isArray(datafile.variables[test.variable].compose)
    ) {
      const a = f.getVariable(test.variable, test.context);
      const b = f.getVariable(test.variable, test.context);
      expect(a).not.toBe(b);
      expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
    }
    expect(JSON.stringify(datafile)).toBe(before);
    f.close();
  });
});
