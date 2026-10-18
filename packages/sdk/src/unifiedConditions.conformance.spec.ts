import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Context, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor, type FeaturevisorOptions } from "./instance";

const fixtureSource = readFileSync(
  resolve(__dirname, "../../../conformance/sdk-conditions.json"),
  "utf8",
);
const fixture = JSON.parse(fixtureSource);

interface Case {
  name: string;
  type: "flag" | "variable";
  feature: string;
  variable: string;
  datafile: DatafileContent;
  context: Context;
  options?: FeaturevisorOptions;
  dependencies?: unknown[];
  expected: { value?: unknown; [key: string]: unknown };
}

describe("portable unified conditions", () => {
  const executed = new Set<string>();

  test("keeps the complete capability contract", () => {
    expect(fixture.version).toBe(1);
    expect(fixture.capability).toBe("unified-conditions");
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(new Set(fixture.cases.map((entry: Case) => entry.name)).size).toBe(fixture.cases.length);
  });

  test("keeps the floating JSON lexeme in the numeric getter control", () => {
    const control = (fixture.cases as Case[]).find(
      (entry) => entry.name === "numeric getter integer equals expected 1.0 lexeme",
    );
    expect(control?.expected.value).toBe(1);
    const sourceCase = fixtureSource.slice(
      fixtureSource.indexOf('"name": "numeric getter integer equals expected 1.0 lexeme"'),
    );
    expect(sourceCase.split('"expected":')[1].split("}")[0]).toMatch(/"value": 1\.0\s/);
  });

  afterAll(() => {
    expect([...executed].sort()).toEqual(fixture.cases.map((entry: Case) => entry.name).sort());
  });

  test.each(fixture.cases as Case[])("$name", (testCase) => {
    const original = JSON.stringify(testCase);
    const dependencies: unknown[] = [];
    const f = createFeaturevisor({
      datafile: testCase.datafile,
      logLevel: "fatal",
      ...testCase.options,
      modules: [
        {
          beforeEvaluation(options) {
            if (options.dependencyPurpose)
              dependencies.push({
                ...("featureKey" in options && options.featureKey
                  ? { feature: options.featureKey }
                  : {}),
                ...(options.variableKey ? { variable: options.variableKey } : {}),
                dependencyPurpose: options.dependencyPurpose,
              });
            return options;
          },
        },
      ],
    });
    const { value, ...expected } = testCase.expected;
    for (let attempt = 0; attempt < 2; attempt++) {
      dependencies.length = 0;
      const evaluation =
        testCase.type === "flag"
          ? f.evaluateFlag(testCase.feature, testCase.context)
          : f.evaluateVariable(testCase.variable, testCase.context);
      for (const [key, expectedValue] of Object.entries(expected)) {
        expect(Object.prototype.hasOwnProperty.call(evaluation, key)).toBe(true);
        expect(evaluation[key as keyof typeof evaluation]).toStrictEqual(expectedValue);
      }
      if (testCase.dependencies) expect(dependencies).toEqual(testCase.dependencies);
      if (Object.prototype.hasOwnProperty.call(testCase.expected, "value"))
        expect(f.getVariable(testCase.variable, testCase.context)).toStrictEqual(value);
      if (testCase.type === "flag")
        expect(f.isEnabled(testCase.feature, testCase.context)).toBe(expected.enabled === true);
    }
    f.close();
    expect(JSON.stringify(testCase)).toBe(original);
    executed.add(testCase.name);
  });
});
