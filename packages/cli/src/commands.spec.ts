import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { parsers } from "@featurevisor/parsers";

import {
  assessDistributionPlugin,
  benchmarkPlugin,
  buildPlugin,
  evaluatePlugin,
  listPlugin,
} from "@featurevisor/core";

const repositoryPath = path.resolve(__dirname, "../../..");
// Transpile only modules loaded by the subprocess. No package outputs are rebuilt.
const sourceRunner = `
  const fs = require("node:fs");
  const path = require("node:path");
  const Module = require("node:module");
  const { transformSync } = require("@swc/core");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (["@featurevisor/core", "@featurevisor/sdk", "@featurevisor/parsers"].includes(request)) {
      request = path.resolve("packages", request.split("/")[1], "src/index.ts");
    }
    if (request.startsWith(".") && request.endsWith(".js") && args[0]?.filename.endsWith(".ts")) {
      const source = path.resolve(path.dirname(args[0].filename), request.slice(0, -3) + ".ts");
      if (fs.existsSync(source)) request = source;
    }
    return resolve.call(this, request, ...args);
  };
  require.extensions[".ts"] = (module, filename) => {
    module._compile(transformSync(fs.readFileSync(filename, "utf8"), {
      filename,
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" }
    }).code, filename);
  };
  process.argv = [process.execPath, "featurevisor", ...process.argv.slice(1)];
  require(path.resolve("packages/cli/src/index.ts"));
`;
const plugins = [
  evaluatePlugin,
  benchmarkPlugin,
  assessDistributionPlugin,
  buildPlugin,
  listPlugin,
];
const defaultExamples = plugins.flatMap((plugin) =>
  plugin.examples.filter(
    ({ command, description }) =>
      !command.includes("--environment=") &&
      !description.startsWith("For a project defining ") &&
      (plugin !== buildPlugin || command.includes("--print")),
  ),
);
const authoringExamples = [evaluatePlugin, benchmarkPlugin].flatMap((plugin) =>
  plugin.examples.filter(({ description }) => description.startsWith("For a project defining ")),
);

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    fs.readdirSync(root, { recursive: true, withFileTypes: true }).map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return entry.isDirectory()
        ? [path.relative(root, file) + "/", ""]
        : [path.relative(root, file), fs.readFileSync(file, "utf8")];
    }),
  );
}

