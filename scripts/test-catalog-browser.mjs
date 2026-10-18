/* global process */

// Build Catalog before running. Only temporary fixtures and an isolated Chrome profile are used.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  exportCatalog,
  serveCatalog,
  resolveCatalogRequestPath,
} = require("../packages/catalog/lib/index.js");
const temporary = mkdtempSync(join(tmpdir(), "featurevisor-catalog-browser-"));
const featureKey = "checkout/cart 100% β";
const scenarioKey = "quality/cart.ready";
const specKey = "features/cart";
const setKeys = ["dev", "production β"];
const encode = (value) => encodeURIComponent(value).replace(/%2F/gi, "%252F");
const json = JSON.stringify;
let chrome;
let cdp;

// An interrupted run must not leave a headless browser behind. Normal and failed
// runs close it in main's finally block.
function killChrome() {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
}
process.on("exit", killChrome);
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
]) {
  process.once(signal, () => {
    killChrome();
    rmSync(temporary, { recursive: true, force: true });
    process.exit(code);
  });
}
let server;
let browserLog = "";

async function until(read, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(25);
  }
  throw new Error("Timed out: " + label);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(json(message.error)));
      else request.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Browser connection closed"));
    }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Browser command timed out: " + method));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(json({ id, method, params }));
      });
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(json(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(expression, label = expression) {
  try {
    return await until(() => evaluate(expression), label);
  } catch (error) {
    const page = await evaluate(
      "({url: location.href, text: document.body.innerText.slice(0, 6000)})",
    ).catch(() => null);
    throw new Error(error.message + "\n" + JSON.stringify(page, null, 2), { cause: error });
  }
}

async function click(selector) {
  await waitFor("document.querySelector(" + json(selector) + ") !== null");
  await evaluate("document.querySelector(" + json(selector) + ").click()");
}

async function clickText(tag, text) {
  const expression =
    "[...document.querySelectorAll(" +
    json(tag) +
    ")].find(el => el.textContent.trim() === " +
    json(text) +
    ")";
  await waitFor("Boolean(" + expression + ")", "Find " + tag + ": " + text);
  await evaluate("(" + expression + ").click()");
}

async function input(selector, value) {
  await waitFor("Boolean(document.querySelector(" + json(selector) + "))");
  await evaluate(
    "(() => { const el = document.querySelector(" +
      json(selector) +
      "); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, " +
      json(value) +
      "); el.dispatchEvent(new Event('input', { bubbles: true })); })()",
  );
}

// Real key events through the browser, so focus, default actions and React handlers all run.
const keys = {
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  Escape: { code: "Escape", keyCode: 27 },
  Enter: { code: "Enter", keyCode: 13 },
  "/": { code: "Slash", keyCode: 191, text: "/" },
};

async function press(key) {
  const { code, keyCode, text } = keys[key];
  await cdp.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    text,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
  });
}

async function reload() {
  const previous = await evaluate("performance.timeOrigin");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("performance.timeOrigin !== " + previous, "New document after reload");
}

