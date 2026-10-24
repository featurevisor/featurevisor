const assert = require("node:assert/strict");
const React = require("react");
const renderer = require("react-test-renderer");
const { createFeaturevisor } = require("@featurevisor/sdk");
const {
  FeaturevisorProvider,
  FeaturevisorScope,
  useFlag,
  useFlags,
  useEveryFlag,
  useSomeFlag,
  useRevision,
  useVariation,
  useVariable,
} = require("@featurevisor/react");

assert.equal(React.version, "16.8.0");

function datafile(label) {
  return {
    schemaVersion: "4",
    revision: label,
    segments: {
      blocked: { conditions: [{ attribute: "blocked", operator: "equals", value: true }] },
    },
    features: Object.fromEntries(
      ["policy", "alternate"].map((key) => [
        key,
        {
          hash: `${label}-${key}`,
          bucketBy: "userId",
          conditions: [{ variable: "gate", operator: "equals", value: true }],
          variations: [{ value: `${label}-${key}`, weight: 100 }],
          variablesSchema: { value: { type: "json", defaultValue: { label: `${label}-${key}` } } },
          traffic: [
            { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
            {
              key: "all",
              conditions: "*",
              percentage: 100000,
              allocation: [{ variation: `${label}-${key}`, range: [0, 100000] }],
            },
          ],
        },
      ]),
    ),
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
      policy: {
        hash: label,
        type: "json",
        defaultValue: { label },
        disabledValue: { label: "blocked" },
        conditions: { feature: "policy" },
      },
    },
  };
}

for (const strict of [false, true]) {
  const first = createFeaturevisor({ logLevel: "fatal", datafile: datafile("first") });
  const second = createFeaturevisor({
    logLevel: "fatal",
    datafile: datafile("second"),
    context: { blocked: true },
  });
  const commits = [];
  let renders = 0;
  let view;
  function Reader({ featureKey, context, duringLayout }) {
    assert.ok(++renders < 160, "hooks did not settle");
    const snapshot = {
      flag: useFlag(featureKey, context),
      variation: useVariation(featureKey, context),
      feature: useVariable(featureKey, "value", context),
      global: useVariable("policy", context),
      flags: useFlags([featureKey, "alternate"], context),
      every: useEveryFlag([featureKey, "alternate"], context),
      some: useSomeFlag([featureKey, "alternate"], context),
      revision: useRevision(),
    };
    React.useLayoutEffect(() => {
      commits.push(snapshot);
    });
    React.useLayoutEffect(() => {
      if (duringLayout) duringLayout();
    }, [duringLayout]);
    return null;
  }
  function tree(
    sdk = first,
    featureKey = "policy",
    context = { userId: "123" },
    duringLayout,
    scope,
  ) {
    const reader = React.createElement(Reader, { featureKey, context, duringLayout });
    const content = React.createElement(
      FeaturevisorProvider,
      { instance: sdk },
      scope ? React.createElement(FeaturevisorScope, { context: scope }, reader) : reader,
    );
    return strict ? React.createElement(React.StrictMode, null, content) : content;
  }
  // alternate shares policy's conditions, so it differs only when policy is pinned.
  const expected = (label, key = "policy", enabled = true, alternate = enabled) => ({
    flag: enabled,
    variation: enabled ? `${label}-${key}` : null,
    feature: enabled ? { label: `${label}-${key}` } : null,
    global: { label: enabled ? label : "blocked" },
    flags: [enabled, alternate],
    every: enabled && alternate,
    some: enabled || alternate,
    revision: label,
  });
  function step(operation, value) {
    commits.length = 0;
    const before = renders;
    renderer.act(() => {
      operation();
    });
    // React 16.8 drains one passive effect batch per act call.
    let settled = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = renders;
      renderer.act(() => {});
      if (renders === previous) {
        settled = true;
        break;
      }
    }
    assert.ok(settled, "passive effects did not settle");
    assert.ok(renders - before <= 12, "too many renders");
    if (value) {
      assert.ok(commits.length > 0);
      commits.forEach((snapshot) => assert.deepEqual(snapshot, value));
    }
  }
  try {
    step(() => {
      view = renderer.create(tree());
    }, expected("first"));
    step(() => view.update(tree(second)), expected("second", "policy", false));
    step(() => view.update(tree()), expected("first"));
    step(() => view.update(tree(first, "alternate")), expected("first", "alternate"));
    step(
      () => view.update(tree(first, "policy", { blocked: true })),
      expected("first", "policy", false),
    );
    step(() => view.update(tree()), expected("first"));
    // A scope's context reaches every hook below it, and leaving it restores the values.
    step(
      () => view.update(tree(first, "policy", { userId: "123" }, undefined, { blocked: true })),
      expected("first", "policy", false),
    );
    step(() => view.update(tree()), expected("first"));
    step(() => first.setContext({ blocked: true }), expected("first", "policy", false));
    step(() => first.setContext({ blocked: false }), expected("first"));
    step(() => first.setDatafile(datafile("updated")), expected("updated"));
    step(() => first.setStickyVariables({ gate: false }), expected("updated", "policy", false));
    step(() => first.setStickyVariables({}, true), expected("updated"));
    step(
      () => first.setStickyFeatures({ policy: { enabled: false } }),
      expected("updated", "policy", false, true),
    );
    step(() => first.setStickyFeatures({}, true), expected("updated"));
    step(() =>
      view.update(tree(second, "policy", {}, () => second.setContext({ blocked: false }))),
    );
    assert.deepEqual(commits[0], expected("second", "policy", false));
    assert.deepEqual(commits[commits.length - 1], expected("second"));
    commits.forEach((snapshot) =>
      assert.ok(
        [expected("second", "policy", false), expected("second")].some(
          (value) => JSON.stringify(value) === JSON.stringify(snapshot),
        ),
        "mixed committed snapshot during subscription replacement",
      ),
    );
    step(() => view.unmount());
    console.log(`React ${React.version} committed snapshots passed (StrictMode=${strict})`);
  } finally {
    if (view) renderer.act(() => view.unmount());
    first.close();
    second.close();
  }
}
