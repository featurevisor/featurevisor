import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { minify } from "terser";

// Compare the complete SDK, not a reduced entrypoint. Optional snapshots let
// successive experiments compare against the previously accepted bundle.
const baseline = process.argv[2] || "HEAD";
const root = process.cwd();
const samples = Number(process.env.SAMPLES || 15);
const iterations = Number(process.env.ITERATIONS || 100_000);
const passes = Number(process.env.TERSER_PASSES || 2);
const datafileSamples = Number(process.env.DATAFILE_SAMPLES || 51);
const datafilesOnly = process.env.BENCHMARK_SCOPE === "datafiles";
const evaluationsOnly = process.env.BENCHMARK_SCOPE === "evaluations";
const selectedEvaluations = process.env.EVALUATION_CASES?.split(",").filter(Boolean);
const reverseOrder = process.env.REVERSE_ORDER === "1";
const stickyIterations = Number(process.env.STICKY_ITERATIONS || 1000);

for (const value of [samples, iterations, passes, datafileSamples, stickyIterations]) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Benchmark counts must be positive integers");
}

async function loadBundle(code, identity) {
  return {
    sdk: await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${identity}`
    ),
    bytes: Buffer.byteLength(code),
    gzip: gzipSync(code).byteLength,
    code,
  };
}

async function bundle(ref) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: ref
      ? [
          {
            name: "baseline-sdk",
            enforce: "pre",
            load(id) {
              const relative = path.relative(root, id).split(path.sep).join("/");
              if (relative.startsWith("packages/sdk/src/") && relative.endsWith(".ts")) {
                return execFileSync("git", ["show", `${ref}:${relative}`], { encoding: "utf8" });
              }
            },
          },
        ]
      : [],
    build: {
      write: false,
      target: "es2015",
      minify: false,
      lib: { entry: "packages/sdk/src/index.ts", formats: ["es"] },
    },
  });
  const source = (Array.isArray(result) ? result[0] : result).output.find(
    (item) => item.type === "chunk",
  ).code;
  const { code } = await minify(source, { module: true, compress: { passes } });
  return loadBundle(code, ref ? "baseline" : "candidate");
}

async function main() {
  const before = process.env.BASELINE_BUNDLE
    ? await loadBundle(readFileSync(process.env.BASELINE_BUNDLE, "utf8"), "baseline")
    : await bundle(baseline);
  const after = await bundle();
  const probe = before.sdk.createFeaturevisor({
    logLevel: "fatal",
    datafile: {
      schemaVersion: "4",
      revision: "probe",
      segments: {},
      features: {
        probe: {
          bucketBy: "userId",
          conditions: { variable: "gate", operator: "equals", value: true },
          traffic: [{ conditions: "*", segments: "*", percentage: 100000 }],
        },
      },
      variables: { gate: { type: "boolean", defaultValue: false } },
    },
  });
  const baselineUnified = !probe.isEnabled("probe");
  probe.close();
  // Adapt the exact same logical selectors to the two contracts. In particular,
  // the candidate intentionally ignores unreleased requiredVariables datafields.
  // Giving both SDKs the old input would silently benchmark a missing gate.
  function featureConditions(value) {
    if (typeof value === "string") return { feature: value };
    if (Array.isArray(value)) return value.map(featureConditions);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        ["and", "or", "not"].includes(key) ? featureConditions(entry) : entry,
      ]),
    );
  }
  function candidateDatafile(input) {
    const decode = (value) => {
      if (typeof value !== "string" || value === "*") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    function visit(value) {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== "object") return value;
      const isDatafile = "schemaVersion" in value;
      const selectors = [];
      let stringify = false;
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (
          ["conditions", "requiredFeatures", "requiredVariables"].includes(key) ||
          (key === "segments" && !isDatafile)
        ) {
          const decoded = key === "requiredFeatures" ? entry : decode(entry);
          // Keep authored bare segment strings bare. Only restore JSON encoding
          // when the legacy input was already a serialized expression.
          stringify ||=
            key !== "requiredFeatures" && typeof entry === "string" && decoded !== entry;
          const expression = key === "requiredFeatures" ? featureConditions(entry) : decoded;
          if (key === "conditions")
            assert.ok(
              !Array.isArray(expression) || expression.length > 0,
              "Empty attribute expressions need an explicit legacy adapter",
            );
          if (expression !== "*" && !(Array.isArray(expression) && expression.length === 0))
            selectors.push(expression);
        } else
          result[key] = ["defaultValue", "disabledValue", "value"].includes(key)
            ? entry
            : visit(entry);
      }
      if (
        selectors.length ||
        "conditions" in value ||
        "requiredFeatures" in value ||
        "requiredVariables" in value ||
        ("segments" in value && !isDatafile)
      ) {
        // Preserve single expression shape. Adding an artificial outer AND to
        // every segment would measure adapter overhead, not the SDK change.
        // Multiple selectors form AND in their source property order. The
        // generated equivalent workloads use one field per selector location;
        // callback audits guard stage/order equivalence if that corpus changes.
        const conditions =
          selectors.length === 1 ? selectors[0] : selectors.length ? selectors.flat() : "*";
        result.conditions = stringify ? JSON.stringify(conditions) : conditions;
      }
      if (isDatafile) result.schemaVersion = "4";
      return result;
    }
    return visit(input);
  }
  const adapt = (sdk, datafile) =>
    sdk === after.sdk || baselineUnified ? candidateDatafile(datafile) : datafile;
  if (process.env.SAVE_BUNDLE) writeFileSync(process.env.SAVE_BUNDLE, after.code);
  const context = { userId: "benchmark-user", country: "nl", plan: "pro", age: 34 };
  const selector = JSON.stringify({ and: ["eligible", { not: ["excluded"] }] });
  const datafile = {
    schemaVersion: "2",
    revision: "benchmark",
    features: {},
    variables: {},
    segments: {
      eligible: {
        conditions: JSON.stringify({
          and: [
            { attribute: "country", operator: "equals", value: "nl" },
            { attribute: "plan", operator: "equals", value: "pro" },
            { attribute: "age", operator: "greaterThanOrEquals", value: 18 },
          ],
        }),
      },
      excluded: {
        conditions: JSON.stringify({ attribute: "country", operator: "equals", value: "us" }),
      },
    },
  };
  for (let i = 0; i < 1_000; i++) {
    datafile.features[`feature${i}`] = {
      hash: `f${i}`,
      bucketBy: "userId",
      variations: [{ value: "treatment", variables: { copy: "Treatment" } }],
      variablesSchema: { copy: { type: "string", defaultValue: "Default" } },
      traffic: [
        {
          key: "all",
          segments: selector,
          percentage: 100000,
          allocation: [{ variation: "treatment", range: [0, 100000] }],
        },
      ],
    };
    datafile.variables[`variable${i}`] = {
      hash: `v${i}`,
      type: "string",
      defaultValue: "Default",
      requiredFeatures: ["feature0"],
      overrides: [{ key: "eligible", segments: selector, value: "Matched" }],
    };
  }
  datafile.variables.accumulation = {
    type: "object",
    defaultValue: { items: [{ id: "a", tags: ["first"] }], enabled: false },
    overrideProgram: [
      {
        key: "all",
        segments: selector,
        onMatch: 1,
        onMiss: 1,
        operations: [
          { op: "set", path: ["enabled"], value: true },
          {
            op: "append",
            path: ["items", { select: { property: "id", values: ["a"] } }, "tags"],
            value: "second",
          },
        ],
      },
    ],
  };
  datafile.variables.methods = {
    type: "array",
    defaultValue: ["card", "paypal", "paypal"],
    overrideProgram: [
      {
        key: "all",
        segments: "*",
        onMatch: 1,
        onMiss: 1,
        operations: [
          { op: "appendUnique", path: [], value: "card" },
          { op: "appendUnique", path: [], value: "ideal" },
          { op: "removeValue", path: [], value: "paypal" },
        ],
      },
    ],
  };
  datafile.features.grouped = {
    ...datafile.features.feature0,
    requiredFeatures: [
      {
        and: [
          "feature0",
          { or: ["feature1", "feature2"] },
          { not: [{ feature: "feature3", enabled: false }] },
        ],
      },
    ],
  };
  datafile.variables.dependent = {
    type: "string",
    defaultValue: "Matched",
    disabledValue: "Blocked",
    requiredVariables: [
      {
        and: [
          { variable: "variable0", operator: "equals", value: "Matched" },
          {
            or: [
              { feature: "feature0", variable: "copy", operator: "equals", value: "Treatment" },
              { variable: "variable1", operator: "equals", value: "unused" },
            ],
          },
        ],
      },
    ],
  };
  // Eligible starts at 18. A separate threshold lets the miss probe reach this
  // leaf after matching eligible, rather than failing the first segment twice.
  const attributeRule = { attribute: "age", operator: "greaterThanOrEquals", value: 21 };
  datafile.segments.attributeRule = { conditions: attributeRule };
  datafile.features.attributeOnlyRule = {
    bucketBy: "userId",
    traffic: [{ key: "attribute", segments: "attributeRule", percentage: 100000 }],
  };
  datafile.features.attributeOnlySegmentRule = {
    ...datafile.features.attributeOnlyRule,
    traffic: [{ key: "attribute", segments: "attributeRule", percentage: 100000 }],
  };
  datafile.features.mixedRule = {
    bucketBy: "userId",
    requiredFeatures: ["feature0"],
    traffic: [{ key: "mixed", segments: ["eligible", "attributeRule"], percentage: 100000 }],
  };
  datafile.features.segmentFeature = {
    bucketBy: "userId",
    requiredFeatures: ["feature0"],
    traffic: [{ key: "segment", segments: "*", percentage: 100000 }],
  };
  const candidateInput = candidateDatafile(datafile);
  // These three cases are new capability proxies, not identical evaluation
  // paths. In particular, a failed local mixed rule predicate skips a dependency
  // which the baseline's root gate must evaluate. Keep a separate segment based
  // attribute rule as the equivalent existing capability regression workload.
  candidateInput.features.attributeOnlyRule.traffic[0].conditions = attributeRule;
  delete candidateInput.features.mixedRule.conditions;
  candidateInput.features.mixedRule.traffic[0].conditions = [
    "eligible",
    attributeRule,
    { feature: "feature0" },
  ];
  delete candidateInput.features.segmentFeature.conditions;
  candidateInput.segments.featureDependency = { conditions: { feature: "feature0" } };
  candidateInput.features.segmentFeature.traffic[0].conditions = "featureDependency";
  const clone = (sdk) =>
    JSON.parse(JSON.stringify(sdk === after.sdk || baselineUnified ? candidateInput : datafile));
  const create = (sdk, modules = []) =>
    sdk.createFeaturevisor({ datafile: clone(sdk), logLevel: "fatal", modules });
  const instances = [create(before.sdk), create(after.sdk)];
  for (const instance of instances) {
    assert.equal(instance.getVariable("dependent", context), "Matched");
    assert.equal(
      instance.getVariable("dependent", { ...context, country: "us" }),
      "Blocked",
      "Both adapters must actually evaluate the variable condition gate",
    );
    for (const feature of ["attributeOnlyRule", "mixedRule", "segmentFeature"]) {
      assert.equal(instance.isEnabled(feature, context), true);
    }
    assert.equal(instance.isEnabled("attributeOnlyRule", { ...context, age: 0 }), false);
    for (const feature of ["mixedRule", "segmentFeature"])
      assert.equal(instance.isEnabled(feature, { ...context, country: "us" }), false);
  }
  const children = instances.map((f) => f.spawn(context));
  const modules = [before.sdk, after.sdk].map((sdk) =>
    create(sdk, [
      {
        beforeEvaluation: (options) => options,
        afterEvaluation: (evaluation) => evaluation,
      },
    ]),
  );
  const proxyCases = new Set(
    baselineUnified ? [] : ["attributeOnlyRule", "mixedRuleConditions", "segmentFeatureCondition"],
  );
  const workloadCategory = (name) =>
    proxyCases.has(name) ? "new_capability_proxy" : "equivalent_condition_workload";
  const callbackTraces = [[], []];
  const callbackIdentity = (options) => ({
    type: options.type,
    feature: options.featureKey ?? null,
    variable: options.variableKey ?? null,
    dependencyPurpose:
      options.dependencyPurpose === "requirement"
        ? "condition"
        : (options.dependencyPurpose ?? null),
    dependencyOf: options.dependencyOf
      ? {
          type: options.dependencyOf.type,
          feature: options.dependencyOf.featureKey ?? null,
          variable: options.dependencyOf.variableKey ?? null,
        }
      : null,
  });
  // Observers run only on separate correctness instances, never timed instances.
  const auditInstances = datafilesOnly
    ? []
    : [before.sdk, after.sdk].map((sdk, index) =>
        create(sdk, [
          {
            beforeEvaluation(options) {
              callbackTraces[index].push({ phase: "before", ...callbackIdentity(options) });
              return options;
            },
            afterEvaluation(evaluation, options) {
              callbackTraces[index].push({ phase: "after", ...callbackIdentity(options) });
              return evaluation;
            },
          },
        ]),
      );
  const auditChildren = auditInstances.map((f) => f.spawn(context));
  function auditCallbacks(name, operations, category, expected) {
    callbackTraces.forEach((trace) => {
      trace.length = 0;
    });
    const values = operations.map((operation) => operation());
    values.forEach((value) => assert.deepEqual(value, expected, `${name}: audited getter result`));
    assert.deepEqual(values[0], values[1], `${name}: adapters must return the same getter value`);
    const equivalentCallbacks =
      JSON.stringify(callbackTraces[0]) === JSON.stringify(callbackTraces[1]);
    if (category === "equivalent_condition_workload") {
      assert.deepEqual(
        callbackTraces[0],
        callbackTraces[1],
        `${name}: dependency order, memoization and early exits must preserve callbacks`,
      );
    }
    return {
      category,
      equivalentCallbacks,
      before: { value: values[0], callbacks: [...callbackTraces[0]] },
      after: { value: values[1], callbacks: [...callbackTraces[1]] },
    };
  }
  const callbackAudits = {};

  function summarize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      samples: values,
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      max: sorted.at(-1),
    };
  }

  function compare(operations, count = iterations, prepare = () => {}) {
    if (reverseOrder) {
      operations = [operations[1], operations[0]];
      const originalPrepare = prepare;
      prepare = (index) => originalPrepare(1 - index);
    }
    const results = [[], []];
    for (let i = 0; i < Math.min(10_000, count) && count > 1; i++) {
      operations[0]();
      operations[1]();
    }
    if (count === 1) {
      for (let warmup = 0; warmup < 10; warmup++) {
        for (const index of [0, 1]) {
          prepare(index);
          operations[index]();
        }
      }
    }
    for (let sample = 0; sample < (count === 1 ? datafileSamples : samples); sample++) {
      // Alternate order to reduce systematic warmup and machine load bias.
      for (const index of sample % 2 ? [1, 0] : [0, 1]) {
        prepare(index);
        const start = performance.now();
        for (let iteration = 0; iteration < count; iteration++) operations[index]();
        results[index].push(((performance.now() - start) * 1_000_000) / count);
      }
    }
    const [old, current] = (reverseOrder ? results.reverse() : results).map(summarize);
    return {
      before: old,
      after: current,
      medianChangePercent: (current.median / old.median - 1) * 100,
    };
  }

  const evaluations = {};
  for (const [name, values, operation, expected] of [
    ["flag", instances, (f) => f.isEnabled("feature0", context), true],
    ["variation", instances, (f) => f.getVariation("feature0", context), "treatment"],
    ["featureVariable", instances, (f) => f.getVariable("feature0", "copy", context), "Treatment"],
    ["globalVariable", instances, (f) => f.getVariable("variable0", context), "Matched"],
    [
      "typedFeatureVariable",
      instances,
      (f) => f.getVariableString("feature0", "copy", context),
      "Treatment",
    ],
    [
      "childTypedFeatureVariable",
      children,
      (f) => f.getVariableString("feature0", "copy"),
      "Treatment",
    ],
    ["childTypedGlobalVariable", children, (f) => f.getVariableString("variable0"), "Matched"],
    ["moduleFlag", modules, (f) => f.isEnabled("feature0", context), true],
    ["moduleGlobalVariable", modules, (f) => f.getVariable("variable0", context), "Matched"],
    ["groupedFeatureConditions", instances, (f) => f.isEnabled("grouped", context), true],
    ["variableConditions", instances, (f) => f.getVariable("dependent", context), "Matched"],
    ["attributeOnlyRule", instances, (f) => f.isEnabled("attributeOnlyRule", context), true],
    [
      "attributeOnlySegmentRule",
      instances,
      (f) => f.isEnabled("attributeOnlySegmentRule", context),
      true,
    ],
    ["mixedRuleConditions", instances, (f) => f.isEnabled("mixedRule", context), true],
    ["segmentFeatureCondition", instances, (f) => f.isEnabled("segmentFeature", context), true],
    ["primitiveMutations", instances, (f) => f.getVariable("methods", context), ["card", "ideal"]],
    [
      "accumulation",
      instances,
      (f) => f.getVariable("accumulation", context),
      { items: [{ id: "a", tags: ["first", "second"] }], enabled: true },
    ],
  ]) {
    if (datafilesOnly || (selectedEvaluations && !selectedEvaluations.includes(name))) continue;
    const operations = values.map((f) => () => operation(f));
    operations.forEach((operation) => assert.deepEqual(operation(), expected));
    const auditValues = values === children ? auditChildren : auditInstances;
    callbackAudits[name] = auditCallbacks(
      name,
      auditValues.map((f) => () => operation(f)),
      workloadCategory(name),
      expected,
    );
    evaluations[name] = compare(operations);
  }
  const shortCircuitAudits = {};
  if (!datafilesOnly) {
    for (const [name, operation, category] of [
      [
        "variableConditionsBlocked",
        (f) => f.getVariable("dependent", { ...context, country: "us" }),
        "equivalent_condition_workload",
      ],
      [
        "groupedFeatureConditionsBlocked",
        (f) => f.isEnabled("grouped", { ...context, country: "us" }),
        "equivalent_condition_workload",
      ],
      [
        "attributeOnlySegmentRuleMiss",
        (f) => f.isEnabled("attributeOnlySegmentRule", { ...context, age: 0 }),
        "equivalent_condition_workload",
      ],
      [
        "directAttributeRuleMiss",
        (f) => f.isEnabled("attributeOnlyRule", { ...context, age: 0 }),
        "new_capability_proxy",
      ],
      [
        "mixedRuleSegmentMiss",
        (f) => f.isEnabled("mixedRule", { ...context, country: "us" }),
        "new_capability_proxy",
      ],
      [
        "mixedRuleAttributeMiss",
        (f) => f.isEnabled("mixedRule", { ...context, age: 19 }),
        "new_capability_proxy",
      ],
      [
        "segmentFeatureDependencyMiss",
        (f) => f.isEnabled("segmentFeature", { ...context, country: "us" }),
        "new_capability_proxy",
      ],
    ]) {
      shortCircuitAudits[name] = auditCallbacks(
        name,
        auditInstances.map((f) => () => operation(f)),
        baselineUnified ? "equivalent_condition_workload" : category,
        name === "variableConditionsBlocked" ? "Blocked" : false,
      );
    }
    for (const name of ["mixedRuleSegmentMiss", "mixedRuleAttributeMiss"]) {
      const reads = (side) =>
        shortCircuitAudits[name][side].callbacks.filter(
          (entry) =>
            entry.phase === "before" &&
            entry.feature === "feature0" &&
            entry.dependencyPurpose === "condition",
        ).length;
      assert.equal(
        reads("before"),
        baselineUnified ? 0 : 1,
        `${name}: baseline prerequisite order`,
      );
      assert.equal(
        reads("after"),
        0,
        `${name}: candidate must short circuit before its feature leaf`,
      );
    }
    auditChildren.forEach((f) => f.close());
    auditInstances.forEach((f) => f.close());
  }
  if (selectedEvaluations) {
    assert.deepEqual(
      Object.keys(evaluations).sort(),
      [...new Set(selectedEvaluations)].sort(),
      "Every selected evaluation must name an existing benchmark case",
    );
  }

  const stickyEvaluations = {};
  if (!datafilesOnly && !evaluationsOnly) {
    // Export actual server evaluations before adding the consumer's gated value.
    // Never make the gated value sticky: that would bypass the prerequisite.
    for (const size of [0, 100, 1000, 5000]) {
      for (const kind of ["features", "variables"]) {
        const consumers = [before.sdk, after.sdk].map((sdk) => {
          const handoff = {
            schemaVersion: "2",
            revision: "sticky",
            segments: {},
            features: {},
            variables: {},
          };
          for (let index = 0; index < Math.max(1, size); index++) {
            if (kind === "features")
              handoff.features[`item${index}`] = {
                bucketBy: "userId",
                traffic: [{ key: "all", segments: "*", percentage: 100000 }],
              };
            else handoff.variables[`item${index}`] = { type: "integer", defaultValue: 1 };
          }
          const server = sdk.createFeaturevisor({
            datafile: adapt(sdk, handoff),
            logLevel: "fatal",
          });
          const sticky =
            kind === "features"
              ? { stickyFeatures: size ? server.getFeatureEvaluations(context) : undefined }
              : { stickyVariables: size ? server.getVariableEvaluations(context) : undefined };
          server.close();
          const consumerDatafile = JSON.parse(JSON.stringify(handoff));
          consumerDatafile.variables.gated = {
            type: "integer",
            defaultValue: 1,
            disabledValue: 0,
            ...(kind === "features"
              ? { requiredFeatures: ["item0"] }
              : {
                  requiredVariables: [{ variable: "item0", operator: "equals", value: 1 }],
                }),
          };
          const instance = sdk.createFeaturevisor({
            datafile: adapt(sdk, consumerDatafile),
            logLevel: "fatal",
            ...sticky,
          });
          const parent = sdk.createFeaturevisor({
            datafile: adapt(sdk, JSON.parse(JSON.stringify(consumerDatafile))),
            logLevel: "fatal",
          });
          const child = parent.spawn(context, sticky);
          return { instance, parent, child };
        });
        for (const mode of ["instance", "child"]) {
          const operations = consumers.map(
            (consumer) => () => consumer[mode].getVariable("gated", context),
          );
          operations.forEach((operation) => assert.equal(operation(), 1));
          stickyEvaluations[`${kind}-${size}-${mode}`] = compare(operations, stickyIterations);
        }
        consumers.forEach(({ instance, parent, child }) => {
          child.close();
          parent.close();
          instance.close();
        });
      }
    }
  }

  let prepared;
  let dependencyGraph;
  if (!datafilesOnly && !evaluationsOnly) {
    // Two shared prerequisites per level expose repeated diamond traversal.
    // Single-call samples avoid running the exponential baseline in a large batch.
    const depth = 18;
    const variables = {};
    const add = (key, dependencies) => {
      variables[key] = {
        type: "integer",
        defaultValue: 1,
        requiredVariables: dependencies.map((variable) => ({
          variable,
          operator: "equals",
          value: 1,
        })),
      };
    };
    let previous = [];
    for (let level = 0; level < depth; level++) {
      const next = [`left${level}`, `right${level}`];
      next.forEach((key) => add(key, previous));
      previous = next;
    }
    add("root", previous);
    const callbacks = [0, 0];
    const graphs = [before.sdk, after.sdk].map((sdk, index) =>
      sdk.createFeaturevisor({
        logLevel: "fatal",
        datafile: adapt(sdk, {
          schemaVersion: "2",
          revision: "diamond",
          features: {},
          segments: {},
          variables,
        }),
        modules: [
          {
            afterEvaluation: (evaluation) => {
              callbacks[index]++;
              return evaluation;
            },
          },
        ],
      }),
    );
    const operations = graphs.map((f) => () => f.getVariable("root"));
    operations.forEach((operation) => assert.equal(operation(), 1));
    assert.equal(
      callbacks[0],
      callbacks[1],
      "Equivalent diamond graphs must perform the same dependency callbacks",
    );
    dependencyGraph = {
      depth,
      callbacksPerCall: { before: callbacks[0], after: callbacks[1] },
      timing: compare(operations, 1),
    };
    graphs.forEach((f) => f.close());
  }
  let datafiles = {};
  let legacyDatafileFingerprint;
  let datafileWorkloads;
  if (!evaluationsOnly) {
    const sdks = [before.sdk, after.sdk];
    const timingInput = (sdk) => {
      const input = clone(sdk);
      // Capability proxies deliberately move edges between gates, rules and
      // segments. Do not include those unequal graphs in replacement timings.
      for (const key of ["attributeOnlyRule", "mixedRule", "segmentFeature"])
        delete input.features[key];
      delete input.segments.featureDependency;
      return input;
    };
    const snapshots = sdks.map(timingInput);
    const datafileInstances = sdks.map((sdk, index) =>
      sdk.createFeaturevisor({
        datafile: JSON.parse(JSON.stringify(snapshots[index])),
        logLevel: "fatal",
      }),
    );
    const replacements = snapshots.map((snapshot) => JSON.parse(JSON.stringify(snapshot)));
    datafileWorkloads = snapshots.map((snapshot) => ({
      fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      features: Object.keys(snapshot.features).length,
      variables: Object.keys(snapshot.variables).length,
      segments: Object.keys(snapshot.segments).length,
    }));
    const replacementToggle = [false, false];
    const initialInstances = [];
    for (const entity of [
      ...replacements.flatMap((replacement) => Object.values(replacement.features)),
      ...replacements.flatMap((replacement) => Object.values(replacement.variables)),
    ]) {
      entity.hash = `${entity.hash}-replacement`;
    }
    datafiles = {
      initial: compare(
        [before.sdk, after.sdk].map((sdk, index) => () => {
          initialInstances[index] = sdk.createFeaturevisor({
            datafile: prepared,
            logLevel: "fatal",
          });
        }),
        1,
        (index) => {
          initialInstances[index]?.close();
          prepared = JSON.parse(JSON.stringify(snapshots[index]));
        },
      ),
      warmSetDatafile: compare(
        datafileInstances.map((f) => () => f.setDatafile(prepared, true)),
        1,
        (index) => {
          replacementToggle[index] = !replacementToggle[index];
          prepared = replacementToggle[index]
            ? JSON.parse(JSON.stringify(replacements[index]))
            : JSON.parse(JSON.stringify(snapshots[index]));
        },
      ),
    };
    initialInstances.forEach((f) => f.close());
    let coldInstances = [];
    const coldSetDatafile = (input) =>
      compare(
        sdks.map((_, index) => () => coldInstances[index].setDatafile(prepared, true)),
        1,
        (index) => {
          coldInstances[index]?.close();
          coldInstances[index] = sdks[index].createFeaturevisor({
            logLevel: "fatal",
            datafile: {
              schemaVersion: index ? "4" : "2",
              revision: "empty",
              features: {},
              segments: {},
              variables: {},
            },
          });
          prepared = JSON.parse(JSON.stringify(input(index)));
        },
      );
    // Cold means the first set on a fresh empty instance, not a cold VM or JIT.
    // Instance setup and input cloning remain outside the timed operation.
    datafiles.coldSetDatafile = coldSetDatafile((index) => snapshots[index]);
    coldInstances.forEach((f) => f.close());
    coldInstances = [];
    // Fresh instance setup is outside the clock. These are the first getter
    // calls after loading, with no untimed getter that could warm entity caches.
    const firstReadCases = [
      ["flag", (f) => f.isEnabled("feature0", context), true],
      ["variation", (f) => f.getVariation("feature0", context), "treatment"],
      ["featureVariable", (f) => f.getVariable("feature0", "copy", context), "Treatment"],
      ["variable", (f) => f.getVariable("variable0", context), "Matched"],
    ];
    for (const [name, operation, expected] of firstReadCases) {
      const first = [];
      const values = [];
      datafiles[`firstEvaluation-${name}`] = compare(
        sdks.map((_, index) => () => {
          values[index] = operation(first[index]);
        }),
        1,
        (index) => {
          first[index]?.close();
          first[index] = sdks[index].createFeaturevisor({
            datafile: JSON.parse(JSON.stringify(snapshots[index])),
            logLevel: "fatal",
          });
        },
      );
      values.forEach((value) => assert.deepEqual(value, expected));
      first.forEach((f) => f.close());
    }
    const legacy = {
      schemaVersion: "2",
      revision: "legacy-normalization",
      segments: datafile.segments,
      features: Object.fromEntries(
        Array.from({ length: 1000 }, (_, index) => [
          `feature${index}`,
          {
            ...datafile.features[`feature${index}`],
            ...(index ? { requiredFeatures: ["feature0"] } : {}),
          },
        ]),
      ),
    };
    legacyDatafileFingerprint = createHash("sha256").update(JSON.stringify(legacy)).digest("hex");
    datafiles.legacyNormalizationColdSetDatafile = coldSetDatafile(() => legacy);
    coldInstances.forEach((f) => f.close());
    const legacyInstances = sdks.map((sdk) =>
      sdk.createFeaturevisor({ datafile: JSON.parse(JSON.stringify(legacy)), logLevel: "fatal" }),
    );
    const legacyChanged = JSON.parse(JSON.stringify(legacy));
    legacyChanged.revision = "legacy-replacement";
    for (const feature of Object.values(legacyChanged.features)) feature.hash += "-replacement";
    const legacyToggles = [false, false];
    datafiles.legacyNormalizationWarmSetDatafile = compare(
      legacyInstances.map((f) => () => f.setDatafile(prepared, true)),
      1,
      (index) => {
        legacyToggles[index] = !legacyToggles[index];
        prepared = JSON.parse(JSON.stringify(legacyToggles[index] ? legacyChanged : legacy));
      },
    );
    legacyInstances.forEach((f) => f.close());
    const update = (country) => ({
      schemaVersion: "2",
      revision: "partial",
      features: {},
      segments: {
        eligible: {
          conditions: { attribute: "country", operator: "equals", value: country },
        },
      },
    });
    const fresh = [];
    datafiles.firstPartialUpdate = compare(
      [0, 1].map((index) => () => fresh[index].setDatafile(prepared)),
      1,
      (index) => {
        fresh[index]?.close();
        fresh[index] = sdks[index].createFeaturevisor({
          datafile: JSON.parse(JSON.stringify(snapshots[index])),
          logLevel: "fatal",
        });
        prepared = adapt(sdks[index], update("us"));
      },
    );
    fresh.forEach((f) => f.close());
    const partialToggles = [false, false];
    datafiles.cachedPartialUpdate = compare(
      datafileInstances.map((f) => () => f.setDatafile(prepared)),
      1,
      (index) => {
        partialToggles[index] = !partialToggles[index];
        prepared = adapt(sdks[index], update(partialToggles[index] ? "us" : "nl"));
      },
    );
    datafileInstances.forEach((f) => f.close());
  }

  const report = {
    baseline,
    baselineUnified,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    fingerprints: {
      beforeBundle: createHash("sha256").update(before.code).digest("hex"),
      afterBundle: createHash("sha256").update(after.code).digest("hex"),
      datafile: createHash("sha256").update(JSON.stringify(datafile)).digest("hex"),
      candidateDatafile: createHash("sha256").update(JSON.stringify(candidateInput)).digest("hex"),
      legacyDatafile: legacyDatafileFingerprint,
      runner: createHash("sha256")
        .update(readFileSync(new URL(import.meta.url)))
        .digest("hex"),
    },
    baselineBundle: process.env.BASELINE_BUNDLE,
    workloadClassification: {
      categories: {
        equivalent_condition_workload:
          "Same getter predicates, dependency identities and order for the generated inputs; legacy selector encoding adapts to conditions. Equivalent probes must preserve canonical callback traces.",
        new_capability_proxy:
          "Equal getter outcomes for the supplied probes, but different evaluator placement or graph topology. Not an equivalent path regression gate and not a claim about arbitrary stateful modules.",
        equivalent_graph_different_encoding:
          "Same entity and dependency graph with schema 2 legacy selectors versus schema 4 conditions. Capability proxies excluded. Input representation and loading work intentionally differ.",
        identical_legacy_input:
          "Identical v3 shaped 1000 feature snapshots for both SDKs. Measures total setDatafile work including legacy normalization, not normalization in isolation.",
        identical_unified_input:
          "Identical schema 4 snapshots for both SDKs, including selector encoding and dependency topology.",
      },
      evaluations: Object.fromEntries(
        Object.keys(evaluations).map((name) => [
          name,
          {
            category: workloadCategory(name),
            regressionGateEligible: !proxyCases.has(name),
          },
        ]),
      ),
      proxies: baselineUnified
        ? {}
        : {
            attributeOnlyRule:
              "Baseline selects an attribute only segment; candidate has a direct attribute rule. Use attributeOnlySegmentRule for the matched existing capability regression gate.",
            mixedRuleConditions:
              "Baseline reads feature0 at the root before testing local segment predicates. Candidate tests eligible and age >= 21 before reading feature0 inside the rule. Timed matched context reaches the same dependency; country us and age 19 misses intentionally skip it only in the candidate.",
            segmentFeatureCondition:
              "Baseline has a root feature0 gate and wildcard rule. Candidate has a rule selecting a segment whose condition reads feature0. Baseline cannot express the candidate segment capability.",
          },
      callbacks: {
        observation:
          "Separate untimed identity observers; before and after hooks, immediate dependencyOf and dependency purpose recorded. Only requirement to condition naming is normalized. Getter outcomes compared, not renamed detailed reasons.",
        matched: callbackAudits,
        shortCircuits: shortCircuitAudits,
      },
      stickyEvaluations: {
        category: "equivalent_condition_workload",
        observation:
          "Same item0 gate, getter result and sticky entry counts. Each SDK exports its own genuine sticky snapshots; incidental evaluation metadata is not a byte identical input. No timed observer callbacks are added.",
      },
      dependencyGraph: {
        category: "equivalent_condition_workload",
        observation:
          "Same 18 level diamond and ordered variable comparisons. Initial dependency callback counts must match; identity observers are not included in its timing.",
      },
      datafiles: {
        category: baselineUnified
          ? "identical_unified_input"
          : "equivalent_graph_different_encoding",
        snapshots: datafileWorkloads,
        excludedProxyFeatures: ["attributeOnlyRule", "mixedRule", "segmentFeature"],
        cold: "First set on a fresh empty instance, not a cold process, VM or JIT. Cloning, setup and previous instance cleanup occur outside timed calls.",
        warm: "Alternating original and changed complete snapshots on initialized instances without modules or children.",
        partialUpdates:
          "Fresh instances always receive country us. Cached instances alternate country us and nl in the same per SDK sequence; there is no random payload mismatch.",
        firstEvaluations:
          "First getter on a fresh loaded instance. Construction, cloning and result validation are outside the clock. Includes lazy parsing and normalization, but not a cold process or JIT.",
        legacy: {
          category: "identical_legacy_input",
          features: 1000,
          coldCase: "legacyNormalizationColdSetDatafile",
          warmCase: "legacyNormalizationWarmSetDatafile",
        },
      },
    },
    adapters: {
      before: baselineUnified
        ? "Schema 4 unified conditions, identical candidate inputs"
        : "Legacy selectors, including unreleased variable prerequisites",
      after: "Schema 4 unified conditions; no ignored legacy variable fields",
      attributeOnlyRule: baselineUnified
        ? "Identical direct attribute rule"
        : "Baseline attribute only segment predicate; candidate direct attribute rule predicate unsupported by the old grammar",
      mixedRule: baselineUnified
        ? "Identical mixed rule leaves"
        : "Baseline root feature gate plus segment predicates; candidate mixed rule leaves",
      segmentFeature: baselineUnified
        ? "Identical segment feature dependency"
        : "Baseline root feature gate; candidate segment referencing the same feature",
      coldSetDatafile:
        "First setDatafile on a fresh empty instance; not a cold process or JIT; setup and clone outside timed call",
      warmSetDatafile:
        "Repeated complete replacement alternating original and changed entity hashes",
      legacyNormalization:
        "Identical 1000 feature v3 inputs on both sides; cold first set and warm changed replacement measured separately; clone outside timed call",
    },
    terserPasses: passes,
    size: {
      before: { bytes: before.bytes, gzip: before.gzip },
      after: { bytes: after.bytes, gzip: after.gzip },
      gzipDifference: after.gzip - before.gzip,
    },
    unit: "nanoseconds per operation (batch timing for evaluations)",
    samples,
    iterations,
    datafileSamples,
    reverseOrder,
    scope: process.env.BENCHMARK_SCOPE || "all",
    selectedEvaluations,
    evaluations,
    stickyIterations,
    stickyEvaluations,
    dependencyGraph,
    datafiles,
  };
  const json = JSON.stringify(report, null, 2);
  if (process.env.BENCHMARK_OUTPUT) writeFileSync(process.env.BENCHMARK_OUTPUT, json + "\n");
  console.log(json);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