function fixture(directory, { sets, environments, base, plans = ["free", "premium"] }) {
  const configuration = {
    sets,
    tags: ["web", "mobile"],
    namespaceCharacter: "/",
    catalogBasePath: base,
    ...(environments ? { environments: ["staging", "production"] } : {}),
    catalogDirectoryPath: join(directory, "catalog"),
    setsDirectoryPath: join(directory, "sets"),
    ...Object.fromEntries(
      ["features", "variables", "segments", "attributes", "targets", "schemas", "tests"].map(
        (name) => [name + "DirectoryPath", join(directory, name)],
      ),
    ),
  };
  const mixedConditions = {
    and: [
      "audience/premium",
      { attribute: "plan", operator: "equals", value: "premium" },
      { feature: "mobileOnly", enabled: false },
      { variable: "checkout/policy", path: ["limit"], operator: "greaterThan", value: 0 },
      { feature: "mobileOnly", variable: "button.label", operator: "notNull" },
    ],
  };
  const rules = [
    {
      key: "everyone",
      conditions: mixedConditions,
      percentage: 100,
      enabled: true,
      variableOverrides: { "button.label": [{ conditions: mixedConditions, value: "Ready" }] },
    },
  ];
  const plan = "$" + "{{ plan }}";
  function source(set = "") {
    return {
      getExtension: () => "yml",
      listSets: async () => setKeys,
      forSet: source,
      listHistoryEntries: async () =>
        Array.from({ length: 55 }, (_, index) => ({
          commit: (set || "root") + "-" + String(index).padStart(6, "0"),
          author: "Catalog browser suite",
          subject: "Catalog change " + index,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 55 - index)).toISOString(),
          entities: [
            { type: "feature", key: featureKey },
            { type: "scenario", key: scenarioKey },
          ],
        })),
      listFeatures: async () => [featureKey, "mobileOnly"],
      readFeature: async (key) => ({
        key,
        description: "Feature in " + (set || "root"),
        tags: [key === featureKey ? "web" : "mobile"],
        bucketBy: "userId",
        variablesSchema: { "button.label": { type: "string", defaultValue: "Continue" } },
        ...(key === featureKey ? { conditions: "audience/eligible" } : {}),
        ...(key === featureKey
          ? {
              variations: [
                {
                  value: "on",
                  weight: 100,
                  variableOverrides: {
                    "button.label": [{ conditions: mixedConditions, value: "Ready" }],
                  },
                },
              ],
            }
          : {}),
        ...(key === featureKey
          ? {
              force: environments
                ? { staging: [{ conditions: mixedConditions, enabled: true }], production: [] }
                : [{ conditions: mixedConditions, enabled: true }],
            }
          : {}),
        rules: environments
          ? {
              staging:
                key === featureKey ? rules : [{ key: "all", conditions: "*", percentage: 100 }],
              production: [],
            }
          : key === featureKey
            ? rules
            : [{ key: "all", conditions: "*", percentage: 100 }],
      }),
      listSegments: async () => ["audience/premium", "audience/eligible"],
      readSegment: async (key) => ({
        key,
        conditions:
          key === "audience/eligible"
            ? mixedConditions
            : [{ attribute: "plan", operator: "equals", value: "premium" }],
      }),
      listAttributes: async () => ["plan"],
      readAttribute: async (key) => ({ key, type: "string" }),
      listVariables: async () => [
        "checkout/message",
        "checkout/policy",
        "checkout/baseView",
        "checkout/view",
        "checkout/alias.message",
        "checkout/alias.view",
        "checkout/alias.json",
        "checkout/alias.json.chain",
        "legacy",
      ],
      readVariable: async (key) =>
        key === "checkout/view"
          ? {
              key,
              description: "Composed screen",
              conditions: mixedConditions,
              disabledValue: {
                label: "Unavailable",
                policy: null,
                view: null,
                alias: null,
                featureLabel: null,
              },
              compose: {
                label: { variable: "checkout/message" },
                policy: { variable: "checkout/policy" },
                view: { variable: "checkout/baseView" },
                alias: { variable: "checkout/alias.view" },
                featureLabel: { feature: featureKey, variable: "button.label" },
              },
              overrides: environments
                ? {
                    staging: [
                      {
                        key: "regional",
                        conditions: mixedConditions,
                        continue: true,
                        mutate: { label: "Premium", "policy.limit": 90 },
                        overrides: [
                          { key: "refined", conditions: "*", mutate: { label: "Ready" } },
                        ],
                      },
                    ],
                    production: [],
                  }
                : [
                    {
                      key: "regional",
                      conditions: mixedConditions,
                      continue: true,
                      mutate: { label: "Premium", "policy.limit": 90 },
                      overrides: [{ key: "refined", conditions: "*", mutate: { label: "Ready" } }],
                    },
                  ],
            }
          : key === "checkout/baseView"
            ? {
                key,
                conditions: "audience/eligible",
                compose: { label: { variable: "checkout/message" } },
              }
            : key === "checkout/alias.message"
              ? {
                  key,
                  compose: "checkout/message",
                  overrides: [{ key: "regional", conditions: "audience/premium", value: null }],
                }
              : key === "checkout/alias.view"
                ? { key, compose: "checkout/baseView" }
                : key === "checkout/alias.json"
                  ? { key, compose: "legacy" }
                  : key === "checkout/alias.json.chain"
                    ? { key, compose: "checkout/alias.json" }
                    : key === "checkout/policy"
                      ? {
                          key,
                          type: "object",
                          defaultValue: { limit: 10 },
                          overrides: [{ key: "raised", conditions: "*", mutate: { limit: 90 } }],
                        }
                      : key === "legacy"
                        ? { key, type: "json", defaultValue: '"null"' }
                        : { key, type: "string", defaultValue: "Hello" },
      listTargets: async () => [],
      listSchemas: async () => [],
      listTests: async () => [specKey],
      readTest: async () => ({
        feature: featureKey,
        assertions: [
          {
            key: "enabled",
            matrix: { plan: ["free", "premium"] },
            context: { plan },
            expectedToBeEnabled: true,
            ...(environments ? { environment: "staging" } : {}),
          },
        ],
      }),
      listScenarios: async () => [scenarioKey],
      readScenario: async () => ({
        description: "Ready for " + plan,
        matrix: { plan: plans },
        context: { plan },
        ...(environments ? { environment: "staging" } : {}),
        checks: [
          { key: "cart", feature: featureKey, enabled: true },
          { key: "message", variable: "checkout/message", value: "Hello" },
        ],
        children: [{ checks: [{ key: "child-cart", feature: featureKey, enabled: true }] }],
      }),
    };
  }
  const datasource = source();
  const runtime = {
    getProjectSetExecutions: async () =>
      (sets ? setKeys : [""]).map((set) => ({
        set,
        projectConfig: configuration,
        datasource: source(set),
      })),
    getCatalogTargetMemberships: async () => ({}),
  };
  return { configuration, datasource, runtime };
}

async function exportQuietly(data, directory, options) {
  const log = console.log;
  try {
    console.log = () => {};
    return await exportCatalog(data.runtime, directory, data.configuration, data.datasource, {
      compactStorage: true,
      ...options,
    });
  } finally {
    console.log = log;
  }
}

async function listen(host) {
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  return host.address().port;
}

