import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyExperimentAllocation } from "./test-experiment-allocation.mjs";

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
      const relativePath = path.slice(source.length).replace(/\\/g, "/").replace(/^\//, "");
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
  if (!existsSync(stateDirectoryPath)) return [];
  return readdirSync(stateDirectoryPath, { recursive: true })
    .filter((name) => statSync(join(stateDirectoryPath, name)).isFile())
    .sort()
    .map((name) => {
      const path = join(stateDirectoryPath, name);
      const stat = statSync(path);
      return { name, size: stat.size, modified: stat.mtimeMs, content: readFileSync(path, "utf8") };
    });
}

function testDefinitionDiff(projectDirectoryPath, sets = false) {
  console.log(`\nTesting definition diffs (${sets ? "sets" : "example-1"})`);
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: projectDirectoryPath,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "Integration fixture");
  };
  git("init", "-b", "main");
  git("config", "user.name", "Integration test");
  git("config", "user.email", "integration@example.com");
  git("config", "commit.gpgsign", "false");
  commit();
  runJson(projectDirectoryPath, ["diff", "--json"], (value) => {
    assert.equal(value.reason, "primary");
    assert.deepEqual(value.changes, []);
  });
  git("switch", "-c", "review");
  const definitions = sets ? join(projectDirectoryPath, "sets", "dev") : projectDirectoryPath;
  const variables = join(definitions, "variables");
  mkdirSync(variables, { recursive: true });
  const variableFile = join(variables, "diffExample.yml");
  writeFileSync(
    variableFile,
    "description: Review example\ntype: string\ndefaultValue: Original\n",
  );
  commit();
  runJson(projectDirectoryPath, ["diff", "--json", "--pretty"], (value) => {
    assert.equal(value.reason, "branch");
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].kind, "added");
    assert.equal(value.changes[0].key, "diffExample");
    if (sets) assert.equal(value.changes[0].set, "dev");
  });
  const index = readFileSync(join(projectDirectoryPath, ".git", "index"));
  const state = snapshotStateFiles(projectDirectoryPath);
  writeFileSync(variableFile, "description: Review example\ntype: string\ndefaultValue: Updated\n");
  runJson(projectDirectoryPath, ["diff", "--json"], (value) => {
    assert.equal(value.reason, "uncommitted");
    assert.deepEqual(value.changes[0].changes, [
      { path: "/defaultValue", kind: "changed", before: "Original", after: "Updated" },
    ]);
  });
  run(projectDirectoryPath, ["diff"], (result) => {
    assert.match(result.stdout, /variable diffExample/);
    assert.match(result.stdout, /Original.*Updated/);
    assert.match(result.stdout, /0 added, 1 changed, 0 removed/);
  });
  runJson(projectDirectoryPath, ["diff", "--from=main", "--to=HEAD", "--json"], (value) => {
    assert.equal(value.reason, "explicit");
    assert.equal(value.changes[0].changes[0].after.defaultValue, "Original");
  });
  if (sets) {
    runJson(projectDirectoryPath, ["diff", "--set=staging", "--json"], (value) => {
      assert.deepEqual(value.changes, []);
    });
    fail(projectDirectoryPath, ["diff", "--set=missing"], /does not exist/);
  }
  const invalid = execute(projectDirectoryPath, ["diff", "--from=missing", "--json"]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).error.code, "diff_error");
  assert.equal(invalid.stdout, "");
  pass("diff reports structured failures without partial output");
  assert.deepEqual(readFileSync(join(projectDirectoryPath, ".git", "index")), index);
  assert.deepEqual(snapshotStateFiles(projectDirectoryPath), state);
  assert.equal(git("branch", "--show-current"), "review");
  pass("diff leaves Git index, branch, and build state untouched");
  run(projectDirectoryPath, ["diff", "--help"], (result) => {
    assert.match(result.stdout, /--from/);
    assert.match(result.stdout, /--to/);
  });
  const rulesFile = join(definitions, "features", "diffRuleExample.yml");
  const rulesDocument = (rules) => {
    const prefix = "description: Rule comparison example\ntags: [all]\nbucketBy: userId\n";
    const list = rules
      .map(([key, percentage]) => `- key: ${key}\n  conditions: '*'\n  percentage: ${percentage}\n`)
      .join("");
    return (
      prefix +
      (sets
        ? "rules:\n" + list.replace(/^/gm, "  ")
        : "rules:\n  production:\n" + list.replace(/^/gm, "    "))
    );
  };
  writeFileSync(
    rulesFile,
    rulesDocument([
      ["rollout", 10],
      ["obsolete", 0],
      ["catchAll", 100],
    ]),
  );
  commit();
  writeFileSync(
    rulesFile,
    rulesDocument([
      ["newAudience", 5],
      ["catchAll", 100],
      ["rollout", 50],
    ]),
  );
  run(projectDirectoryPath, ["diff"], (result) => {
    assert.match(result.stdout, /Rule "newAudience" added \(position 1\)/);
    assert.match(result.stdout, /Rule "obsolete" removed/);
    assert.match(result.stdout, /Rule "rollout" updated/);
    assert.match(result.stdout, /Rollout percentage: 10 → 50/);
    assert.match(result.stdout, /Rule order \(reordered\)/);
    assert.doesNotMatch(result.stdout, /Rule "catchAll" updated|\/rules\//);
  });
  runJson(projectDirectoryPath, ["diff", "--json"], (value) => {
    assert.equal(value.changes[0].key, "diffRuleExample");
    assert.ok(value.changes[0].changes.some((change) => change.path.startsWith("/rules/")));
    assert.ok(
      value.changes[0].details[0].children.some((detail) => detail.label === 'Rule "rollout"'),
    );
  });
}

function testMutationOrderMigration(projectDirectoryPath) {
  runJson(projectDirectoryPath, ["lint", "--json"], (report) => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(
      (report.warnings || []).filter((warning) => warning.code !== "context_value_mismatch"),
      [],
    );
    assert.ok(
      (report.warnings || []).every(
        (warning) => warning.code === "context_value_mismatch" && warning.path.includes("context"),
      ),
      "Deliberately invalid Example 1 contexts should produce only advisory schema warnings",
    );
  });
  for (const option of ["--v3-mutation-order", "--v3MutationOrder"]) {
    runJson(projectDirectoryPath, ["lint", option, "--json"], (report) => {
      assert.deepEqual(report.errors, []);
      const warning = report.warnings.find(
        (item) => item.code === "mutation_order_changed" && item.key === "arrayMutationExamples",
      );
      assert.ok(warning, "the opt in migration comparison must find the example");
      assert.match(warning.message, /v3 resolution \(shortest paths first\):/);
      assert.match(warning.message, /v4 resolution \(authored order\):/);
    });
  }
  run(projectDirectoryPath, ["build", "--environment=production", "--json"], (result) => {
    assert.ok(parseJson(result, "build").features.arrayMutationExamples);
    assert.equal(result.stderr, "");
  });
  fail(
    projectDirectoryPath,
    ["build", "--v3-mutation-order"],
    /unknown arguments.*v3-mutation-order/i,
  );
}

function testDateContexts(projectDirectoryPath) {
  const context = JSON.stringify({ userId: "scheduled-user", date: "2026-01-01" });
  for (const selection of [["--feature=scheduledRelease"], ["--variable=releaseTimestamp"]]) {
    const args = ["evaluate", ...selection, "--environment=staging", `--context=${context}`];
    runJson(projectDirectoryPath, [...args, "--explain", "--json"], (result) => {
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].attribute, "date");
      assert.match(result.warnings[0].message, /before and after operators do not match/);
      assert.match(result.warnings[0].message, /Context value "2026-01-01"/);
      if (selection[0].startsWith("--feature")) assert.equal(result.flag.enabled, false);
      else assert.equal(result.variableValue, "2026-11-27T00:00:00Z");
    });
    run(projectDirectoryPath, args, (result) => assert.match(result.stdout, /Warnings/));
  }
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--feature=scheduledRelease",
      "--environment=staging",
      "--json",
      '--context={"userId":"scheduled-user","date":"2026-11-27T01:00:00+01:00"}',
    ],
    (result) => {
      assert.equal(result.flag.enabled, true);
      assert.equal(result.warnings, undefined);
    },
  );
  run(
    projectDirectoryPath,
    [
      "test",
      "--entity-type=scenario",
      "--key-pattern=^scenarios.scheduled-release$",
      "--only-failures",
    ],
    (result) => assert.match(result.stdout, /Total cases:\s+4 passed, 0 failed/),
  );
  const invalid = join(projectDirectoryPath, "segments", "invalidDateComparison.yml");
  writeFileSync(
    invalid,
    JSON.stringify({
      description: "A date cannot be treated as text",
      conditions: { attribute: "date", operator: "matches", value: "[" },
    }),
  );
  try {
    const result = execute(projectDirectoryPath, ["lint", "--entity-type=segment", "--json"]);
    assert.equal(result.status, 1);
    const report = parseJson(result, "date operator lint");
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0].message, /date-time attribute "date"/);
    assert.deepEqual(report.errors[0].path, ["conditions", "operator"]);
    pass("date operators emit one precise diagnostic without duplicate regex errors");
  } finally {
    rmSync(invalid);
  }
}

