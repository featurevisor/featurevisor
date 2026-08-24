/* global __dirname, process */

const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const binPath = path.resolve(__dirname, "..", "bin.js");

function run(args, setup) {
  const cwd = mkdtempSync(path.join(tmpdir(), "featurevisor-cli-smoke-"));

  try {
    const commandCwd = setup ? setup(cwd) || cwd : cwd;
    return spawnSync(process.execPath, [binPath, ...args], {
      cwd: commandCwd,
      encoding: "utf8",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("prints package versions", () => {
  const result = run(["--version"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /@featurevisor\/cli:/);
  assert.match(result.stdout, /@featurevisor\/core:/);
});

test("prints package versions alongside a root directory option", () => {
  const result = run(["--root-directory-path", ".", "--version"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /@featurevisor\/cli:/);
  assert.match(result.stdout, /@featurevisor\/core:/);
});

test("shows help when requested", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: featurevisor <command> \[options\]/);
});

test("accepts obsolete flags without a dedicated failure", () => {
  const result = run(["init", "--schema-version=1", "--with-scopes", "--with-tags", "--help"]);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /Unknown argument/);
});

test("rejects misspelled built in options", () => {
  const result = run(["init", "--exmaple=json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: exmaple/);
});

test("rejects unexpected positional arguments", () => {
  const result = run(["init", "unexpected"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: unexpected/);
});

test("shows project command help outside a project", () => {
  const result = run(["help", "build"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /featurevisor build/);
  assert.match(result.stdout, /--target/);
});

test("discovers a project from a nested directory", () => {
  const result = run(["config", "--json"], (root) => {
    writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
    const nested = path.join(root, "features", "checkout");
    mkdirSync(nested, { recursive: true });
    return nested;
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"featuresDirectoryPath"/);
});

test("keeps undeclared custom plugin options permissive", () => {
  const result = run(["custom", "--anything=value"], (root) => {
    writeFileSync(
      path.join(root, "featurevisor.config.js"),
      `module.exports = {
        plugins: [{
          command: "custom",
          handler: async ({ parsed }) => console.log(parsed.anything),
          examples: [{ command: "custom --anything=value", description: "custom command" }],
        }],
      };\n`,
    );
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /value/);
});

test("validates declared custom plugin options", () => {
  const result = run(["custom", "--unknown=value"], (root) => {
    writeFileSync(
      path.join(root, "featurevisor.config.js"),
      `module.exports = {
        plugins: [{
          command: "custom",
          options: { known: { type: "string" } },
          handler: async () => undefined,
          examples: [{ command: "custom --known=value", description: "custom command" }],
        }],
      };\n`,
    );
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: unknown/);
});

test("requires a feature or top level variable for evaluation commands", () => {
  const result = run(["benchmark", "--context={}"], (root) => {
    writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --feature or --variable/);
});

test("benchmarks a top level variable without a feature", () => {
  const result = run(["benchmark", "--variable=supportEmail", "--n=1"], (root) => {
    writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
    mkdirSync(path.join(root, "variables"), { recursive: true });
    writeFileSync(
      path.join(root, "variables", "supportEmail.yml"),
      "description: Support email\ntype: string\ndefaultValue: help@example.com\n",
    );
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Evaluated value.*help@example.com/);
});
