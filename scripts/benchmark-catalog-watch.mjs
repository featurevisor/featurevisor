import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Run after the parent integration and package builds. Never builds or edits examples.
// node scripts/benchmark-catalog-watch.mjs [results.json]
// node scripts/benchmark-catalog-watch.mjs --self-test
// CATALOG_BENCH_REPEATS=5 CATALOG_WATCH_TIMEOUT_MS=60000
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const excluded = new Set([".git", "node_modules", ".featurevisor", "datafiles", "catalog"]);

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function copyProject(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(source, file);
      return !excluded.has(relative.split(path.sep)[0]) && !fs.lstatSync(file).isSymbolicLink();
    },
  });
}

function positiveInteger(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error(`Invalid positive integer: ${value}`);
  return result;
}

function summary(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  return {
    minMs: sorted[0] ?? null,
    medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    maxMs: sorted.at(-1) ?? null,
    samplesMs: values,
  };
}

function replaceDescription(contents, marker) {
  assert.match(contents, /^description:[^\r\n]*$/m, "Expected a single line feature description");
  return contents.replace(/^description:[^\r\n]*$/m, `description: ${marker}`);
}

function git(project, args) {
  return execFileSync(
    "git",
    ["--git-dir", path.join(project, ".git"), "--work-tree", project, "-C", project, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function closeSession(handle, inFlight, server) {
  let stopError;
  try {
    await handle?.stop();
  } catch (error) {
    stopError = error;
  }
  await Promise.allSettled([...inFlight]);
  try {
    await server?.close();
  } catch (error) {
    // New stop() owns the server; the baseline stop() only owns the watcher.
    if (error.code !== "ERR_SERVER_NOT_RUNNING") throw error;
  }
  if (stopError) throw stopError;
}

async function selfTest() {
  const temporary = fs.mkdtempSync(path.join(tmpdir(), "catalog-watch-self-test-"));
  try {
    const source = path.join(temporary, "source");
    const copy = path.join(temporary, "copy");
    fs.mkdirSync(path.join(source, "features"), { recursive: true });
    fs.writeFileSync(path.join(source, "features/a.yml"), "description: Original\ntags: [all]\n");
    for (const name of excluded) {
      fs.mkdirSync(path.join(source, name));
      fs.writeFileSync(path.join(source, name, "ignored"), "ignored");
    }
    copyProject(source, copy);
    assert.deepEqual(fs.readdirSync(copy), ["features"]);
    const feature = path.join(copy, "features/a.yml");
    fs.writeFileSync(feature, replaceDescription(fs.readFileSync(feature, "utf8"), "Changed"));
    assert.match(fs.readFileSync(path.join(source, "features/a.yml"), "utf8"), /Original/);
    assert.equal(within(source, `${source}-other`), false);
    assert.equal(within(source, path.join(source, "features")), true);
    assert.deepEqual(summary([3, null, 1, 2]), {
      minMs: 1,
      medianMs: 2,
      maxMs: 3,
      samplesMs: [3, null, 1, 2],
    });
    assert.equal(summary([null]).medianMs, null);
    assert.equal(positiveInteger(undefined, 5), 5);
    assert.throws(() => positiveInteger("0", 5));
    assert.throws(() => replaceDescription("tags: [all]", "Changed"));
    git(copy, ["init", "--quiet"]);
    git(copy, [
      "config",
      "remote.origin.url",
      "https://github.com/catalog-benchmark/self-test.git",
    ]);
    assert.equal(
      git(copy, ["config", "--get", "remote.origin.url"]).trim(),
      "https://github.com/catalog-benchmark/self-test.git",
    );
    assert.equal(fs.existsSync(path.join(source, ".git", "config")), false);
    let stopped = false;
    await closeSession(
      {
        stop: async () => {
          await delay(1);
          stopped = true;
        },
      },
      [],
      {
        close: async () => {
          assert.equal(stopped, true);
          throw Object.assign(new Error("Already closed"), { code: "ERR_SERVER_NOT_RUNNING" });
        },
      },
    );
    let closed = false;
    await closeSession({ stop: () => {} }, [], {
      close: async () => {
        closed = true;
      },
    });
    assert.equal(closed, true);
    await assert.rejects(
      closeSession(undefined, [], {
        close: async () => {
          throw new Error("Other failure");
        },
      }),
      /Other failure/,
    );
    console.log("Catalog watcher benchmark helper checks passed. No built packages loaded.");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function benchmark() {
  const baseline = process.env.CATALOG_BENCH_BASELINE === "1";
  const repeats = positiveInteger(process.env.CATALOG_BENCH_REPEATS, 5);
  const timeoutMs = positiveInteger(process.env.CATALOG_WATCH_TIMEOUT_MS, 60000);
  const temporary = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), "featurevisor-catalog-watch-")),
  );
  const originalWatch = fs.watch;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const results = [];
  let measurement;
  let warnings = [];
  let nativeRegistrations = 0;

  // Observe real native callbacks without replacing the watcher or its scheduling.
  // Install before loading built packages, whose CommonJS imports may copy fs.watch.
  fs.watch = function (...args) {
    nativeRegistrations++;
    const callback = args.at(-1);
    if (typeof callback === "function") {
      const directory = path.resolve(String(args[0]));
      args[args.length - 1] = function (event, filename) {
        const changed = filename ? path.resolve(directory, filename.toString()) : directory;
        if (
          measurement &&
          measurement.nativeEventAt === null &&
          within(changed, measurement.file)
        ) {
          measurement.nativeEventAt = performance.now();
        }
        return callback.call(this, event, filename);
      };
    }
    return originalWatch.apply(this, args);
  };
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    originalWarn(...args);
  };

  try {
    const { getProjectConfig, Datasource, getProjectSetExecutions } = require("@featurevisor/core");
    const {
      getCatalogTargetMemberships,
      resolveCatalogOverrideValue,
      reloadCatalogProject,
    } = require("../packages/core/lib/catalog.js");
    const { createCatalogApi, startCatalogDevMode } = require("@featurevisor/catalog");
    const { resolveCatalogStorage, readCatalogStorageEntry } = baseline
      ? {
          resolveCatalogStorage: (_storage, logicalPath) => ({ blockURL: logicalPath }),
          readCatalogStorageEntry: (document) => document,
        }
      : require("../packages/catalog/lib/storage.js");
    const { watchCatalogInputs } = require("../packages/catalog/lib/node/watch.js");
    if (!baseline) {
      assert.equal(
        typeof watchCatalogInputs,
        "function",
        "Build the new watcher before benchmarking",
      );
    } else {
      assert.equal(
        typeof watchCatalogInputs,
        "undefined",
        "Baseline mode requires the old compiled watcher, not rebuilt output",
      );
    }
    assert.equal(
      typeof reloadCatalogProject,
      "function",
      "Build the Core Catalog integration first",
    );
    const runtime = {
      getProjectSetExecutions,
      getCatalogTargetMemberships,
      resolveOverrideValue: resolveCatalogOverrideValue,
      reloadCatalogProject,
    };

    for (const name of ["example-1", "example-sets"]) {
      const project = path.join(temporary, name);
      // Borrow immutable local objects without a checkout or any new commits.
      // The old exporter exits on an unborn repository, even with no entity history.
      execFileSync("git", ["clone", "--shared", "--no-checkout", "--quiet", root, project], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      copyProject(path.join(root, "examples", name), project);
      // A private repository prevents accidental discovery of the workspace repository.
      // Remote configuration changes exercise Git invalidation without making commits.
      git(project, [
        "config",
        "remote.origin.url",
        "https://github.com/catalog-benchmark/baseline.git",
      ]);
      const outDir = path.join(project, "catalog");
      const config = getProjectConfig(project);
      const api = createCatalogApi(runtime);
      const publications = [];
      const inFlight = new Set();
      let lastActivity = performance.now();
      let exportError;
      let server;
      let handle;
      warnings = [];
      nativeRegistrations = 0;
      console.log = () => {};

      const instrumentedApi = {
        ...api,
        exportCatalog: (...args) => {
          const startedAt = performance.now();
          lastActivity = startedAt;
          const operation = api
            .exportCatalog(...args)
            .then((result) => {
              const publishedAt = performance.now();
              lastActivity = publishedAt;
              publications.push({ result, startedAt, publishedAt });
              return result;
            })
            .catch((error) => {
              exportError = error;
              throw error;
            });
          inFlight.add(operation);
          void operation.then(
            () => inFlight.delete(operation),
            () => inFlight.delete(operation),
          );
          return operation;
        },
        serveCatalog: async (...args) => {
          server = await api.serveCatalog(...args);
          return server;
        },
      };

      async function waitFor(check) {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (exportError) throw exportError;
          const result = await check();
          if (result) return result;
          await delay(10);
        }
        throw new Error(
          `${name}: timed out waiting for a verified generation; check watcher integration and rebuild packages`,
        );
      }
      async function settle() {
        // Exclude startup fallback scans and late duplicate events from the next sample.
        await waitFor(() => inFlight.size === 0 && performance.now() - lastActivity >= 1250);
      }
      function readDocument(manifest, logicalPath) {
        const resolution = resolveCatalogStorage(manifest.storage, logicalPath);
        assert.ok(resolution, `Missing published document: ${logicalPath}`);
        const document = JSON.parse(
          fs.readFileSync(path.join(outDir, resolution.blockURL), "utf8"),
        );
        return readCatalogStorageEntry(document, resolution);
      }

      try {
        handle = await startCatalogDevMode(
          runtime,
          instrumentedApi,
          project,
          config,
          new Datasource(config, project),
          { _: [], outDir, port: "0", assets: false },
        );
        await settle();
        if (!baseline)
          assert.ok(
            nativeRegistrations > 0,
            "Built dev mode did not attempt native watching; rebuild the parent integration",
          );
        const featureRelative =
          name === "example-1" ? "features/allowSignup.yml" : "sets/admin/features/promoBanner.yml";
        const featureFile = path.join(project, featureRelative);
        const originalFeature = fs.readFileSync(featureFile, "utf8");
        const configFile = path.join(project, "featurevisor.config.js");
        const originalConfig = fs.readFileSync(configFile, "utf8");
        const logicalFeature =
          name === "example-1"
            ? "data/root/entities/feature/allowSignup.json"
            : "data/sets/admin/entities/feature/promoBanner.json";
        const cases = [
          {
            name: name === "example-1" ? "singleFeatureEdit" : "setFeatureEdit",
            file: featureFile,
            mutate: (marker) =>
              fs.writeFileSync(featureFile, replaceDescription(originalFeature, marker)),
            verify: (manifest, marker) =>
              readDocument(manifest, logicalFeature)?.entity?.description === marker,
          },
          {
            name: "configEdit",
            file: configFile,
            mutate: (marker) =>
              fs.writeFileSync(
                configFile,
                `${originalConfig}\nmodule.exports.tags = [...module.exports.tags, ${JSON.stringify(marker)}];\n`,
              ),
            verify: (manifest, marker) => manifest.projectConfig.tags.includes(marker),
          },
          {
            name: "gitConfigEdit",
            file: path.resolve(project, git(project, ["rev-parse", "--git-path", "config"]).trim()),
            mutate: (marker) =>
              git(project, [
                "config",
                "remote.origin.url",
                `https://github.com/catalog-benchmark/${marker}.git`,
              ]),
            verify: (manifest, marker) => manifest.links?.repository?.includes(marker),
          },
        ];
        const timings = {};
        for (const scenario of cases) {
          if (baseline && scenario.name === "gitConfigEdit") {
            timings[scenario.name] = {
              skipped:
                "Baseline watches authored inputs only; Git metadata does not trigger a rebuild.",
            };
            continue;
          }
          const samples = [];
          const scenarioRepeats =
            scenario.name === "configEdit" || scenario.name === "gitConfigEdit"
              ? positiveInteger(process.env.CATALOG_WATCH_METADATA_REPEATS, repeats)
              : repeats;
          for (let iteration = 0; iteration < scenarioRepeats; iteration++) {
            await settle();
            const marker = `watchbench-${scenario.name}-${iteration}`;
            const previousCount = publications.length;
            measurement = {
              file: scenario.file,
              nativeEventAt: null,
              mutationAt: performance.now(),
            };
            scenario.mutate(marker);
            const completed = await waitFor(() =>
              publications
                .slice(previousCount)
                .find(({ result }) => scenario.verify(result.manifest, marker)),
            );
            const manifest = JSON.parse(
              fs.readFileSync(path.join(outDir, "data/manifest.json"), "utf8"),
            );
            assert.ok(
              scenario.verify(manifest, marker),
              "The on disk generation must contain the edit",
            );
            samples.push({
              mutationToGenerationMs: completed.publishedAt - measurement.mutationAt,
              nativeEventToGenerationMs:
                measurement.nativeEventAt === null
                  ? null
                  : completed.publishedAt - measurement.nativeEventAt,
              exportMs: completed.publishedAt - completed.startedAt,
            });
            measurement = undefined;
          }
          timings[scenario.name] = Object.fromEntries(
            ["mutationToGenerationMs", "nativeEventToGenerationMs", "exportMs"].map((metric) => [
              metric,
              summary(samples.map((sample) => sample[metric])),
            ]),
          );
        }
        results.push({
          project: name,
          repeats,
          nativeRegistrations,
          warnings: [...warnings],
          timings,
        });
        originalLog(name, JSON.stringify(results.at(-1)));
      } finally {
        measurement = undefined;
        await closeSession(handle, inFlight, server);
        console.log = originalLog;
      }
    }
    const report = {
      baseline,
      node: process.version,
      platform: process.platform,
      measuredAt: new Date().toISOString(),
      methodology:
        "Real startCatalogDevMode, isolated copies, no UI assets, private Git clones borrowing existing local history without creating commits. Mutation timing includes filesystem write or Git command, watcher delivery, debounce and generation export. Native event timing is null under polling. Completion is export resolution after manifest publication, before verification IO. Startup and settling are excluded.",
      results,
    };
    if (process.argv[2])
      fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
  } finally {
    fs.watch = originalWatch;
    console.log = originalLog;
    console.warn = originalWarn;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes("--self-test")) await selfTest();
  else if (process.argv.includes("--help")) {
    console.log(
      "After building: node scripts/benchmark-catalog-watch.mjs [results.json]\nHelper checks without builds: node scripts/benchmark-catalog-watch.mjs --self-test\nOptions: CATALOG_BENCH_REPEATS=5 CATALOG_WATCH_TIMEOUT_MS=60000",
    );
  } else await benchmark();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
