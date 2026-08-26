import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectoryPath = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(rootDirectoryPath, "packages", "cli", "bin.js");
const temporaryDirectoryPath = mkdtempSync(join(tmpdir(), "featurevisor-cli-integration-"));
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
let checks = 0;

function copyProject(name) {
  const source = join(rootDirectoryPath, "examples", name);
  const destination = join(temporaryDirectoryPath, name);

  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const relativePath = path.slice(source.length).replace(/^\//, "");
      const firstPart = relativePath.split("/")[0];

      return !["catalog", "datafiles", "node_modules", "out", "src"].includes(firstPart);
    },
  });

  return destination;
}

function clean(value) {
  return value.replace(ansiPattern, "").trim();
}

function formatCommand(args) {
  return `featurevisor ${args.join(" ")}`;
}

function execute(projectDirectoryPath, args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd || projectDirectoryPath,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    timeout: 120_000,
  });

  if (result.error) {
    throw result.error;
  }

  return {
    ...result,
    stdout: clean(result.stdout || ""),
    stderr: clean(result.stderr || ""),
  };
}

function pass(label) {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function run(projectDirectoryPath, args, verify) {
  const result = execute(projectDirectoryPath, args);
  const command = formatCommand(args);

  assert.equal(
    result.status,
    0,
    `${command} failed\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
  );
  verify?.(result);
  pass(command);
  return result;
}

function fail(projectDirectoryPath, args, expected) {
  const result = execute(projectDirectoryPath, args);
  const command = formatCommand(args);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
  assert.match(output, expected, `${command} did not report the expected failure\n\n${output}`);
  pass(`${command} rejects invalid input`);
}

function parseJson(result, command) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${command} did not produce valid JSON\n\n${result.stdout}`, { cause: error });
  }
}

function runJson(projectDirectoryPath, args, verify) {
  return run(projectDirectoryPath, args, (result) => {
    const value = parseJson(result, formatCommand(args));
    verify?.(value);
  });
}

function assertFile(path, description) {
  assert.equal(existsSync(path), true, `${description} was not generated at ${path}`);
}

function snapshotStateFiles(projectDirectoryPath) {
  const stateDirectoryPath = join(projectDirectoryPath, ".featurevisor");
  return readdirSync(stateDirectoryPath)
    .sort()
    .map((name) => {
      const path = join(stateDirectoryPath, name);
      const stat = statSync(path);
      return { name, size: stat.size, modified: stat.mtimeMs, content: readFileSync(path, "utf8") };
    });
}