function testVariableDiagnostics(projectDirectoryPath) {
  const file = join(projectDirectoryPath, "features", "diagnosticProbe.yml");
  writeFileSync(
    file,
    JSON.stringify({
      description: "Each invalid authored value produces one diagnostic",
      bucketBy: "userId",
      variablesSchema: {
        code: { type: "string", minLength: 5, defaultValue: "abcdef" },
        count: { type: "integer", defaultValue: 1 },
        opensAt: { type: "string", format: "date-time", defaultValue: "2026-01-01T00:00:00Z" },
      },
      variations: [
        { value: "control", weight: 50, variables: { code: "ab" } },
        { value: "treatment", weight: 50 },
      ],
      rules: {
        staging: [
          {
            key: "everyone",
            conditions: "*",
            percentage: 100,
            variables: { code: "abc", count: "nope", opensAt: "tomorrow" },
          },
        ],
      },
    }),
  );
  const args = ["lint", "--entity-type=feature", "--key-pattern=^diagnosticProbe$"];
  try {
    const result = execute(projectDirectoryPath, [...args, "--json"]);
    assert.equal(result.status, 1);
    const report = parseJson(result, "variable diagnostics");
    assert.deepEqual(
      report.errors.map((issue) => issue.path),
      [
        ["variations", 0, "variables", "code"],
        ["rules", "staging", 0, "variables", "code"],
        ["rules", "staging", 0, "variables", "count"],
        ["rules", "staging", 0, "variables", "opensAt"],
      ],
    );
    pass("JSON lint reports each variation and rule variable value error once");
    const text = execute(projectDirectoryPath, args);
    assert.equal(text.status, 1);
    for (const issue of report.errors) {
      const label = issue.path.join(".");
      assert.equal((text.stdout + text.stderr).split(label).length - 1, 1, label);
    }
    pass("text lint reports each variation and rule variable value error once");
  } finally {
    rmSync(file);
  }
}

function testMutationPrecomputation(projectDirectoryPath) {
  const configFile = join(projectDirectoryPath, "featurevisor.config.js");
  const original = readFileSync(configFile, "utf8");
  const contexts = [
    { country: "nl", city: "amsterdam", device: "mobile" },
    { country: "nl", city: "amsterdam", device: "desktop" },
    { country: "nl", city: "rotterdam" },
    { country: "us" },
  ];
  const baseline = [];
  try {
    for (const precompute of [true, false]) {
      writeFileSync(
        configFile,
        `${original}\nmodule.exports.precomputeMutations = ${precompute};\n`,
      );
      run(projectDirectoryPath, ["lint", "--entity-type=variable"]);
      run(projectDirectoryPath, [
        "test",
        "--key-pattern=^(mutationConformance|orderedMutationCheckout|orderedMutationFeature)$",
        "--only-failures",
      ]);
      for (const [index, context] of contexts.entries()) {
        runJson(
          projectDirectoryPath,
          [
            "evaluate",
            "--variable=campaignBanner",
            "--environment=production",
            "--target=all",
            `--context=${JSON.stringify(context)}`,
            "--explain",
            "--json",
          ],
          (evaluation) => {
            if (precompute) baseline[index] = evaluation.variableValue;
            else {
              assert.deepEqual(evaluation.variableValue, baseline[index]);
              assert.ok(evaluation.variable.overrideProgram.length);
              assert.equal(evaluation.variable.overrides, undefined);
              assert.ok(
                evaluation.explanation.evidence.some(
                  (entry) => entry.title === "Applied runtime global variable overrides",
                ),
              );
            }
            assert.deepEqual(evaluation.explanation.result.value, evaluation.variableValue);
            assert.equal(evaluation.reason, "variable_override_rule");
          },
        );
      }
      // Runtime execution does not bypass result validation in linting.
      const invalid = join(projectDirectoryPath, "variables", "invalidPrecomputation.yml");
      writeFileSync(
        invalid,
        JSON.stringify({
          description: "Invalid mutation",
          type: "object",
          properties: { count: { type: "integer", minimum: 1 } },
          defaultValue: { count: 2 },
          overrides: { production: [{ key: "all", conditions: "*", mutate: { count: 0 } }] },
        }),
      );
      try {
        fail(projectDirectoryPath, ["lint", "--entity-type=variable"], /invalidPrecomputation/);
      } finally {
        rmSync(invalid);
      }
    }
  } finally {
    writeFileSync(configFile, original);
  }
}

function testOrderedMutationCodeGeneration(projectDirectoryPath) {
  const definition = join(projectDirectoryPath, "variables", "orderedMutationCodegen.yml");
  const directory = join(projectDirectoryPath, "ordered-mutation-codegen");
  const mutations = [{ title: "Checkout" }, { "methods:append": "ideal" }];
  let baseline;
  try {
    for (const mutate of [Object.fromEntries(mutations.flatMap(Object.entries)), mutations]) {
      writeFileSync(
        definition,
        JSON.stringify({
          description: "Equivalent code generation for both authoring forms",
          tags: ["all"],
          type: "object",
          properties: {
            title: { type: "string" },
            methods: { type: "array", items: { type: "string" } },
          },
          defaultValue: { title: "Default", methods: ["card"] },
          overrides: { production: [{ key: "all", conditions: "*", mutate }] },
        }),
      );
      run(projectDirectoryPath, [
        "lint",
        "--entity-type=variable",
        "--key-pattern=^orderedMutationCodegen$",
      ]);
      run(projectDirectoryPath, [
        "generate-code",
        "--language=typescript",
        "--react",
        `--out-dir=${directory}`,
      ]);
      const files = readdirSync(directory)
        .sort()
        .map((file) => [file, readFileSync(join(directory, file), "utf8")]);
      if (baseline) assert.deepEqual(files, baseline);
      else baseline = files;
    }
    pass("ordered and map mutations generate identical TypeScript and React code");
  } finally {
    rmSync(definition, { force: true });
    rmSync(directory, { recursive: true, force: true });
  }
}

