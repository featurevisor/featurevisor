/* global process */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "featurevisor-browser-"));
const browserCandidates = [
  process.env.FEATUREVISOR_BROWSER_BIN,
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || ""}`);
  }
  return result.stdout || "";
}

try {
  const entryPath = join(temporaryDirectory, "entry.js");
  const bundlePath = join(temporaryDirectory, "bundle.js");
  const htmlPath = join(temporaryDirectory, "index.html");

  writeFileSync(
    entryPath,
    `
import { createFeaturevisor } from ${JSON.stringify(
      join(rootDirectory, "packages/sdk/esm/index.js"),
    )};
import { FeaturevisorOpenFeatureProvider } from ${JSON.stringify(
      join(rootDirectory, "packages/openfeature-provider-web/esm/index.js"),
    )};

const featurevisor = createFeaturevisor({
  logLevel: "fatal",
  datafile: {
    schemaVersion: "4",
    revision: "browser",
    segments: {},
    features: {
      portableDate: {
        bucketBy: "userId",
        force: [{ conditions: { attribute: "date", operator: "before", value: "2024-03-01T00:00:00Z" }, enabled: true }],
      },
      smoke: {
        key: "smoke",
        bucketBy: "userId",
        conditions: [{ variable: "policy", path: [0, "enabled"], operator: "equals", value: true }],
        traffic: [{ key: "all", conditions: "*", percentage: 100000, enabled: true }],
      },
    },
    variables: {
      view: {
        type: "object",
        compose: [{ key: "enabled", feature: "smoke" }, { key: "methods", variable: "methods" }],
      },
      patchedView: {
        type: "object",
        compose: [{ key: "enabled", feature: "smoke" }, { key: "methods", variable: "methods" }],
        overrideProgram: [{ key: "add", keyPath: ["add"], segments: "*", onMatch: 1, onMiss: 1,
          operations: [{ op: "appendUnique", path: ["methods"], value: "cash" }] }],
      },
      literalView: {
        type: "object", compose: [{ key: "enabled", feature: "smoke" }],
        overrideProgram: [{ key: "literal", keyPath: ["literal"], segments: "*", onMatch: 1, onMiss: 1,
          operations: [{ op: "set", path: [], value: { enabled: false } }] }],
      },
      methods: {
        type: "array",
        defaultValue: ["card", "paypal", "paypal"],
        overrideProgram: [
          { key: "methods", keyPath: ["methods"], segments: "*", onMatch: 1, onMiss: 1,
            operations: [
              { op: "appendUnique", path: [], value: "card" },
              { op: "appendUnique", path: [], value: "ideal" },
              { op: "removeValue", path: [], value: "paypal" },
            ] },
        ],
      },
      policy: {
        type: "array",
        defaultValue: [],
        overrideProgram: [
          { key: "add", keyPath: ["add"], segments: "*", onMatch: 1, onMiss: 1,
            operations: [{ op: "append", path: [], value: { id: "item", enabled: false } }] },
          { key: "update", keyPath: ["update"], segments: "*", onMatch: 2, onMiss: 2,
            operations: [{ op: "set", path: [{ select: { property: "id", values: ["item"] } }, "enabled"], value: true }] },
        ],
      },
    },
  },
});
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor });
const specialContext = JSON.parse('{"__proto__":{"injected":true}}');
featurevisor.setContext(specialContext);
const child = featurevisor.spawn(specialContext);
child.setContext(specialContext);
const safeContext = child.getContext({});
document.body.dataset.result =
  Object.getPrototypeOf(safeContext) === Object.prototype &&
  Object.prototype.hasOwnProperty.call(safeContext, "__proto__") &&
  safeContext.injected === undefined &&
  featurevisor.isEnabled("smoke", { userId: "browser" }) &&
  featurevisor.isEnabled("portableDate", { date: "2024-02-29T23:59:59.999Z" }) &&
  !featurevisor.isEnabled("portableDate", { date: "2024-02-30T00:00:00Z" }) &&
  JSON.stringify(featurevisor.getVariable("policy")) === '[{"id":"item","enabled":true}]' &&
  JSON.stringify(featurevisor.getVariable("methods")) === '["card","ideal"]' &&
  JSON.stringify(featurevisor.getVariable("view")) === '{"enabled":true,"methods":["card","ideal"]}' &&
  Object.getPrototypeOf(featurevisor.getVariable("view")) === Object.prototype &&
  JSON.stringify(featurevisor.getVariable("patchedView")) === '{"enabled":true,"methods":["card","ideal","cash"]}' &&
  featurevisor.getVariable("literalView").enabled === false &&
  featurevisor.getVariable("literalView") !== featurevisor.getVariable("literalView") &&
  JSON.stringify(featurevisor.getVariable("methods")) === '["card","ideal"]' &&
  featurevisor.isEnabled("smoke", { userId: "browser-again" }) &&
  provider.featurevisor === featurevisor
    ? "passed"
    : "failed";
`,
  );

  run(join(rootDirectory, "node_modules", ".bin", "esbuild"), [
    entryPath,
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=chrome80",
    `--outfile=${bundlePath}`,
  ]);
  writeFileSync(
    htmlPath,
    `<!doctype html><html><body><script src="./bundle.js"></script></body></html>`,
  );

  const browser = browserCandidates.find((candidate) => {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  });
  if (!browser) {
    throw new Error(
      "No Chrome or Chromium executable found. Set FEATUREVISOR_BROWSER_BIN to run the browser smoke test.",
    );
  }

  const html = run(
    browser,
    [
      "--headless=new",
      `--user-data-dir=${join(temporaryDirectory, "browser-profile")}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-extensions",
      "--no-first-run",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ],
    { timeout: 30000 },
  );
  if (!html.includes('data-result="passed"')) {
    throw new Error(`Browser smoke test did not pass:\n${html}`);
  }

  console.log("Browser SDK and OpenFeature provider smoke test passed.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