function testStandardProject(projectDirectoryPath) {
  console.log("\nTesting examples/example-1");

  writeFileSync(
    join(projectDirectoryPath, "targets", "context-hash.yml"),
    [
      "description: Context revision integration target",
      "tag: all",
      "context:",
      "  country: nl",
      "  device: mobile",
      "",
    ].join("\n"),
  );

  runJson(projectDirectoryPath, ["config", "--json"], (config) => {
    assert.deepEqual(config.environments, ["staging", "production"]);
    assert.equal(config.sets, false);
  });

  const nestedDirectoryPath = join(projectDirectoryPath, "tests", "features");
  const nestedResult = execute(projectDirectoryPath, ["config", "--json"], {
    cwd: nestedDirectoryPath,
  });
  assert.equal(nestedResult.status, 0, nestedResult.stderr);
  assert.equal(parseJson(nestedResult, "nested config").sets, false);
  pass("project discovery from a nested directory");

  runJson(
    projectDirectoryPath,
    ["--root-directory-path", projectDirectoryPath, "config", "--json"],
    (config) => assert.equal(config.sets, false),
  );

  run(projectDirectoryPath, ["lint"]);
  runJson(projectDirectoryPath, ["lint", "--json"], (result) => {
    assert.deepEqual(result.errors, []);
  });
  for (const entityType of [
    "feature",
    "segment",
    "group",
    "schema",
    "attribute",
    "target",
    "test",
  ]) {
    run(projectDirectoryPath, ["lint", `--entity-type=${entityType}`]);
  }
  run(projectDirectoryPath, ["lint", "--key-pattern=^(foo|mobile)$"]);

  run(projectDirectoryPath, ["test", "--only-failures"]);
  run(projectDirectoryPath, ["test", "--entity-type=feature", "--key-pattern=^foo$"]);
  run(projectDirectoryPath, ["test", "--entity-type=segment", "--key-pattern=^mobile$"]);
  run(projectDirectoryPath, ["test", "--target=all", "--target=checkout", "--only-failures"]);
  run(projectDirectoryPath, ["test", "--assertion-pattern=.*", "--only-failures"]);

  const datafilesDirectoryPath = join(projectDirectoryPath, "generated-datafiles");
  run(projectDirectoryPath, [
    "build",
    `--datafiles-dir=${datafilesDirectoryPath}`,
    "--no-state-files",
  ]);
  assertFile(join(datafilesDirectoryPath, "staging", "featurevisor-all.json"), "staging datafile");
  assertFile(
    join(datafilesDirectoryPath, "production", "featurevisor-checkout.json"),
    "production target datafile",
  );
  pass("build generated base and target datafiles");

  runJson(
    projectDirectoryPath,
    ["build", "--print", "--environment=staging", "--feature=foo", "--target=all"],
    (datafile) => {
      assert.equal(datafile.schemaVersion, "2");
      assert.ok(datafile.features.foo);
    },
  );

  let contentRevision;
  runJson(
    projectDirectoryPath,
    [
      "build",
      "--print",
      "--environment=staging",
      "--feature=foo",
      "--target=context-hash",
      "--revision=source-a",
      "--revision-from-hash",
    ],
    (datafile) => {
      assert.notEqual(datafile.revision, "source-a");
      contentRevision = datafile.revision;
    },
  );
  runJson(
    projectDirectoryPath,
    [
      "build",
      "--print",
      "--environment=staging",
      "--feature=foo",
      "--target=context-hash",
      "--revision=source-b",
      "--revision-from-hash",
    ],
    (datafile) => assert.equal(datafile.revision, contentRevision),
  );

  const context = '{"userId":"123","device":"mobile","country":"nl"}';
  const stateBeforeRuntimeCommands = snapshotStateFiles(projectDirectoryPath);
  runJson(
    projectDirectoryPath,
    ["evaluate", "--feature=foo", "--environment=staging", `--context=${context}`, "--json"],
    (evaluations) => {
      assert.equal(evaluations.flag.enabled, true);
      assert.ok(evaluations.variation.variation.value);
      assert.equal(typeof evaluations.variables.qux.variableValue, "boolean");
    },
  );
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--feature=foo",
      "--environment=production",
      "--target=all",
      "--target=checkout",
      `--context=${context}`,
      "--json",
    ],
    (evaluations) => {
      assert.deepEqual(
        evaluations.map((entry) => entry.target),
        ["all", "checkout"],
      );
    },
  );

  run(projectDirectoryPath, [
    "benchmark",
    "--feature=foo",
    "--environment=staging",
    `--context=${context}`,
    "-n=10",
  ]);
  run(projectDirectoryPath, [
    "benchmark",
    "--feature=foo",
    "--environment=staging",
    `--context=${context}`,
    "--variation",
    "-n=10",
  ]);
  run(projectDirectoryPath, [
    "benchmark",
    "--feature=foo",
    "--environment=staging",
    `--context=${context}`,
    "--variable=qux",
    "--target=all",
    "-n=10",
  ]);
  run(projectDirectoryPath, [
    "assess-distribution",
    "--feature=foo",
    "--environment=staging",
    `--context=${context}`,
    "--populate-uuid=userId",
    "--target=all",
    "-n=20",
  ]);
  assert.deepEqual(snapshotStateFiles(projectDirectoryPath), stateBeforeRuntimeCommands);
  pass("runtime evaluation commands leave state files untouched");

  for (const selector of [
    "features",
    "segments",
    "groups",
    "schemas",
    "attributes",
    "targets",
    "tests",
  ]) {
    runJson(projectDirectoryPath, ["list", `--${selector}`, "--json"], (entities) => {
      assert.ok(Array.isArray(entities));
      assert.ok(entities.length > 0);
    });
  }
  runJson(
    projectDirectoryPath,
    ["list", "--features", "--tag=all", "--target=checkout", "--json"],
    (features) => assert.ok(features.length > 0),
  );
  runJson(
    projectDirectoryPath,
    ["list", "--features", "--with-variations", "--with-variables", "--json"],
    (features) => assert.ok(features.some((feature) => feature.key === "foo")),
  );
  runJson(projectDirectoryPath, ["list", "--tests", "--apply-matrix", "--json"], (tests) =>
    assert.ok(tests.length > 0),
  );

  run(projectDirectoryPath, ["find-duplicate-segments", "--authors"]);
  run(projectDirectoryPath, ["find-usage", "--segment=mobile"]);
  run(projectDirectoryPath, ["find-usage", "--attribute=country"]);
  run(projectDirectoryPath, ["find-usage", "--feature=foo"]);
  run(projectDirectoryPath, ["find-usage", "--unused-segments"]);
  run(projectDirectoryPath, ["find-usage", "--unused-attributes"]);
  run(projectDirectoryPath, ["info", "--target=all", "--target=checkout"]);

  const generatedCodeDirectoryPath = join(projectDirectoryPath, "generated-code");
  run(projectDirectoryPath, [
    "generate-code",
    "--language=typescript",
    `--out-dir=${generatedCodeDirectoryPath}`,
    "--tag=all",
    "--target=checkout",
  ]);
  assertFile(join(generatedCodeDirectoryPath, "features.ts"), "generated feature types");
  pass("generate-code wrote TypeScript output");

  const catalogDirectoryPath = join(projectDirectoryPath, "generated-catalog");
  run(join(rootDirectoryPath, "examples", "example-1"), [
    "catalog",
    "export",
    `--out-dir=${catalogDirectoryPath}`,
  ]);
  assertFile(join(catalogDirectoryPath, "data", "manifest.json"), "Catalog manifest");
  pass("catalog export wrote its manifest");

  run(projectDirectoryPath, ["example", "--foo=bar"], (result) => {
    assert.match(result.stdout, /Running the example command/);
  });

  fail(projectDirectoryPath, ["lint", "--key-pattern=["], /valid regular expression/i);
  fail(projectDirectoryPath, ["evaluate", "--feature=foo", "--context=[]"], /JSON object/i);
  fail(projectDirectoryPath, ["benchmark", "--feature=foo", "-n=0"], /positive integer/i);
  fail(
    projectDirectoryPath,
    ["benchmark", "--feature=foo", "--variation", "--variable=qux"],
    /cannot be combined/i,
  );
  fail(projectDirectoryPath, ["list", "--features", "--segments"], /only one/i);
  fail(
    projectDirectoryPath,
    ["list", "--features", "--with-tests", "--without-tests"],
    /cannot be combined/i,
  );
  fail(projectDirectoryPath, ["find-usage"], /one usage query/i);
  fail(projectDirectoryPath, ["lint", "--key-pattrn=foo"], /Unknown argument/i);
}

