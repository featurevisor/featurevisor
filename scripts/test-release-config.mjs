import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const lerna = JSON.parse(readFileSync(new URL("../lerna.json", import.meta.url), "utf8"));
assert.equal(lerna.command.version.changelogPreset, "conventionalcommits");

// Match what Lerna's version command loads: the preset beside Lerna, and the parser used by
// the git client of its conventional-recommended-bump, not a separately installed version.
const resolveFrom = (specifier, packageJson) =>
  findPackageJSON(specifier, pathToFileURL(packageJson));
const importPackage = (packageJson) => {
  const { exports } = JSON.parse(readFileSync(packageJson, "utf8"));
  const entry = typeof exports === "string" ? exports : exports.import || exports["."];
  return import(pathToFileURL(join(dirname(packageJson), entry)).href);
};
async function main() {
  const lernaPackage = findPackageJSON("lerna", import.meta.url);
  const presetModule = await importPackage(
    resolveFrom("conventional-changelog-conventionalcommits", lernaPackage),
  );
  const preset = await presetModule.default();
  const { CommitParser } = await importPackage(
    resolveFrom(
      "conventional-commits-parser",
      resolveFrom(
        "@conventional-changelog/git-client",
        resolveFrom("conventional-recommended-bump", lernaPackage),
      ),
    ),
  );
  const parser = new CommitParser(preset.parser);
  for (const [message, expected] of [
    ["fix: correct a condition", 2],
    ["feat: add a new operator", 1],
    ["refactor!: remove an obsolete API", 0],
    ["feat(sdk)!: change evaluation", 0],
    ["refactor: replace an API\n\nBREAKING CHANGE: use the new API", 0],
  ]) {
    const result = await preset.whatBump([parser.parse(message)]);
    assert.equal(result.level, expected, message);
  }
  console.log("Release preset recognises fixes, features, breaking headers and breaking footers.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