async function startServer(data, directory, hash, liveReload = false) {
  if (hash && !liveReload) {
    // A plain static host, deliberately without the SPA fallback supplied by serveCatalog.
    const host = http.createServer(async (request, response) => {
      const base = data.configuration.catalogBasePath;
      if (!request.url.startsWith(base)) {
        response.writeHead(404).end();
        return;
      }
      const resolution = await resolveCatalogRequestPath(
        data.configuration.catalogDirectoryPath,
        "/" + request.url.slice(base.length),
      );
      try {
        if (resolution.status !== "ok") throw new Error("Invalid path");
        const content = readFileSync(resolution.filePath);
        const mime = resolution.filePath.endsWith(".js")
          ? "text/javascript"
          : resolution.filePath.endsWith(".css")
            ? "text/css"
            : resolution.filePath.endsWith(".json")
              ? "application/json"
              : resolution.filePath.endsWith(".png")
                ? "image/png"
                : "text/html";
        response.writeHead(200, { "Content-Type": mime }).end(content);
      } catch {
        response.writeHead(404).end();
      }
    });
    const port = await listen(host);
    return {
      origin: "http://127.0.0.1:" + port,
      close: () =>
        new Promise((resolve) => {
          host.close(resolve);
          // The isolated browser may retain test connections after navigation.
          host.closeAllConnections();
        }),
    };
  }
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const handle = await serveCatalog(data.runtime, directory, data.configuration, data.datasource, {
    port,
    liveReload,
  });
  return { ...handle, origin: "http://127.0.0.1:" + port };
}

