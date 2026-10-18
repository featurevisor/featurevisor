import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createSemverProject, assertSemverReport } from "./semver-conformance-project.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = dirname(root);
const temporary = mkdtempSync(join(tmpdir(), "featurevisor-runner-conformance-"));
const selected = process.argv.slice(2);
const runners = {
  javascript: { cwd: root, command: process.execPath, args: [join(root, "packages/cli/bin.js")] },
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

function write(project, file, value) {
  const destination = join(project, file);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function fixture(name, sets = false, environments = true) {
  const project = join(temporary, name);
  mkdirSync(project);
  symlinkSync(
    join(root, "node_modules"),
    join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  write(
    project,
    "featurevisor.config.js",
    `module.exports = ${JSON.stringify({ parser: "json", ...(sets || !environments ? {} : { environments: ["production"] }), sets, tags: ["all"] })};`,
  );
  const locations = sets ? ["sets/staging/", "sets/production/"] : [""];
  for (const prefix of locations) {
    const environment = sets || !environments ? {} : { environment: "production" };
    write(project, `${prefix}attributes/country.json`, { description: "Country", type: "string" });
    write(project, `${prefix}segments/dutch.json`, {
      description: "Dutch audience, tested independently of Target datafiles",
      conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
    });
    write(project, `${prefix}targets/checks.json`, {
      description: "Selected definitions without the independently tested segment",
      includeFeatures: ["checkout"],
      includeVariables: ["minimum", "maximum", "settings"],
    });
    const rules = [{ key: "available", conditions: "*", percentage: 100 }];
    write(project, `${prefix}features/checkout.json`, {
      description: "Checkout",
      tags: ["all"],
      bucketBy: "userId",
      rules: sets || !environments ? rules : { production: rules },
    });
    write(project, `${prefix}features/unused.json`, {
      description: "No associated specs",
      tags: ["all"],
      bucketBy: "userId",
      rules: sets || !environments ? rules : { production: rules },
    });
    write(project, `${prefix}variables/maximum.json`, {
      description: "Maximum",
      tags: ["all"],
      type: "integer",
      defaultValue: 10,
    });
    write(project, `${prefix}variables/unusedValue.json`, {
      description: "No associated specs",
      tags: ["all"],
      type: "string",
      defaultValue: "unused",
    });
    const overrides = [
      {
        key: "netherlands",
        conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        value: 12,
      },
    ];
    write(project, `${prefix}variables/minimum.json`, {
      description: "Minimum",
      tags: ["all"],
      type: "integer",
      defaultValue: 5,
      overrides: sets || !environments ? overrides : { production: overrides },
    });
    write(project, `${prefix}tests/minimum.spec.json`, {
      variable: "minimum",
      assertions: [
        {
          ...environment,
          key: `it's a "quoted" case`,
          context: { country: "de" },
          expectedValue: 5,
          checks: [
            { key: "minimum-positive", variable: "minimum", operator: "greaterThan", value: 0 },
            { key: "not-dutch", segment: "dutch", matches: false },
          ],
        },
      ],
    });
    write(project, `${prefix}tests/scenarios/checkout.spec.json`, {
      feature: "checkout",
      assertions: [{ ...environment, at: 50, expectedToBeEnabled: true }],
    });
    write(project, `${prefix}variables/settings.json`, {
      description: "Null and missing values",
      tags: ["all"],
      type: "object",
      defaultValue: { nullable: null },
    });
    write(project, `${prefix}tests/settings.spec.json`, {
      variable: "settings",
      assertions: [
        {
          key: "explicit-null",
          ...environment,
          checks: [{ variable: "settings", path: "nullable", operator: "isNull" }],
        },
        {
          key: "missing-path",
          ...environment,
          checks: [
            { key: "missing-value", variable: "settings", path: "absent", operator: "isNull" },
          ],
        },
      ],
    });
    write(project, `${prefix}tests/journeys/limits.spec.json`, {
      ...environment,
      target: "checks",
      matrix: { country: ["nl", "de"] },
      context: { country: "${{ country }}" },
      checks: [
        {
          key: "checkout-ready",
          description: "Checkout remains enabled",
          feature: "checkout",
          enabled: true,
        },
        {
          key: "bounds",
          description: "Minimum must not exceed maximum",
          variable: "minimum",
          operator: "lessThanOrEquals",
          compareTo: { variable: "maximum" },
        },
        {
          key: "named-group",
          or: [
            { feature: "checkout", enabled: true },
            { variable: "minimum", operator: "equals", value: 99 },
          ],
        },
        { key: "audience", segment: "dutch", matches: false },
      ],
      children: [
        {
          context: { country: "de" },
          checks: [
            {
              key: "child-bounds",
              variable: "minimum",
              operator: "lessThanOrEquals",
              compareTo: { variable: "maximum" },
            },
            { segment: "dutch", matches: false },
          ],
        },
        {
          checks: [
            {
              key: "inherited-bounds",
              variable: "minimum",
              operator: "lessThanOrEquals",
              compareTo: { variable: "maximum" },
            },
          ],
        },
      ],
    });
  }
  return project;
}

function mavenArguments(args) {
  return args.map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`).join(" ");
}

function execute(name, project, args, exactRerun = false, launcher, hostileLocale = false) {
  const runner = runners[name];
  const directoryOption = name === "javascript" ? "rootDirectoryPath" : "projectDirectoryPath";
  const testArgs = [
    "test",
    ...(exactRerun ? [] : [`--${directoryOption}=${project}`]),
    "--json",
    ...args,
  ];
  const argv = launcher
    ? [
        "-c",
        `${launcher.command} "$@"`,
        "featurevisor-rerun",
        ...(launcher.argumentEncoding === "maven-exec"
          ? [`-Dexec.args=${mavenArguments(testArgs)}`]
          : testArgs),
      ]
    : name === "java"
      ? [...runner.args, `-Dexec.args=${mavenArguments(testArgs)}`]
      : [...runner.args, ...testArgs];
  const result = spawnSync(launcher ? "sh" : runner.command, argv, {
    cwd: runner.cwd,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...runner.env,
      ...(hostileLocale ? { LANG: undefined, LC_ALL: "C", LC_CTYPE: "C" } : {}),
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${name}: ${result.stderr}`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${name}: expected exactly one JSON document\n${result.stdout}\n${result.stderr}`,
    );
  }
  assert.equal(report.schemaVersion, 1);
  if (args.includes("--pretty"))
    assert.match(result.stdout, /\n\s+"/, `${name}: --pretty should indent JSON`);
  assert.equal(report.runner, name);
  assert.equal(result.status, report.passed ? 0 : 1, `${name}: inconsistent exit status`);
  return report;
}

function comparable(report) {
  return {
    passed: report.passed,
    summary: report.summary,
    results: report.results
      .map((spec) => ({
        type: spec.type,
        key: spec.key,
        source: spec.source,
        set: spec.set,
        passed: spec.passed,
        cases: spec.cases
          .map((testCase) => ({
            id: testCase.id,
            environment: testCase.environment,
            target: testCase.target,
            context: testCase.context,
            matrixValues: testCase.matrixValues,
            passed: testCase.passed,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.source.localeCompare(b.source)),
  };
}

function collisionFixture() {
  const project = fixture("cache identities");
  rmSync(join(project, "tests"), { recursive: true });
  rmSync(join(project, "features"), { recursive: true });
  rmSync(join(project, "variables"), { recursive: true });
  rmSync(join(project, "targets"), { recursive: true });
  write(
    project,
    "featurevisor.config.js",
    'module.exports = { parser: "json", environments: ["prod", "prod-target-web"] };',
  );
  write(project, "attributes/channel.json", { description: "Channel", type: "string" });
  write(project, "attributes/userId.json", { description: "User", type: "string" });
  write(project, "features/flag.json", {
    description: "Environment specific flag",
    bucketBy: "userId",
    rules: {
      prod: [{ key: "off", conditions: "*", percentage: 0 }],
      "prod-target-web": [{ key: "on", conditions: "*", percentage: 100 }],
    },
  });
  for (const [key, channel] of [
    ["web", "web"],
    ["web-target-mobile", "mobile"],
    ["mobile", "second-mobile"],
  ]) {
    write(project, `targets/${key}.json`, { description: key, context: { channel } });
  }
  const override = (value) => ({
    key: value,
    conditions: [{ attribute: "channel", operator: "equals", value }],
    value,
  });
  write(project, "variables/marker.json", {
    description: "Selected datafile marker",
    type: "string",
    defaultValue: "base",
    overrides: {
      prod: [override("web"), override("mobile")],
      "prod-target-web": [
        override("second-mobile"),
        { key: "base", conditions: "*", value: "second-base" },
      ],
    },
  });
  const selections = [
    { environment: "prod", target: "web", value: "web", enabled: false },
    { environment: "prod-target-web", value: "second-base", enabled: true },
    { environment: "prod", target: "web-target-mobile", value: "mobile", enabled: false },
    { environment: "prod-target-web", target: "mobile", value: "second-mobile", enabled: true },
  ];
  write(project, "tests/flag.spec.json", {
    feature: "flag",
    assertions: selections.map(({ environment, target, enabled }) => ({
      environment,
      target,
      at: 50,
      expectedToBeEnabled: enabled,
    })),
  });
  write(project, "tests/marker.spec.json", {
    variable: "marker",
    assertions: selections.map(({ environment, target, value }) => ({
      environment,
      target,
      expectedValue: value,
    })),
  });
  selections.forEach(({ environment, target, value, enabled }, index) =>
    write(project, `tests/scenario-${index}.spec.json`, {
      environment,
      target,
      at: 50,
      checks: [
        { variable: "marker", operator: "equals", value },
        { feature: "flag", enabled },
      ],
    }),
  );
  return project;
}

function assertionFailureFixture() {
  const project = fixture("ordinary assertion errors");
  rmSync(join(project, "tests"), { recursive: true });
  write(project, "features/checkout.json", {
    bucketBy: "userId",
    variations: [{ value: "control", weight: 100 }],
    variablesSchema: { label: { type: "string", defaultValue: "actual" } },
    rules: { production: [{ key: "all", conditions: "*", percentage: 100 }] },
  });
  const expectation = {
    expectedToBeEnabled: false,
    expectedVariation: "treatment",
    expectedVariables: { label: "expected" },
  };
  write(project, "tests/feature.spec.json", {
    feature: "checkout",
    assertions: [
      { environment: "production", at: 50, ...expectation, children: [{ ...expectation }] },
    ],
  });
  write(project, "tests/variable.spec.json", {
    variable: "maximum",
    assertions: [
      {
        environment: "production",
        expectedValue: -1,
        expectedEvaluation: { reason: "error" },
        children: [{ expectedValue: -2 }],
      },
    ],
  });
  write(project, "tests/segment.spec.json", {
    segment: "dutch",
    assertions: [{ context: { country: "nl" }, expectedToMatch: false }],
  });
  return project;
}

function dependentSegmentsFixture(environments = true) {
  const project = fixture(
    `dependent segment evaluations ${environments ? "with environments" : "without environments"}`,
    false,
    environments,
  );
  const environment = environments ? { environment: "production" } : {};
  rmSync(join(project, "tests"), { recursive: true });
  write(project, "attributes/userId.json", { description: "User", type: "string" });
  write(project, "variables/policy.json", {
    description: "Evaluated source with a nested property",
    type: "object",
    defaultValue: { limits: { maximum: 12 } },
  });
  write(project, "segments/member.json", {
    description: "A segment with all condition leaf kinds",
    conditions: [
      "dutch",
      { feature: "checkout" },
      { variable: "policy", path: "limits.maximum", operator: "greaterThan", value: 10 },
    ],
  });
  write(project, "variables/screen.json", {
    description: "Composition keeps its source dependencies in a filtered Target",
    conditions: "member",
    disabledValue: { ready: false, limit: null },
    compose: {
      ready: { feature: "checkout" },
      limit: { variable: "policy" },
    },
  });
  write(project, "targets/screen.json", {
    description: "Composition closure and specialized country",
    includeVariables: ["screen"],
    context: { country: "nl" },
  });
  write(project, "tests/member.spec.json", {
    segment: "member",
    assertions: [
      {
        ...environment,
        at: 50,
        context: { country: "nl", userId: "member" },
        expectedToMatch: true,
      },
      {
        ...environment,
        at: 50,
        context: { country: "de", userId: "member" },
        expectedToMatch: false,
      },
      {
        ...environment,
        at: 50,
        target: "screen",
        context: { country: "de", userId: "member" },
        expectedToMatch: true,
      },
      {
        ...environment,
        at: 50,
        stickyFeatures: { checkout: { enabled: false } },
        context: { country: "nl", userId: "member" },
        expectedToMatch: false,
      },
      {
        ...environment,
        at: 50,
        stickyVariables: { policy: { limits: { maximum: 1 } } },
        context: { country: "nl", userId: "member" },
        expectedToMatch: false,
      },
    ],
  });
  write(project, "variables/maintenance.json", {
    description: "Kill switch read by a feature gate",
    type: "boolean",
    defaultValue: false,
  });
  const gatedRules = [{ key: "available", conditions: "*", percentage: 100 }];
  write(project, "features/gated.json", {
    description: "Feature gated on a global variable",
    bucketBy: "userId",
    conditions: [{ variable: "maintenance", operator: "equals", value: false }],
    rules: environments ? { production: gatedRules } : gatedRules,
  });
  // Feature assertions and their children each own their sticky values.
  // Children do not inherit them from the parent assertion.
  write(project, "tests/gated.spec.json", {
    feature: "gated",
    assertions: [
      {
        ...environment,
        key: "maintenance",
        at: 50,
        stickyVariables: { maintenance: true },
        expectedToBeEnabled: false,
        children: [
          { stickyVariables: { maintenance: false }, expectedToBeEnabled: true },
          { expectedToBeEnabled: true },
          { stickyFeatures: { gated: { enabled: false } }, expectedToBeEnabled: false },
        ],
      },
      {
        ...environment,
        key: "sticky-feature",
        at: 50,
        stickyFeatures: { gated: { enabled: false } },
        expectedToBeEnabled: false,
        children: [{ expectedToBeEnabled: true }],
      },
    ],
  });
  write(project, "tests/attributeOnly.spec.json", {
    segment: "dutch",
    assertions: [{ context: { country: "nl" }, expectedToMatch: true }],
  });
  write(project, "tests/dependent-checks.spec.json", {
    ...environment,
    target: "screen",
    at: 50,
    context: { country: "de", userId: "member" },
    checks: [
      { segment: "member", matches: true },
      { variable: "screen", path: "ready", operator: "equals", value: true },
      { variable: "screen", path: "limit.limits.maximum", operator: "equals", value: 12 },
    ],
    children: [
      { context: { country: "nl" }, checks: [{ segment: "member", matches: true }] },
      {
        context: { country: "nl" },
        stickyFeatures: { checkout: { enabled: false } },
        checks: [{ segment: "member", matches: false }],
      },
    ],
  });
  return project;
}

function assertionErrors(report) {
  return report.results
    .flatMap((spec) =>
      spec.cases.flatMap((testCase) =>
        testCase.errors.map((error) => ({
          source: spec.source,
          type: error.type,
          path: error.path,
          expected: error.expected,
          actual: error.actual,
        })),
      ),
    )
    .sort((a, b) =>
      JSON.stringify([a.source, a.path]).localeCompare(JSON.stringify([b.source, b.path])),
    );
}

try {
  const names = selected.length ? selected : Object.keys(runners);
  const semverProject = createSemverProject(root, join(temporary, "version comparisons"));
  const assertionProject = assertionFailureFixture();
  const expectedAssertionErrors = assertionErrors(execute("javascript", assertionProject, []));
  assert.equal(expectedAssertionErrors.length, 10);
  for (const name of names) assert.ok(runners[name], `Unknown runner ${name}`);
  const examples = ["example-1", "example-test-environments", "example-composition"].map((name) => {
    const directory = join(root, "examples", name);
    const baseline = execute("javascript", directory, []);
    assert.equal(baseline.passed, true, `${name}: JavaScript example baseline failed`);
    return { name, directory, summary: baseline.summary };
  });
  const project = fixture("project with spaces");
  const dependentProjects = [true, false].map((environments) => {
    const project = dependentSegmentsFixture(environments);
    const baseline = execute("javascript", project, ["--coverage"]);
    assert.equal(baseline.passed, true, JSON.stringify(baseline));
    assert.deepEqual(baseline.summary.assertions, { passed: 9, failed: 0 });
    return { project, baseline };
  });
  const collisionProject = collisionFixture();
  const unicodeProject = fixture("unicode roundtrip");
  const unicodeDateProject = fixture("unicode timestamp errors");
  write(unicodeDateProject, "variables/invalidTimestamp.json", {
    description: "An evaluated string is not a valid portable timestamp",
    type: "string",
    defaultValue: "٢٠٢٦-٠١-٠١T00:00:00Z",
  });
  write(unicodeDateProject, "tests/invalidTimestamp.spec.json", {
    variable: "invalidTimestamp",
    assertions: [
      {
        environment: "production",
        checks: [{ operator: "before", value: "2027-01-01T00:00:00Z" }],
      },
    ],
  });
  write(unicodeProject, "variables/greeting.json", {
    description: "Réel Café 東京 🧪",
    tags: ["all"],
    type: "string",
    defaultValue: "Réel Café 東京 🧪",
  });
  write(unicodeProject, "tests/greeting.spec.json", {
    variable: "greeting",
    assertions: [
      {
        environment: "production",
        description: "Vérification Café 東京 🧪",
        context: { message: "Contexte Café 東京 🧪" },
        expectedValue: "Attendu Café 東京 🧪",
        // Checks expose structured operands even when native assertion errors are generic.
        checks: [{ variable: "greeting", operator: "equals", value: "Attendu Café 東京 🧪" }],
      },
    ],
  });
  const setProject = fixture("sets", true);
  const invalidProject = fixture("unknown scenario property");
  const preflightProject = fixture("reference preflight");
  const preflightCases = [
    {
      or: [
        { feature: "checkout", enabled: true },
        { feature: "missing", enabled: false },
      ],
    },
    {
      and: [
        { feature: "checkout", enabled: false },
        { variable: "missing", operator: "isNull" },
      ],
    },
    {
      not: [
        { feature: "checkout", enabled: false },
        { feature: "checkout", variable: "missing", operator: "isNull" },
      ],
    },
    {
      or: [
        { feature: "checkout", enabled: true },
        { variable: "minimum", operator: "equals", compareTo: { variable: "missing" } },
      ],
    },
    {
      or: [
        { feature: "checkout", enabled: true },
        { variable: "unusedValue", operator: "notNull" },
      ],
    },
  ];
  for (const [index, check] of preflightCases.entries()) {
    for (const child of [false, true]) {
      write(preflightProject, `tests/preflight/${index}-${child}.spec.json`, {
        environment: "production",
        target: "checks",
        ...(child
          ? { checks: [{ feature: "checkout", enabled: true }], children: [{ checks: [check] }] }
          : { checks: [check] }),
      });
    }
  }
  write(preflightProject, "variables/preflight/owned.json", {
    description: "Owning variable must not evaluate before child reference validation",
    type: "integer",
    defaultValue: 5,
  });
  write(preflightProject, "tests/preflight/owned-variable.spec.json", {
    variable: "preflight.owned",
    assertions: [
      {
        environment: "production",
        expectedValue: 5,
        children: [{ checks: [{ variable: "missing", operator: "isNull" }] }],
      },
    ],
  });
  write(invalidProject, "tests/arbitrary/invalid.spec.json", {
    environment: "production",
    checks: [{ feature: "checkout", enabled: true }],
    unexpectedProperty: true,
  });
  const baseline = execute("javascript", project, ["--coverage", "--uncovered"]);
  assert.equal(baseline.passed, false);
  assert.deepEqual(baseline.summary.assertions, { passed: 4, failed: 2 });
  assert.equal(baseline.results.find((spec) => spec.type === "scenario").key, "journeys.limits");
  assert.deepEqual(baseline.uncovered, [
    { set: null, features: ["unused"], variables: ["unusedValue"] },
  ]);
  for (const name of names) {
    for (const { project, baseline } of dependentProjects) {
      const dependentReport = execute(name, project, ["--coverage"]);
      assert.deepEqual(
        comparable(dependentReport),
        comparable(baseline),
        `${name}: dependent segment specs, authored checks or specialized Target semantics differ in ${project}`,
      );
      assert.ok(
        dependentReport.coverage.selections.every(
          (entry) =>
            !entry.featureKey || ["checkout", "unused", "gated"].includes(entry.featureKey),
        ),
        `${name}: synthetic segment helper leaked into observed coverage`,
      );
    }
    const aliasSelection = ["--key-pattern=*", "--entity-type=feature", "--only-failures"];
    const camelSelection = ["--keyPattern=*", "--entityType=feature", "--onlyFailures"];
    const camelReport = execute(name, project, camelSelection);
    for (const directoryOption of ["root-directory-path", "rootDirectoryPath"]) {
      const aliasReport = execute(
        name,
        project,
        [`--${directoryOption}=${project}`, ...aliasSelection],
        true,
      );
      assert.deepEqual(
        comparable(aliasReport),
        comparable(camelReport),
        `${name}: option aliases differ`,
      );
    }
    assertSemverReport(execute(name, semverProject.project, []), semverProject, name);
    assert.deepEqual(
      assertionErrors(execute(name, assertionProject, [])),
      expectedAssertionErrors,
      `${name}: ordinary assertion error fields differ`,
    );
    const collision = execute(name, collisionProject, []);
    assert.equal(
      collision.passed,
      true,
      `${name}: datafile cache collision: ${JSON.stringify(collision)}`,
    );
    assert.deepEqual(collision.summary.assertions, { passed: 12, failed: 0 });
    const invalidSet = execute(name, join(root, "examples/example-yml"), ["--set=does-not-exist"]);
    assert.equal(invalidSet.passed, false, `${name}: silently ignored --set without Sets`);
    assert.ok(invalidSet.errors.length, `${name}: missing Set selection error`);
    for (const example of examples) {
      const report = execute(name, example.directory, []);
      assert.equal(
        report.passed,
        true,
        `${name}: ${example.name} failed: ${JSON.stringify({
          summary: report.summary,
          errors: report.errors,
          results: report.results
            .filter((spec) => !spec.passed)
            .map((spec) => ({ ...spec, cases: spec.cases.filter((testCase) => !testCase.passed) })),
        })}`,
      );
      assert.deepEqual(report.summary, example.summary, `${name}: ${example.name} totals differ`);
      if (example.name === "example-1") {
        // Unsetting LANG alone may still inherit a UTF-8 LC_CTYPE.
        // Structured reports currently have no timing fields, so compare every field.
        const hostileReport = execute(name, example.directory, [], false, undefined, true);
        assert.deepEqual(
          hostileReport,
          report,
          `${name}: C locale changed the full example report`,
        );
      }
    }
    const unicodeReport = execute(name, unicodeProject, ["--keyPattern=^greeting$"]);
    const dateReport = execute(name, unicodeDateProject, ["--keyPattern=^invalidTimestamp$"]);
    assert.equal(
      dateReport.summary.assertions.failed,
      1,
      `${name}: Unicode timestamp was accepted`,
    );
    assert.ok(dateReport.results[0]?.cases[0]?.errors.length, `${name}: missing timestamp error`);
    const unicodeCase = unicodeReport.results[0]?.cases[0];
    assert.equal(unicodeReport.summary.assertions.failed, 1, `${name}: unicode case did not fail`);
    assert.ok(unicodeCase?.description.endsWith("Vérification Café 東京 🧪"));
    assert.equal(unicodeCase?.context.message, "Contexte Café 東京 🧪");
    // Native runners may expose the values in a typed field or error message.
    const unicodeErrors = JSON.stringify(unicodeCase?.errors);
    assert.ok(unicodeErrors.includes("Attendu Café 東京 🧪"), `${name}: ${unicodeErrors}`);
    assert.ok(unicodeErrors.includes("Réel Café 東京 🧪"), `${name}: ${unicodeErrors}`);
    const hostileUnicodeReport = execute(
      name,
      unicodeProject,
      ["--keyPattern=^greeting$"],
      false,
      undefined,
      true,
    );
    assert.deepEqual(
      hostileUnicodeReport,
      unicodeReport,
      `${name}: C locale changed the full unicode report`,
    );
    const report = execute(name, project, ["--coverage", "--uncovered"]);
    assert.deepEqual(
      comparable(report),
      comparable(baseline),
      `${name}: report identity or outcomes differ`,
    );
    assert.deepEqual(report.uncovered, baseline.uncovered, `${name}: association gaps differ`);
    const verbose = execute(name, project, ["--pretty", "--verbose", "--showDatafile"]);
    assert.deepEqual(
      comparable(verbose),
      comparable(baseline),
      `${name}: output flags changed case outcomes`,
    );
    assert.equal(report.coverage.mode, "observed-selections");
    assert.ok(
      report.coverage.selections.some(
        (entry) => entry.featureKey === "checkout" && entry.ruleKey === "available",
      ),
      `${name}: selected feature rule missing`,
    );
    assert.ok(
      report.coverage.selections.some(
        (entry) => entry.variableKey === "minimum" && entry.overridePath?.includes("netherlands"),
      ),
      `${name}: selected override missing`,
    );
    const cases = report.results.flatMap((spec) => spec.cases);
    const missingCase = report.results
      .find((spec) => spec.type === "variable" && spec.key === "settings")
      .cases.find((testCase) => !testCase.passed);
    assert.ok(
      missingCase.errors[0].details?.evaluated?.some((leaf) => leaf.actualMissing === true),
      `${name}: missing path needs explicit presence evidence, not null or an ambiguous string`,
    );
    const failedScenario = report.results
      .find((spec) => spec.type === "scenario")
      .cases.find((testCase) => !testCase.passed);
    assert.ok(
      failedScenario.errors.some(
        (error) => JSON.stringify(error.path) === JSON.stringify(["checks", 1]),
      ),
      `${name}: root check authored path missing`,
    );
    const segmentError = failedScenario.errors.find(
      (error) => error.details?.checkKey === "audience",
    );
    assert.ok(segmentError, `${name}: missing segment check failure`);
    assert.ok(
      segmentError.details.evaluated.some(
        (leaf) =>
          leaf.reference?.segment === "dutch" &&
          leaf.property === "matches" &&
          leaf.actual === true &&
          leaf.expected === false,
      ),
      `${name}: missing segment evidence`,
    );
    assert.ok(
      failedScenario.errors.some(
        (error) => JSON.stringify(error.path) === JSON.stringify(["children", 1, "checks", 0]),
      ),
      `${name}: child check authored path missing`,
    );
    for (const testCase of cases) {
      assert.ok(Array.isArray(testCase.errors));
      if (!testCase.passed) assert.ok(testCase.errors.length);
      assert.ok(
        testCase.rerun.args.some(
          (arg) =>
            arg ===
            `--${name === "javascript" ? "rootDirectoryPath" : "projectDirectoryPath"}=${project}`,
        ),
        `${name}: explicit project directory missing from rerun`,
      );
      const rerun = execute(name, project, testCase.rerun.args.slice(1), true, testCase.rerun);
      assert.equal(
        rerun.summary.assertions.passed + rerun.summary.assertions.failed,
        1,
        `${name}: exact rerun of ${testCase.id} failed: ${JSON.stringify(rerun)}`,
      );
      assert.equal(rerun.passed, testCase.passed);
      assert.equal(rerun.results[0].cases[0].id, testCase.id);
    }
    const unknown = execute(name, project, ["--case=does-not-exist"]);
    assert.equal(unknown.passed, false);
    assert.ok(unknown.errors.length);
    const invalid = execute(name, invalidProject, []);
    assert.equal(invalid.passed, false, `${name}: unknown scenario property was accepted`);
    assert.ok(invalid.errors.length, `${name}: invalid authoring needs a reported error`);
    const preflight = execute(name, preflightProject, ["--keyPattern=^preflight\\.", "--coverage"]);
    assert.equal(preflight.passed, false, `${name}: skipped invalid reference passed`);
    assert.equal(
      preflight.summary.assertions.passed,
      0,
      `${name}: every invalid reference must fail`,
    );
    assert.equal(preflight.summary.assertions.failed, 11, `${name}: missing preflight cases`);
    assert.deepEqual(
      preflight.coverage.selections,
      [],
      `${name}: evaluated a getter before preflight completed`,
    );
    const setReport = execute(name, setProject, ["--set=staging"]);
    const setBaseline = execute("javascript", setProject, ["--set=staging"]);
    assert.deepEqual(comparable(setReport), comparable(setBaseline));
    const failed = setReport.results
      .flatMap((spec) => spec.cases)
      .find((testCase) => !testCase.passed);
    const boundsError = failedScenario.errors.find(
      (error) => JSON.stringify(error.path) === JSON.stringify(["checks", 1]),
    );
    assert.equal(boundsError?.type, "check", `${name}: typed check error missing`);
    assert.equal(boundsError.expected, true);
    assert.equal(boundsError.actual, false);
    assert.equal(boundsError.details?.checkKey, "bounds");
    assert.ok(
      boundsError.details?.evaluated?.some(
        (leaf) =>
          leaf.reference?.variable === "minimum" &&
          leaf.actual === 12 &&
          leaf.expected === 10 &&
          leaf.compareTo?.variable === "maximum",
      ),
      `${name}: typed operand evidence missing`,
    );
    const rerun = execute(name, setProject, failed.rerun.args.slice(1), true, failed.rerun);
    assert.equal(rerun.summary.assertions.failed, 1);
    const implicitSet = execute(name, setProject, [`--case=${failed.id}`]);
    assert.equal(
      implicitSet.summary.assertions.failed,
      1,
      `${name}: exact case should find its set without an explicit set flag`,
    );
    assert.equal(implicitSet.results[0].set, "staging");
    console.log(
      `✓ ${name}: example-1 (including C locale), example-test-environments, example-composition, dependent segments with and without environments, ${semverProject.comparisons} version comparisons, typed assertion failures, authored specs, preflight, matrix identities, exact reruns, coverage and sets`,
    );
  }
  console.log(`Runner conformance passed for ${names.length} runners.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
