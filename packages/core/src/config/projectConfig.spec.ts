import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CustomParser } from "@featurevisor/parsers";

import {
  getProjectConfig,
  getProjectConfigForSet,
  SETS_DIRECTORY_NAME,
  TARGETS_DIRECTORY_NAME,
  TESTS_DIRECTORY_NAME,
} from "./projectConfig";

function createTempProject(configBody: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-project-config-"));
  fs.writeFileSync(path.join(tempRoot, "featurevisor.config.js"), configBody, "utf8");
  return tempRoot;
}

describe("core: projectConfig", () => {
  it.each([
    [undefined, "/"],
    ["/", "/"],
    ["/team/catalog", "/team/catalog/"],
    ["/flags/", "/flags/"],
    ["/flags.web/", "/flags.web/"],
    ["/team.v4/catalog", "/team.v4/catalog/"],
  ])("normalizes Catalog base path %s", (input, expected) => {
    const root = createTempProject(
      `module.exports = ${JSON.stringify(input === undefined ? {} : { catalogBasePath: input })}`,
    );
    try {
      expect(getProjectConfig(root).catalogBasePath).toBe(expected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it.each([
    "https://example.com/",
    "//host/",
    "/../",
    "/./",
    "/flags/../web/",
    "/flags/./web/",
    "/a//b/",
    "/a?b",
    "/%2f/",
    '/"/',
    "relative",
    null,
  ])("rejects unsafe Catalog base path %s", (catalogBasePath) => {
    const root = createTempProject(`module.exports = ${JSON.stringify({ catalogBasePath })}`);
    try {
      expect(() => getProjectConfig(root)).toThrow("Invalid catalogBasePath");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it.each([
    ["null", /expected a built-in parser name or a custom parser object/],
    ["[]", /expected a built-in parser name or a custom parser object/],
    ["42", /expected a built-in parser name or a custom parser object/],
    ["{}", /extension must be a nonempty string/],
    ["{ extension: ' ' }", /extension must be a nonempty string/],
    ["{ extension: 'toml' }", /parse must be a function/],
    ["{ extension: 'toml', parse: 42 }", /parse must be a function/],
    ["{ extension: 'toml', parse: JSON.parse }", /stringify must be a function/],
    [
      "{ extension: 'toml', parse: JSON.parse, stringify: 'not a function' }",
      /stringify must be a function/,
    ],
  ])("rejects invalid parser %s before using the datasource", (parser, message) => {
    const root = createTempProject(`module.exports = { parser: ${parser} };`);
    try {
      expect(() => getProjectConfig(root)).toThrow(message);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["yml", "json"])("resolves the built-in %s parser", (parser) => {
    const root = createTempProject(`module.exports = { parser: ${JSON.stringify(parser)} };`);
    try {
      const resolved = getProjectConfig(root).parser as CustomParser;
      expect(typeof resolved.parse).toBe("function");
      expect(typeof resolved.stringify).toBe("function");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves custom parser methods and their optional file paths", () => {
    const root = createTempProject(`module.exports = { parser: {
      extension: 'custom',
      parse(content, filePath) { return { content, filePath, extension: this.extension }; },
      stringify(content, filePath) { return JSON.stringify({ content, filePath, extension: this.extension }); }
    } };`);
    try {
      const parser = getProjectConfig(root).parser as CustomParser;
      expect(parser.parse("hello", "file.custom")).toEqual({
        content: "hello",
        filePath: "file.custom",
        extension: "custom",
      });
      expect(JSON.parse(parser.stringify({ enabled: true }, "file.custom"))).toEqual({
        content: { enabled: true },
        filePath: "file.custom",
        extension: "custom",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets project defaults", () => {
    const root = createTempProject("module.exports = {};");
    const config = getProjectConfig(root);

    expect(config.environments).toBeUndefined();
    expect(config.namespaceCharacter).toBe(".");
    expect(config.reservedKeys).toEqual(["feature", "variation", "variable"]);
    expect(config.sets).toBe(false);
    expect(config.promotionFlows).toBeUndefined();
    expect(config.allowFeatureAndVariableKeyCollisions).toBe(false);
    expect(config.requireOverrideKeysInFeatures).toBe(false);
    expect(config.precomputeMutations).toBe(true);
    expect(config.disallowOperators).toEqual([]);
    expect(config.setsDirectoryPath).toBe(path.join(root, SETS_DIRECTORY_NAME));
    expect(config.targetsDirectoryPath).toBe(path.join(root, TARGETS_DIRECTORY_NAME));
    expect(config.testsDirectoryPath).toBe(path.join(root, TESTS_DIRECTORY_NAME));
    expect("scopes" in config).toBe(false);
    expect("siteExportDirectoryPath" in config).toBe(false);
  });

  it("uses a custom tests directory", () => {
    const root = createTempProject(
      'module.exports = { testsDirectoryPath: "<rootDir>/specifications" };',
    );
    const config = getProjectConfig(root);

    expect(config.testsDirectoryPath).toBe(path.join(root, "specifications"));
  });

  it.each([true, false])("accepts precomputeMutations=%s and preserves it in sets", (enabled) => {
    const root = createTempProject(
      `module.exports = { sets: true, precomputeMutations: ${enabled} };`,
    );
    const config = getProjectConfig(root);
    expect(config.precomputeMutations).toBe(enabled);
    expect(getProjectConfigForSet(config, "staging").precomputeMutations).toBe(enabled);
  });

  it.each([null, 0, 1, "false", "", {}, []])("rejects invalid precomputeMutations %p", (value) => {
    const root = createTempProject(
      `module.exports = { precomputeMutations: ${JSON.stringify(value)} };`,
    );
    expect(() => getProjectConfig(root)).toThrow(/Invalid precomputeMutations:.*must be a boolean/);
  });

  it("validates exact disallowed comparison operator names", () => {
    const root = createTempProject(
      'module.exports = { disallowOperators: ["equals", "notEmpty"] };',
    );
    expect(getProjectConfig(root).disallowOperators).toEqual(["equals", "notEmpty"]);
    expect(getProjectConfigForSet(getProjectConfig(root), "staging").disallowOperators).toEqual([
      "equals",
      "notEmpty",
    ]);
    for (const invalid of ['"equals"', '["Equals"]', '["append"]', "[3]", "{}"]) {
      const invalidRoot = createTempProject(`module.exports = { disallowOperators: ${invalid} };`);
      expect(() => getProjectConfig(invalidRoot)).toThrow(/Invalid disallowOperators/);
    }
  });

  it("validates allowedConditions", () => {
    expect(getProjectConfig(createTempProject("module.exports = {};")).allowedConditions).toBe(
      undefined,
    );
    const root = createTempProject(
      'module.exports = { allowedConditions: { rules: ["segment"], segments: [] } };',
    );
    expect(getProjectConfig(root).allowedConditions).toEqual({ rules: ["segment"], segments: [] });
    expect(getProjectConfigForSet(getProjectConfig(root), "staging").allowedConditions).toEqual({
      rules: ["segment"],
      segments: [],
    });
    for (const [invalid, message] of [
      ["[]", "Invalid allowedConditions: expected an object"],
      ['{ rule: ["segment"] }', "Invalid allowedConditions.rule: unknown location. Use one of:"],
      ['{ rules: "segment" }', "Invalid allowedConditions.rules: expected an array"],
      ['{ rules: ["segments"] }', "Invalid allowedConditions.rules[0]: segments. Use one of:"],
      [
        '{ rules: ["segment", "segment"] }',
        'Invalid allowedConditions.rules: duplicate kind "segment"',
      ],
    ]) {
      const invalidRoot = createTempProject(`module.exports = { allowedConditions: ${invalid} };`);
      expect(() => getProjectConfig(invalidRoot)).toThrow(message);
    }
  });

  it("accepts custom and empty reservedKeys", () => {
    const customRoot = createTempProject('module.exports = { reservedKeys: ["custom"] };');
    expect(getProjectConfig(customRoot).reservedKeys).toEqual(["custom"]);

    const emptyRoot = createTempProject("module.exports = { reservedKeys: [] };");
    expect(getProjectConfig(emptyRoot).reservedKeys).toEqual([]);
  });

  it("rejects invalid reservedKeys", () => {
    const cases = [
      {
        config: 'module.exports = { reservedKeys: "variable" };',
        message: "It must be an array of unique, non-empty strings.",
      },
      {
        config: 'module.exports = { reservedKeys: ["variable", 1] };',
        message: "Invalid reservedKeys[1]",
      },
      {
        config: 'module.exports = { reservedKeys: [""] };',
        message: "Invalid reservedKeys[0]",
      },
      {
        config: 'module.exports = { reservedKeys: [" variable"] };',
        message: "without surrounding whitespace",
      },
      {
        config: 'module.exports = { reservedKeys: ["variable", "variable"] };',
        message: 'duplicate key "variable"',
      },
    ];

    for (const testCase of cases) {
      const root = createTempProject(testCase.config);
      expect(() => getProjectConfig(root)).toThrow(testCase.message);
    }
  });

  it("validates allowFeatureAndVariableKeyCollisions", () => {
    const allowedRoot = createTempProject(
      "module.exports = { allowFeatureAndVariableKeyCollisions: true };",
    );
    expect(getProjectConfig(allowedRoot).allowFeatureAndVariableKeyCollisions).toBe(true);

    const invalidRoot = createTempProject(
      'module.exports = { allowFeatureAndVariableKeyCollisions: "yes" };',
    );
    expect(() => getProjectConfig(invalidRoot)).toThrow(
      "Invalid allowFeatureAndVariableKeyCollisions: yes. It must be a boolean.",
    );
  });

  it("validates requireOverrideKeysInFeatures", () => {
    const enabledRoot = createTempProject(
      "module.exports = { requireOverrideKeysInFeatures: true };",
    );
    expect(getProjectConfig(enabledRoot).requireOverrideKeysInFeatures).toBe(true);

    const invalidRoot = createTempProject(
      'module.exports = { requireOverrideKeysInFeatures: "yes" };',
    );
    expect(() => getProjectConfig(invalidRoot)).toThrow(
      "Invalid requireOverrideKeysInFeatures: yes. It must be a boolean.",
    );
  });

  it("silently ignores obsolete scopes configuration", () => {
    const root = createTempProject(
      'module.exports = { scopes: [{ name: "web", context: { platform: "web" } }] };',
    );
    const config = getProjectConfig(root);

    expect("scopes" in config).toBe(false);
  });

  it("throws when sets is not boolean", () => {
    const root = createTempProject("module.exports = { sets: 'yes' };");

    expect(() => getProjectConfig(root)).toThrow("Invalid sets: yes. It must be a boolean.");
  });

  it("accepts environments when it is an array of strings", () => {
    const root = createTempProject('module.exports = { environments: ["staging", "production"] };');
    const config = getProjectConfig(root);

    expect(config.environments).toEqual(["staging", "production"]);
  });

  it("throws when environments is present but not an array of strings", () => {
    const cases = [
      {
        config: "module.exports = { environments: false };",
        message: "Invalid environments: false. It must be an array of strings when defined.",
      },
      {
        config: 'module.exports = { environments: "production" };',
        message: "Invalid environments: production. It must be an array of strings when defined.",
      },
      {
        config: "module.exports = { environments: { production: true } };",
        message:
          "Invalid environments: [object Object]. It must be an array of strings when defined.",
      },
      {
        config: 'module.exports = { environments: ["production", 1] };',
        message: "Invalid environments[1]: 1. It must be a string.",
      },
    ];

    for (const testCase of cases) {
      const root = createTempProject(testCase.config);

      expect(() => getProjectConfig(root)).toThrow(testCase.message);
    }
  });

  it("accepts custom namespaceCharacter values including slash", () => {
    const root = createTempProject('module.exports = { namespaceCharacter: "/" };');
    const config = getProjectConfig(root);

    expect(config.namespaceCharacter).toBe("/");
  });

  it.each([
    { value: [], message: "omit environments" },
    { value: [""], message: "nonempty name" },
    { value: [" "], message: "nonempty name" },
    { value: ["production "], message: "surrounding whitespace" },
    { value: ["\tproduction"], message: "surrounding whitespace" },
    { value: ["production", "production"], message: 'duplicate name "production"' },
  ])("rejects invalid environment names: $value", ({ value, message }) => {
    const root = createTempProject(`module.exports = { environments: ${JSON.stringify(value)} };`);
    expect(() => getProjectConfig(root)).toThrow(message);
  });

  it("throws when namespaceCharacter is not a non-empty string", () => {
    const cases = [
      {
        config: "module.exports = { namespaceCharacter: '' };",
        message: "Invalid namespaceCharacter: . It must be a non-empty string.",
      },
      {
        config: "module.exports = { namespaceCharacter: 1 };",
        message: "Invalid namespaceCharacter: 1. It must be a non-empty string.",
      },
    ];

    for (const testCase of cases) {
      const root = createTempProject(testCase.config);

      expect(() => getProjectConfig(root)).toThrow(testCase.message);
    }
  });

  it("accepts valid promotionFlows object rules", () => {
    const root = createTempProject(
      [
        "module.exports = {",
        "  promotionFlows: [",
        '    { from: "dev", to: "staging" },',
        '    { from: "staging", to: "production" },',
        "  ],",
        "};",
        "",
      ].join("\n"),
    );

    const config = getProjectConfig(root);

    expect(config.promotionFlows).toEqual([
      { from: "dev", to: "staging" },
      { from: "staging", to: "production" },
    ]);
  });

  it("rejects invalid promotionFlows shapes", () => {
    const cases = [
      {
        config: "module.exports = { promotionFlows: true };",
        message: "Invalid promotionFlows: true. It must be an array.",
      },
      {
        config: 'module.exports = { promotionFlows: ["dev"] };',
        message:
          'Invalid promotionFlows[0]: dev. Each entry must be an object with exactly "from" and "to" string fields.',
      },
      {
        config: 'module.exports = { promotionFlows: [{ from: "dev" }] };',
        message:
          'Invalid promotionFlows[0]: {"from":"dev"}. Each entry must contain exactly "from" and "to".',
      },
      {
        config:
          'module.exports = { promotionFlows: [{ from: "dev", to: "staging", note: true }] };',
        message:
          'Invalid promotionFlows[0]: {"from":"dev","to":"staging","note":true}. Each entry must contain exactly "from" and "to".',
      },
      {
        config: 'module.exports = { promotionFlows: [{ from: "dev", to: 1 }] };',
        message:
          'Invalid promotionFlows[0]: {"from":"dev","to":1}. "from" and "to" must be strings.',
      },
    ];

    for (const testCase of cases) {
      const root = createTempProject(testCase.config);

      expect(() => getProjectConfig(root)).toThrow(testCase.message);
    }
  });

  it("remaps project config paths for a set", () => {
    const root = createTempProject("module.exports = { sets: true };");
    const config = getProjectConfig(root);
    const setConfig = getProjectConfigForSet(config, "staging");
    const setRoot = path.join(root, "sets", "staging");

    expect(setConfig.featuresDirectoryPath).toBe(path.join(setRoot, "features"));
    expect(setConfig.environments).toBeUndefined();
    expect(setConfig.namespaceCharacter).toBe(".");
    expect(setConfig.reservedKeys).toEqual(["feature", "variation", "variable"]);
    expect(setConfig.segmentsDirectoryPath).toBe(path.join(setRoot, "segments"));
    expect(setConfig.attributesDirectoryPath).toBe(path.join(setRoot, "attributes"));
    expect(setConfig.schemasDirectoryPath).toBe(path.join(setRoot, "schemas"));
    expect(setConfig.targetsDirectoryPath).toBe(path.join(setRoot, "targets"));
    expect(setConfig.testsDirectoryPath).toBe(path.join(setRoot, "tests"));
    expect(setConfig.stateDirectoryPath).toBe(path.join(root, ".featurevisor", "sets", "staging"));
    expect(setConfig.datafilesDirectoryPath).toBe(path.join(root, "datafiles", "staging"));
  });

  it("preserves configured environments when remapping project config for a set", () => {
    const root = createTempProject(
      'module.exports = { sets: true, environments: ["staging", "production"] };',
    );
    const config = getProjectConfig(root);
    const setConfig = getProjectConfigForSet(config, "staging");

    expect(setConfig.environments).toEqual(["staging", "production"]);
  });
});