async function runCase({ base, hash, sets, environments }, index) {
  const label = [
    hash ? "hash/static" : "browser/server",
    base,
    sets ? "sets" : "root",
    environments ? "environments" : "flat rules",
  ].join(" ");
  const directory = join(temporary, "fixture-" + index);
  const data = fixture(directory, { base, sets, environments });
  await exportQuietly(data, directory, { browserRouter: !hash });
  server = await startServer(data, directory, hash);
  const errors = [];
  const requests = [];
  const unlisten = cdp.listen(({ method, params }) => {
    if (method === "Runtime.exceptionThrown") errors.push(params.exceptionDetails);
    if (method === "Network.responseReceived" && params.response.url.startsWith(server.origin)) {
      requests.push(params.response.url);
      if (params.response.status >= 400)
        errors.push({ status: params.response.status, url: params.response.url });
    }
  });
  const scope = sets ? "/sets/" + encode(setKeys[0]) : "";
  const entity = scope + "/features/" + encode(featureKey);
  const url = (route) => server.origin + base + (hash ? "#" + route : route.replace(/^\//, ""));
  const at = (route) => "location.href === " + json(url(route));
  const clickRoute = async (route) => {
    const link =
      "[...document.querySelectorAll('a')].find(el => el.href === " + json(url(route)) + ")";
    await waitFor("Boolean(" + link + ")", "Link to " + route);
    await evaluate("(" + link + ").click()");
  };
  const loadedEntity = "document.querySelector('h1')?.textContent === " + json(featureKey);
  const navigate = async (route, ready) => {
    const result = await cdp.send("Page.navigate", { url: url(route) });
    assert.equal(result.errorText, undefined);
    await waitFor(at(route));
    await waitFor(ready);
  };
  try {
    // A fresh direct deep link fetches the entry, lazy chunks and data from the mount.
    await navigate(entity, loadedEntity);
    assert.equal(await evaluate("document.querySelector('base') === null"), true);
    assert.equal(
      await evaluate("document.querySelector('meta[name=featurevisor-catalog-base]').content"),
      base,
    );
    await waitFor(
      "[...document.querySelectorAll('header img')].length >= 2 && [...document.querySelectorAll('header img')].every(img => img.complete && img.naturalWidth > 0)",
      "Catalog logos load",
    );
    await click("button[aria-label=" + json("Copy " + featureKey) + "]");
    await waitFor("document.body.innerText.includes('Entity key copied')");
    assert.equal(await evaluate("window.__copiedCatalogKey"), featureKey);

    await clickText("a", "Tests");
    await waitFor(at(entity + "/tests"));
    await waitFor("document.body.innerText.includes('2 matrix cases')");
    await click('a[aria-label^="Link to assertion "]');
    const permalink = await evaluate("location.href");
    assert.match(permalink, /assertion=/);
    await reload();
    await waitFor(
      "location.href === " +
        json(permalink) +
        ' && Boolean(document.querySelector(\'article[id^="assertion-"][aria-current="true"]\'))',
      "Assertion permalink survives reload",
    );
    await clickText("a", "Open complete scenario");
    const scenarioRoute = scope + "/tests/" + encode(scenarioKey);
    await waitFor(at(scenarioRoute));
    await waitFor(
      "document.querySelectorAll('a[aria-label^=\"Link to check \"]').length === 6",
      "Scenario expands matrix and child checks",
    );
    await evaluate(
      "[...document.querySelectorAll('a[aria-label^=\"Link to check \"]')].at(-1).click()",
    );
    const checkPermalink = await evaluate("location.href");
    assert.match(checkPermalink, /assertion=.*check/);
    await reload();
    await waitFor(
      "location.href === " +
        json(checkPermalink) +
        ' && Boolean(document.querySelector(\'li[id^="assertion-"][aria-current="true"]\'))',
      "Named matrix child check permalink survives reload",
    );

    await navigate(
      scope + "/features",
      "Boolean(document.querySelector('input[placeholder=\"Search features...\"]'))",
    );
    await input('input[placeholder="Search features..."]', "tag:web");
    await waitFor(
      "document.querySelector('input[placeholder=\"Search features...\"]').value === 'tag:web' && !document.querySelector('main').innerText.includes('mobileOnly')",
    );
    const filtered = await evaluate("location.href");
    assert.match(filtered, /q=tag/);
    await clickRoute(entity);
    await waitFor(loadedEntity);
    await evaluate("history.back()");
    await waitFor(
      "location.href === " +
        json(filtered) +
        " && document.querySelector('input')?.value === 'tag:web'",
      "Back retains filter",
    );
    await evaluate("history.forward()");
    await waitFor(loadedEntity);

    await clickText("a", "Rules");
    await waitFor("Boolean(document.querySelector('a[aria-label=\"Link to this rule\"]'))");
    assert.equal(await evaluate("document.body.innerText.includes('staging')"), environments);
    const beforeRule = await evaluate("location.href");
    await click('a[aria-label="Link to this rule"]');
    await waitFor(
      "location.href.startsWith(" + json(beforeRule + "#") + ")",
      "Rule fragment stays on the deep route",
    );
    await waitFor(loadedEntity);
    await reload();
    await waitFor(loadedEntity);

    await navigate(entity + "/history", "document.body.innerText.includes('Catalog change 0')");
    await clickText("button", "Load older commits");
    await waitFor("document.body.innerText.includes('Catalog change 54')");
    await navigate(
      scope + "/tests",
      "Boolean(document.querySelector('input[placeholder=\"Search tests...\"]'))",
    );
    await clickText("button", "Scenarios");
    await waitFor(
      "document.querySelector('input[placeholder=\"Search tests...\"]').value.includes('kind:scenario') && !document.querySelector('main').innerText.includes(" +
        json(specKey) +
        ")",
    );
    await clickRoute(scenarioRoute);
    await waitFor(at(scenarioRoute));

    const composedRoute = scope + "/variables/" + encode("checkout/view");
    const checkMutationSpacing = async (path) => {
      const measurements = await evaluate(`(() => {
        return [...document.querySelectorAll('[data-mutation-value]')].map(value => {
          const path = value.previousElementSibling;
          const p = path.getBoundingClientRect();
          const v = (value.firstElementChild || value).getBoundingClientRect();
          return { path: path.textContent, value: value.textContent,
            horizontalGap: v.left - p.right, verticalGap: v.top - p.bottom };
        });
      })()`);
      assert.ok(measurements.some((entry) => entry.path === path && entry.value === "90"));
      for (const entry of measurements) {
        assert.ok(
          entry.verticalGap >= -0.5 || entry.horizontalGap >= 4,
          "Mutation path/value must be on separate lines or at least 4px apart: " + json(entry),
        );
      }
    };
    const checkPageFits = async () => {
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
        true,
        "Changed Catalog page fits the viewport",
      );
    };
    for (const width of [1280, 402]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const segmentRoute = scope + "/segments/" + encode("audience/eligible");
      const referencedFeature = scope + "/features/mobileOnly";
      const policyRoute = scope + "/variables/" + encode("checkout/policy");
      const assertConditionLinks = async () => {
        for (const route of [
          scope + "/segments/" + encode("audience/premium"),
          referencedFeature,
          referencedFeature + "/variables#button-label",
          policyRoute,
          scope + "/attributes/plan",
        ]) {
          assert.equal(
            await evaluate(
              "[...document.querySelectorAll('main a')].some(a => a.href === " +
                json(url(route)) +
                ")",
            ),
            true,
            "Unified condition reference links to " + route,
          );
        }
        // Outline chips move to their own line before wrapping, so only a key wider than the row breaks.
        assert.deepEqual(
          await evaluate(
            "[...document.querySelectorAll('main ol a')].filter(a => a.getBoundingClientRect().height > 24 && a.getBoundingClientRect().width < a.closest('div').getBoundingClientRect().width - 1).map(a => a.textContent)",
          ),
          [],
          "Condition chips are never squeezed narrower than their row",
        );
        await checkPageFits();
      };
      await navigate(entity, loadedEntity);
      await waitFor("document.querySelector('main')?.textContent.includes('Root conditions')");
      // A segment opens in place, so a chain of segments reads as one expression.
      await click('button[aria-label="Show conditions of segment audience/eligible"]');
      await waitFor(
        "[...document.querySelectorAll('main .border-dashed a')].some(a => a.href === " +
          json(url(scope + "/segments/" + encode("audience/premium"))) +
          ")",
        "Expanded segment shows the segment it uses",
      );
      await checkPageFits();
      await click('button[aria-label="Hide conditions of segment audience/eligible"]');
      await waitFor("!document.querySelector('main .border-dashed')");
      await clickRoute(segmentRoute);
      await waitFor(at(segmentRoute));
      await waitFor("document.querySelector('h1')?.textContent === 'audience/eligible'");
      await assertConditionLinks();
      await clickRoute(referencedFeature + "/variables#button-label");
      await waitFor("Boolean(document.querySelector('section#button-label'))");
      await reload();
      await waitFor("Boolean(document.querySelector('section#button-label'))");
      for (const tab of ["rules", "force"]) {
        await navigate(entity + "/" + tab + (environments ? "/staging" : ""), loadedEntity);
        await waitFor("document.querySelector('main')?.textContent.includes('Conditions')");
        await assertConditionLinks();
      }
      await navigate(entity + "/variations", loadedEntity);
      await waitFor("document.querySelector('main')?.textContent.includes('Conditions')");
      await assertConditionLinks();
      await navigate(
        scope + "/segments/" + encode("audience/premium") + "/usage",
        // "Used by" groups its direct users by type.
        "[...document.querySelectorAll('main h3')].some(h => h.firstChild?.textContent === 'Segments')",
      );
      const assertUsageTarget = async (route, label) => {
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('main li li a')].some(a => a.href === " +
              json(url(route)) +
              " && a.textContent === " +
              json(label) +
              ")",
          ),
          true,
          "Reverse condition usage targets " + route,
        );
      };
      // Everything in a segment is its conditions, so a segment user links by its key alone.
      const assertOwnerLink = async (route) => {
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('main li > div > a')].some(a => a.href === " +
              json(url(route)) +
              ")",
          ),
          true,
          "Usage links the owner " + route,
        );
      };
      await assertOwnerLink(segmentRoute);
      // Entities reaching it only through others name the chain between them.
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('main h3')].some(h => h.firstChild?.textContent === 'Through other entities') && [...document.querySelectorAll('main li a')].some(a => a.href === " +
            json(url(scope + "/variables/" + encode("checkout/baseView"))) +
            " && a.closest('span')?.textContent.startsWith('through'))",
        ),
        true,
        "Indirect usage shows the chain through checkout/baseView",
      );
      await checkPageFits();
      for (const route of [referencedFeature, policyRoute]) {
        await navigate(
          route + "/usage",
          "[...document.querySelectorAll('main h3')].some(h => h.firstChild?.textContent === 'Segments')",
        );
        await assertOwnerLink(segmentRoute);
        await assertUsageTarget(composedRoute, "conditions");
        const environment = environments ? "/staging" : "";
        const anchorEnvironment = environments ? "staging-" : "";
        await assertUsageTarget(
          entity + "/rules" + environment + "#rules-" + anchorEnvironment + "everyone",
          "rules" + (environments ? " › staging" : "") + " › everyone",
        );
        await assertUsageTarget(
          entity + "/force" + environment + "#force-" + anchorEnvironment + "1",
          "force" + (environments ? " › staging" : "") + " › entry 1",
        );
        await assertUsageTarget(
          entity + "/variations#on-overrides-button-label",
          "variation on › variable button.label › override 1",
        );
        await checkPageFits();
      }
      await navigate(
        scope + "/variables",
        "Boolean(document.querySelector('input[placeholder=\"Search variables...\"]'))",
      );
      const chips = await evaluate(
        "[...document.querySelectorAll('button')].map(button => button.textContent)",
      );
      assert.ok(chips.indexOf("json") < chips.indexOf("object"));
      assert.ok(chips.indexOf("object") < chips.indexOf("Composed"));
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('a')].find(a => a.href === " +
            json(url(composedRoute)) +
            ")?.textContent.includes('composed')",
        ),
        true,
      );
      await clickText("button", "Composed");
      await waitFor(
        "document.querySelector('input[placeholder=\"Search variables...\"]').value.includes('with:composition') && !document.querySelector('main').innerText.includes('checkout/policy')",
      );
      assert.equal(
        await evaluate("document.querySelector('main').innerText.includes('6 of 9 variables')"),
        true,
      );
      await checkPageFits();
      await clickText("button", "json");
      await waitFor("document.querySelector('main').innerText.includes('2 of 9 variables')");
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('main code')].filter(code => code.textContent === 'json, decoded').length",
        ),
        2,
      );
      await checkPageFits();
      for (const [key, source, type] of [
        ["checkout/alias.message", "checkout/message", "string"],
        ["checkout/alias.view", "checkout/baseView", "object"],
        ["checkout/alias.json", "legacy", "json, decoded"],
        ["checkout/alias.json.chain", "checkout/alias.json", "json, decoded"],
      ]) {
        const aliasRoute = scope + "/variables/" + encode(key);
        const sourceRoute = scope + "/variables/" + encode(source);
        await navigate(aliasRoute, "document.querySelector('h1')?.textContent === " + json(key));
        await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Alias')");
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('main span')].some(s => s.textContent === " +
              json(type) +
              ")",
          ),
          true,
        );
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('main span')].some(s => s.textContent === 'composed')",
          ),
          true,
        );
        assert.equal(
          await evaluate(
            "Boolean(document.querySelector('tbody')) || document.querySelector('main').innerText.includes('Default value')",
          ),
          false,
        );
        if (type === "json, decoded") {
          assert.equal(
            await evaluate(
              "document.querySelector('main').innerText.includes('The alias receives the evaluated, decoded JSON value, which may be an object, array, scalar or null.')",
            ),
            true,
          );
          assert.equal(
            await evaluate("document.querySelector('main').innerText.includes('Structure')"),
            false,
          );
        }
        await checkPageFits();
        await clickRoute(sourceRoute);
        await waitFor(at(sourceRoute));
        await navigate(
          sourceRoute + "/usage",
          "[...document.querySelectorAll('main h3')].some(h => h.firstChild?.textContent === 'Variables')",
        );
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('main li')].some(li => li.querySelector(':scope > div > a')?.href === " +
              json(url(aliasRoute)) +
              " && [...li.querySelectorAll('li a')].some(a => a.textContent === " +
              // The page is the source, so the alias needs no repeat of its key.
              json("alias") +
              " && a.href === " +
              json(url(aliasRoute)) +
              "))",
          ),
          true,
          "Usage shows the alias owner followed by its source",
        );
        await checkPageFits();
        await navigate(
          aliasRoute + "/overrides",
          "document.querySelector('h1')?.textContent === " + json(key),
        );
        await waitFor(
          "document.body.innerText.includes(" +
            json(
              key === "checkout/alias.message"
                ? "The source variable is evaluated first."
                : "Everyone gets the source variable value, including null.",
            ) +
            ")",
        );
        assert.equal(
          await evaluate(
            "/default value|assembled object|Accumulating value preview/i.test(document.querySelector('main').innerText)",
          ),
          false,
        );
        await checkPageFits();
        const aliasOverridesURL = await evaluate("location.href");
        await reload();
        await waitFor("location.href === " + json(aliasOverridesURL));
      }
      await navigate(
        composedRoute,
        "document.querySelector('h1')?.textContent === 'checkout/view'",
      );
      await waitFor(
        "document.querySelector('main').innerText.includes('Checked before composition sources and overrides.')",
      );
      assert.equal(
        await evaluate("document.querySelector('main').innerText.includes('Unavailable')"),
        true,
      );
      assert.equal(
        await evaluate("document.querySelector('main').innerText.includes('Default value')"),
        false,
      );
      await assertConditionLinks();
      await waitFor(
        "document.body.textContent.includes('Each property starts with its source value. Overrides then run in order and can change it.')",
        "Composition caption describes overrides",
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('main span')].some(span => span.textContent === 'composed')",
        ),
        true,
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('tbody tr')].find(row => row.cells[0]?.textContent === 'view')?.cells[1].textContent",
        ),
        "Composed variable",
      );
      assert.equal(await evaluate("document.querySelector('thead th')?.textContent"), "Property");
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('tbody tr')].find(row => row.cells[0]?.textContent === 'alias')?.cells[1].textContent",
        ),
        "Composed variable",
        "A map property can read a string alias source",
      );
      await checkPageFits();
      await evaluate("document.activeElement?.blur()");
      await press("/");
      await waitFor("Boolean(document.querySelector('[role=dialog] input'))");
      await cdp.send("Input.insertText", { text: "featureLabel" });
      await waitFor(
        "[...document.querySelectorAll('[role=option]')].some(option => option.textContent.includes('Property: featureLabel'))",
        "Map search matches are labelled Property",
      );
      await checkPageFits();
      await press("Escape");
      await waitFor("!document.querySelector('[role=dialog]')");
      const sourceRoute = entity + "/variables#button-label";
      await clickRoute(sourceRoute);
      await waitFor(at(sourceRoute));
      await waitFor("Boolean(document.querySelector('section#button-label'))");
      await checkPageFits();
      await reload();
      await waitFor("Boolean(document.querySelector('section#button-label'))");
      await waitFor(at(sourceRoute));
      await navigate(
        scope + "/variables/" + encode("checkout/alias.view") + "/usage",
        "document.body.innerText.includes('property alias')",
      );
      assert.equal(
        await evaluate("document.querySelector('main').innerText.includes('compose alias')"),
        false,
      );
      await checkPageFits();
      await navigate(
        scope + "/variables/" + encode("checkout/baseView"),
        "document.querySelector('h1')?.textContent === 'checkout/baseView'",
      );
      await waitFor(
        "document.body.textContent.includes('Each property contains its source value.')",
        "Composition caption without overrides",
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('main code')].some(code => code.textContent === 'null')",
        ),
        true,
        "A composition without disabledValue displays its null gate fallback",
      );
      await checkPageFits();
      await navigate(
        scope + "/variables/" + encode("checkout/policy") + "/overrides",
        "Boolean(document.querySelector('[data-mutation-value]'))",
      );
      await checkMutationSpacing("limit");
      await checkPageFits();
      await navigate(
        composedRoute,
        "document.querySelector('h1')?.textContent === 'checkout/view'",
      );
      await clickText("a", "Overrides");
      await waitFor(
        "document.body.innerText.includes('All composition sources are evaluated first.')",
      );
      assert.equal(
        await evaluate("document.body.innerText.includes('Accumulating value preview')"),
        false,
      );
      await waitFor(
        "document.querySelectorAll('a[aria-label=\"Link to this override\"]').length === 2",
      );
      await checkMutationSpacing("policy.limit");
      await assertConditionLinks();
      await checkPageFits();
      const expectedComposedPermalink = await evaluate(
        "document.querySelector('a[aria-label=\"Link to this override\"]').href",
      );
      await click('a[aria-label="Link to this override"]');
      await waitFor("location.href === " + json(expectedComposedPermalink));
      const composedPermalink = await evaluate("location.href");
      assert.ok(new URL(composedPermalink).hash.length > 1);
      await reload();
      await waitFor(
        "location.href === " +
          json(composedPermalink) +
          " && document.body.innerText.includes('All composition sources are evaluated first.')",
      );
    }
    await cdp.send("Emulation.clearDeviceMetricsOverride");

    if (sets) {
      await navigate(entity, loadedEntity);
      await evaluate(
        "(() => { const select = document.querySelector('select[aria-label=\"Switch catalog set\"]'); select.value = " +
          json(setKeys[1]) +
          "; select.dispatchEvent(new Event('change', { bubbles: true })); })()",
      );
      await waitFor(at("/sets/" + encode(setKeys[1]) + "/features/" + encode(featureKey)));
      await waitFor("document.body.innerText.includes(" + json("Feature in " + setKeys[1]) + ")");
    }
    assert.equal(
      requests.some((request) => request.includes("/data/blocks/")),
      true,
    );
    assert.equal(
      requests.some((request) => request.includes("/assets/EntityDetailPage")),
      true,
    );
    assert.equal(
      requests.every((request) => new URL(request).pathname.startsWith(base)),
      true,
    );
    assert.deepEqual(errors, [], "Browser errors in " + label);
    console.log("PASS " + label);
  } finally {
    unlisten();
    await cdp.send("Page.navigate", { url: "about:blank" });
    await server.close();
    server = undefined;
  }
}

