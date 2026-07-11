/* global __dirname, process */

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const binPath = path.resolve(__dirname, "..", "bin.js");

function run(args) {
  const cwd = mkdtempSync(path.join(tmpdir(), "featurevisor-cli-smoke-"));

  try {
    return spawnSync(process.execPath, [binPath, ...args], {
      cwd,
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

test("shows help when requested", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: <command> \[options\]/);
});

test("accepts obsolete flags without a dedicated failure", () => {
  const result = run(["--schema-version=1", "--with-scopes", "--with-tags"]);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /Unknown argument/);
});
