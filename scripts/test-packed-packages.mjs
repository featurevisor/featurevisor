/* global process */

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "featurevisor-packages-"));
const packageDirectories = [
  "types",
  "sdk",
  "react",
  "vue",
  "catalog",
  "parsers",
  "core",
  "cli",
  "openfeature-provider-core",
  "openfeature-provider-node",
  "openfeature-provider-web",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      npm_config_cache: join(temporaryDirectory, "npm-cache"),
    },
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.stderr ? `\n${result.stderr}` : ""}`,
    );
  }

  return result.stdout || "";
}

try {
  const tarballs = [];

  for (const directory of packageDirectories) {
    const packageDirectory = join(rootDirectory, "packages", directory);
    const output = run(
      "npm",
      ["pack", "--json", "--pack-destination", temporaryDirectory],
      { cwd: packageDirectory, capture: true },
    );
    const [{ filename }] = JSON.parse(output);
    const tarball = join(temporaryDirectory, filename);
    tarballs.push(tarball);

    const entries = run("tar", ["-tf", tarball], { capture: true }).trim().split("\n");
    const forbidden = entries.filter(
      (entry) =>
        /\.spec\.[cm]?[jt]sx?(?:\.map)?$/.test(entry) ||
        entry.includes("instance.test-fixtures") ||
        (["core", "parsers", "catalog"].includes(directory) && entry.startsWith("package/src/")),
    );
    if (forbidden.length > 0) {
      throw new Error(
        `@featurevisor/${directory} contains non-runtime files:\n${forbidden.join("\n")}`,
      );
    }
  }

  const consumerDirectory = join(temporaryDirectory, "consumer");
  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      ...tarballs,
    ],
    { cwd: consumerDirectory },
  );

  writeFileSync(
    join(consumerDirectory, "consumer.cjs"),
    `
const sdk = require("@featurevisor/sdk");
const react = require("@featurevisor/react");
const vue = require("@featurevisor/vue");
const core = require("@featurevisor/core");
const nodeProvider = require("@featurevisor/openfeature-provider-node");

for (const [name, value] of Object.entries({
  createFeaturevisor: sdk.createFeaturevisor,
  FeaturevisorProvider: react.FeaturevisorProvider,
  setupApp: vue.setupApp,
  buildDatafile: core.buildDatafile,
  FeaturevisorOpenFeatureProvider: nodeProvider.FeaturevisorOpenFeatureProvider,
})) {
  if (typeof value !== "function") throw new Error(name + " is not callable");
}
`,
  );
  run(process.execPath, ["consumer.cjs"], { cwd: consumerDirectory });

  writeFileSync(
    join(consumerDirectory, "consumer.mjs"),
    `
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorProvider } from "@featurevisor/react";
import { setupApp } from "@featurevisor/vue";
import { FeaturevisorOpenFeatureProvider } from "@featurevisor/openfeature-provider-web";

for (const [name, value] of Object.entries({
  createFeaturevisor,
  FeaturevisorProvider,
  setupApp,
  FeaturevisorOpenFeatureProvider,
})) {
  if (typeof value !== "function") throw new Error(name + " is not callable");
}
`,
  );
  run(process.execPath, ["consumer.mjs"], { cwd: consumerDirectory });

  writeFileSync(
    join(consumerDirectory, "consumer.ts"),
    `
import {
  createFeaturevisor,
  type Featurevisor,
  type FeaturevisorOptions,
} from "@featurevisor/sdk";
import { FeaturevisorProvider } from "@featurevisor/react";
import { setupApp } from "@featurevisor/vue";
import { FeaturevisorOpenFeatureProvider } from "@featurevisor/openfeature-provider-web";

const options: FeaturevisorOptions = {};
const featurevisor: Featurevisor = createFeaturevisor(options);
void FeaturevisorProvider;
void setupApp;
void new FeaturevisorOpenFeatureProvider({ featurevisor });
`,
  );
  run(
    join(rootDirectory, "node_modules", ".bin", "tsc"),
    [
      "--strict",
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ES2020",
      "--module",
      "Node16",
      "--moduleResolution",
      "Node16",
      "consumer.ts",
    ],
    { cwd: consumerDirectory },
  );

  console.log(
    `Packed package contents and clean CommonJS, ESM, and TypeScript consumers are valid for ${tarballs
      .map((tarball) => basename(tarball))
      .join(", ")}.`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