async function runLiveReload(hash) {
  const directory = join(temporary, "live-" + hash);
  const base = "/before/catalog/";
  const data = fixture(directory, { base, sets: false, environments: false });
  await exportQuietly(data, directory, { browserRouter: !hash });
  server = await startServer(data, directory, hash, true);
  const sources = [];
  const unlisten = cdp.listen(({ method, params }) => {
    if (method === "Network.responseReceived" && params.type === "EventSource") {
      sources.push(params.response.url);
    }
  });
  try {
    const route = "/features/" + encode(featureKey) + "/tests?assertion=unknown";
    const suffix = hash ? "#" + route : route.slice(1) + "#main-content";
    await cdp.send("Page.navigate", { url: server.origin + base + suffix });
    await waitFor("document.body.innerText.includes('2 matrix cases')");
    await until(
      () => sources.includes(server.origin + base + "__featurevisor_catalog_reload"),
      "Original live reload connection",
    );
    data.configuration.catalogBasePath = "/after/catalog/";
    await exportQuietly(data, directory, {
      browserRouter: !hash,
      copyAssets: false,
      preserveAssets: true,
    });
    server.setBasePath(data.configuration.catalogBasePath);
    server.triggerReload();
    await waitFor(
      "location.href === " + json(server.origin + data.configuration.catalogBasePath + suffix),
      "Live prefix migration retains route, query and fragment",
    );
    await waitFor(
      "document.querySelector('meta[name=featurevisor-catalog-base]')?.content === '/after/catalog/' && document.body.innerText.includes('2 matrix cases')",
    );
    await until(
      () => sources.includes(server.origin + "/after/catalog/__featurevisor_catalog_reload"),
      "New live reload connection",
    );
    const oldMount = await fetch(server.origin + base + "data/manifest.json");
    assert.equal(oldMount.status, 404);
    const generation = await evaluate("performance.timeOrigin");
    server.triggerReload();
    await waitFor(
      "performance.timeOrigin !== " +
        generation +
        " && document.body.innerText.includes('2 matrix cases')",
      "Unchanged prefix reloads the page",
    );
    console.log("PASS live prefix migration and reload " + (hash ? "hash" : "browser"));
  } finally {
    unlisten();
    await cdp.send("Page.navigate", { url: "about:blank" });
    await server.close();
    server = undefined;
  }
}