function testScenarioChecks(projectDirectoryPath) {
  const scenarioKeys = {
    capacity: "scenarios.connection-capacity",
    featureAndGlobal: "workflows.feature-and-global",
    featureState: "scenarios.feature-state",
  };
  const expectedScenarioKeys = [
    "scenarios.array-membership",
    "scenarios.connection-capacity",
    "scenarios.emptiness-checks",
    "scenarios.experiment-allocation",
    "scenarios.feature-state",
    "scenarios.scheduled-release",
    "scenarios.signup-consistency",
    "scenarios.signup-sticky-children",
    "scenarios.unified-conditions",
    "scenarios.version-compatibility",
    "workflows.audience-checks",
    "workflows.feature-and-global",
  ];
  run(projectDirectoryPath, ["test", "--entity-type=scenario", "--only-failures"]);
  run(projectDirectoryPath, [
    "test",
    "--entity-type=scenario",
    "--target=connection-tests",
    `--key-pattern=^${scenarioKeys.capacity.replaceAll(".", "\\.")}$`,
    "--assertion-pattern=staging",
  ]);
  runJson(
    projectDirectoryPath,
    ["list", "--tests", "--entity-type=scenario", "--apply-matrix", "--json"],
    (specs) => {
      assert.deepEqual(specs.map((spec) => spec.scenario).sort(), expectedScenarioKeys);
      const allocation = specs.find((spec) => spec.scenario === "scenarios.experiment-allocation");
      assert.equal(allocation.assertions.length, 18);
      assert.equal(allocation.assertions[0].checks[1].key, "never-both-enabled");
      const capacity = specs.find((spec) => spec.scenario === scenarioKeys.capacity);
      assert.equal(capacity.assertions.length, 4);
      assert.equal(capacity.assertions[0].checks[0].compareTo.variable, "connectionSettings");
      assert.equal(capacity.assertions[0].matrix, undefined);
      const featureAndGlobal = specs.find(
        (spec) => spec.scenario === scenarioKeys.featureAndGlobal,
      );
      assert.equal(
        featureAndGlobal.assertions[0].children[0].checks[0].variable,
        "connectionLimit",
      );
      const featureState = specs.find((spec) => spec.scenario === scenarioKeys.featureState);
      assert.equal(featureState.assertions[0].checks[0].feature, "pricing");
      assert.equal(featureState.assertions[0].children[0].checks[0].variation, "control");
      const audience = specs.find((spec) => spec.scenario === "workflows.audience-checks");
      assert.equal(audience.assertions.length, 2);
      assert.ok(audience._segments["countries.netherlands"]);
      assert.equal(audience.assertions[0].target, "connection-tests");
      const mixed = specs.find((spec) => spec.scenario === "scenarios.unified-conditions");
      assert.ok(mixed._segments.conditionAudience);
      assert.ok(mixed._segments["countries.netherlands"]);
      assert.equal(mixed.assertions[0].at, 75);
      assert.equal(mixed.assertions[0].children[1].stickyFeatures.conditionSource.enabled, false);
    },
  );

  runJson(projectDirectoryPath, ["list", "--scenarios", "--json"], (specs) => {
    assert.deepEqual(specs.map((spec) => spec.key).sort(), expectedScenarioKeys);
    assert.ok(
      specs.every(
        (spec) =>
          spec.checks.length &&
          !Object.hasOwn(spec, "scenario") &&
          !Object.hasOwn(spec, "assertions"),
      ),
    );
    assert.ok(specs.find((spec) => spec.key === scenarioKeys.capacity).matrix);
    assert.ok(specs.find((spec) => spec.key === scenarioKeys.featureAndGlobal));
  });
  run(projectDirectoryPath, ["lint", "--entity-type=scenario"]);

  // A project can test scenarios without any entity specs.
  const testsDirectory = join(projectDirectoryPath, "tests");
  const savedTests = join(projectDirectoryPath, "saved-tests");
  renameSync(testsDirectory, savedTests);
  mkdirSync(testsDirectory);
  for (const directory of ["scenarios", "workflows"]) {
    renameSync(join(savedTests, directory), join(testsDirectory, directory));
  }
  try {
    run(projectDirectoryPath, ["test", "--only-failures"], (result) => {
      assert.match(
        result.stdout,
        new RegExp(`Scenario specs:\\s+${expectedScenarioKeys.length} passed, 0 failed`),
      );
    });
  } finally {
    for (const directory of ["scenarios", "workflows"]) {
      renameSync(join(testsDirectory, directory), join(savedTests, directory));
    }
    rmSync(testsDirectory, { recursive: true, force: true });
    renameSync(savedTests, testsDirectory);
  }

  const entityInScenariosFile = join(testsDirectory, "scenarios", "pricing-entity.spec.yml");
  writeFileSync(
    entityInScenariosFile,
    JSON.stringify({
      feature: "pricing",
      assertions: [{ environment: "production", at: 10, expectedToBeEnabled: false }],
    }),
  );
  try {
    runJson(projectDirectoryPath, ["list", "--tests", "--json"], (specs) => {
      const entitySpec = specs.find((spec) => spec.key === "scenarios.pricing-entity");
      assert.equal(entitySpec.feature, "pricing");
      assert.equal(Object.hasOwn(entitySpec, "scenario"), false);
    });
    runJson(projectDirectoryPath, ["list", "--tests", "--execution-protocol"], (document) => {
      const entitySpec = document.tests.find((spec) => spec.key === "scenarios.pricing-entity");
      assert.equal(entitySpec._test.entityType, "feature");
      assert.match(entitySpec._test.source, /tests\/scenarios\/pricing-entity\.spec\.yml$/);
      assert.equal(JSON.parse(entitySpec.assertions[0]._case.id)[2], "scenarios.pricing-entity");
    });
    run(projectDirectoryPath, ["lint", "--entity-type=test"]);
    run(projectDirectoryPath, [
      "test",
      "--entity-type=feature",
      "--key-pattern=^pricing$",
      "--only-failures",
    ]);
  } finally {
    rmSync(entityInScenariosFile, { force: true });
  }

  const integrationDirectory = join(testsDirectory, "integration");
  const file = join(integrationDirectory, "integration-failure.spec.yml");
  mkdirSync(integrationDirectory, { recursive: true });
  const writeScenario = (scenario) =>
    writeFileSync(
      file,
      JSON.stringify({
        environment: "production",
        ...scenario,
      }),
    );
  const testArgs = [
    "test",
    "--entity-type=scenario",
    "--key-pattern=^integration\\.integration-failure$",
    "--only-failures",
  ];
  try {
    writeScenario({
      checks: [{ variable: "connectionLimit", operator: "lessThan", value: 0 }],
    });
    fail(projectDirectoryPath, testArgs, /check 1: did not match/);
    writeScenario({ checks: [{ feature: "pricing", variation: "unknown" }] });
    fail(
      projectDirectoryPath,
      testArgs,
      /feature pricing, variation: expected unknown, received control/,
    );
    writeScenario({
      target: "connection-tests",
      checks: [{ variable: "signupMessage", operator: "isNull" }],
    });
    fail(projectDirectoryPath, testArgs, /absent from the selected datafile/);
    writeScenario({
      checks: [
        {
          not: [
            {
              variable: "connectionLimit",
              operator: "greaterThan",
              compareTo: { variable: "connectionSettings" },
            },
          ],
        },
      ],
    });
    fail(projectDirectoryPath, testArgs, /Numeric comparison requires finite numbers/);
    writeScenario({
      checks: [{ variable: "connectionLimit", operator: "notNull" }],
      children: [
        {
          checks: [{ variable: "connectionLimit", operator: "lessThan", value: 0 }],
        },
      ],
    });
    fail(projectDirectoryPath, testArgs, /Child 1, check 1/);
    writeScenario({ checks: [] });
    fail(projectDirectoryPath, ["lint", "--entity-type=scenario"], /nonempty checks/);
    fail(projectDirectoryPath, testArgs, /nonempty checks/);
    writeScenario({
      checks: [{ feature: "pricing", variation: "control" }],
      unexpectedProperty: true,
    });
    fail(projectDirectoryPath, ["lint", "--entity-type=scenario"], /Unrecognized key/);
    fail(projectDirectoryPath, testArgs, /Unknown scenario property/);

    writeScenario({
      feature: "pricing",
      checks: [{ feature: "pricing", enabled: true }],
    });
    fail(
      projectDirectoryPath,
      ["lint", "--entity-type=test"],
      /entity test specs cannot contain root checks/i,
    );
    fail(projectDirectoryPath, ["test", "--only-failures"], /cannot contain root checks/i);

    writeScenario({ description: "Missing both an entity owner and scenario checks" });
    fail(projectDirectoryPath, ["lint", "--entity-type=test"], /root feature.*scenario checks/i);
    fail(projectDirectoryPath, ["test", "--only-failures"], /root feature.*scenario checks/i);

    writeScenario({
      checks: [{ feature: "pricing", enabled: true }],
      scenario: "authored-label",
    });
    fail(projectDirectoryPath, ["lint", "--entity-type=scenario"], /Unrecognized key.*scenario/is);
    fail(projectDirectoryPath, ["test", "--only-failures"], /Unknown scenario property "scenario"/);

    writeScenario({
      checks: [{ feature: "pricing", enabled: true }],
      assertions: [],
    });
    fail(projectDirectoryPath, ["lint", "--entity-type=scenario"], /without assertions/);
    fail(projectDirectoryPath, ["test", "--only-failures"], /without assertions/);
  } finally {
    rmSync(integrationDirectory, { recursive: true, force: true });
  }
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

  const removedGroups = execute(projectDirectoryPath, ["list", "--groups", "--json"]);
  assert.equal(removedGroups.status, 1);
  assert.equal(removedGroups.stdout, "");
  const removedGroupsError = JSON.parse(removedGroups.stderr).error;
  assert.equal(removedGroupsError.code, "removed_groups");
  assert.ok(
    removedGroupsError.message.includes(
      "https://featurevisor.com/docs/migrations/v4/#groups-removed",
    ),
  );
  pass("list --groups --json returns removed_groups and the migration link");

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
    "schema",
    "attribute",
    "target",
    "test",
    "variable",
  ]) {
    run(projectDirectoryPath, ["lint", `--entity-type=${entityType}`]);
  }
  run(projectDirectoryPath, ["lint", "--key-pattern=^(foo|mobile)$"]);

  run(projectDirectoryPath, ["test", "--only-failures"]);
  const configPath = join(projectDirectoryPath, "featurevisor.config.js");
  const originalConfig = readFileSync(configPath, "utf8");
  try {
    writeFileSync(
      configPath,
      `${originalConfig}\nmodule.exports.disallowOperators = ["includesAny", "notIncludesAny"];\n`,
    );
    const blocked = execute(projectDirectoryPath, ["lint", "--json"]);
    assert.equal(blocked.status, 1);
    const errors = parseJson(blocked, "blocked membership operators").errors;
    for (const operator of ["includesAny", "notIncludesAny"]) {
      for (const entityType of ["segment", "variable", "scenario"]) {
        assert.ok(
          errors.some(
            (error) =>
              error.entityType === entityType &&
              error.message.includes(`Operator "${operator}" is disallowed`),
          ),
          `${entityType} must reject ${operator}`,
        );
      }
    }
    pass(
      "disallowOperators blocks both membership operators in segments, variable prerequisites and scenario checks",
    );
  } finally {
    writeFileSync(configPath, originalConfig);
  }
  const invalidCandidatesPath = join(
    projectDirectoryPath,
    "segments",
    "invalidMembershipCandidates.yml",
  );
  try {
    for (const operator of ["includesAny", "notIncludesAny", "in", "notIn"]) {
      writeFileSync(
        invalidCandidatesPath,
        JSON.stringify({
          description: "Invalid membership candidate diagnostics",
          conditions: {
            attribute: operator.endsWith("Any") ? "permissions" : "country",
            operator,
            value: operator.endsWith("Any") ? [["write"]] : [{ country: "nl" }],
          },
        }),
      );
      const result = execute(projectDirectoryPath, ["lint", "--entity-type=segment", "--json"]);
      assert.equal(result.status, 1);
      const errors = parseJson(result, "invalid membership candidates").errors.filter(
        (error) => error.key === "invalidMembershipCandidates",
      );
      assert.ok(
        errors.some((error) =>
          error.message.includes(
            operator.endsWith("Any")
              ? "each candidate must be a string, number, boolean or null"
              : "value must be a list of strings or of numbers",
          ),
        ),
      );
      assert.ok(errors.every((error) => error.message !== "Invalid input"));
      if (operator.endsWith("Any")) {
        assert.equal(errors.length, 1, "malformed candidate must have one diagnostic");
      }
      pass(`lint retains specific malformed candidate diagnostics for ${operator}`);
    }
  } finally {
    rmSync(invalidCandidatesPath, { force: true });
  }
  run(projectDirectoryPath, [
    "test",
    "--key-pattern=^(permissionMembership|permissionNotice|scenarios.array-membership)$",
    "--only-failures",
  ]);
  for (const permissions of [["admin"], ["read"], []]) {
    for (const selector of ["--feature=permissionMembership", "--variable=permissionNotice"]) {
      run(projectDirectoryPath, [
        "evaluate",
        selector,
        "--environment=staging",
        "--target=all",
        "--explain",
        `--context=${JSON.stringify({ userId: "membership-integration", permissions })}`,
      ]);
    }
  }
  for (const environment of ["staging", "production"]) {
    runJson(
      projectDirectoryPath,
      [
        "build",
        `--environment=${environment}`,
        "--target=all",
        "--print",
        "--no-state-files",
        "--revision-from-hash",
      ],
      (datafile) => verifyExperimentAllocation(datafile, environment),
    );
  }
  run(projectDirectoryPath, ["test", "--entity-type=feature", "--key-pattern=^foo$"]);
  run(projectDirectoryPath, ["test", "--entity-type=segment", "--key-pattern=^mobile$"]);
  run(projectDirectoryPath, [
    "test",
    "--entity-type=variable",
    "--key-pattern=^(campaignBanner|flexibleIdentifier|signupMessage)$",
  ]);
  run(projectDirectoryPath, [
    "test",
    "--target=all",
    "--target=checkout",
    "--target=signup-message",
    "--only-failures",
  ]);
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

  const selectedDirectory = join(projectDirectoryPath, "selected-environment");
  run(projectDirectoryPath, [
    "build",
    "--environment=production",
    `--datafiles-dir=${selectedDirectory}`,
  ]);
  assertFile(
    join(selectedDirectory, "production", "featurevisor-all.json"),
    "selected environment datafile",
  );
  assertFile(join(selectedDirectory, "REVISION"), "custom output revision");
  assert.equal(existsSync(join(selectedDirectory, "staging")), false);
  pass("normal build honours the environment and writes the custom output revision");
  for (const extra of [[], ["--json"]]) {
    fail(
      projectDirectoryPath,
      ["build", "--environment=missing", ...extra],
      /Unknown environment/i,
    );
  }

  runJson(
    projectDirectoryPath,
    ["build", "--print", "--environment=staging", "--feature=foo", "--target=all"],
    (datafile) => {
      assert.equal(datafile.schemaVersion, "4");
      assert.ok(datafile.features.foo);
    },
  );
  runJson(
    projectDirectoryPath,
    ["build", "--print", "--environment=production", "--target=checkout"],
    (datafile) => {
      assert.deepEqual(Object.keys(datafile.variables), ["checkoutSettings"]);
      assert.ok(datafile.features.pricing);
      assert.ok(datafile.features.sidebar);
      assert.equal(datafile.variables.supportEmail, undefined);
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
  // Inject a contradictory explanation in a child process, never in project files.
  for (const json of [false, true]) {
    const script = [
      "const explanations = require(process.argv[1]);",
      "const original = explanations.explainEvaluation;",
      "explanations.explainEvaluation = (...args) => { const result = original(...args); result.result.value = 'incorrect'; return result; };",
      "process.argv = [process.execPath, process.argv[2], ...process.argv.slice(3)];",
      "require(process.argv[1]);",
    ].join("\n");
    const failed = spawnSync(
      process.execPath,
      [
        "-e",
        script,
        join(rootDirectoryPath, "packages/core/lib/evaluate/explain.js"),
        cliPath,
        "evaluate",
        "--variable=supportEmail",
        "--environment=production",
        "--explain",
        ...(json ? ["--json"] : []),
      ],
      { cwd: projectDirectoryPath, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
    assert.equal(failed.stdout.trim(), "");
    if (json) {
      const error = JSON.parse(failed.stderr).error;
      assert.equal(error.code, "evaluation_explanation_mismatch");
      assert.ok(error.details.mismatches.some((entry) => entry.field === "result.value"));
    } else {
      assert.match(failed.stderr, /Explanation does not match the SDK evaluation/);
    }
    pass(`evaluate explanation mismatch exits with an error (${json ? "JSON" : "text"})`);
  }
  for (const kind of ["feature", "variable"]) {
    for (const json of [false, true]) {
      for (const explain of [false, true]) {
        const result = execute(projectDirectoryPath, [
          "evaluate",
          `--${kind}=missing-${kind}`,
          "--environment=production",
          ...(json ? ["--json"] : []),
          ...(explain ? ["--explain"] : []),
        ]);
        assert.equal(result.status, 1);
        assert.equal(result.stdout.trim(), "");
        if (json) assert.equal(JSON.parse(result.stderr).error.code, `unknown_${kind}`);
        else assert.match(result.stderr, /Unknown (feature|variable)/);
        pass(`evaluate rejects unknown ${kind} (json=${json}, explain=${explain})`);
      }
    }
  }
  // Explanations augment the real SDK result without changing any evaluation.
  for (const selection of [
    ["--feature=foo"],
    ["--feature=pricing"],
    ["--feature=testDisabled"],
    ["--feature=withOverrides"],
    ["--variable=campaignBanner"],
    ["--variable=dependencyMessage"],
    ["--variable=runtimeMessage"],
    ["--variable=paymentPolicy"],
  ]) {
    const args = [
      "evaluate",
      ...selection,
      "--environment=production",
      '--context={"userId":"123","country":"nl","city":"amsterdam","device":"mobile"}',
      "--json",
    ];
    let original;
    runJson(projectDirectoryPath, args, (result) => {
      original = result;
    });
    runJson(projectDirectoryPath, [...args, "--explain", "--verbose", "--pretty"], (result) => {
      const { explanation, ...evaluations } = result;
      assert.deepEqual(evaluations, original);
      assert.ok(explanation);
      if (selection[0] === "--variable=campaignBanner") {
        assert.deepEqual(explanation.result.value, original.variableValue);
        assert.equal(explanation.mode, "outcome");
        const construction = explanation.evidence.find(
          (entry) => entry.title === "Authored value construction (build time)",
        );
        assert.deepEqual(
          construction.details.overrides.map((entry) => entry.path),
          [["netherlands"], ["netherlands", "amsterdam"], ["netherlands", "amsterdam", "mobile"]],
        );
        assert.deepEqual(construction.details.compiledValue, original.variableValue);
      }
    });
  }
  run(
    projectDirectoryPath,
    [
      "evaluate",
      "--feature=pricing",
      "--environment=production",
      '--context={"userId":"123","country":"nl"}',
      "--explain",
    ],
    (result) => {
      assert.match(result.stdout, /Value: "control"/);
      assert.match(result.stdout, /disabledVariationValue/);
      assert.match(result.stdout, /not a complete execution trace/);
    },
  );
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--variable=accumulatingPolicy",
      "--environment=production",
      '--context={"country":"nl","city":"amsterdam","device":"mobile"}',
      "--explain",
      "--json",
    ],
    (evaluation) => {
      assert.deepEqual(
        evaluation.variableValue.items.map((item) => item.id),
        ["mobile", "nl", "mobile-tail"],
      );
      assert.equal(evaluation.variableValue.items[1].message, "Mobile Netherlands policy");
      assert.equal(evaluation.variableOverrideKey, "mobile-remove");
      assert.deepEqual(evaluation.variableOverridePaths, [
        ["netherlands"],
        ["netherlands", "amsterdam"],
        ["netherlands", "amsterdam-message"],
        ["mobile-prepend"],
        ["mobile-append"],
        ["mobile-select"],
        ["mobile-remove"],
      ]);
      assert.deepEqual(evaluation.explanation.result.value, evaluation.variableValue);
    },
  );
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--variable=campaignBanner",
      "--environment=production",
      "--target=all",
      "--target=checkout",
      "--explain",
      "--json",
    ],
    (result) => {
      assert.deepEqual(
        result.map((entry) => entry.target),
        ["all", "checkout"],
      );
      assert.equal(result[0].evaluations.explanation.source.target, "all");
      assert.equal(result[1].evaluations.explanation.source.target, "checkout");
      assert.equal(result[1].evaluations.explanation.result.reason, "variable_not_found");
    },
  );
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
      "--variable=supportEmail",
      "--environment=production",
      '--context={"country":"nl"}',
      "--json",
    ],
    (evaluation) => {
      assert.equal(evaluation.variableValue, "support-nl@example.com");
      assert.equal(evaluation.variableOverrideKey, "netherlands");
    },
  );
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--variable=campaignBanner",
      "--environment=production",
      '--context={"country":"nl","city":"amsterdam","device":"mobile"}',
      "--json",
    ],
    (evaluation) => {
      assert.equal(evaluation.variableValue.message, "Welkom");
      assert.equal(evaluation.variableValue.cta.title, "Meer informatie");
      assert.equal(evaluation.variableValue.cta.url, "https://featurevisor.com/mobile");
      assert.equal(evaluation.variableOverrideKey, "mobile");
      assert.deepEqual(evaluation.variableOverridePath, ["netherlands", "amsterdam", "mobile"]);
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
    "--variable=flexibleIdentifier",
    "--environment=production",
    '--context={"country":"nl"}',
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
    "schemas",
    "attributes",
    "targets",
    "tests",
    "variables",
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
    ["list", "--variables", "--target=checkout", "--json"],
    (variables) =>
      assert.deepEqual(
        variables.map((variable) => variable.key),
        ["checkoutSettings"],
      ),
  );
  runJson(
    projectDirectoryPath,
    ["list", "--features", "--with-variations", "--with-variables", "--json"],
    (features) => assert.ok(features.some((feature) => feature.key === "foo")),
  );
  runJson(projectDirectoryPath, ["list", "--tests", "--apply-matrix", "--json"], (tests) => {
    assert.ok(tests.length > 0);
    assert.ok(
      tests.every((test) => test.assertions.every((assertion) => !("matrix" in assertion))),
    );
    const signupMessage = tests.find((test) => test.variable === "signupMessage");
    assert.ok(signupMessage);
    assert.equal(signupMessage.assertions[0].target, "signup-message");
    assert.equal(signupMessage.assertions[2].children[0].expectedValue, "Create your account");
  });
  runJson(projectDirectoryPath, ["list", "--tests", "--execution-protocol"], (document) => {
    assert.equal(document.kind, "featurevisor.test-execution");
    assert.equal(document.schemaVersion, 1);
    assert.ok(document.tests.length > 0);
    assert.ok(document.tests.every((test) => test._test));
    assert.ok(
      document.tests.every((test) => test.assertions.every((assertion) => assertion._case)),
    );
    const segment = document.tests.find((test) => test.segment === "conditionAudience");
    assert.equal(segment.assertions.length, 8);
    assert.equal(segment.assertions[0].environment, "production");
    assert.equal(segment.assertions[0].at, 75);
    assert.deepEqual(segment.assertions[6].stickyVariables.conditionPolicy, { enabled: false });
  });

  run(projectDirectoryPath, ["find-duplicate-segments", "--authors"]);
  run(projectDirectoryPath, ["find-usage", "--segment=mobile"]);
  run(projectDirectoryPath, ["find-usage", "--attribute=country"]);
  run(projectDirectoryPath, ["find-usage", "--feature=foo"]);
  run(projectDirectoryPath, ["find-usage", "--variable=campaignBanner"]);
  run(projectDirectoryPath, ["find-usage", "--variable=runtimePolicy"], (result) => {
    assert.match(result.stdout, /Conditions in features:[^\n]*\bvariableRequirementsExample\b/);
    assert.match(result.stdout, /Conditions in global variables:[^\n]*\bruntimeMessage\b/);
  });
  run(projectDirectoryPath, ["find-usage", "--unused-segments"]);
  run(projectDirectoryPath, ["find-usage", "--unused-attributes"]);
  run(projectDirectoryPath, ["info", "--target=all", "--target=checkout"], (result) => {
    assert.match(result.stdout, /Total Variables:/);
    assert.match(result.stdout, /Total Variables \(in features\):/);
    assert.doesNotMatch(result.stdout, /Total Groups:/);
  });

  const generatedCodeDirectoryPath = join(projectDirectoryPath, "generated-code");
  run(projectDirectoryPath, [
    "generate-code",
    "--language=typescript",
    `--out-dir=${generatedCodeDirectoryPath}`,
    "--tag=all",
    "--target=checkout",
  ]);
  assertFile(join(generatedCodeDirectoryPath, "features.ts"), "generated feature types");
  assertFile(join(generatedCodeDirectoryPath, "variables.ts"), "generated global variable types");
  assert.match(
    readFileSync(join(generatedCodeDirectoryPath, "variables.ts"), "utf8"),
    /checkoutSettings/,
  );
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
  for (const value of ["0", "-5", "1.5", "invalid", ""]) {
    for (const mode of [[], ["--json"], ["--print"]]) {
      fail(
        projectDirectoryPath,
        ["build", `--inflate=${value}`, ...mode],
        /--inflate must be a positive integer/i,
      );
    }
    const result = execute(projectDirectoryPath, ["test", `--inflate=${value}`, "--json"]);
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, false);
    assert.equal(report.results.length, 0);
    assert.match(report.errors[0].message, /--inflate must be a positive integer/i);
    pass(`test --inflate=${value} rejects invalid inflation with a JSON report`);
  }
  for (const args of [
    ["build", "--json", "--environment=production"],
    ["list", "--features", "--json"],
    ["test", "--json"],
    ["benchmark", "--feature=foo", "--environment=production", "-n=1"],
  ]) {
    fail(projectDirectoryPath, [...args, "--set=does-not-exist"], /does not configure Sets/i);
  }
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
  run(projectDirectoryPath, [
    "test",
    "--set=staging",
    "--entity-type=scenario",
    "--target=all",
    "--only-failures",
  ]);
  run(projectDirectoryPath, [
    "test",
    "--set=production",
    "--entity-type=variable",
    "--only-failures",
  ]);

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

  const statefulDirectory = join(projectDirectoryPath, "stateful-datafiles");
  run(projectDirectoryPath, ["build", `--datafiles-dir=${statefulDirectory}`]);
  assertFile(join(statefulDirectory, "REVISION"), "root set revision");
  for (const set of ["dev", "staging", "production"]) {
    assertFile(join(statefulDirectory, set, "REVISION"), `${set} custom output revision`);
  }
  for (const extra of [[], ["--json", "--set=dev"]]) {
    fail(
      projectDirectoryPath,
      ["build", "--environment=production", ...extra],
      /does not configure environments/i,
    );
  }

  runJson(projectDirectoryPath, ["list", "--set=dev", "--features", "--json"], (features) =>
    assert.deepEqual(
      features.map((feature) => feature.key),
      ["checkoutFlow"],
    ),
  );
  runJson(projectDirectoryPath, ["list", "--set=dev", "--variables", "--json"], (variables) =>
    assert.deepEqual(
      variables.map((variable) => variable.key),
      ["checkoutMessage"],
    ),
  );
  runJson(
    projectDirectoryPath,
    ["list", "--set=staging", "--tests", "--apply-matrix", "--json"],
    (tests) => assert.ok(tests.length > 0),
  );
  runJson(
    projectDirectoryPath,
    ["list", "--set=staging", "--tests", "--execution-protocol"],
    (document) => {
      assert.equal(document.kind, "featurevisor.test-execution");
      assert.equal(document.schemaVersion, 1);
      assert.ok(document.tests.length > 0);
      assert.ok(document.tests.every((test) => test._test.set === "staging"));
    },
  );
  const missingSet = execute(projectDirectoryPath, ["list", "--tests", "--execution-protocol"]);
  assert.notEqual(missingSet.status, 0);
  assert.equal(missingSet.stdout, "");
  assert.match(JSON.parse(missingSet.stderr).error.message, /Pass --set/);
  pass("execution protocol requires a set and returns a structured error without partial output");

  const context = '{"userId":"123","team":"engineering"}';
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--set=staging",
      "--variable=checkoutMessage",
      "--target=all",
      `--context=${context}`,
      "--json",
      "--explain",
    ],
    (result) => {
      assert.equal(result.explanation.source.set, "staging");
      assert.equal(result.explanation.source.environment, false);
      assert.equal(result.explanation.result.value, "Staging checkout for engineers");
      assert.ok(
        result.explanation.evidence.some(
          (entry) => entry.title === "Authored value construction (build time)",
        ),
      );
    },
  );
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
  runJson(
    projectDirectoryPath,
    [
      "evaluate",
      "--set=staging",
      "--variable=checkoutMessage",
      "--target=all",
      `--context=${context}`,
      "--json",
    ],
    (evaluation) => {
      assert.equal(evaluation.variableValue, "Staging checkout for engineers");
      assert.equal(evaluation.variableOverrideKey, "internal");
    },
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

function testFeatureExpectationReferences() {
  const project = copyProject("example-yml");
  writeFileSync(
    join(project, "features", "expectationFlag.yml"),
    "description: A flag without variations or variables\nbucketBy: userId\nrules:\n  - key: all\n    conditions: '*'\n    percentage: 100\n",
  );
  mkdirSync(join(project, "tests"), { recursive: true });
  writeFileSync(
    join(project, "tests", "expectationFlag.spec.yml"),
    "feature: expectationFlag\nassertions:\n  - at: 50\n    expectedVariation: null\n    expectedVariables:\n      missing: null\n    children:\n      - expectedVariation: control\n        expectedVariables:\n          absent: fallback\n",
  );
  const result = execute(project, ["lint", "--json"]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  const errors = report.errors.filter((error) => /expectationFlag.spec/.test(error.filePath || ""));
  assert.equal(errors.length, 4, JSON.stringify(report.errors));
  assert.match(JSON.stringify(errors), /has no variations/);
  assert.match(JSON.stringify(errors), /Unknown variable/);
  pass("lint rejects unknown feature expectation references, including child assertions");
}

function testMalformedDefinitions() {
  const project = copyProject("example-yml");
  writeFileSync(
    join(project, "features", "aaaMissing.yml"),
    "description: Missing required fields\n",
  );
  writeFileSync(
    join(project, "features", "badYaml.yml"),
    "description: Broken YAML\nrules:\n  - key: first\n  key: invalid\n",
  );
  const lint = execute(project, ["lint", "--json"]);
  assert.equal(lint.status, 1);
  const report = JSON.parse(lint.stdout);
  const parseErrors = report.errors.filter((error) =>
    /badYaml|line 4|Sequence item/.test(error.message),
  );
  assert.equal(parseErrors.length, 1, JSON.stringify(report.errors));
  assert.match(parseErrors[0].filePath, /features[/\\]badYaml\.yml$/);
  pass("lint attributes a parse failure once to the correct file");
  for (const command of ["lint", "build", "test"]) {
    const result = execute(project, [command]);
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /badYaml\.yml/);
    assert.doesNotMatch(output, /at .*node_modules|linePos:|YAMLParseError:.*\n\s+at /);
    pass(`${command} reports a readable parse error with filename and exits 1`);
    const verbose = execute(project, [command, "--verbose"]);
    assert.equal(verbose.status, 1);
    assert.match(verbose.stdout + verbose.stderr, /badYaml\.yml/);
    assert.match(verbose.stdout + verbose.stderr, /YAMLParseError|at .*node_modules/);
    pass(`${command} retains parser details when verbose is requested`);
  }
}

function testAliasCompositionProject() {
  const project = join(temporaryDirectoryPath, "alias-composition");
  const write = (name, value) => {
    const file = join(project, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  mkdirSync(project, { recursive: true });
  const configPath = join(project, "featurevisor.config.js");
  const config = 'module.exports = { namespaceCharacter: "/", tags: ["source", "web"] };\n';
  writeFileSync(configPath, config);
  write("attributes/country.yml", { description: "Country", type: "string" });
  write("variables/sources/policy.current.yml", {
    description: "Source policy",
    tags: ["source"],
    type: "object",
    required: ["label", "items"],
    properties: {
      label: { type: "string" },
      items: { type: "array", items: { type: "string" } },
    },
    defaultValue: { label: "Default", items: ["source"] },
    overrides: [
      {
        key: "nl",
        conditions: { attribute: "country", operator: "equals", value: "nl" },
        mutate: { label: "Netherlands" },
      },
    ],
  });
  write("variables/sources/json.yml", {
    description: "JSON source",
    tags: ["source"],
    type: "json",
    defaultValue: '"decoded"',
  });
  write("variables/sources/array.yml", {
    description: "Array source",
    tags: ["source"],
    type: "array",
    items: { type: "string" },
    defaultValue: ["source"],
  });
  write("variables/sources/flag.yml", {
    description: "Flag source",
    tags: ["source"],
    type: "boolean",
    defaultValue: false,
  });
  write("variables/sources/null.yml", {
    description: "Null source",
    tags: ["source"],
    type: "json",
    defaultValue: "null",
  });
  write("variables/gate.yml", {
    description: "Override gate",
    tags: ["source"],
    type: "boolean",
    defaultValue: true,
  });
  write("variables/aliasPolicy.yml", {
    description: "Policy alias",
    tags: ["web"],
    compose: "sources/policy.current",
    overrides: [
      {
        key: "nl",
        conditions: [
          { attribute: "country", operator: "equals", value: "nl" },
          { variable: "gate", operator: "equals", value: true },
        ],
        mutate: { "items:append": "alias" },
      },
    ],
  });
  write("variables/aliasJson.yml", {
    description: "JSON alias",
    tags: ["web"],
    compose: "sources/json",
    overrides: [
      {
        key: "nl",
        conditions: { attribute: "country", operator: "equals", value: "nl" },
        value: "replacement",
      },
    ],
  });
  for (const [key, source] of [
    ["aliasArray", "sources/array"],
    ["aliasFlag", "sources/flag"],
    ["aliasNull", "sources/null"],
    ["chain", "aliasPolicy"],
  ]) {
    write(`variables/${key}.yml`, { description: key, tags: ["web"], compose: source });
  }
  write("targets/aliases.yml", {
    description: "Aliases and their dependency closure",
    tag: "web",
    includeVariables: ["alias*", "chain"],
    excludeVariables: ["sources/*", "gate"],
  });
  const state = snapshotStateFiles(project);
  run(project, ["lint"]);
  for (const precompute of [false, true]) {
    writeFileSync(configPath, `${config}\nmodule.exports.precomputeMutations = ${precompute};\n`);
    runJson(project, ["build", "--target=aliases", "--json", "--no-state-files"], (datafile) => {
      assert.equal(datafile.variables.aliasPolicy.compose, "sources/policy.current");
      assert.equal(datafile.variables.aliasPolicy.type, "object");
      assert.ok(datafile.variables.aliasPolicy.overrideProgram);
      assert.ok(datafile.variables.gate);
      assert.ok(datafile.variables["sources/policy.current"]);
      assert.equal(datafile.variables.aliasJson.type, "json");
      assert.equal(datafile.variables.aliasArray.type, "array");
      assert.equal(datafile.variables.aliasFlag.type, "boolean");
      assert.equal(Object.hasOwn(datafile.variables.aliasPolicy, "defaultValue"), false);
      assert.equal(Object.hasOwn(datafile.variables.aliasPolicy, "overrides"), false);
    });
    for (const [key, expected, country] of [
      ["aliasPolicy", { label: "Default", items: ["source"] }, "de"],
      ["aliasPolicy", { label: "Netherlands", items: ["source", "alias"] }, "nl"],
      ["chain", { label: "Netherlands", items: ["source", "alias"] }, "nl"],
      ["aliasJson", "decoded", "de"],
      ["aliasJson", "replacement", "nl"],
      ["aliasArray", ["source"], "de"],
      ["aliasFlag", false, "de"],
      ["aliasNull", null, "de"],
    ]) {
      runJson(
        project,
        [
          "evaluate",
          `--variable=${key}`,
          "--target=aliases",
          "--json",
          "--explain",
          `--context=${JSON.stringify({ country })}`,
        ],
        (result) => {
          assert.deepEqual(result.variableValue, expected);
          assert.deepEqual(result.explanation.result.value, expected);
          const evidence = result.explanation.evidence.find(
            (entry) => entry.title === "Composition source",
          );
          assert.deepEqual(evidence.details.value, expected);
          assert.equal(evidence.details.hasValue, true);
          assert.equal(
            result.explanation.evidence.some((entry) => entry.title === "Composition members"),
            false,
          );
        },
      );
    }
  }
  writeFileSync(configPath, config);
  for (const explain of [false, true]) {
    run(
      project,
      [
        "evaluate",
        "--variable=aliasJson",
        '--context={"country":"nl"}',
        ...(explain ? ["--explain"] : []),
      ],
      (result) => {
        assert.match(result.stdout, /SDK result after overrides: "replacement"/);
        assert.match(result.stdout, /Alias source: sources\/json/);
      },
    );
  }
  run(project, ["find-usage", "--variable=sources/policy.current"], (result) => {
    assert.match(result.stdout, /Aliased by: aliasPolicy/);
    assert.doesNotMatch(result.stdout, /\bchain\b/);
  });
  run(project, ["list", "--variables"], (result) =>
    assert.match(result.stdout, /aliasPolicy \(composed\)/),
  );
  runJson(project, ["list", "--variables", "--json"], (result) => {
    const alias = result.find((entry) => entry.key === "aliasPolicy");
    assert.equal(alias.compose, "sources/policy.current");
    assert.equal(Object.hasOwn(alias, "type"), false);
  });
  const generated = join(project, "generated");
  run(project, [
    "generate-code",
    "--language=typescript",
    "--target=aliases",
    "--react",
    `--out-dir=${generated}`,
  ]);
  const types = readFileSync(join(generated, "variables.ts"), "utf8");
  assert.match(types, /aliasPolicy: CompositionSource</);
  assert.match(types, /aliasArray: CompositionSource<string\[\]> \| null/);
  assert.match(types, /aliasFlag: CompositionSource<boolean> \| null/);
  assert.match(types, /aliasJson: CompositionSource<unknown> \| null/);
  assert.doesNotMatch(types, /"sources\/policy.current":/);
  assert.deepEqual(snapshotStateFiles(project), state);
  pass("alias composition CLI commands preserve project state");
  write("features/experiment.yml", {
    description: "Feature source hint",
    bucketBy: "country",
    rules: [{ key: "all", conditions: "*", percentage: 100 }],
  });
  for (const [compose, overrides, expected] of [
    [5, undefined, "compose must be a global variable key or a nonempty map of references."],
    [true, undefined, "compose must be a global variable key or a nonempty map of references."],
    [
      "experiment",
      undefined,
      '"experiment" is a feature. Use { enabled: { feature: "experiment" } } in compose to read its flag.',
    ],
    [
      "sources/flag",
      [{ key: "bad", conditions: "*", value: "not a boolean" }],
      'Variable "invalidAlias" (type boolean)',
    ],
  ]) {
    write("variables/invalidAlias.yml", {
      description: "Invalid alias",
      compose,
      ...(overrides ? { overrides } : {}),
    });
    const result = execute(project, [
      "lint",
      "--entity-type=variable",
      "--key-pattern=^invalidAlias$",
      "--json",
    ]);
    assert.notEqual(result.status, 0);
    const report = parseJson(result, "alias lint diagnostics");
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].key, "invalidAlias");
    assert.ok(report.errors[0].message.includes(expected), report.errors[0].message);
    pass(`alias lint identifies the authored problem: ${JSON.stringify(compose)}`);
  }
  rmSync(join(project, "variables/invalidAlias.yml"));
}

function testCompositionProject() {
  const project = copyProject("example-composition");
  const state = snapshotStateFiles(project);
  run(project, ["lint"]);
  runJson(project, ["build", "--target=web", "--json", "--no-state-files"], (datafile) => {
    assert.deepEqual(Object.keys(datafile.features).sort(), ["checkout", "delivery"]);
    assert.equal(datafile.variables.screen.type, "object");
    assert.ok(datafile.variables.policy);
    assert.equal(Object.hasOwn(datafile.variables.screen, "defaultValue"), false);
  });
  runJson(project, ["test", "--json"], (report) => assert.equal(report.passed, true));
  for (const explain of [false, true])
    runJson(
      project,
      [
        "evaluate",
        "--variable=screen",
        "--target=web",
        "--json",
        '--context={"userId":"example-user","country":"nl"}',
        ...(explain ? ["--explain"] : []),
      ],
      (result) => {
        assert.equal(result.reason, "variable_composed");
        assert.deepEqual(result.variableValue, {
          flag: false,
          variation: "unavailable",
          label: "Not available",
          flags: { checkout: true, delivery: false },
          config: { policy: { limit: 75 }, raw: { source: "example" } },
        });
        if (explain) {
          assert.deepEqual(result.explanation.result.value, result.variableValue);
          const evidence = result.explanation.evidence.find(
            (entry) => entry.title === "Composition members",
          );
          assert.ok(evidence);
          assert.ok(
            evidence.details.members.every(
              (member) => typeof member.property === "string" && !Object.hasOwn(member, "alias"),
            ),
          );
        }
      },
    );
  const configPath = join(project, "featurevisor.config.js");
  const originalConfig = readFileSync(configPath, "utf8");
  for (const precompute of [true, false]) {
    writeFileSync(
      configPath,
      `${originalConfig}\nmodule.exports.precomputeMutations = ${precompute};\n`,
    );
    runJson(project, ["build", "--target=regional", "--json", "--no-state-files"], (datafile) => {
      assert.ok(datafile.variables.regionalScreen.overrideProgram);
      assert.equal(Object.hasOwn(datafile.variables.regionalScreen, "defaultValue"), false);
      assert.ok(datafile.features.checkout);
      assert.ok(datafile.variables.policy);
    });
    for (const explain of [false, true]) {
      for (const [country, expected, paths] of [
        [
          "nl",
          { label: "Collect today", policy: { limit: 100 } },
          [["netherlands"], ["netherlands", "amsterdam"], ["checkout"]],
        ],
        ["gb", { label: null, policy: { limit: 25 } }, [["uk"]]],
      ]) {
        runJson(
          project,
          [
            "evaluate",
            "--variable=regionalScreen",
            "--target=regional",
            "--json",
            `--context=${JSON.stringify({ userId: "example-user", country, city: "Amsterdam" })}`,
            ...(explain ? ["--explain"] : []),
          ],
          (result) => {
            assert.equal(result.reason, "variable_override_rule");
            assert.deepEqual(result.variableValue, expected);
            assert.deepEqual(result.variableOverridePaths, paths);
            if (explain) {
              assert.deepEqual(result.explanation.result.value, expected);
              assert.equal(
                result.explanation.evidence.find((item) => item.title === "Composition members")
                  .details.afterOverrides,
                true,
              );
            }
          },
        );
      }
    }
    runJson(project, ["test", "--json"], (report) => assert.equal(report.passed, true));
    run(project, [
      "benchmark",
      "--variable=regionalScreen",
      "--target=regional",
      "-n",
      "20",
      '--context={"country":"nl","city":"Amsterdam"}',
    ]);
  }
  writeFileSync(configPath, originalConfig);
  const generated = join(project, "generated-code");
  run(project, [
    "generate-code",
    "--language=typescript",
    "--target=web",
    `--out-dir=${generated}`,
    "--react",
  ]);
  assert.match(readFileSync(join(generated, "variables.ts"), "utf8"), /screen:.*CompositionSource/);
  const catalog = join(project, "generated-catalog");
  run(project, ["catalog", "export", `--out-dir=${catalog}`]);
  assertFile(join(catalog, "data", "manifest.json"), "composition Catalog manifest");
  assert.deepEqual(snapshotStateFiles(project), state);
  pass("composition CLI commands preserve project state");
}

function testSlashNamespaces() {
  const project = copyProject("example-namespace-slash");
  run(project, ["lint"]);
  run(project, ["test", "--only-failures"]);
  runJson(
    project,
    ["build", "--environment=production", "--target=all", "--json", "--no-state-files"],
    (datafile) => {
      assert.ok(datafile.features["checkout/redesign"]);
      assert.ok(datafile.segments["audience/netherlands"]);
      assert.equal(datafile.features["checkout/redesign"].bucketBy, "user.id");
    },
  );
  const generated = join(project, "generated-code");
  run(project, ["generate-code", "--language=typescript", `--out-dir=${generated}`]);
  const attributes = readFileSync(join(generated, "attributes.ts"), "utf8");
  assert.match(attributes, /export type UserAttribute/);
  assert.match(attributes, /id\?: string/);
  assert.match(attributes, /country\?: string/);
  const catalog = join(project, "generated-catalog");
  run(project, ["catalog", "export", `--out-dir=${catalog}`]);
  assertFile(join(catalog, "data", "manifest.json"), "slash namespace Catalog manifest");
  pass("slash entity namespaces work alongside root object attributes");
}

function testAttributeNamespaceGuard(project, set, dotted = false) {
  const directory = set ? join(project, "sets", set, "attributes") : join(project, "attributes");
  const nestedDirectory = join(directory, "namespaceGuard");
  const source = dotted
    ? join(directory, "namespaceGuard.unused.yml")
    : join(nestedDirectory, "unused.yml");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, "description: Unused nested attribute\n\ntype: string\n");
  const selected = set ? [`--set=${set}`] : [];
  const before = snapshotStateFiles(project);
  try {
    const result = execute(project, ["lint", ...selected, "--json"]);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const issues = report.errors.filter((error) =>
      error.filePath
        .replace(/\\/g, "/")
        .endsWith(
          dotted ? "attributes/namespaceGuard.unused.yml" : "attributes/namespaceGuard/unused.yml",
        ),
    );
    assert.equal(issues.length, 1, JSON.stringify(report));
    assert.equal(issues[0].code, "invalid_attribute_namespace");
    assert.equal(issues[0].entityType, "attribute");
    pass(
      `lint reports unused ${dotted ? "dotted" : "nested"} attributes${set ? " in a Set" : " in " + basename(project)}`,
    );
    const rejectedCommands = [
      ["build", "--target=all", ...(set ? [] : ["--environment=staging"])],
      ["list", "--attributes", "--json"],
      [
        "generate-code",
        "--language=typescript",
        `--out-dir=${join(project, "invalid-attribute-code")}`,
      ],
      ["info"],
    ];
    if (!set)
      rejectedCommands.push([
        "catalog",
        "export",
        `--out-dir=${join(project, "invalid-attribute-catalog")}`,
      ]);
    for (const command of rejectedCommands) {
      fail(project, [...command, ...selected], /Attribute definitions cannot be namespaced/);
      assert.deepEqual(snapshotStateFiles(project), before);
    }
    if (set === "staging") {
      fail(
        project,
        ["promote", "--from=staging", "--to=production"],
        /Attribute definitions cannot be namespaced/,
      );
      assert.deepEqual(snapshotStateFiles(project), before);
    }
    assert.equal(existsSync(join(project, "invalid-attribute-code", "index.ts")), false);
    assert.equal(existsSync(join(project, "invalid-attribute-code", "instance.ts")), false);
    assert.equal(
      existsSync(join(project, "invalid-attribute-catalog", "data", "manifest.json")),
      false,
    );
    pass("invalid attribute namespaces do not rewrite state or publish code or a Catalog manifest");
  } finally {
    rmSync(dotted ? source : nestedDirectory, { recursive: true, force: true });
  }
}

