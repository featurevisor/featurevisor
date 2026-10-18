import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lerna = JSON.parse(readFileSync(new URL("../lerna.json", import.meta.url), "utf8"));
assert.equal(lerna.command.version.changelogPreset, "conventionalcommits");

// Match Lerna's require-first loader and its installed parser, not a separate parser version.
const lernaRequire = createRequire(require.resolve("lerna"));
const presetModule = lernaRequire("conventional-changelog-conventionalcommits");
const preset = (presetModule.default || presetModule)();
const parser = lernaRequire("conventional-commits-parser");
for (const [message, expected] of [
  ["fix: correct a condition", 2],
  ["feat: add a new operator", 1],
  ["refactor!: remove an obsolete API", 0],
  ["feat(sdk)!: change evaluation", 0],
  ["refactor: replace an API\n\nBREAKING CHANGE: use the new API", 0],
]) {
  const commit = parser.sync(message, preset.parser);
  assert.equal(preset.whatBump([commit]).level, expected, message);
}
console.log("Release preset recognises fixes, features, breaking headers and breaking footers.");