/** Keyboard, focus and collapsed permalink behaviour, which static rendering cannot cover. */
async function runInteractions() {
  const directory = join(temporary, "interactions");
  mkdirSync(directory, { recursive: true });
  // A GitHub remote gives every entity source links. The branch is explicit, as in CI.
  spawnSync("git", ["init", "-q", directory]);
  spawnSync("git", [
    "-C",
    directory,
    "remote",
    "add",
    "origin",
    "https://github.com/acme/flags.git",
  ]);
  const data = fixture(directory, {
    base: "/",
    sets: false,
    environments: false,
    plans: ["free", "basic", "premium", "enterprise"],
  });
  await exportQuietly(data, directory, { browserRouter: true, branch: "main" });
  server = await startServer(data, directory, false);
  const errors = [];
  const unlisten = cdp.listen(({ method, params }) => {
    if (method === "Runtime.exceptionThrown") errors.push(params.exceptionDetails);
  });
  const caseButton = (position) =>
    "[...document.querySelectorAll('h3 button[aria-expanded]')][" + position + "]";
  const active = "document.activeElement";
  const caret = "document.querySelector('button[aria-label=\"More ways to open this file\"]')";
  try {
    // A collapsed case opens when a newly followed permalink points inside it.
    const scenarioRoute = "/tests/" + encode(scenarioKey);
    await cdp.send("Page.navigate", { url: server.origin + scenarioRoute });
    await waitFor(
      "document.querySelectorAll('h3 button[aria-expanded=\"false\"]').length === 4",
      "Four matrix cases start collapsed",
    );
    await evaluate(caseButton(1) + ".click()");
    await waitFor(caseButton(1) + ".getAttribute('aria-expanded') === 'true'");
    await evaluate(caseButton(1) + ".click()");
    await waitFor(caseButton(1) + ".getAttribute('aria-expanded') === 'false'");
    const checkLink =
      "[...document.querySelectorAll('a')].find(a => a.textContent.startsWith('Case 1.2 ·'))";
    await waitFor("Boolean(" + checkLink + ")", "Check link into the collapsed case");
    await evaluate("(" + checkLink + ").click()");
    await waitFor(
      caseButton(1) + ".getAttribute('aria-expanded') === 'true'",
      "Following the permalink reopens its case",
    );
    await waitFor(
      '(() => { const target = document.querySelector(\'li[id^="assertion-"][aria-current="true"]\'); if (!target) return false; const box = target.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })()',
      "The selected check is rendered and scrolled into view",
    );

    // The source link menu: arrows open it and move focus, Escape returns focus, and an
    // outside click closes it. Paths are encoded.
    await cdp.send("Page.navigate", {
      url: server.origin + "/features/" + encode(featureKey),
    });
    await waitFor("document.querySelector('h1')?.textContent === " + json(featureKey));
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('a')].find(a => a.textContent === 'View on GitHub')?.href",
      ),
      "https://github.com/acme/flags/blob/main/features/checkout/cart%20100%25%20%CE%B2.yml",
    );
    await evaluate(caret + ".focus()");
    await press("ArrowDown");
    await waitFor(
      active +
        ".getAttribute('role') === 'menuitem' && " +
        active +
        ".textContent === 'Propose change'",
      "ArrowDown opens the menu on its first item",
    );
    assert.match(await evaluate(active + ".title"), /on main, where you can propose/);
    await press("ArrowDown");
    await waitFor(active + ".textContent === 'Propose change'", "Arrow keys wrap within the menu");
    await press("Escape");
    await waitFor(
      "!document.querySelector('[role=menu]') && " + active + " === " + caret,
      "Escape closes the menu and returns focus to its button",
    );
    await evaluate(caret + ".click()");
    await waitFor("Boolean(document.querySelector('[role=menu]'))");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 5,
      y: 400,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 5,
      y: 400,
      button: "left",
      clickCount: 1,
    });
    await waitFor("!document.querySelector('[role=menu]')", "An outside click closes the menu");

    // Search: stored recents with unknown types are ignored, the active option is announced,
    // and Escape returns focus to where it was.
    await evaluate(
      "localStorage.setItem('featurevisor-catalog:recent:/', " +
        json(
          json([
            { type: "group", key: "removed" },
            { type: "toString", key: "inherited" },
            { type: "feature", key: featureKey },
          ]),
        ) +
        ")",
    );
    await evaluate(caret + ".focus()");
    await press("/");
    const searchInput = "document.querySelector('[role=dialog] input')";
    await waitFor(active + " === " + searchInput, "Slash opens search with the input focused");
    await waitFor(
      "document.querySelector('[role=dialog]').textContent.includes('Recently viewed') && document.querySelectorAll('[role=option]').length === 1",
      "Only the valid recent entry is listed",
    );
    await cdp.send("Input.insertText", { text: "cart" });
    await waitFor(
      "document.querySelectorAll('[role=option]').length >= 2 && " +
        searchInput +
        ".getAttribute('aria-activedescendant') === 'catalog-search-option-0'",
      "Results announce the first active option",
    );
    await waitFor(
      "/result/.test(document.querySelector('[role=dialog] [role=status]').textContent)",
    );
    await press("ArrowDown");
    await waitFor(
      searchInput +
        ".getAttribute('aria-activedescendant') === 'catalog-search-option-1' && document.getElementById('catalog-search-option-1').getAttribute('aria-selected') === 'true'",
      "ArrowDown moves the active option",
    );
    await press("Escape");
    await waitFor(
      "!document.querySelector('[role=dialog]') && " + active + " === " + caret,
      "Escape closes search and restores focus",
    );
    assert.deepEqual(errors, [], "Browser errors during interactions");
    console.log("PASS keyboard, focus and collapsed permalink interactions");
  } finally {
    unlisten();
    await cdp.send("Page.navigate", { url: "about:blank" });
    await server.close();
    server = undefined;
  }
}

