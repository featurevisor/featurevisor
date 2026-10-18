import path from "node:path";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "../linter/lintProject";
import { testProject } from "../tester/testProject";
import { createTestReport } from "../tester/report";

describe("Example 1 dependency message condition terminology", () => {
  it.each([false, true])(
    "lints and passes all four authored cases with precompute=%s",
    async (precomputeMutations) => {
      expect(require.resolve("@featurevisor/sdk")).toMatch(/packages\/sdk\/src\/index\.ts$/);
      const rootDirectoryPath = path.resolve(__dirname, "../../../../examples/example-1");
      const projectConfig = {
        ...getProjectConfig(rootDirectoryPath),
        plugins: [],
        precomputeMutations,
      };
      const deps = {
        rootDirectoryPath,
        projectConfig,
        datasource: new Datasource(projectConfig, rootDirectoryPath),
        options: {},
      };
      const output = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        const lint = await lintProject(deps, { keyPattern: "dependencyMessage", json: true });
        expect(lint.errors).toEqual([]);
        expect(lint.hasError).toBe(false);
        const report = createTestReport();
        expect(
          await testProject(deps, { keyPattern: "dependencyMessage", quiet: true, report }),
        ).toBe(false);
        expect(
          report.results.flatMap((result) => result.cases).filter((item) => !item.passed),
        ).toEqual([]);
        expect(report.errors).toEqual([]);
        expect(report.summary.assertions).toEqual({ passed: 4, failed: 0 });
      } finally {
        output.mockRestore();
      }
    },
  );
});
