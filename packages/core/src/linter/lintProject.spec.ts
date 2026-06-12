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

function createTempSplitProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-lint-split-"));

  fs.writeFileSync(
    path.join(tempRoot, "featurevisor.config.js"),
    `
module.exports = {
  environments: ['staging', 'production'],
  splitByEnvironment: true,
  tags: ['all'],
};
`.trimStart(),
    "utf8",
  );

  fs.mkdirSync(path.join(tempRoot, "features"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "environments", "staging"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "environments", "production"), { recursive: true });

  fs.writeFileSync(
    path.join(tempRoot, "features", "foo.yml"),
    `
key: foo
description: Foo
tags:
  - all
bucketBy: userId
`.trimStart(),
    "utf8",
  );

  fs.writeFileSync(
    path.join(tempRoot, "environments", "staging", "foo.yml"),
    `
rules:
  - key: everyone
    segments: '*'
    percentage: 100
`.trimStart(),
    "utf8",
  );

  fs.writeFileSync(
    path.join(tempRoot, "environments", "production", "foo.yml"),
    `
rules:
  - key: everyone
    segments: '*'
    percentage: 0
`.trimStart(),
    "utf8",
  );

  return tempRoot;
}

function replaceInFile(filePath: string, search: string, replacement: string) {
  const contents = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, contents.replace(search, replacement), "utf8");
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

  it("accepts promotable flags on top-level authored entities", async () => {
    const files = [
      path.join(tempProjectPath, "attributes", "userId.yml"),
      path.join(tempProjectPath, "segments", "everyone.yml"),
      path.join(tempProjectPath, "features", "showHeader.yml"),
      path.join(tempProjectPath, "groups", "myExclusionGroup.yml"),
      path.join(tempProjectPath, "schemas", "money.yml"),
      path.join(tempProjectPath, "tests", "features", "showHeader.spec.yml"),
    ];

    for (const file of files) {
      fs.appendFileSync(file, "\npromotable: false\n");
    }

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual({
      hasError: false,
      errors: [],
    });
  });

  it("accepts promotable flags on feature rules", async () => {
    replaceInFile(
      path.join(tempProjectPath, "features", "showHeader.yml"),
      '    - key: "1"',
      '    - key: "1"\n      promotable: false',
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual({
      hasError: false,
      errors: [],
    });
  });

  it("rejects non-boolean promotable values", async () => {
    fs.appendFileSync(
      path.join(tempProjectPath, "attributes", "userId.yml"),
      "\npromotable: nope\n",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.hasError).toEqual(true);
    expect(
      result.errors.some(
        (error) => error.path.join(".") === "promotable" && error.message.includes("boolean"),
      ),
    ).toEqual(true);
  });

  it("rejects non-boolean rule promotable values", async () => {
    replaceInFile(
      path.join(tempProjectPath, "features", "showHeader.yml"),
      '    - key: "1"',
      '    - key: "1"\n      promotable: nope',
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.hasError).toEqual(true);
    expect(
      result.errors.some(
        (error) =>
          error.path.join(".") === "rules.staging.0.promotable" &&
          error.message.includes("boolean"),
      ),
    ).toEqual(true);
  });

  it("returns structured errors in JSON mode", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "attributes", "invalid name.yml"),
      `
description: this has an invalid key name
type: string
`.trimStart(),
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

  it("reports real example-1 segment, feature, and test schema mistakes with useful paths", async () => {
    replaceInFile(
      path.join(tempProjectPath, "segments", "desktop.yml"),
      `
conditions:
  - attribute: device
    operator: equals
    value: desktop
`.trimStart(),
      `
conditions:
  - attribute: device
    operator: equals
    value: desktop
  - attribute: notARealAttribute
    operator: equals
    value: nope
`.trimStart(),
    );

    replaceInFile(
      path.join(tempProjectPath, "features", "withSchema.yml"),
      `
  singleLink:
    schema: link
    defaultValue:
      title: Home
      url: /
`.trimStart(),
      `
  singleLink:
    schema: link
    defaultValue:
      title: Home
      url: 123
`.trimStart(),
    );

    replaceInFile(
      path.join(tempProjectPath, "tests", "features", "withSchema.spec.yml"),
      "    environment: staging",
      "    environment: qa",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.hasError).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: expect.stringContaining(path.join("segments", "desktop.yml")),
          entityType: "segment",
          key: "desktop",
          message: 'Unknown attribute "notARealAttribute"',
          path: ["conditions", 1, "attribute"],
          code: "custom",
        }),
        expect.objectContaining({
          filePath: expect.stringContaining(path.join("features", "withSchema.yml")),
          entityType: "feature",
          key: "withSchema",
          message: 'Variable "url" (type string) must be a string; got number.',
          path: ["variablesSchema", "singleLink", "defaultValue", "url"],
          code: "custom",
        }),
        expect.objectContaining({
          filePath: expect.stringContaining(path.join("tests", "features", "withSchema.spec.yml")),
          entityType: "test",
          key: "features/withSchema.spec",
          message: 'Unknown environment "qa"',
          path: ["assertions", 0, "environment"],
          code: "custom",
        }),
      ]),
    );
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
    expect(output).toContain('\n  "errors": []\n');
  });

  it("does not call process.exit for zod validation errors while linting tests", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "broken.spec.yml"),
      `
feature: foo
`.trimStart(),
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

  it("reports missing split environment file with environment file path", async () => {
    const splitProjectPath = createTempSplitProject();
    fs.unlinkSync(path.join(splitProjectPath, "environments", "production", "foo.yml"));

    const result = await lintProject(getDeps(splitProjectPath) as any, {
      json: true,
      entityType: "feature",
    });

    expect(result.hasError).toBe(true);
    expect(result.errors[0].filePath).toContain(path.join("environments", "production", "foo.yml"));
  });

  it("reports split environment feature schema errors against environment file path", async () => {
    const splitProjectPath = createTempSplitProject();
    fs.writeFileSync(
      path.join(splitProjectPath, "environments", "staging", "foo.yml"),
      `
rules:
  - key: everyone
    segments: '*'
    percentage: invalid
`.trimStart(),
      "utf8",
    );

    const result = await lintProject(getDeps(splitProjectPath) as any, {
      json: true,
      entityType: "feature",
    });

    expect(result.hasError).toBe(true);
    expect(
      result.errors.some((error) =>
        error.filePath.includes(path.join("environments", "staging", "foo.yml")),
      ),
    ).toBe(true);
  });
});
