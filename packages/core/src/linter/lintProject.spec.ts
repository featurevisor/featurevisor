import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { lintPlugin, lintProject, type LintResult } from "./lintProject";

function createTempProjectFromExample1() {
  const fixturePath = path.resolve(__dirname, "../../../../examples/example-1");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-lint-"));

  fs.cpSync(fixturePath, tempRoot, { recursive: true });

  return tempRoot;
}

function getDeps(rootDirectoryPath: string) {
  const projectConfig = getProjectConfig(rootDirectoryPath);
  const datasource = new Datasource(projectConfig, rootDirectoryPath);

  return {
    rootDirectoryPath,
    projectConfig,
    datasource,
    options: {},
  };
}

describe("core: lintProject", function () {
  let tempProjectPath: string;

  beforeEach(() => {
    tempProjectPath = createTempProjectFromExample1();
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("returns JSON-friendly empty errors array for a valid project", async () => {
    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual({
      hasError: false,
      errors: [],
    });
  });

  it("returns structured errors in JSON mode", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "invalid name.yml"),
      "description: this has an invalid key name\ntype: string\n",
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "attribute",
    });

    expect(result.hasError).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);

    expect(result.errors[0]).toMatchObject({
      entityType: "attribute",
      key: "invalid name",
      message: 'Invalid name: "invalid name"',
      code: "invalid_name",
      path: [],
    });

    expect(result.errors[0].filePath).toContain("attributes");
  });

  it("plugin prints pretty JSON only once in --json --pretty mode", async () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const pluginResult = await lintPlugin.handler({
      ...getDeps(tempProjectPath),
      parsed: {
        json: true,
        pretty: true,
      },
    } as any);

    expect(pluginResult).toBeUndefined();
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toContain("\n  \"errors\": []\n");
  });

  it("does not call process.exit for zod validation errors while linting tests", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "broken.spec.yml"),
      "feature: foo\n",
      "utf8",
    );

    const processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as typeof process.exit);

    const result: LintResult = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "test",
    });

    expect(result.hasError).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