function testSetProject(projectDirectoryPath) {
  console.log("\nTesting examples/example-test-environments");

  runJson(projectDirectoryPath, ["config", "--json"], (config) => {
    assert.equal(config.sets, true);
  });
  run(projectDirectoryPath, ["lint"]);
  runJson(projectDirectoryPath, ["lint", "--set=dev", "--json"], (result) => {
    assert.deepEqual(result.errors, []);
  });
  run(projectDirectoryPath, ["test", "--only-failures"]);
  run(projectDirectoryPath, ["test", "--set=staging", "--target=all", "--only-failures"]);

  const datafilesDirectoryPath = join(projectDirectoryPath, "generated-datafiles");
  run(projectDirectoryPath, [
    "build",
    `--datafiles-dir=${datafilesDirectoryPath}`,
    "--no-state-files",
  ]);
  for (const set of ["dev", "staging", "production"]) {
    assertFile(join(datafilesDirectoryPath, set, "featurevisor-all.json"), `${set} datafile`);
  }
  pass("set build generated a datafile for every release lane");

  runJson(projectDirectoryPath, ["list", "--set=dev", "--features", "--json"], (features) =>
    assert.deepEqual(
      features.map((feature) => feature.key),
      ["checkoutFlow"],
    ),
  );
  runJson(
    projectDirectoryPath,
    ["list", "--set=staging", "--tests", "--apply-matrix", "--json"],
    (tests) => assert.ok(tests.length > 0),
  );

  const context = '{"userId":"123","team":"engineering"}';
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--set=staging",
      "--feature=checkoutFlow",
      "--target=all",
      `--context=${context}`,
      "--json",
    ],
    (evaluations) => assert.equal(evaluations.flag.enabled, true),
  );
  run(projectDirectoryPath, [
    "benchmark",
    "--set=dev",
    "--feature=checkoutFlow",
    "--target=all",
    `--context=${context}`,
    "-n=10",
  ]);
  run(projectDirectoryPath, [
    "assess-distribution",
    "--set=staging",
    "--feature=checkoutFlow",
    "--target=all",
    `--context=${context}`,
    "--populate-uuid=userId",
    "-n=20",
  ]);
  run(projectDirectoryPath, ["info", "--set=production", "--target=all"]);
  run(projectDirectoryPath, ["find-usage", "--set=staging", "--segment=internal"]);
  run(projectDirectoryPath, ["find-duplicate-segments", "--set=staging"]);

  const generatedCodeDirectoryPath = join(projectDirectoryPath, "generated-code");
  run(projectDirectoryPath, [
    "generate-code",
    "--set=dev",
    "--language=typescript",
    `--out-dir=${generatedCodeDirectoryPath}`,
    "--target=all",
  ]);
  assertFile(join(generatedCodeDirectoryPath, "features.ts"), "set generated feature types");
  pass("set generate-code wrote TypeScript output");

  const catalogDirectoryPath = join(projectDirectoryPath, "generated-catalog");
  run(join(rootDirectoryPath, "examples", "example-test-environments"), [
    "catalog",
    "export",
    `--out-dir=${catalogDirectoryPath}`,
  ]);
  const manifest = JSON.parse(
    readFileSync(join(catalogDirectoryPath, "data", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.sets, true);
  assert.deepEqual(manifest.setKeys, ["dev", "staging", "production"]);
  pass("set Catalog manifest includes every release lane");

  run(projectDirectoryPath, ["promote", "--from=dev", "--to=staging"]);
  run(projectDirectoryPath, [
    "promote",
    "--from=dev",
    "--to=staging",
    "--target=all",
    "--tag=all",
    "--include-features=checkout*",
    "--audit",
  ]);
  run(projectDirectoryPath, [
    "promote",
    "--from=staging",
    "--to=production",
    "--conflicts=destination",
    "--show-unchanged",
  ]);

  fail(projectDirectoryPath, ["list", "--features", "--json"], /--set/i);
  fail(
    projectDirectoryPath,
    ["promote", "--from=dev", "--to=production"],
    /not allowed|promotionFlows/i,
  );
  fail(
    projectDirectoryPath,
    ["promote", "--from=dev", "--to=staging", "--include-features=missing*"],
    /No promotable changes|No source features or variables matched/i,
  );
}

try {
  assertFile(cliPath, "built Featurevisor CLI");
  const standardProject = copyProject("example-1");
  const setProject = copyProject("example-test-environments");

  mkdirSync(join(standardProject, "generated-datafiles"), { recursive: true });
  mkdirSync(join(setProject, "generated-datafiles"), { recursive: true });

  testStandardProject(standardProject);
  testSetProject(setProject);

  console.log(`\nFeaturevisor CLI integration checks passed: ${checks}`);
} finally {
  rmSync(temporaryDirectoryPath, { recursive: true, force: true });
}