async function main() {
  try {
    const browser = [
      process.env.FEATUREVISOR_BROWSER_BIN,
      process.env.CHROME_BIN,
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
      .filter(Boolean)
      .find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
    assert.ok(browser, "No Chrome or Chromium found. Set FEATUREVISOR_BROWSER_BIN.");
    const profile = join(temporary, "browser-profile");
    chrome = spawn(
      browser,
      [
        "--headless=new",
        "--user-data-dir=" + profile,
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    chrome.stderr.on("data", (chunk) => {
      browserLog = (browserLog + chunk).slice(-16000);
    });
    const portFile = join(profile, "DevToolsActivePort");
    await until(() => {
      if (chrome.exitCode !== null || chrome.signalCode !== null)
        throw new Error("Chrome exited: " + browserLog);
      return existsSync(portFile);
    }, "Chrome debug endpoint");
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const tabs = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    cdp = await connect(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    // Capture the browser API boundary without touching the user's operating system clipboard.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copiedCatalogKey = value; } } });",
    });
    let count = 0;
    for (const base of ["/", "/internal/catalog/"]) {
      for (const hash of [false, true]) {
        for (const shape of [
          { sets: false, environments: false },
          { sets: true, environments: false },
          { sets: true, environments: true },
        ]) {
          await runCase({ base, hash, ...shape }, ++count);
        }
      }
    }
    await runLiveReload(false);
    await runLiveReload(true);
    await runInteractions();
    console.log(
      "Catalog isolated Chrome suite passed: " +
        count +
        " deployment/project combinations, live reload in both routers, and keyboard interactions.",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, "exit");
      chrome.kill("SIGTERM");
      const timeout = setTimeout(() => chrome.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
    await server?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
