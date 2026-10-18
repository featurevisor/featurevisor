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

    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    expect(
      result.warnings?.some((warning) => warning.code === "mutation_order_changed"),
    ).toBeFalsy();
  });

  it.each(["enum", "const"])(
    "schema only lint validates unused referenced timestamp %s values with indexed paths",
    async (keyword) => {
      const valid = { when: "1970-01-01T00:00:00Z" };
      const source = path.join(tempProjectPath, "schemas", "probeSchedule.yml");
      fs.writeFileSync(
        path.join(tempProjectPath, "schemas", "probeTimestamp.yml"),
        JSON.stringify({
          type: "string",
          format: "date-time",
        }),
      );
      fs.writeFileSync(
        path.join(tempProjectPath, "schemas", "probeAlias.yml"),
        JSON.stringify({ schema: "probeTimestamp" }),
      );
      const schema = { type: "object", properties: { when: { schema: "probeAlias" } } };
      fs.writeFileSync(
        source,
        JSON.stringify({
          ...schema,
          [keyword]:
            keyword === "enum"
              ? [valid, { when: "soon" }, { when: "2026-01-01" }]
              : { when: "soon" },
        }),
      );
      const options = { json: true, entityType: "schema", keyPattern: "^probeSchedule$" };
      const result = await lintProject(getDeps(tempProjectPath) as any, options);
      expect(result.hasError).toBe(true);
      expect(result.errors.map((issue) => issue.path)).toEqual(
        keyword === "enum"
          ? [
              ["enum", 1, "when"],
              ["enum", 2, "when"],
            ]
          : [["const", "when"]],
      );
      for (const issue of result.errors) {
        expect(issue).toEqual(
          expect.objectContaining({
            entityType: "schema",
            key: "probeSchedule",
            filePath: path.relative(process.cwd(), source),
            message: expect.stringContaining("portable timestamp"),
          }),
        );
      }
      fs.writeFileSync(
        source,
        JSON.stringify({ ...schema, [keyword]: keyword === "enum" ? [valid] : valid }),
      );
      expect(await lintProject(getDeps(tempProjectPath) as any, options)).toEqual({
        hasError: false,
        errors: [],
      });
    },
  );

  it("reports nonblocking test context warnings with actual source paths after matrix expansion", async () => {
    const source = path.join(tempProjectPath, "tests", "features", "warningProbe.spec.yml");
    fs.writeFileSync(
      source,
      `feature: showHeader
assertions:
  - environment: production
    at: 50
    matrix:
      country: [nl, 42]
    context:
      country: '\${{ country }}'
      unknownAttribute: 42
    expectedToBeEnabled: true
    children:
      - context:
          country: false
        expectedToBeEnabled: true
`,
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "test",
      keyPattern: "warningProbe",
    });
    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        entityType: "test",
        key: expect.stringContaining("warningProbe"),
        filePath: path.relative(process.cwd(), source),
        code: "context_value_mismatch",
        path: ["assertions", 0, "children", 0, "context", "country"],
      }),
      expect.objectContaining({
        entityType: "test",
        code: "context_value_mismatch",
        path: ["assertions", 0, "context", "country"],
      }),
    ]);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const handled = await lintPlugin.handler({
      ...getDeps(tempProjectPath),
      parsed: { json: true, entityType: "test", keyPattern: "warningProbe" },
    } as any);
    expect(handled).not.toBe(false);
    const json = JSON.parse(log.mock.calls[log.mock.calls.length - 1][0]);
    expect(json.errors).toEqual([]);
    expect(json.warnings).toEqual(result.warnings);
  });

  it("reports scenario root and child context warnings at the authored spec path", async () => {
    const source = path.join(tempProjectPath, "tests", "scenarios", "warnings", "probe.spec.yml");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      source,
      `environment: production
matrix:
  country: [nl, 42]
context:
  country: '\${{ country }}'
checks:
  - feature: showHeader
    enabled: true
children:
  - context:
      country: false
    checks:
      - feature: showHeader
        enabled: true
`,
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "scenario",
      keyPattern: "warnings",
    });
    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        entityType: "scenario",
        filePath: path.relative(process.cwd(), source),
        code: "context_value_mismatch",
        path: ["children", 0, "context", "country"],
      }),
      expect.objectContaining({
        entityType: "scenario",
        filePath: path.relative(process.cwd(), source),
        code: "context_value_mismatch",
        path: ["context", "country"],
      }),
    ]);
  });

  it("keeps intentional invalid contexts runnable and warns for segment and variable specs", async () => {
    const root = createTempProject();
    try {
      for (const directory of [
        "attributes",
        "segments",
        "variables",
        "tests/segments",
        "tests/variables",
      ])
        fs.mkdirSync(path.join(root, directory), { recursive: true });
      fs.writeFileSync(
        path.join(root, "attributes", "now.yml"),
        "description: Current time\ntype: string\nformat: date-time\n",
      );
      fs.writeFileSync(
        path.join(root, "segments", "afterLaunch.yml"),
        "description: After launch\nconditions:\n  - attribute: now\n    operator: after\n    value: 2026-01-01T00:00:00Z\n",
      );
      fs.writeFileSync(
        path.join(root, "variables", "message.yml"),
        "description: Message\ntype: string\ndefaultValue: Welcome\n",
      );
      fs.writeFileSync(
        path.join(root, "tests", "segments", "afterLaunch.spec.yml"),
        "segment: afterLaunch\nassertions:\n  - context: { now: 42 }\n    expectedToMatch: false\n",
      );
      fs.writeFileSync(
        path.join(root, "tests", "variables", "message.spec.yml"),
        "variable: message\nassertions:\n  - context: { now: soon }\n    expectedValue: Welcome\n",
      );
      const deps = getDeps(root) as any;
      const result = await lintProject(deps, { json: true });
      expect(result.hasError).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "segments.afterLaunch",
            code: "context_value_mismatch",
            path: ["assertions", 0, "context", "now"],
          }),
          expect.objectContaining({
            key: "variables.message",
            code: "context_value_mismatch",
            path: ["assertions", 0, "context", "now"],
          }),
        ]),
      );
      await expect(testProject(deps, { onlyFailures: true, quiet: true })).resolves.toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves genuine Example 1 mismatches without warning for scheduled release scenarios", async () => {
    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "test",
    });
    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    const deps = getDeps(tempProjectPath);
    let countryWarning;
    for (const warning of result.warnings || []) {
      if (
        warning.code !== "context_value_mismatch" ||
        warning.path[warning.path.length - 1] !== "country"
      )
        continue;
      const spec = await deps.datasource.readTest(warning.key);
      const value = warning.path.reduce<any>((entry, key) => entry?.[key], spec);
      if (value && typeof value === "object") {
        countryWarning = warning;
        break;
      }
    }
    expect(countryWarning).toBeDefined();
    expect(
      (await deps.datasource.listScenarios()).some((key) => /scheduled.release/.test(key)),
    ).toBe(true);
    const scenarios = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "scenario",
      keyPattern: "scheduled.release",
    });
    expect(scenarios.hasError).toBe(false);
    expect(scenarios.errors).toEqual([]);
    expect(scenarios.warnings).toBeUndefined();
  });

  it("does not serialize raw bigint context values in lint JSON warnings", async () => {
    const source = path.join(tempProjectPath, "tests", "features", "bigintWarning.spec.yml");
    fs.writeFileSync(
      source,
      "feature: showHeader\nassertions:\n  - environment: production\n    at: 50\n    context: { country: invalid }\n    expectedToBeEnabled: true\n",
    );
    const deps = getDeps(tempProjectPath);
    jest.spyOn(deps.datasource, "readTest").mockResolvedValue({
      feature: "showHeader",
      assertions: [
        {
          environment: "production",
          at: 50,
          context: { country: 42n } as any,
          expectedToBeEnabled: true,
        },
      ],
    });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      lintPlugin.handler({
        ...deps,
        parsed: { json: true, entityType: "test", keyPattern: "bigintWarning" },
      } as any),
    ).resolves.not.toBe(false);
    const json = JSON.parse(log.mock.calls[log.mock.calls.length - 1][0]);
    expect(json.errors).toEqual([]);
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "context_value_mismatch",
        path: ["assertions", 0, "context", "country"],
      }),
    ]);
    expect(json.warnings[0]).not.toHaveProperty("value");
  });

  it("reports migration differences only when explicitly requested", async () => {
    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      v3MutationOrder: true,
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          key: "arrayMutationExamples",
          code: "mutation_order_changed",
          path: ["rules", "production", 0, "variableOverrides", "navigation", 0, "mutate"],
        }),
      ]),
    );
  });

  it("shows both resolved values and the overwritten mutation assignment", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "orderingProbe.yml"),
      `
description: Ordering probe
bucketBy: userId
tags: [all]
variablesSchema:
  cta:
    type: object
    properties:
      label: { type: string }
    defaultValue: { label: Start }
force:
  staging:
    - conditions: "*"
      enabled: true
      variables:
        cta.label: private-child-value
        cta: { label: private-parent-value }
rules:
  staging:
    - key: all
      conditions: "*"
      percentage: 100
      variables:
        cta.label: private-child-value
        cta: { label: private-parent-value }
  production:
    - key: all
      conditions: "*"
      percentage: 100
`,
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "feature",
      v3MutationOrder: true,
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "orderingProbe",
          code: "mutation_order_changed",
          path: ["rules", "staging", 0, "variables"],
        }),
        expect.objectContaining({
          key: "orderingProbe",
          code: "mutation_order_changed",
          path: ["force", "staging", 0, "variables"],
        }),
      ]),
    );
    const warning = result.warnings?.find(
      (item) => item.key === "orderingProbe" && item.path.join(".") === "rules.staging.0.variables",
    );
    expect(warning?.message).toContain('"cta.label" is overwritten by the later "cta" assignment');
    expect(warning?.message).toContain(
      'v3 resolution (shortest paths first): {"cta":{"label":"private-child-value"}}',
    );
    expect(warning?.message).toContain(
      'v4 resolution (authored order): {"cta":{"label":"private-parent-value"}}',
    );
  });

  it("attributes required variable cycles to the originating entity", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "cycleA.yml"),
      "description: Cycle A\ntype: boolean\ndefaultValue: true\nconditions:\n  variable: cycleB\n  operator: equals\n  value: true\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempProjectPath, "variables", "cycleB.yml"),
      "description: Cycle B\ntype: boolean\ndefaultValue: true\nconditions:\n  variable: cycleA\n  operator: equals\n  value: true\n",
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "variable",
          key: "cycleA",
          filePath: expect.stringContaining("variables/cycleA.yml"),
          path: ["conditions"],
          code: "circular_dependency",
        }),
      ]),
    );
  });

  it("does not warn for a memoized diamond dependency graph", async () => {
    for (let level = 0; level <= 11; level++) {
      for (const branch of ["a", "b"]) {
        const requirement =
          level === 11
            ? ""
            : `conditions:\n  or:\n    - { variable: a${level + 1}, operator: equals, value: true }\n    - { variable: b${level + 1}, operator: equals, value: true }\n`;
        fs.writeFileSync(
          path.join(tempProjectPath, "variables", `${branch}${level}.yml`),
          `description: Cost probe\ntype: boolean\ndefaultValue: true\n${requirement}`,
          "utf8",
        );
      }
    }
    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "variable",
    });
    expect(result.hasError).toBe(false);
    expect(
      result.warnings?.filter((item) => item.code === "dependency_expansion_cost") || [],
    ).toEqual([]);
  });

  it("reports one legacy required migration error", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "features", "legacyRequired.yml"),
      "description: Legacy\ntags: [all]\nbucketBy: userId\nrequired:\n  - key: showHeader\nrules:\n  staging:\n    - key: all\n      conditions: '*'\n      percentage: 100\n",
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result.hasError).toBe(true);
    expect(
      result.errors.filter((item) => item.message.includes("`required` has been removed")),
    ).toHaveLength(1);
    expect(result.errors.filter((item) => item.path.join(".") === "required")).toHaveLength(1);
  });

  it("suggests a misspelt root test owner with its authored path", async () => {
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "ownerTypo.spec.yml"),
      "featur: showHeader\nassertions: []\n",
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "test",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ownerTypo",
          path: ["featur"],
          message: expect.stringContaining('Did you mean "feature"'),
        }),
      ]),
    );
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
        '      conditions: "*"',
        "      percentage: 100",
        "  production:",
        "    - key: all",
        '      conditions: "*"',
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

  it("lints authored scenario checks separately from test entities", async () => {
    fs.mkdirSync(path.join(tempProjectPath, "tests", "scenarios", "checkout"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "scenarios", "checkout", "readiness.spec.yml"),
      [
        "description: Checkout is ready",
        "environment: production",
        "matrix:",
        "  feature: [showHeader]",
        "context:",
        "  checks: preserved context value",
        "checks:",
        '  - feature: "${{ feature }}"',
        "    enabled: true",
        "children:",
        "  - checks:",
        "      - variable: supportEmail",
        "        operator: contains",
        '        value: "@"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "scenario",
    });

    expect(result).toEqual({ hasError: false, errors: [] });
  });

  it("rejects dots in scenario file names when dot is the namespace character", async () => {
    fs.mkdirSync(path.join(tempProjectPath, "tests", "scenarios"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "scenarios", "checkout.readiness.spec.yml"),
      [
        "description: Checkout is ready",
        "checks:",
        "  - variable: supportEmail",
        "    operator: exists",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "scenario",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "scenario",
          filePath: expect.stringContaining(
            path.join("tests", "scenarios", "checkout.readiness.spec.yml"),
          ),
          code: "invalid_name",
        }),
      ]),
    );
  });

  it("allows nested scenario paths when slash is the namespace character", async () => {
    const root = createTempProject('module.exports = { namespaceCharacter: "/" };');
    tempProjectPath = root;
    fs.mkdirSync(path.join(root, "variables", "support"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "variables", "support", "email.yml"),
      "description: Support email\ntype: string\ndefaultValue: support@example.com\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, "tests", "scenarios", "checkout"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tests", "scenarios", "checkout", "readiness.spec.yml"),
      [
        "description: Checkout is ready",
        "checks:",
        "  - variable: support/email",
        "    operator: exists",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(root) as any, {
      json: true,
      entityType: "scenario",
    });

    expect(result).toEqual({ hasError: false, errors: [] });
  });

  it("reports root and child check errors against the scenario spec path", async () => {
    fs.mkdirSync(path.join(tempProjectPath, "tests", "scenarios"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, "tests", "scenarios", "broken.spec.yml"),
      [
        "description: Broken",
        "environment: production",
        "checks:",
        "  - variable: missing",
        "    operator: exists",
        "children:",
        "  - context:",
        "      checks: preserved child context value",
        "    checks:",
        "      - feature: missing",
        "        enabled: true",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, {
      json: true,
      entityType: "scenario",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "scenario",
          key: "scenarios.broken",
          filePath: expect.stringContaining(path.join("tests", "scenarios", "broken.spec.yml")),
          path: ["checks"],
        }),
        expect.objectContaining({
          entityType: "scenario",
          key: "scenarios.broken",
          filePath: expect.stringContaining(path.join("tests", "scenarios", "broken.spec.yml")),
          path: ["children", 0, "checks"],
        }),
      ]),
    );
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
      path.join(tempProjectPath, "schemas", "money.yml"),
      path.join(tempProjectPath, "tests", "features", "showHeader.spec.yml"),
    ];

    for (const file of files) {
      fs.appendFileSync(file, "\npromotable: false\n");
    }

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual(expect.objectContaining({ hasError: false, errors: [] }));
  });

  it("accepts promotable flags on feature rules", async () => {
    replaceInFile(
      path.join(tempProjectPath, "features", "showHeader.yml"),
      '    - key: "1"',
      '    - key: "1"\n      promotable: false',
    );

    const result = await lintProject(getDeps(tempProjectPath) as any, { json: true });

    expect(result).toEqual(expect.objectContaining({ hasError: false, errors: [] }));
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

    expect(result).toEqual(expect.objectContaining({ hasError: false, errors: [] }));
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
          message: 'Unknown attribute "notARealAttribute".',
          path: ["conditions", 1, "attribute"],
          code: "custom",
        }),
        expect.objectContaining({
          filePath: expect.stringContaining(path.join("features", "withSchema.yml")),
          entityType: "feature",
          key: "withSchema",
          message: 'Variable "url" (type string) must be a string, but got a number.',
          path: ["variablesSchema", "singleLink", "defaultValue", "url"],
          code: "custom",
        }),
        expect.objectContaining({
          filePath: expect.stringContaining(path.join("tests", "features", "withSchema.spec.yml")),
          entityType: "test",
          key: "features.withSchema",
          message: 'Unknown environment "qa". Available environments: staging, production.',
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
    expect(output).toContain('"errors": []');
  });

  it("passes the migration flag from the CLI plugin and advertises it in help examples", async () => {
    expect(lintPlugin.examples).toContainEqual(
      expect.objectContaining({ command: "lint --v3-mutation-order" }),
    );
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await lintPlugin.handler({
      ...getDeps(tempProjectPath),
      parsed: { json: true, v3MutationOrder: true },
    } as any);

    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mutation_order_changed", key: "arrayMutationExamples" }),
      ]),
    );
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
