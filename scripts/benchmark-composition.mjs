import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { minify } from "terser";
import { build } from "vite";

// Run only after other verification and benchmarks have finished.
// SMOKE=1 node scripts/benchmark-composition.mjs [output.json]
// node scripts/benchmark-composition.mjs [output.json]
// OUTPUT, BASELINE_REF, SAMPLES, ITERATIONS, LARGE_ITERATIONS, WARMUP,
// OP_ITERATIONS, OP_WARMUP and REVERSE_ORDER can override the defaults.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const smoke = process.env.SMOKE === "1";
const outputPath = process.env.OUTPUT || process.argv[2];
const reverseOrder = process.env.REVERSE_ORDER === "1";
const baselineRef = process.env.BASELINE_REF || "15d0ca44";
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const baselineSha = git("rev-parse", `${baselineRef}^{commit}`).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function count(name, fallback) {
  const value = Number(process.env[name] || fallback);
  assert(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}
const settings = {
  smoke,
  samples: count("SAMPLES", smoke ? 2 : 9),
  iterations: count("ITERATIONS", smoke ? 20 : 100_000),
  largeIterations: count("LARGE_ITERATIONS", smoke ? 10 : 10_000),
  warmup: count("WARMUP", smoke ? 20 : 10_000),
  operationIterations: count("OP_ITERATIONS", smoke ? 2 : 10),
  operationWarmup: count("OP_WARMUP", smoke ? 2 : 20),
  featureCount: smoke ? 8 : 1_000,
  ordinaryGlobalCount: smoke ? 8 : 1_000,
  compositionCounts: smoke ? [0, 4, 8] : [0, 100, 1_000],
  reverseOrder,
  viteTarget: "es2015",
  terserPasses: 2,
  gzipOptions: "Node gzipSync defaults",
  gc: "No forced collection; normal runtime GC is included in measured batches",
  execution: "All builds, cases, warmups and timed batches run serially",
};

const packages = [
  { name: "@featurevisor/sdk", directory: "sdk", external: [] },
  {
    name: "@featurevisor/react",
    directory: "react",
    external: ["react", "react-dom", "@featurevisor/sdk"],
  },
  { name: "@featurevisor/vue", directory: "vue", external: ["vue", "@featurevisor/sdk"] },
  {
    name: "@featurevisor/openfeature-provider-web",
    directory: "openfeature-provider-web",
    external: [],
  },
];
const sourceDirectories = [
  ...packages.map(({ directory }) => directory),
  "openfeature-provider-core",
];
const isSource = (name) => /\.(ts|tsx)$/.test(name) && !/\.(spec|test-helper)\./.test(name);
function snapshotSources(ref) {
  const sources = new Map();
  if (ref) {
    const files = git(
      "ls-tree",
      "-r",
      "--name-only",
      ref,
      "--",
      ...sourceDirectories.map((directory) => `packages/${directory}/src`),
    )
      .trim()
      .split("\n");
    for (const file of files.filter(isSource)) sources.set(file, git("show", `${ref}:${file}`));
  } else {
    const visit = (directory) => {
      for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${item.name}`;
        if (item.isDirectory()) visit(file);
        else if (isSource(file)) sources.set(file, readFileSync(path.join(root, file), "utf8"));
      }
    };
    for (const directory of sourceDirectories) visit(`packages/${directory}/src`);
  }
  return sources;
}
const baselineSources = snapshotSources(baselineSha);
const currentSources = snapshotSources();
function sourceDigest(sources) {
  return sha256(JSON.stringify([...sources].sort(([a], [b]) => a.localeCompare(b))));
}

function sourcePlugin(sources) {
  const absoluteKey = (id) => path.relative(root, id.split("?")[0]).split(path.sep).join("/");
  const aliases = new Map(
    sourceDirectories.map((directory) => [
      `@featurevisor/${directory}`,
      `packages/${directory}/src/index.ts`,
    ]),
  );
  return {
    name: "composition-source-snapshot",
    enforce: "pre",
    resolveId(id, importer) {
      if (aliases.has(id)) return path.join(root, aliases.get(id));
      if (importer && id.startsWith(".") && sources.has(absoluteKey(importer))) {
        const relative = absoluteKey(path.resolve(path.dirname(importer), id));
        const candidates = [
          relative,
          relative.replace(/\.js$/, ".ts"),
          relative.replace(/\.js$/, ".tsx"),
          `${relative}.ts`,
          `${relative}/index.ts`,
        ];
        const found = candidates.find((candidate) => sources.has(candidate));
        if (found) return path.join(root, found);
      }
    },
    load(id) {
      const relative = absoluteKey(id);
      if (sources.has(relative)) return sources.get(relative);
      if (sourceDirectories.some((directory) => relative.startsWith(`packages/${directory}/`))) {
        throw new Error(
          `Source snapshot does not contain ${relative}; refusing package output fallback`,
        );
      }
    },
  };
}

async function bundle(sources, entry, external = [], minification = false) {
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [sourcePlugin(sources)],
    build: {
      write: false,
      target: settings.viteTarget,
      minify: minification,
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: path.join(root, entry), formats: ["es"], fileName: () => "current.js" },
      rollupOptions: { external },
    },
  });
  const chunks = (Array.isArray(result) ? result[0] : result).output.filter(
    (item) => item.type === "chunk",
  );
  assert.equal(chunks.length, 1, "A single complete ES module bundle is required");
  return chunks[0].code;
}
async function terser(code) {
  const result = await minify(code, { module: true, compress: { passes: 2 } });
  assert(result.code, "Terser must produce a bundle");
  return result.code;
}
async function load(code, identity) {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${identity}`);
}
function sizes(original, esbuild, minified) {
  return {
    original: Buffer.byteLength(original),
    esbuild: Buffer.byteLength(esbuild),
    esbuildGzip: gzipSync(esbuild).byteLength,
    terser: Buffer.byteLength(minified),
    terserGzip: gzipSync(minified).byteLength,
  };
}
function changes(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((column) => [
      column,
      {
        bytes: after[column] - before[column],
        percent: before[column] === 0 ? null : (after[column] / before[column] - 1) * 100,
      },
    ]),
  );
}
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    unit: "microseconds/operation",
    samples: values,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1),
  };
}
let resultSink;
function compare(operations, iterations, warmup) {
  const values = operations.map(() => []);
  const order = reverseOrder ? [1, 0] : [0, 1];
  for (const index of order) {
    for (let iteration = 0; iteration < warmup; iteration++) resultSink = operations[index]();
  }
  for (let sample = 0; sample < settings.samples; sample++) {
    for (const index of sample % 2 ? [...order].reverse() : order) {
      let last;
      const start = performance.now();
      for (let iteration = 0; iteration < iterations; iteration++) last = operations[index]();
      const elapsed = performance.now() - start;
      resultSink = last;
      values[index].push((elapsed * 1_000) / iterations);
    }
  }
  const [first, second] = values.map(summary);
  return {
    iterationsPerBatch: iterations,
    warmupPerOperation: warmup,
    first,
    second,
    medianRatio: first.median / second.median,
  };
}

