import type { Test, TestFeature, TestVariable } from "@featurevisor/types";
import * as path from "node:path";

import { filterTestForTargets, testProject } from "./testProject";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getProjectSetExecutions } from "../sets";
import { createTestReport } from "./report";

describe("core: unscoped segment assertions in environment projects", () => {
  it.each([
    ["example-json", 7, 3],
    ["example-sets", 8, 4],
  ])(
    "runs the real %s project without requiring an unscoped datafile",
    async (example, total, segments) => {
      const rootDirectoryPath = path.resolve(__dirname, "../../../../examples", example);
      const projectConfig = getProjectConfig(rootDirectoryPath);
      const datasource = new Datasource(projectConfig, rootDirectoryPath);
      const report = createTestReport();
      for (const execution of await getProjectSetExecutions(projectConfig, datasource)) {
        const options = { json: true, quiet: true, report, set: execution.set || null };
        expect(
          await testProject(
            {
              rootDirectoryPath,
              projectConfig: execution.projectConfig,
              datasource: execution.datasource,
              options,
            },
            options,
          ),
        ).toBe(false);
      }
      expect(report.passed).toBe(true);
      expect(report.errors).toEqual([]);
      expect(report.summary.assertions).toEqual({ passed: total, failed: 0 });
      expect(
        report.results
          .filter((result) => result.type === "segment")
          .flatMap((result) => result.cases),
      ).toHaveLength(segments);
    },
  );
});

describe("core: test target selection", () => {
  const featureTest = {
    key: "checkout",
    feature: "checkout",
    assertions: [
      { description: "base", context: {}, expectedToBeEnabled: true },
      { description: "web", target: "web", context: {}, expectedToBeEnabled: true },
      { description: "mobile", target: "mobile", context: {}, expectedToBeEnabled: true },
    ],
  } as TestFeature;

  it("keeps untargeted assertions and assertions for all selected targets", () => {
    const filtered = filterTestForTargets(featureTest, ["web", "mobile"]) as TestFeature;

    expect(filtered.assertions.map((assertion) => assertion.description)).toEqual([
      "base",
      "web",
      "mobile",
    ]);
  });

  it("removes assertions for targets that were not selected", () => {
    const filtered = filterTestForTargets(featureTest, ["web"]) as TestFeature;

    expect(filtered.assertions.map((assertion) => assertion.description)).toEqual(["base", "web"]);
  });

  it("skips a feature test when none of its targeted assertions were selected", () => {
    const targetedOnly = {
      ...featureTest,
      assertions: featureTest.assertions.slice(1),
    } as TestFeature;

    expect(filterTestForTargets(targetedOnly, ["api"])).toBeUndefined();
  });

  it("keeps segment tests without targeted assertions unchanged", () => {
    const segmentTest = {
      key: "everyone",
      segment: "everyone",
      assertions: [],
    } as unknown as Test;

    expect(filterTestForTargets(segmentTest, ["web"])).toBe(segmentTest);
  });

  it("filters explicitly targeted segment assertions before datafile selection", () => {
    const test: Test = {
      segment: "audience",
      assertions: [
        { description: "base", context: {}, expectedToMatch: true },
        { description: "web", target: "web", context: {}, expectedToMatch: true },
        { description: "mobile", target: "mobile", context: {}, expectedToMatch: true },
      ],
    };
    expect(
      filterTestForTargets(test, ["web"])!.assertions.map((assertion) => assertion.description),
    ).toEqual(["base", "web"]);
    expect(
      filterTestForTargets({ ...test, assertions: test.assertions.slice(1) }, ["api"]),
    ).toBeUndefined();
  });

  it("filters variable assertions using the same target rules as features", () => {
    const variableTest: TestVariable = {
      variable: "supportEmail",
      assertions: [
        { environment: "production", expectedValue: "base" },
        { environment: "production", target: "web", expectedValue: "web" },
        { environment: "production", target: "mobile", expectedValue: "mobile" },
      ],
    };

    const filtered = filterTestForTargets(variableTest, ["web"]) as TestVariable;
    expect(filtered.assertions.map((assertion) => assertion.expectedValue)).toEqual([
      "base",
      "web",
    ]);
  });
});
