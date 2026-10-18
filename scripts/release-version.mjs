import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const packageVersions = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readJson(join(root, "packages", entry.name, "package.json")))
  .filter((pkg) => pkg.name?.startsWith("@featurevisor/"));

assert.ok(packageVersions.length > 0, "No publishable packages found");
const major = Number(readJson(join(root, "lerna.json")).version.split(".")[0]);
const allBeforeFour =
  major < 4 && packageVersions.every((pkg) => Number(pkg.version.split(".")[0]) < 4);
const allAtLeastFour =
  major >= 4 && packageVersions.every((pkg) => Number(pkg.version.split(".")[0]) >= 4);
assert.ok(allBeforeFour || allAtLeastFour, "Mixed major versions: refusing to publish");

const existingTag = spawnSync("git", ["tag", "--list", "v4.0.0"], { cwd: root, encoding: "utf8" });
assert.equal(existingTag.status, 0, existingTag.stderr);
assert.ok(
  !allBeforeFour || !existingTag.stdout.trim(),
  "v4.0.0 already exists: refusing initial release",
);

if (process.argv.includes("--mode")) {
  assert.equal(process.argv.length, 3, "Only --mode is supported");
  console.log(allBeforeFour ? "initial" : "regular");
  process.exit(0);
}
assert.equal(process.argv.length, 2, "Only --mode is supported");

const args = allBeforeFour
  ? [
      "lerna",
      "version",
      "4.0.0",
      "--conventional-commits",
      "--force-publish",
      "--exact",
      "--yes",
      "--no-push",
    ]
  : [
      "lerna",
      "version",
      "--conventional-commits",
      "--conventional-graduate",
      "--exact",
      "--yes",
      "--no-push",
    ];
console.log(allBeforeFour ? "Initial 4.0.0 release of all packages" : "Conventional release");
const result = spawnSync(join(root, "node_modules", ".bin", "lerna"), args.slice(1), {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
assert.equal(result.status, 0, "Versioning failed; publish and push must not run");

if (allBeforeFour) {
  assert.equal(readJson(join(root, "lerna.json")).version, "4.0.0");
  const lock = readJson(join(root, "package-lock.json"));
  const workspaces = ["packages", "examples"].flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name))
      .filter((path) => {
        try {
          readJson(join(root, path, "package.json"));
          return true;
        } catch {
          return false;
        }
      }),
  );
  const names = new Set(workspaces.map((path) => readJson(join(root, path, "package.json")).name));
  for (const path of workspaces) {
    const pkg = readJson(join(root, path, "package.json"));
    assert.equal(pkg.version, "4.0.0", `${pkg.name} was not updated to 4.0.0`);
    assert.equal(lock.packages[path]?.version, "4.0.0", `${pkg.name} lockfile version is stale`);
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, range] of Object.entries(pkg[field] || {})) {
        if (names.has(name)) assert.equal(range, "4.0.0", `${pkg.name} ${field} ${name} is stale`);
      }
    }
  }
  const tag = spawnSync("git", ["rev-parse", "v4.0.0^{commit}"], { cwd: root, encoding: "utf8" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(tag.status, 0, "Lerna did not create v4.0.0");
  assert.equal(
    tag.stdout.trim(),
    head.stdout.trim(),
    "v4.0.0 does not point at the version commit",
  );
}