const context = { userId: "composition-benchmark-user" };
function feature(index, variant = "a") {
  return {
    hash: `feature-${index}-${variant}`,
    bucketBy: "userId",
    variations: [{ value: "treatment", variables: { copy: `copy-${index}-${variant}` } }],
    variablesSchema: { copy: { type: "string", defaultValue: "default" } },
    traffic: [
      {
        key: "all",
        segments: "*",
        percentage: 100000,
        allocation: [{ variation: "treatment", range: [0, 100000] }],
      },
    ],
  };
}
function globalVariable(index, variant = "a") {
  return {
    hash: `variable-${index}-${variant}`,
    type: "json",
    defaultValue: JSON.stringify({
      delivery: `delivery-${index}-${variant}`,
      methods: ["card", "ideal"],
    }),
  };
}
function entries(count, repeated = false) {
  assert.equal(count % 4, 0);
  return Array.from({ length: count }, (_, index) => {
    const source = repeated ? 0 : Math.floor(index / 4);
    const key = `member${String(index).padStart(3, "0")}`;
    switch (index % 4) {
      case 0:
        return { key, feature: `feature${source}` };
      case 1:
        return { key, feature: `feature${source}`, variation: true };
      case 2:
        return { key, feature: `feature${source}`, variable: "copy" };
      default:
        return { key, variable: `variable${source}` };
    }
  });
}
function datafile(features, globals, compositions = 0, variant = "a") {
  const payload = {
    schemaVersion: "2",
    revision: variant,
    segments: {},
    features: {},
    variables: {},
  };
  for (let index = 0; index < features; index++)
    payload.features[`feature${index}`] = feature(index, variant);
  for (let index = 0; index < globals; index++)
    payload.variables[`variable${index}`] = globalVariable(index, variant);
  for (let index = 0; index < compositions; index++) {
    payload.variables[`composition${index}`] = {
      hash: `composition-${index}`,
      type: "object",
      compose: entries(4, true),
    };
  }
  return payload;
}
function directGetter(members) {
  const fields = members.map((entry) => {
    const feature = JSON.stringify(entry.feature);
    const variable = JSON.stringify(entry.variable);
    const call =
      entry.feature === undefined
        ? `instance.getVariable(${variable}, context)`
        : entry.variable !== undefined
          ? `instance.getVariable(${feature}, ${variable}, context)`
          : entry.variation
            ? `instance.getVariation(${feature}, context)`
            : `instance.isEnabled(${feature}, context)`;
    return `${JSON.stringify(entry.key)}: ${call}`;
  });
  const source = `return { ${fields.join(", ")} };`;
  // Compile once outside timing, matching application object literal assembly.
  return { operation: new Function("instance", "context", source), source };
}
function expected(members) {
  return Object.fromEntries(
    members.map((entry) => {
      const index = Number((entry.feature || entry.variable).replace(/^(feature|variable)/, ""));
      return [
        entry.key,
        entry.feature === undefined
          ? { delivery: `delivery-${index}-a`, methods: ["card", "ideal"] }
          : entry.variable
            ? `copy-${index}-a`
            : entry.variation
              ? "treatment"
              : true,
      ];
    }),
  );
}

