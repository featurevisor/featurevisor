const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const React = require("react");
const renderer = require("react-test-renderer");
const { createFeaturevisor } = require("@featurevisor/sdk");
const { FeaturevisorProvider, useFlag, useVariable, useSdk } = require("@featurevisor/react");

assert.equal(React.version, "16.8.0");
assert.equal(require("react-test-renderer/package.json").version, "16.8.0");
assert.equal(createRequire(require.resolve("@featurevisor/react"))("react"), React);
assert.equal(createRequire(require.resolve("react-test-renderer"))("react"), React);

function datafile(grant = "read") {
  return {
    schemaVersion: "4",
    revision: grant,
    segments: {},
    features: {
      policy: {
        hash: `feature-${grant}`,
        bucketBy: "userId",
        conditions: [{ variable: "gate", operator: "equals", value: true }],
        traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        variablesSchema: { grants: { type: "json", defaultValue: { grants: [grant] } } },
      },
    },
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
      policy: {
        hash: `global-${grant}`,
        type: "json",
        defaultValue: { grants: [] },
        disabledValue: { grants: ["blocked"] },
        conditions: [{ variable: "gate", operator: "equals", value: true }],
        overrideProgram: [
          {
            key: "grant",
            keyPath: ["grant"],
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            operations: [{ op: "append", path: ["grants"], value: grant }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  };
}

function instance(grant) {
  const sdk = createFeaturevisor({
    logLevel: "fatal",
    context: { country: "nl" },
    datafile: datafile(grant),
  });
  const on = sdk.on.bind(sdk);
  const subscriptions = [];
  sdk.on = (...args) => {
    const unsubscribe = on(...args);
    const subscription = { cleanups: 0 };
    subscriptions.push(subscription);
    return () => {
      assert.equal(++subscription.cleanups, 1, "subscription cleaned up more than once");
      unsubscribe();
    };
  };
  return { sdk, subscriptions };
}

for (const strict of [false, true]) {
  const first = instance("read");
  const second = instance("second");
  const snapshots = [];
  let view;
  let renders = 0;
  function Reader({ country }) {
    assert.ok(++renders <= 80, "hooks failed to settle");
    const context = { userId: "123", ...(country ? { country } : {}) };
    const snapshot = {
      enabled: useFlag("policy", context),
      global: useVariable("policy", context),
      feature: useVariable("policy", "grants", context),
    };
    assert.ok([first.sdk, second.sdk].includes(useSdk()));
    snapshots.push(snapshot);
    return React.createElement("output", null, JSON.stringify(snapshot));
  }
  function tree(sdk = first.sdk, country) {
    const content = React.createElement(
      FeaturevisorProvider,
      { instance: sdk },
      React.createElement(Reader, { country }),
    );
    return strict ? React.createElement(React.StrictMode, null, content) : content;
  }
  const expected = (grant, global = [grant], enabled = true) => ({
    enabled,
    global: { grants: global },
    feature: enabled ? { grants: [grant] } : null,
  });
  const expectValue = (value) => assert.deepEqual(JSON.parse(view.toJSON().children[0]), value);
  const step = (operation) => {
    const before = renders;
    renderer.act(() => {
      operation();
    });
    // React 16.8 act drains one passive effect batch. Flush any resulting work
    // before checking that subsequent SDK events cannot reach detached readers.
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
    assert.ok(renders - before <= 8, "update triggered excessive renders");
  };
  const active = (instance) =>
    instance.subscriptions.filter((entry) => entry.cleanups === 0).length;

  try {
    step(() => {
      view = renderer.create(tree());
    });
    assert.deepEqual(snapshots[0], expected("read"), "initial render must have evaluated values");
    expectValue(expected("read"));
    assert.equal(active(first), 12, "one listener per event for each of the three hooks");
    step(() => view.update(tree()));
    step(() => view.update(tree()));
    expectValue(expected("read"));
    assert.equal(active(first), 12);
    step(() => view.update(tree(first.sdk, "de")));
    expectValue(expected("read", []));
    step(() => view.update(tree()));
    step(() => first.sdk.setContext({ country: "de" }));
    expectValue(expected("read", []));
    step(() => first.sdk.setContext({ country: "nl" }));
    expectValue(expected("read"));
    step(() => first.sdk.setDatafile(datafile("write")));
    expectValue(expected("write"));
    step(() => first.sdk.setStickyVariables({ gate: false }));
    expectValue(expected("write", ["blocked"], false));
    step(() => first.sdk.setStickyVariables({}, true));
    expectValue(expected("write"));
    step(() => view.update(tree(second.sdk)));
    expectValue(expected("second"));
    assert.equal(active(first), 0, "provider replacement must release old SDK listeners");
    assert.equal(active(second), 12);
    const beforeOldEvent = renders;
    step(() => first.sdk.setContext({ country: "de" }));
    assert.equal(renders, beforeOldEvent);
    step(() => view.unmount());
    assert.equal(active(second), 0, "unmount must release all SDK listeners");
    const beforeUnmountedEvent = renders;
    step(() => second.sdk.setDatafile(datafile("after-unmount")));
    assert.equal(renders, beforeUnmountedEvent);
    console.log(
      `React ${React.version} packaged consumer passed (StrictMode=${strict}, ${renders} renders)`,
    );
  } finally {
    if (view) renderer.act(() => view.unmount());
    first.sdk.close();
    second.sdk.close();
  }
}