function parseExample(command: string): string[] {
  // Help examples use single quotes around JSON and no shell expansion.
  return (command.match(/(?:[^\s']+|'[^']*')+/g) || []).map((arg) => arg.replace(/'/g, ""));
}

describe("CLI command examples and outcomes", () => {
  let root: string;
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-cli-commands-"));
    fs.cpSync(path.join(repositoryPath, "examples/example-yml"), root, {
      recursive: true,
      filter: (file) =>
        !["node_modules", "datafiles", ".featurevisor", ".git"].includes(path.basename(file)),
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[], columns?: number) {
    const result = spawnSync(
      process.execPath,
      ["-e", sourceRunner, "--", ...args, `--root-directory-path=${root}`],
      {
        cwd: repositoryPath,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: undefined,
          ...(columns ? { COLUMNS: String(columns) } : {}),
        },
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { success: result.status === 0, exitCode: result.status };
  }

  function output() {
    return stdout;
  }

  test("loads the current workspace sources", () => {
    expect(require.resolve("@featurevisor/core")).toBe(
      path.join(repositoryPath, "packages/core/src/index.ts"),
    );
    expect(require.resolve("@featurevisor/sdk")).toBe(
      path.join(repositoryPath, "packages/sdk/src/index.ts"),
    );
  });

  test.each([true, false])(
    "keeps root help compact with existing command availability (project=%s)",
    async (project) => {
      if (!project) fs.unlinkSync(path.join(root, "featurevisor.config.js"));
      expect(await run(["--help"])).toEqual({ success: true, exitCode: 0 });
      if (project) expect(output()).not.toMatch(/featurevisor init\s+Scaffold/);
      else expect(output()).toMatch(/featurevisor init\s+Scaffold/);
      expect(output()).toContain("Run featurevisor <command> --help for options and examples.");
      const examples = output().split("Examples:")[1];
      expect(examples.match(/^\s{2}featurevisor /gm)).toHaveLength(project ? 5 : 6);
      expect(examples).not.toContain("--variation");
      expect(examples).not.toContain("--include-features");
    },
  );

  test("puts capability examples in evaluate help, not unrelated commands", async () => {
    expect(await run(["evaluate", "--help"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).toContain("Examples:");
    expect(output()).toContain("--feature=showCookieBanner");
    expect(output()).toContain("--feature=sidebar");
    expect(output()).toContain("--variable=supportEmail");
    expect(output()).not.toMatch(/featurevisor (?:init|benchmark|build|list)\b/);
    expect(
      output()
        .split("Examples:")[1]
        .match(/^\s{2}featurevisor /gm),
    ).toHaveLength(evaluatePlugin.examples.length);
    expect(await run(["benchmark", "--help"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).toContain("--variation");
    expect(output()).toContain("--variable=title");
    expect(
      output()
        .split("Examples:")[1]
        .match(/^\s{2}featurevisor /gm),
    ).toHaveLength(benchmarkPlugin.examples.length);
  });

  test.each([80, 120])("keeps quoted context examples copyable at %i columns", async (columns) => {
    for (const args of [["--help"], ["evaluate", "--help"]]) {
      expect(await run(args, columns)).toEqual({ success: true, exitCode: 0 });
      expect(output()).toContain("--root-directory-path");
      expect(output()).not.toContain("--rootDirectoryPath");
      const contextLines = output()
        .split("\n")
        .filter((line) => line.includes("--context="));
      expect(contextLines.length).toBeGreaterThan(0);
      for (const line of contextLines) {
        expect(line).toMatch(/--context='\{[^']+\}'/);
      }
    }
  });

  test("retains a custom project plugin named init", async () => {
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      `module.exports = {
      plugins: [{ command: "init", handler: async () => undefined,
        examples: [{ command: "init", description: "Custom project initialization" }] }]
    };`,
    );
    expect(await run(["--help"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).toContain("Custom project initialization");
    expect(stderr).toBe("");
  });

  test("shows init examples inside a project without extracting anything", async () => {
    const before = snapshot(root);
    expect(await run(["init", "--help"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).toContain("--example=with-environments");
    expect(snapshot(root)).toEqual(before);
  });

  test.each([
    { args: ["lnt"], hint: 'Did you mean "lint"?' },
    { args: ["lint", "--entitytype=feature"], hint: 'Did you mean "--entity-type"?' },
    {
      args: ["list", "--features", "--key-patern=showCookieBanner"],
      hint: 'Did you mean "--key-pattern"?',
    },
  ])("suggests a correction but still rejects $args", async ({ args, hint }) => {
    const before = snapshot(root);
    expect(await run(args)).toEqual({ success: false, exitCode: 1 });
    expect(stderr).toContain(hint);
    expect(snapshot(root)).toEqual(before);
  });

  test("does not suggest unrelated or other command options", async () => {
    expect(await run(["evaluate", "--key-patern=anything"])).toEqual({
      success: false,
      exitCode: 1,
    });
    expect(stderr).not.toContain("Did you mean");
    expect(await run(["unrelated-command"])).toEqual({ success: false, exitCode: 1 });
    expect(stderr).not.toContain("Did you mean");
  });

  test("scaffold test cases have plain descriptions and pass unchanged expectations", async () => {
    expect(await run(["test"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).not.toMatch(/Assertion #\d+ \(/);
    expect(output()).toContain("Matches users in the Netherlands");
    expect(output()).toContain("Does not match when country is missing");
    expect(output()).not.toMatch(/At \d+%/);
  });

  test.each(defaultExamples)("runs the read only help example: $command", async ({ command }) => {
    const before = snapshot(root);
    expect(await run(parseExample(command))).toEqual({ success: true, exitCode: 0 });
    expect(stderr).toBe("");
    expect(snapshot(root)).toEqual(before);
    expect(output()).not.toMatch(/feature_not_found|variable_not_found|Value: undefined/);
    if (command.startsWith("evaluate")) expect(output()).toContain("Value: true");
    if (command.startsWith("benchmark")) expect(output()).toMatch(/Evaluated value.*true/);
    if (command.startsWith("build")) {
      expect(JSON.parse(output()).features).toHaveProperty("showCookieBanner");
    }
  });

  test.each(authoringExamples)("runs the prerequisite example: $command", async ({ command }) => {
    expect(command).not.toContain("--environment");
    const examplePath = path.join(repositoryPath, "examples/example-1");
    // Reuse real authored definitions, selecting their production content for a flat fixture.
    for (const file of ["features/sidebar.yml", "variables/supportEmail.yml"]) {
      const definition = parsers.yml.parse<Record<string, any>>(
        fs.readFileSync(path.join(examplePath, file), "utf8"),
      );
      for (const field of ["rules", "overrides", "expose"]) {
        if (definition[field]) {
          if (definition[field].production === undefined) delete definition[field];
          else definition[field] = definition[field].production;
        }
      }
      const destination = path.join(root, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, parsers.yml.stringify(definition));
    }
    for (const country of ["germany", "switzerland", "netherlands"]) {
      const file = `segments/countries/${country}.yml`;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(examplePath, file), path.join(root, file));
    }
    const before = snapshot(root);
    expect(await run(parseExample(command))).toEqual({ success: true, exitCode: 0 });
    expect(stderr).toBe("");
    expect(snapshot(root)).toEqual(before);
    assertAuthoringValue(command);

    // The same examples also work in the unchanged environment based Example 1 project.
    fs.rmSync(root, { recursive: true });
    fs.cpSync(examplePath, root, {
      recursive: true,
      filter: (file) =>
        !["node_modules", "datafiles", ".featurevisor", ".git"].includes(path.basename(file)),
    });
    const exampleBefore = snapshot(root);
    expect(await run([...parseExample(command), "--environment=production"])).toEqual({
      success: true,
      exitCode: 0,
    });
    expect(stderr).toBe("");
    expect(snapshot(root)).toEqual(exampleBefore);
    assertAuthoringValue(command);
  });

  function assertAuthoringValue(command: string) {
    expect(output()).not.toMatch(/feature_not_found|variable_not_found|\bValue: undefined/);
    if (command.includes("--variable=supportEmail")) {
      expect(output()).toContain('"support-nl@example.com"');
    } else if (command.includes("--variation")) {
      expect(output()).toMatch(/Evaluated value.*"(?:control|treatment)"/);
    } else {
      expect(output()).toContain('"Sidebar Title for production"');
      if (command.startsWith("evaluate")) {
        expect(output()).toContain("Variable: title");
        expect(output()).toMatch(/Value: "(?:control|treatment)"/);
      }
    }
  }

  test.each(plugins.filter((plugin) => plugin !== listPlugin))(
    "$command labels its environment example and runs it on the environment scaffold",
    async (plugin) => {
      fs.rmSync(root, { recursive: true });
      fs.cpSync(path.join(repositoryPath, "examples/example-with-environments"), root, {
        recursive: true,
        filter: (file) =>
          !["node_modules", "datafiles", ".featurevisor", ".git"].includes(path.basename(file)),
      });
      const examples = plugin.examples.filter(({ command }) => command.includes("--environment="));
      expect(examples).toHaveLength(1);
      expect(examples[0].description).toMatch(/^With environments configured:/);
      expect(await run(parseExample(examples[0].command))).toEqual({ success: true, exitCode: 0 });
      expect(stderr).toBe("");
    },
  );

  test.each(["keyPattern", "key-pattern"])("accepts the --%s alias", async (flag) => {
    expect(await run(["list", "--features", `--${flag}=^showCookieBanner$`, "--json"])).toEqual({
      success: true,
      exitCode: 0,
    });
    expect(JSON.parse(output()).map((feature: { key: string }) => feature.key)).toEqual([
      "showCookieBanner",
    ]);
  });

  test.each(["executionProtocol", "execution-protocol"])(
    "keeps hidden --%s usable",
    async (flag) => {
      expect(await run(["list", "--tests", `--${flag}`])).toEqual({ success: true, exitCode: 0 });
      expect(JSON.parse(output())).toMatchObject({
        kind: "featurevisor.test-execution",
        schemaVersion: 1,
      });
    },
  );

  test("list help describes selectors without internal test options", async () => {
    expect(await run(["list", "--help"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).toMatch(/--features\s+list features/);
    expect(output()).toMatch(/--variables\s+list global variables/);
    expect(output()).not.toMatch(/--executionProtocol|--executionMetadata|--case\b/);
  });

  test("lint shows parse error stacks only with --verbose", async () => {
    fs.writeFileSync(path.join(root, "features/broken.yml"), "description: [\n");
    expect(await run(["lint"])).toEqual({ success: false, exitCode: 1 });
    expect(output()).toContain("broken.yml");
    expect(output()).not.toMatch(/\n\s+at /);
    expect(await run(["lint", "--verbose"])).toEqual({ success: false, exitCode: 1 });
    expect(stderr).toBe("");
    expect(output()).toContain("broken.yml");
    expect(output()).toMatch(/\n\s+at /);
  });

  test("list without a selector names the available flags", async () => {
    expect(await run(["list"])).toEqual({ success: false, exitCode: 1 });
    const message = stderr;
    for (const selector of [
      "features",
      "segments",
      "schemas",
      "attributes",
      "variables",
      "targets",
      "datafiles",
      "tests",
      "scenarios",
    ]) {
      expect(message).toContain(`--${selector}`);
    }
  });

  test("uses singular and plural entity counts", async () => {
    await run(["list", "--features"]);
    expect(output()).toContain("Found 1 feature.");
    await run(["list", "--attributes"]);
    expect(output()).toContain("Found 3 attributes.");
  });

  test("does not print an environment heading for a flat build", async () => {
    expect(await run(["build"])).toEqual({ success: true, exitCode: 0 });
    expect(output()).not.toMatch(/No environment|Environment "/);
    expect(output()).toMatch(/Target.*all/);
    await run(["list", "--datafiles"]);
    expect(output()).toContain("Found 1 datafile.");
  });

  test("failed assertions exit unsuccessfully", async () => {
    const file = path.join(root, "tests/features/showCookieBanner.spec.yml");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace("expectedToBeEnabled: true", "expectedToBeEnabled: false"),
    );
    expect(await run(["test"])).toEqual({ success: false, exitCode: 1 });
  });

  test.each(["feature", "variable"])(
    "rejects evaluation of an unknown authored %s key",
    async (entity) => {
      expect(await run(["evaluate", `--${entity}=missing`, "--json"])).toEqual({
        success: false,
        exitCode: 1,
      });
      expect(output()).toBe("");
      expect(JSON.parse(stderr).error.code).toBe(`unknown_${entity}`);
    },
  );
});
