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
    schemaVersion: "2",
    revision: "browser",
    segments: {},
    features: {
      smoke: {
        key: "smoke",
        bucketBy: "userId",
        traffic: [{ key: "all", segments: "*", percentage: 100000, enabled: true }],
      },
    },
  },
});
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor });
document.body.dataset.result =
  featurevisor.isEnabled("smoke", { userId: "browser" }) &&
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
