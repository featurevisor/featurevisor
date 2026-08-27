import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { testProject } from "../tester";
import { lintPlugin, lintProject, type LintResult } from "./lintProject";

function createTempProjectFromExample1() {
  const fixturePath = path.resolve(__dirname, "../../../../examples/example-1");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-lint-"));

  fs.cpSync(fixturePath, tempRoot, { recursive: true });

  return tempRoot;
}

function createTempProject(configBody = "module.exports = {};") {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-lint-"));

  fs.writeFileSync(path.join(tempRoot, "featurevisor.config.js"), configBody, "utf8");

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

  it("rejects feature and global variable key collisions unless explicitly allowed", async () => {
    const variablePath = path.join(tempProjectPath, "variables", "showHeader.yml");
    fs.writeFileSync(variablePath, "type: boolean\ndefaultValue: true\n", "utf8");

    const rejected = await lintProject(getDeps(tempProjectPath) as any, { json: true });
    expect(rejected.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "variable",
          key: "showHeader",
          code: "feature_variable_key_collision",
        }),
      ]),
    );

    const allowedDeps = getDeps(tempProjectPath);
    allowedDeps.projectConfig.allowFeatureAndVariableKeyCollisions = true;
    const allowed = await lintProject(allowedDeps as any, { json: true });
    expect(allowed.errors.some((error) => error.code === "feature_variable_key_collision")).toBe(
      false,
    );
  });

  it("rejects default reserved feature and global variable keys", async () => {
    for (const key of ["feature", "variation", "variable"]) {
      fs.copyFileSync(
        path.join(tempProjectPath, "features", "showHeader.yml"),
        path.join(tempProjectPath, "features", `${key}.yml`),
      );
      fs.copyFileSync(
        path.join(tempProjectPath, "variables", "supportEmail.yml"),
        path.join(tempProjectPath, "variables", `${key}.yml`),
      );
    }

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });
    for (const entityType of ["feature", "variable"]) {
      for (const key of ["feature", "variation", "variable"]) {
        expect(result.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ entityType, key, code: "reserved_key" }),
          ]),
        );
      }
    }
  });

  it("uses custom reserved keys and allows disabling the rule", async () => {
    fs.copyFileSync(
      path.join(tempProjectPath, "features", "showHeader.yml"),
      path.join(tempProjectPath, "features", "custom.yml"),
    );
    fs.copyFileSync(
      path.join(tempProjectPath, "variables", "supportEmail.yml"),
      path.join(tempProjectPath, "variables", "custom.yml"),
    );

    const customDeps = getDeps(tempProjectPath);
    customDeps.projectConfig.reservedKeys = ["custom"];
    const rejected = await lintProject(customDeps as any, { json: true });
    expect(rejected.errors.filter((error) => error.code === "reserved_key")).toHaveLength(2);

    const disabledDeps = getDeps(tempProjectPath);
    disabledDeps.projectConfig.reservedKeys = [];
    const allowed = await lintProject(disabledDeps as any, { json: true });
    expect(allowed.errors.some((error) => error.code === "reserved_key")).toBe(false);
  });

  it("applies reservedKeys to variables declared inside features", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "reservedVariableKey.yml"),
      [
        "description: Reserved variable key fixture",
        "bucketBy: userId",
        "variablesSchema:",
        "  variable:",
        "    type: string",
        "    defaultValue: value",
        "rules:",
        "  staging:",
        "    - key: all",
        '      segments: "*"',
        "      percentage: 100",
        "  production:",
        "    - key: all",
        '      segments: "*"',
        "      percentage: 100",
        "",
      ].join("\n"),
      "utf8",
    );

    const rejected = await lintProject(getDeps(tempProjectPath) as any, { json: true });
    expect(rejected.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          key: "reservedVariableKey",
          path: ["variablesSchema", "variable"],
          message: expect.stringContaining("reserved"),
        }),
      ]),
    );

    const customizedDeps = getDeps(tempProjectPath);
    customizedDeps.projectConfig.reservedKeys = ["variation"];
    const allowed = await lintProject(customizedDeps as any, { json: true });
    expect(
      allowed.errors.some(
        (error) =>
          error.key === "reservedVariableKey" &&
          error.path.join(".") === "variablesSchema.variable",
      ),
    ).toBe(false);
  });

  it("reports key collisions from focused feature and variable lint runs", async () => {
    const variablePath = path.join(tempProjectPath, "variables", "showHeader.yml");
    fs.writeFileSync(variablePath, "type: boolean\ndefaultValue: true\n", "utf8");

    const featureResult = await lintProject(getDeps(tempProjectPath) as any, {
      entityType: "feature",
      json: true,
    });
    expect(featureResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          key: "showHeader",
          code: "feature_variable_key_collision",
        }),
      ]),
    );

    const variableResult = await lintProject(getDeps(tempProjectPath) as any, {
      entityType: "variable",
      json: true,
    });
    expect(variableResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "variable",
          key: "showHeader",
          code: "feature_variable_key_collision",
        }),
      ]),
    );
  });

  it("rejects entity file names containing the namespace character", async () => {
    const root = createTempProject();
    tempProjectPath = root;

    fs.mkdirSync(path.join(root, "segments"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "segments", "version_5.5.yml"),
      [
        "description: Version 5.5",
        "conditions:",
        "  - attribute: version",
        "    operator: semverEquals",
        "    value: 5.5.0",
        "",
      ].join("\n"),
    );

    const result = await lintProject(getDeps(root) as any, { json: true });

    expect(result.hasError).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "segment",
          filePath: expect.stringContaining(path.join("segments", "version_5.5.yml")),
          message: 'Invalid file or directory name: "version_5.5.yml"',
          code: "invalid_name",
        }),
      ]),
    );
  });

  it("allows established test file suffixes with the namespace character", async () => {
    const root = createTempProject();
    tempProjectPath = root;

    fs.mkdirSync(path.join(root, "tests", "features"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tests", "features", "checkout.spec.yml"),
      ["feature: checkout", "assertions: []", ""].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(root) as any, { json: true, entityType: "test" });

    expect(
      result.errors.some(
        (error) =>
          error.code === "invalid_name" &&
          error.filePath.includes(path.join("tests", "features", "checkout.spec.yml")),
      ),
    ).toBe(false);
  });

  it("lints slash-namespaced global variables and their tests", async () => {
    const root = createTempProject(
      'module.exports = { namespaceCharacter: "/", environments: ["production"] };',
    );
    tempProjectPath = root;

    fs.mkdirSync(path.join(root, "variables", "checkout"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "variables", "checkout", "supportEmail.yml"),
      [
        "description: Checkout support email",
        "type: string",
        "defaultValue: checkout@example.com",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(root, "tests", "variables", "checkout"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tests", "variables", "checkout", "supportEmail.spec.yml"),
      [
        "variable: checkout/supportEmail",
        "assertions:",
        "  - environment: production",
        "    expectedValue: checkout@example.com",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(root) as any, { json: true });
    expect(result).toEqual({ hasError: false, errors: [] });
    await expect(
      testProject(getDeps(root) as any, { onlyFailures: true, quiet: true }),
    ).resolves.toBe(false);
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

  it("accepts keyed promotable assertions in feature and segment test specs", async () => {
    const featureTestPath = path.join(tempProjectPath, "tests", "features", "showHeader.spec.yml");
    let assertionIndex = 0;
    const featureTest = fs
      .readFileSync(featureTestPath, "utf8")
      .replace(/^  - description:/gm, () => {
        assertionIndex++;
        return `  - key: assertion-${assertionIndex}\n    description:`;
      })
      .replace("  - key: assertion-1", "  - key: assertion-1\n    promotable: false");
    fs.writeFileSync(featureTestPath, featureTest, "utf8");

    replaceInFile(
      path.join(tempProjectPath, "tests", "segments", "everyone.spec.yml"),
      "  - context:",
      "  - key: matches-everyone\n    promotable: false\n    context:",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual({
      hasError: false,
      errors: [],
    });
  });

  it("requires stable unique keys for assertion-level promotion", async () => {
    const testPath = path.join(tempProjectPath, "tests", "features", "showHeader.spec.yml");
    replaceInFile(
      testPath,
      '  - description: "should be disabled for desktop users below v5"',
      '  - promotable: false\n    description: "should be disabled for desktop users below v5"',
    );

    const missingKeyResult = await lintProject(getDeps(tempProjectPath) as any, { json: true });
    expect(missingKeyResult.hasError).toEqual(true);
    expect(
      missingKeyResult.errors.some(
        (error) =>
          error.path.join(".") === "assertions.0.key" && error.message.includes("key is required"),
      ),
    ).toEqual(true);

    replaceInFile(testPath, "  - promotable: false", "  - key: duplicate\n    promotable: false");
    replaceInFile(
      testPath,
      '  - description: "should be enabled for desktop users above v5"',
      '  - key: duplicate\n    description: "should be enabled for desktop users above v5"',
    );

    const duplicateKeyResult = await lintProject(getDeps(tempProjectPath) as any, { json: true });
    expect(duplicateKeyResult.hasError).toEqual(true);
    expect(
      duplicateKeyResult.errors.some(
        (error) =>
          error.path.join(".") === "assertions.1.key" &&
          error.message.includes("Duplicate assertion key"),
      ),
    ).toEqual(true);
    expect(
      duplicateKeyResult.errors.some(
        (error) =>
          error.path.join(".") === "assertions.2.key" && error.message.includes("All assertions"),
      ),
    ).toEqual(true);
  });

  it("rejects non-boolean assertion promotable values", async () => {
    replaceInFile(
      path.join(tempProjectPath, "tests", "segments", "everyone.spec.yml"),
      "  - context:",
      "  - key: matches-everyone\n    promotable: nope\n    context:",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.hasError).toEqual(true);
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
          key: "features.withSchema.spec",
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
});
