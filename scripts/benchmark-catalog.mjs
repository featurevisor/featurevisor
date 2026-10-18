import { createRequire } from "node:module";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { mkdtempSync, mkdirSync, readdirSync, statSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run after building. Outputs stay outside the authored projects.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { getProjectConfig, Datasource, getProjectSetExecutions } = require("@featurevisor/core");
const {
  getCatalogTargetMemberships,
  resolveCatalogOverrideValue,
} = require("../packages/core/lib/catalog.js");
const { exportCatalog, createCatalogDevSession } = require("@featurevisor/catalog");
const runtime = {
  getProjectSetExecutions,
  getCatalogTargetMemberships,
  resolveOverrideValue: resolveCatalogOverrideValue,
};
const output = process.argv[2];
const repeats = Number(process.env.CATALOG_BENCH_REPEATS || 5);
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error("Invalid CATALOG_BENCH_REPEATS");
const temporary = mkdtempSync(join(tmpdir(), "featurevisor-catalog-benchmark-"));
const results = [];
const log = console.log;
const RICH_TAGS = [
  "all",
  "web",
  "ios",
  "android",
  "checkout",
  "search",
  "growth",
  "payments",
  "admin",
  "labs",
];
const RICH_FIXTURE = {
  kind: "rich",
  environments: ["staging", "production"],
  features: 5000,
  featureShape:
    "description, two tags, four variables (string, boolean, integer, object), two variations, three segment rules and an everyone rule per environment, root feature conditions on every fifth, a staging force entry on every tenth",
  segments: 1000,
  segmentShape: "three conditions joined by and",
  attributes: 7,
  variables: 1000,
  variableShape: "string with one staging and four production overrides",
  targets: 10,
  testSpecs: 3000,
  testSpecShape: "one 15 case matrix assertion and one plain assertion",
  scenarios: 250,
};
const PLAIN_FIXTURE = {
  kind: "plain",
  environments: ["staging", "production"],
  features: 5000,
  featureShape: "description, one tag and one rule per environment",
  segments: 500,
  attributes: 1,
  targets: 2,
};

// The realistic project behind specs/catalog-performance-2026-10-09.md. Test specs and
// scenarios are what made Git history classification expensive, which the plain large
// project cannot show. Keep the shapes in step with RICH_FIXTURE, which is recorded with
// every result.
function writeRichProject(write) {
  const tags = RICH_TAGS;
  const countries = [
    "nl",
    "de",
    "gb",
    "us",
    "fr",
    "es",
    "it",
    "se",
    "no",
    "dk",
    "ch",
    "at",
    "be",
    "pl",
  ];
  const { features, segments, variables, testSpecs, scenarios } = RICH_FIXTURE;
  for (const [name, type] of [
    ["country", "string"],
    ["plan", "string"],
    ["deviceId", "string"],
    ["userId", "string"],
    ["version", "semver"],
    ["age", "integer"],
    ["beta", "boolean"],
  ])
    write(`attributes/${name}.yml`, `description: ${name} attribute\ntype: ${type}\n`);
  for (let i = 0; i < segments; i++)
    write(
      `segments/segment${i}.yml`,
      `description: Segment ${i}\nconditions:\n  and:\n    - attribute: country\n      operator: equals\n      value: ${countries[i % countries.length]}\n    - attribute: plan\n      operator: in\n      value: [plan${i % 7}, plan${(i + 1) % 7}]\n    - attribute: age\n      operator: greaterThan\n      value: ${18 + (i % 40)}\n`,
    );
  const rules = (i, environment, percentage) =>
    `  ${environment}:\n` +
    [0, 1, 2]
      .map(
        (r) =>
          `    - key: rule${r}-${countries[(i + r) % countries.length]}\n      conditions: [segment${(i + r) % segments}, segment${(i + r * 7) % segments}]\n      percentage: ${percentage}\n` +
          (r === 1 ? "      variation: treatment\n" : ""),
      )
      .join("") +
    `    - key: everyone\n      conditions: "*"\n      percentage: ${percentage / 2}\n`;
  for (let i = 0; i < features; i++) {
    const required = i > 10 && i % 5 === 0 ? `conditions:\n  - feature: feature${i - 7}\n` : "";
    const force =
      i % 10 === 0
        ? `force:\n  staging:\n    - conditions:\n        - attribute: userId\n          operator: equals\n          value: qa-${i}\n      enabled: true\n      variation: treatment\n`
        : "";
    write(
      `features/feature${i}.yml`,
      `description: Feature ${i} controls the ${tags[i % tags.length]} experience\ntags: [${[...new Set([tags[i % tags.length], "all"])].join(", ")}]\nbucketBy: userId\n${required}variablesSchema:\n  title:\n    type: string\n    defaultValue: Title ${i}\n  enabledCta:\n    type: boolean\n    defaultValue: false\n  limit:\n    type: integer\n    defaultValue: ${i % 100}\n  config:\n    type: object\n    properties:\n      color:\n        type: string\n      size:\n        type: integer\n    defaultValue:\n      color: blue\n      size: 10\nvariations:\n  - value: control\n    weight: 50\n  - value: treatment\n    weight: 50\n    variables:\n      title: Treatment title ${i}\n      enabledCta: true\nrules:\n${rules(i, "staging", 100)}${rules(i, "production", 50)}${force}`,
    );
  }
  for (let i = 0; i < variables; i++)
    write(
      `variables/variable${i}.yml`,
      `description: Global variable ${i}\ntags: [${tags[i % tags.length]}]\ntype: string\ndefaultValue: default-${i}\noverrides:\n  staging:\n    - key: staging\n      conditions: "*"\n      value: staging-${i}\n  production:\n` +
        [0, 1, 2, 3]
          .map(
            (o) =>
              `    - key: ${countries[(i + o) % countries.length]}\n      conditions:\n        attribute: country\n        operator: equals\n        value: ${countries[(i + o) % countries.length]}\n      value: value-${i}-${o}\n`,
          )
          .join(""),
    );
  for (const tag of tags) write(`targets/${tag}.yml`, `description: ${tag} target\ntag: ${tag}\n`);
  for (let i = 0; i < testSpecs; i++)
    write(
      `tests/features/feature${i}.spec.yml`,
      `feature: feature${i}\nassertions:\n  - matrix:\n      country: [nl, de, gb, us, fr]\n      at: [5, 10, 20]\n    description: "Feature ${i} in \${{ country }} at \${{ at }}"\n    environment: production\n    at: \${{ at }}\n    context:\n      country: \${{ country }}\n      plan: plan1\n      age: 30\n    expectedToBeEnabled: true\n  - description: Staging has everything\n    environment: staging\n    at: 50\n    context:\n      country: nl\n    expectedToBeEnabled: true\n`,
    );
  for (let i = 0; i < scenarios; i++)
    write(
      `tests/scenarios/scenario${i}.spec.yml`,
      `description: Scenario ${i} keeps features consistent\nenvironment: production\nat: 40\ncontext:\n  country: nl\n  userId: user-${i}\nchecks:\n  - key: consistent\n    or:\n      - and:\n          - feature: feature${i}\n            enabled: true\n          - feature: feature${i + 1}\n            variation: treatment\n      - not:\n          - feature: feature${i + 2}\n            enabled: true\n  - variable: variable${i % variables}\n    operator: notEquals\n    value: nothing\n`,
    );
  return tags;
}

function createLargeProject() {
  const project = join(temporary, "large-project");
  const write = (file, value) => {
    const destination = join(project, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  };
  write(
    "featurevisor.config.js",
    `module.exports = { environments: ["staging", "production"], tags: ${JSON.stringify(
      process.env.CATALOG_BENCH_RICH ? RICH_TAGS : ["all"],
    )} };\n`,
  );
  execFileSync("git", ["init", "-q", project]);
  execFileSync("git", ["-C", project, "add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      project,
      "-c",
      "user.name=Catalog benchmark",
      "-c",
      "user.email=catalog@example.invalid",
      "commit",
      "-qm",
      "Benchmark configuration",
    ],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    },
  );
  if (process.env.CATALOG_BENCH_RICH) {
    writeRichProject(write);
  } else {
    write("attributes/country.yml", "type: string\n");
    for (let i = 0; i < PLAIN_FIXTURE.segments; i++)
      write(
        `segments/segment${i}.yml`,
        `conditions:\n  - attribute: country\n    operator: equals\n    value: country${i}\n`,
      );
    for (let i = 0; i < PLAIN_FIXTURE.features; i++)
      write(
        `features/feature${i}.yml`,
        `description: Feature ${i} for large Catalog benchmarks\ntags: [all]\nbucketBy: country\nrules:\n  staging:\n    - key: audience\n      conditions: segment${i % 500}\n      percentage: 100\n  production:\n    - key: audience\n      conditions: segment${i % 500}\n      percentage: 50\n`,
      );
    write("targets/all.yml", "description: All features\n");
    write(
      "targets/subset.yml",
      "description: Selected features\nincludeFeatures: [feature1, feature2, feature3]\n",
    );
  }
  if (process.env.CATALOG_BENCH_HISTORY) {
    execFileSync("git", ["-C", project, "add", "."]);
    execFileSync(
      "git",
      [
        "-C",
        project,
        "-c",
        "user.name=Catalog benchmark",
        "-c",
        "user.email=catalog@example.invalid",
        "commit",
        "-qm",
        "Benchmark definitions",
      ],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-01-01T00:00:01Z",
          GIT_COMMITTER_DATE: "2026-01-01T00:00:01Z",
        },
      },
    );
  }
  return project;
}
function size(directory) {
  let bytes = 0,
    files = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = size(file);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      files++;
      bytes += statSync(file).size;
    }
  }
  return { bytes, files };
}
async function main() {
  try {
    const projects =
      process.env.CATALOG_BENCH_LARGE || process.env.CATALOG_BENCH_RICH
        ? ["large-project"]
        : ["example-1", "example-sets"];
    for (const name of projects) {
      const project =
        name === "large-project" ? createLargeProject() : resolve(root, "examples", name);
      const config = getProjectConfig(project);
      const timings = { cold: [], warm: [], rebuild: [] };
      let footprint;
      for (let i = 0; i < repeats; i++) {
        const outDir = join(temporary, name, String(i));
        const datasource = new Datasource(config, project);
        console.log = () => {};
        for (const mode of ["cold", "warm", "rebuild"]) {
          // Session reuse is the watcher path. Include session setup in cold/warm
          // exports, but not ordinary rebuild timings.
          const devSession =
            mode === "rebuild" && !process.env.CATALOG_BENCH_BASELINE
              ? await createCatalogDevSession(project, config, datasource, { outDir })
              : undefined;
          const start = performance.now();
          await exportCatalog(runtime, project, config, datasource, {
            outDir,
            copyAssets: false,
            preserveAssets: mode !== "cold",
            devSession,
            compactStorage: true,
          });
          timings[mode].push(performance.now() - start);
        }
        footprint = size(outDir);
        console.log = log;
      }
      const summary = Object.fromEntries(
        Object.entries(timings).map(([mode, values]) => {
          const sorted = [...values].sort((a, b) => a - b);
          return [
            mode,
            {
              minMs: sorted[0],
              medianMs: sorted[Math.floor(sorted.length / 2)],
              maxMs: sorted.at(-1),
              samplesMs: values,
            },
          ];
        }),
      );
      // Record the fixture with its timings, so results from different shapes are never mixed.
      const fixture =
        name === "large-project"
          ? {
              ...(process.env.CATALOG_BENCH_RICH ? RICH_FIXTURE : PLAIN_FIXTURE),
              history: process.env.CATALOG_BENCH_HISTORY
                ? "definitions committed in one commit"
                : "configuration only",
            }
          : { kind: "example", path: `examples/${name}` };
      results.push({ project: name, fixture, repeats, ...summary, ...footprint });
      log(name, JSON.stringify(results.at(-1)));
    }
    if (output)
      writeFileSync(resolve(output), JSON.stringify({ node: process.version, results }, null, 2));
  } finally {
    console.log = log;
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