function compositionCases(sdk) {
  const results = [];
  for (const definition of [
    { name: "members4", members: 4 },
    { name: "members20", members: 20 },
    { name: "members100", members: 100 },
    { name: "repeatedReferences20", members: 20, repeated: true },
    { name: "nestedComposition20", members: 20, nested: true },
    { name: "moduleCounts4", members: 4, module: true },
    { name: "childInstance20", members: 20, child: true },
  ]) {
    console.error(`Composition: ${definition.name}`);
    const members = entries(definition.members, definition.repeated);
    const payload = datafile(Math.ceil(definition.members / 4), Math.ceil(definition.members / 4));
    payload.variables.config = { hash: "config", type: "object", compose: members };
    if (definition.nested)
      payload.variables.outer = {
        hash: "outer",
        type: "object",
        compose: [{ key: "nested", variable: "config" }],
      };
    let trace;
    let callbackCount = 0;
    const module = {
      name: "composition-benchmark-counter",
      beforeEvaluation(options) {
        callbackCount++;
        if (trace)
          trace.push({
            type: options.type,
            featureKey: options.featureKey,
            variableKey: options.variableKey,
            dependencyOf: options.dependencyOf ? { ...options.dependencyOf } : null,
          });
        return options;
      },
    };
    const parent = sdk.createFeaturevisor({
      datafile: payload,
      logLevel: "fatal",
      modules: definition.module ? [module] : [],
    });
    const instance = definition.child ? parent.spawn(context) : parent;
    const callContext = definition.child ? {} : context;
    const compose = () => instance.getVariable(definition.nested ? "outer" : "config", callContext);
    const assembled = directGetter(members);
    const getters = () =>
      definition.nested
        ? { nested: assembled.operation(instance, callContext) }
        : assembled.operation(instance, callContext);
    const expectedValue = definition.nested ? { nested: expected(members) } : expected(members);
    const observations = {};
    for (const [name, operation] of [
      ["compose", compose],
      ["direct", getters],
    ]) {
      trace = definition.module ? [] : undefined;
      callbackCount = 0;
      const value = operation();
      assert.deepEqual(normalize(value), expectedValue, `${definition.name}/${name}`);
      if (definition.module)
        observations[name] = { beforeEvaluationCalls: callbackCount, evaluations: trace };
    }
    trace = undefined;
    if (definition.module) {
      assert(
        observations.compose.evaluations.some(
          (item) => item.dependencyOf?.variableKey === "config",
        ),
      );
      assert(
        observations.compose.evaluations
          .filter((item) => item.dependencyOf)
          .every(
            (item) =>
              item.dependencyOf.type === "variable" && item.dependencyOf.variableKey === "config",
          ),
      );
      assert(observations.direct.evaluations.every((item) => item.dependencyOf === null));
    }
    const timing = compare(
      [compose, getters],
      definition.members === 100 ? settings.largeIterations : settings.iterations,
      settings.warmup,
    );
    assert.deepEqual(normalize(compose()), normalize(getters()));
    results.push({
      ...definition,
      payload,
      context: definition.child ? { inherited: context, getterContext: {} } : context,
      expected: expectedValue,
      directGetterSource: assembled.source,
      correctness:
        "Both operations match independently defined expected values before timing and each other afterwards",
      modules: definition.module ? observations : undefined,
      iterationsPerBatch: timing.iterationsPerBatch,
      warmupPerOperation: timing.warmupPerOperation,
      compose: timing.first,
      directGetters: timing.second,
      composeToDirectMedianRatio: timing.medianRatio,
    });
    if (definition.child) instance.close();
    parent.close();
  }
  return results;
}