function testSavedAllocationGuard() {
  const project = join(temporaryDirectoryPath, "saved-allocation");
  const write = (relative, value) => {
    const file = join(project, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("featurevisor.config.js", 'module.exports = { parser: "json", stringify: false };');
  write("attributes/userId.json", { type: "string" });
  write("targets/all.json", { description: "All definitions" });
  write("features/checkout.json", {
    description: "Allocation safety",
    bucketBy: "userId",
    variations: [
      { value: "control", weight: 50 },
      { value: "treatment", weight: 50 },
    ],
    rules: [{ key: "rollout", conditions: "*", percentage: 50 }],
  });
  run(project, ["build"]);
  const files = readdirSync(join(project, ".featurevisor"));
  const stateName = files.find(
    (name) => name.startsWith("existing-state") && name.endsWith(".json"),
  );
  assert.ok(stateName, "initial build writes saved allocation state");
  const state = JSON.parse(readFileSync(join(project, ".featurevisor", stateName), "utf8"));
  state.features.checkout.traffic[0].allocation[0].range[0] = 5000;
  write(`.featurevisor/${stateName}`, state);
  const snapshot = snapshotStateFiles(project);
  const result = execute(project, ["build", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "invalid_saved_allocation");
  assert.equal(error.details.feature, "checkout");
  assert.equal(error.details.rule, "rollout");
  assert.equal(error.details.stateFile, `.featurevisor/${stateName}`);
  assert.match(error.message, /State file: \.featurevisor\/existing-state/);
  assert.match(error.message, /https:\/\/featurevisor.com\/docs\/state-files\/#traffic-allocation/);
  assert.deepEqual(snapshotStateFiles(project), snapshot);
  const regular = execute(project, ["build"]);
  assert.equal(regular.status, 1);
  assert.match(regular.stderr + regular.stdout, /Invalid saved variation allocation/);
  assert.deepEqual(snapshotStateFiles(project), snapshot);
  pass("invalid saved allocations fail without rewriting state or revision");
}

try {
  assertFile(cliPath, "built Featurevisor CLI");
  testFeatureExpectationReferences();
  testSavedAllocationGuard();
  testMalformedDefinitions();
  const standardProject = copyProject("example-1");
  const setProject = copyProject("example-test-environments");

  mkdirSync(join(standardProject, "generated-datafiles"), { recursive: true });
  mkdirSync(join(setProject, "generated-datafiles"), { recursive: true });

  testStandardProject(standardProject);
  testDateContexts(standardProject);
  testVariableDiagnostics(standardProject);
  testMutationOrderMigration(standardProject);
  testScenarioChecks(standardProject);
  testMutationPrecomputation(standardProject);
  testOrderedMutationCodeGeneration(standardProject);
  testSetProject(setProject);
  testCompositionProject();
  testAliasCompositionProject();
  testSlashNamespaces();
  testAttributeNamespaceGuard(standardProject);
  testAttributeNamespaceGuard(setProject, "staging");
  testAttributeNamespaceGuard(standardProject, undefined, true);
  testAttributeNamespaceGuard(setProject, "staging", true);
  testAttributeNamespaceGuard(
    join(temporaryDirectoryPath, "example-namespace-slash"),
    undefined,
    true,
  );

  testDefinitionDiff(standardProject);
  testDefinitionDiff(setProject, true);

  console.log(`\nFeaturevisor CLI integration checks passed: ${checks}`);
} finally {
  rmSync(temporaryDirectoryPath, { recursive: true, force: true });
}
