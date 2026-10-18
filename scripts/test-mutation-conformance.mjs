import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = dirname(root);
const sourceProject = join(root, "examples", "example-1");
const sourceConfig = join(sourceProject, "featurevisor.config.js");
const originalConfig = readFileSync(sourceConfig, "utf8");
const temporary = mkdtempSync(join(tmpdir(), "featurevisor-mutation-conformance-"));
const cli = join(root, "packages", "cli", "bin.js");
const selected = process.argv.slice(2);

// Keep these launchers aligned with test-runner-conformance.mjs.
const runners = {
  javascript: { cwd: root, command: process.execPath, args: [cli] },
  go: { cwd: join(workspace, "featurevisor-go"), command: "go", args: ["run", "cmd/main.go"] },
  swift: {
    cwd: join(workspace, "featurevisor-swift2"),
    command: "swift",
    args: ["run", "--skip-build", "featurevisor"],
  },
  java: {
    cwd: join(workspace, "featurevisor-java"),
    command: "mvn",
    args: [
      "-q",
      "-pl",
      "featurevisor-sdk",
      "exec:java",
      "-Dexec.mainClass=com.featurevisor.cli.CLI",
    ],
  },
  ruby: {
    cwd: join(workspace, "featurevisor-ruby"),
    command: "bundle",
    args: ["exec", "ruby", "bin/featurevisor"],
  },
  python: {
    cwd: join(workspace, "featurevisor-python"),
    command: process.env.FEATUREVISOR_PYTHON || "python3",
    args: ["-m", "featurevisor"],
    env: { PYTHONPATH: "src" },
  },
  php: { cwd: join(workspace, "featurevisor-php"), command: "./featurevisor", args: [] },
  rust: {
    cwd: join(workspace, "featurevisor-rust"),
    command: "cargo",
    args: ["run", "--quiet", "--features", "cli", "--bin", "featurevisor", "--"],
  },
  elixir: { cwd: join(workspace, "featurevisor-elixir"), command: "./featurevisor", args: [] },
  dart: {
    cwd: join(workspace, "featurevisor-dart/packages/featurevisor"),
    command: "dart",
    args: ["run", "bin/featurevisor.dart"],
  },
  dotnet: {
    cwd: join(workspace, "featurevisor-dotnet"),
    command: "dotnet",
    args: [
      "run",
      "--no-build",
      "--project",
      "src/Featurevisor.Cli/Featurevisor.Cli.csproj",
      "-c",
      "Release",
      "-f",
      "net10.0",
      "--",
    ],
  },
};