function affected(details) {
  const features = [...details.features].sort();
  const variables = [...details.variables].sort();
  return {
    features: features.length,
    variables: variables.length,
    featureKeys: features,
    variableKeys: variables,
  };
}

// Compare unchanged getters first, then composed overrides with their
// unmodified composition and with equivalent application side mutation work.
function overrideCases(sdks) {
  const results = [];
  for (const definition of [
    { name: "noOverrides4", members: 4, mode: "none" },
    { name: "unmatched1", members: 4, mode: "miss" },
    { name: "matchedLeaf1", members: 4, mode: "leaf" },
    { name: "continuing10", members: 4, mode: "continue", steps: 10 },
    { name: "miss99ThenMatch", members: 4, mode: "scan", steps: 100 },
    { name: "nested3", members: 4, mode: "nested", steps: 3 },
    { name: "members20Leaf1", members: 20, mode: "leaf" },
    { name: "members100Leaf1", members: 100, mode: "leaf" },
    { name: "large1000FieldLeaf1", members: 4, mode: "large", fields: 1000 },
    { name: "wholeReplacement", members: 4, mode: "replace" },
  ]) {
    console.error(`Composition overrides: ${definition.name}`);
    const payload = datafile(1000, 1000);
    payload.variables.config = { type: "object", compose: entries(definition.members) };
    if (definition.fields)
      payload.variables.variable0 = {
        type: "object",
        defaultValue: Object.fromEntries(
          Array.from({ length: definition.fields }, (_, i) => [`field${i}`, i]),
        ),
      };
    const key = "member003";
    const steps = definition.steps || 1;
    const program =
      definition.mode === "none"
        ? undefined
        : Array.from({ length: steps }, (_, i) => ({
            key: `step${i}`,
            keyPath:
              definition.mode === "nested"
                ? Array.from({ length: i + 1 }, (_, j) => `step${j}`)
                : [`step${i}`],
            conditions: {
              attribute: "region",
              operator: "equals",
              value:
                definition.mode === "miss" || (definition.mode === "scan" && i < steps - 1)
                  ? "us"
                  : "nl",
            },
            operations:
              definition.mode === "replace"
                ? [{ op: "set", path: [], value: expected(entries(definition.members)) }]
                : [
                    {
                      op: "set",
                      path: [key, definition.fields ? "field0" : "delivery"],
                      value: definition.fields ? 1000 + i : `override${i}`,
                    },
                  ],
            onMatch: definition.mode === "continue" || definition.mode === "nested" ? i + 1 : steps,
            onMiss: definition.mode === "nested" ? steps : i + 1,
          }));
    const options = { logLevel: "fatal", datafile: payload };
    const before = sdks[0].createFeaturevisor(options);
    const unchanged = sdks[1].createFeaturevisor(options);
    const withOverrides = sdks[1].createFeaturevisor({
      ...options,
      datafile: {
        ...payload,
        variables: {
          ...payload.variables,
          config: { ...payload.variables.config, ...(program ? { overrideProgram: program } : {}) },
        },
      },
    });
    const ctx = { ...context, region: "nl" };
    const beforePlain = () => before.getVariable("config", ctx);
    const afterPlain = () => unchanged.getVariable("config", ctx);
    const afterOverride = () => withOverrides.getVariable("config", ctx);
    const manual = () => {
      let value = beforePlain();
      // Equivalent ordinary code, not an attempt to emulate SDK metadata,
      // module tracking, parsed condition caching or prerequisite sessions.
      for (let i = 0; i < (program?.length || 0); i++) {
        const step = program[i];
        if (ctx.region !== step.conditions.value) continue;
        value = sdks[0].applyVariableOperations(value, step.operations);
        // Match the production contract's fresh outer object for root literals.
        if (step.operations.some((operation) => operation.op === "set" && !operation.path.length))
          value = { ...value };
        if (step.onMatch === program.length) break;
      }
      return value;
    };
    assert.deepEqual(afterPlain(), beforePlain());
    assert.deepEqual(afterOverride(), manual());
    const sourceBefore = JSON.stringify(before.getVariable("variable0", ctx));
    const batches =
      definition.fields || steps === 100 || definition.members === 100
        ? settings.largeIterations
        : settings.iterations;
    const ordinary = compare([beforePlain, afterPlain], batches, settings.warmup);
    const addedWork = compare([afterPlain, afterOverride], batches, settings.warmup);
    const equivalent = compare([manual, afterOverride], batches, settings.warmup);
    assert.deepEqual(afterOverride(), manual());
    assert.equal(JSON.stringify(withOverrides.getVariable("variable0", ctx)), sourceBefore);
    results.push({
      ...definition,
      iterationsPerBatch: batches,
      project: { features: 1000, ordinaryVariables: 1000 },
      program,
      unchanged: { baseline: ordinary.first, trial: ordinary.second },
      additionalWork: { withoutOverrides: addedWork.first, withOverrides: addedWork.second },
      equivalent: { baselineManual: equivalent.first, trialBuiltIn: equivalent.second },
      caveat:
        "Timed batches use warmed SDKs. Min/max are batch mean bounds, not individual evaluation extremes. The application side comparator does not return override diagnostic metadata.",
    });
    for (const f of [before, unchanged, withOverrides]) f.close();
  }
  return results;
}
function largeValueCases(sdks) {
  return [10, 100, 1000].map((fields) => {
    const value = Object.fromEntries(
      Array.from({ length: fields }, (_, index) => [
        `field${index}`,
        { label: `Value ${index}`, enabled: true },
      ]),
    );
    const instances = sdks.map((sdk) =>
      sdk.createFeaturevisor({
        logLevel: "fatal",
        datafile: {
          schemaVersion: "2",
          revision: "large",
          segments: {},
          features: {},
          variables: {
            source: { type: "object", defaultValue: value },
            config: { type: "object", compose: [{ key: "value", variable: "source" }] },
          },
        },
      }),
    );
    try {
      for (const instance of instances) {
        const result = instance.getVariable("config", context);
        assert.deepEqual(normalize(result), { value });
        assert.equal(result.value, instance.getVariable("source", context));
      }
      const timing = compare(
        instances.map((instance) => () => instance.getVariable("config", context)),
        settings.largeIterations,
        1000,
      );
      return {
        fields,
        sourceBytes: Buffer.byteLength(JSON.stringify(value)),
        baseline: timing.first,
        current: timing.second,
        changePercent: (timing.second.median / timing.first.median - 1) * 100,
      };
    } finally {
      instances.forEach((instance) => instance.close());
    }
  });
}

function datafileCases(sdks, dependencies) {
  const supportsComposition = sdks.map((sdk) => {
    const instance = sdk.createFeaturevisor({
      logLevel: "fatal",
      datafile: {
        schemaVersion: "2",
        revision: "probe",
        features: {},
        segments: {},
        variables: {
          value: { type: "boolean", defaultValue: true },
          composed: { type: "object", compose: [{ key: "value", variable: "value" }] },
        },
      },
    });
    try {
      return instance.evaluateVariable("composed").reason === "variable_composed";
    } finally {
      instance.close();
    }
  });
  const results = [];
  for (const compositions of settings.compositionCounts) {
    console.error(
      `Datafiles: ${settings.featureCount} features, ${settings.ordinaryGlobalCount} globals, ${compositions} compositions`,
    );
    const payloads = ["a", "b"].map((variant) =>
      datafile(settings.featureCount, settings.ordinaryGlobalCount, compositions, variant),
    );
    const result = {
      compositions,
      payloadDefinition: {
        features: settings.featureCount,
        ordinaryGlobals: settings.ordinaryGlobalCount,
        compositions,
        membersPerComposition: 4,
        sources:
          "Every composition references feature0 as flag, variation and copy, plus global variable0",
        fullReplacement:
          "Alternate a/b revisions; all source hashes and source values change; composition hashes and references stay constant",
        partialUpdate:
          "Alternate a/b definitions for exactly one feature0 or variable0; all other definitions and composition hashes stay constant",
        bytes: payloads.map((payload) => Buffer.byteLength(JSON.stringify(payload))),
        sha256: payloads.map((payload) => sha256(JSON.stringify(payload))),
        exampleFeature: payloads[0].features.feature0,
        exampleGlobal: payloads[0].variables.variable0,
        exampleComposition: payloads[0].variables.composition0 || null,
        baselineCaveat: supportsComposition[0]
          ? "Both source refs support composition; propagation expectations include every composed dependent"
          : "Baseline does not understand compose; nonzero composition rows measure identical payload parsing/indexing overhead, not equivalent composition propagation semantics",
      },
      operations: {},
    };
    const indexes = dependencies.map((dependency) =>
      dependency.createDatafileDependencyIndex(payloads[0]),
    );
    for (const operation of [
      "dependencyIndex",
      "propagateFeature",
      "propagateGlobal",
      "fullReplacement",
      "partialFeature",
      "partialGlobal",
    ]) {
      const instances = sdks.map((sdk) =>
        sdk.createFeaturevisor({ datafile: payloads[0], logLevel: "fatal" }),
      );
      const observed = [null, null];
      const cleanups = instances.map((instance, index) =>
        instance.on("datafile_set", (details) => {
          observed[index] = details;
        }),
      );
      const counters = [0, 0];
      const operations = sdks.map((_, index) => () => {
        if (operation === "dependencyIndex")
          return dependencies[index].createDatafileDependencyIndex(payloads[0]);
        if (operation.startsWith("propagate")) {
          const features = operation === "propagateFeature" ? ["feature0"] : [];
          const variables = operation === "propagateGlobal" ? ["variable0"] : [];
          dependencies[index].addDatafileDependencyChanges(features, variables, [], indexes[index]);
          observed[index] = { features, variables };
          return observed[index];
        }
        const payload = payloads[++counters[index] % 2];
        const patch =
          operation === "fullReplacement"
            ? payload
            : {
                schemaVersion: "2",
                revision: payload.revision,
                segments: {},
                features:
                  operation === "partialFeature" ? { feature0: payload.features.feature0 } : {},
                variables:
                  operation === "partialGlobal" ? { variable0: payload.variables.variable0 } : {},
              };
        const success = instances[index].setDatafile(patch, operation === "fullReplacement");
        if (!success) throw new Error(`setDatafile failed: ${operation}`);
        return success;
      });
      const timing = compare(operations, settings.operationIterations, settings.operationWarmup);
      const events = observed.map((details, index) => {
        if (!details) return null;
        const info = affected(details);
        const full = operation === "fullReplacement";
        const global = operation.endsWith("Global");
        const expectedFeatures = full ? settings.featureCount : global ? 0 : 1;
        const expectedVariables =
          (full ? settings.ordinaryGlobalCount : global ? 1 : 0) +
          (supportsComposition[index] ? compositions : 0);
        assert.equal(
          info.features,
          expectedFeatures,
          `${operation} feature propagation (${index})`,
        );
        assert.equal(
          info.variables,
          expectedVariables,
          `${operation} variable propagation (${index})`,
        );
        for (let member = 0; member < compositions; member++) {
          assert.equal(
            info.variableKeys.includes(`composition${member}`),
            supportsComposition[index],
            `${operation} composition${member}`,
          );
        }
        return info;
      });
      result.operations[operation] = {
        iterationsPerBatch: timing.iterationsPerBatch,
        warmupPerOperation: timing.warmupPerOperation,
        baseline: timing.first,
        current: timing.second,
        currentToBaselineMedianRatio: timing.second.median / timing.first.median,
        medianChangePercent: (timing.second.median / timing.first.median - 1) * 100,
        affected: { baseline: events[0], current: events[1] },
        timingBoundary: operation.startsWith("propagate")
          ? "Direct private dependency propagation with a prebuilt index; seed arrays and queue allocations included, no event listeners"
          : operation === "dependencyIndex"
            ? "Direct private dependency index construction, independent of setDatafile"
            : "Complete setDatafile call, including merging/validation/index construction/propagation and a minimal datafile_set observer",
      };
      cleanups.forEach((cleanup) => cleanup());
      instances.forEach((instance) => instance.close());
    }
    results.push(result);
  }
  return results;
}