function mavenArguments(args) {
  return args.map((arg) => `'${arg.replace(/'/g, `'"'"'`)}'`).join(" ");
}

function parseJson(name, result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${name}: ${result.stderr}`);
  assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${name}: expected exactly one JSON document\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function executeRunner(name, project) {
  const runner = runners[name];
  const directoryOption = name === "javascript" ? "rootDirectoryPath" : "projectDirectoryPath";
  const testArgs = [
    "test",
    `--${directoryOption}=${project}`,
    "--keyPattern=^(mutationConformance|orderedMutationCheckout|orderedMutationFeature)$",
    "--json",
  ];
  const args =
    name === "java"
      ? [...runner.args, `-Dexec.args=${mavenArguments(testArgs)}`]
      : [...runner.args, ...testArgs];
  const report = parseJson(
    name,
    spawnSync(runner.command, args, {
      cwd: runner.cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...runner.env },
    }),
  );
  assert.equal(report.schemaVersion, 1, `${name}: unexpected report schema`);
  assert.equal(report.runner, name, `${name}: unexpected runner identity`);
  assert.equal(report.passed, true, `${name}: portable mutation spec failed`);
  assert.deepEqual(report.summary.specs, { passed: 3, failed: 0 });
  assert.deepEqual(report.summary.assertions, { passed: 16, failed: 0 });
  return report;
}

function comparable(report) {
  return {
    passed: report.passed,
    summary: report.summary,
    results: report.results.map((spec) => ({
      type: spec.type,
      key: spec.key,
      source: spec.source,
      set: spec.set,
      passed: spec.passed,
      cases: spec.cases.map((testCase) => ({
        id: testCase.id,
        environment: testCase.environment,
        target: testCase.target,
        context: testCase.context,
        matrixValues: testCase.matrixValues,
        passed: testCase.passed,
      })),
    })),
  };
}

function copyProject(precomputeMutations) {
  const mode = String(precomputeMutations);
  const project = join(temporary, mode);
  cpSync(sourceProject, project, {
    recursive: true,
    filter: (path) => {
      const relative = path.slice(sourceProject.length).replace(/^\//, "");
      const first = relative.split("/")[0];
      return ![".featurevisor", "catalog", "datafiles", "node_modules", "out", "src"].includes(
        first,
      );
    },
  });
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"), "dir");
  const config = join(project, "featurevisor.config.js");
  writeFileSync(
    config,
    `${readFileSync(config, "utf8")}\nmodule.exports.precomputeMutations = ${mode};\n`,
  );
  return project;
}

function buildSnapshot(project, environment, precomputeMutations) {
  const datafile = parseJson(
    `javascript build (${precomputeMutations}, ${environment})`,
    spawnSync(
      process.execPath,
      [
        cli,
        "build",
        "--print",
        `--root-directory-path=${project}`,
        `--environment=${environment}`,
        "--target=mutation-conformance",
        "--no-state-files",
        "--revision-from-hash",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      },
    ),
  );
  assert.deepEqual(Object.keys(datafile.features).sort(), ["allowSignup"]);
  assert.deepEqual(Object.keys(datafile.variables).sort(), [
    "mutationConformance",
    "runtimePolicy",
  ]);
  const variable = datafile.variables.mutationConformance;
  assert.equal(typeof datafile.revision, "string");
  assert.equal(typeof variable.hash, "string");
  if (environment === "staging") {
    assert.equal(Boolean(variable.overrides), precomputeMutations);
    assert.equal(Boolean(variable.overrideProgram), !precomputeMutations);
  } else {
    assert.equal(Boolean(variable.overrides), false);
    assert.equal(Boolean(variable.overrideProgram), true);
  }
  return { datafileHash: datafile.revision, variableHash: variable.hash };
}

try {
  const names = selected.length
    ? selected
    : Object.keys(runners).filter((name) => name !== "javascript");
  for (const name of names) assert.ok(runners[name], `Unknown runner ${name}`);
  const nativeNames = names.filter((name) => name !== "javascript");
  const baselines = new Map();
  const hashes = new Map();

  for (const precomputeMutations of [true, false]) {
    const project = copyProject(precomputeMutations);
    const modeHashes = {};
    for (const environment of ["staging", "production"]) {
      modeHashes[environment] = buildSnapshot(project, environment, precomputeMutations);
    }
    hashes.set(precomputeMutations, modeHashes);

    const baseline = executeRunner("javascript", project);
    baselines.set(precomputeMutations, comparable(baseline));
    for (const name of nativeNames) {
      assert.deepEqual(
        comparable(executeRunner(name, project)),
        comparable(baseline),
        `${name}: portable outcomes differ with precomputeMutations=${precomputeMutations}`,
      );
    }
  }

  assert.deepEqual(
    baselines.get(true),
    baselines.get(false),
    "JavaScript portable outcomes differ between precomputation modes",
  );
  assert.notEqual(hashes.get(true).staging.variableHash, hashes.get(false).staging.variableHash);
  assert.notEqual(hashes.get(true).staging.datafileHash, hashes.get(false).staging.datafileHash);
  assert.equal(readFileSync(sourceConfig, "utf8"), originalConfig, "Example1 config changed");

  for (const precomputeMutations of [true, false]) {
    for (const environment of ["staging", "production"]) {
      const snapshot = hashes.get(precomputeMutations)[environment];
      console.log(
        `precomputeMutations=${precomputeMutations} ${environment}: datafile=${snapshot.datafileHash} variable=${snapshot.variableHash}`,
      );
    }
  }
  console.log(
    `Mutation conformance passed: 2 modes, 3 specs, 16 assertions per mode, ${2 * (nativeNames.length + 1)} runner reports`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