async function main() {
  const startedAt = new Date().toISOString();
  const machine = {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    loadAverageAtStart: os.loadavg(),
  };
  const libraries = [null, null];
  const bundleSizes = [];
  for (const packageConfig of packages) {
    console.error(`Bundles: ${packageConfig.name}`);
    const measurements = [];
    for (const [index, sources] of [baselineSources, currentSources].entries()) {
      const entry = `packages/${packageConfig.directory}/src/index.ts`;
      const original = await bundle(sources, entry, packageConfig.external);
      const esbuild = await bundle(sources, entry, packageConfig.external, "esbuild");
      const minified = await terser(original);
      measurements.push({ ...sizes(original, esbuild, minified), bundleSha256: sha256(minified) });
      if (packageConfig.directory === "sdk")
        libraries[index] = await load(minified, index === 0 ? "baseline-sdk" : "current-sdk");
    }
    const [before, after] = measurements;
    const columns = ["original", "esbuild", "esbuildGzip", "terser", "terserGzip"];
    bundleSizes.push({
      package: packageConfig.name,
      external: packageConfig.external,
      baseline: before,
      current: after,
      delta: changes(Object.fromEntries(columns.map((key) => [key, before[key]])), after),
    });
  }
  const dependencies = [];
  for (const [index, sources] of [baselineSources, currentSources].entries()) {
    dependencies.push(
      await load(
        await terser(await bundle(sources, "packages/sdk/src/dependencies.ts")),
        `dependencies-${index}`,
      ),
    );
  }
  const report = {
    reportVersion: 1,
    startedAt,
    metadata: {
      baselineRef,
      baselineSha,
      currentHead: git("rev-parse", "HEAD").trim(),
      currentBranch: git("branch", "--show-current").trim(),
      sources: {
        baselineSha256: sourceDigest(baselineSources),
        currentSha256: sourceDigest(currentSources),
        directories: sourceDirectories,
        strategy:
          "In memory source snapshots; baseline git show; current filesystem; workspace imports resolve to source, never built package output",
      },
      lockfileSha256: sha256(readFileSync(path.join(root, "package-lock.json"))),
      node: process.version,
      execArgv: process.execArgv,
      runtimeVersions: process.versions,
      tooling: {
        vite: require("vite/package.json").version,
        terser: require("terser/package.json").version,
        dependencies: "Same currently installed external dependencies for both source refs",
      },
      machine,
      settings,
      performanceValidity: smoke
        ? "Smoke only. Small batches and competing integration load must not be used for performance conclusions."
        : "Run on an idle machine; compare both initial orders and inspect the recorded raw batches.",
      scriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      normalization:
        "Recursively normalize object prototypes and sorted keys outside timed sections; preserve arrays and null",
      order:
        "Alternate the pair order per sample; REVERSE_ORDER changes the initial order; warm each case independently",
      comparison:
        "Composition timing measures the current SDK, and optionally the baseline via BASELINE_COMPOSITION=1. Datafile timing compares baseline and current on byte identical payloads. All five size columns contain exact bytes, not rounded kB.",
      bundleSizeColumns: {
        original: "Original bundle bytes",
        esbuild: "esbuild minified bytes",
        esbuildGzip: "esbuild minified plus gzip bytes",
        terser: "Terser with two compression passes, minified bytes",
        terserGzip: "Terser with two compression passes, minified plus gzip bytes",
      },
      bundleSizeCaveat:
        "These are controlled source snapshot comparisons, not measurements of make bundle-sizes package output. Internal provider dependencies resolve to source here, while make bundle-sizes may resolve compiled package dependencies. Record actual package bundle columns separately. Do not claim an exact provider-web make delta without verifying matching baseline compiled dependencies.",
    },
    bundleSizes,
    overrides: process.env.OVERRIDES_ONLY === "1" ? overrideCases(libraries) : null,
    baselineComposition:
      process.env.OVERRIDES_ONLY === "1"
        ? null
        : process.env.BASELINE_COMPOSITION === "1"
          ? compositionCases(libraries[0])
          : null,
    composition: process.env.OVERRIDES_ONLY === "1" ? null : compositionCases(libraries[1]),
    largeValues:
      process.env.OVERRIDES_ONLY === "1"
        ? null
        : process.env.BASELINE_COMPOSITION === "1"
          ? largeValueCases(libraries)
          : null,
    datafiles: process.env.OVERRIDES_ONLY === "1" ? null : datafileCases(libraries, dependencies),
    completedAt: new Date().toISOString(),
    finalSinkPresent: resultSink !== undefined,
  };
  report.metadata.machine.loadAverageAtEnd = os.loadavg();
  const json = JSON.stringify(report, null, 2) + "\n";
  if (outputPath) {
    writeFileSync(path.resolve(outputPath), json);
    console.error(`Report written: ${path.resolve(outputPath)}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
