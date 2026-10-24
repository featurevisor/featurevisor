/* global process */

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "featurevisor-vue-minimum-"));

function run(command, args, cwd = temporary, timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      NODE_PATH: "",
      npm_config_cache: join(temporary, "npm-cache"),
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}\n${result.stdout || ""}${result.stderr || ""}`,
    );
  }
  return result.stdout;
}

function npm(args, cwd, timeout) {
  return process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args], cwd, timeout)
    : run("npm", args, cwd, timeout);
}

try {
  // Consume existing output only. Building here could disrupt another consumer.
  const tarballs = ["types", "sdk", "vue"].map((name) => {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    if (!existsSync(join(directory, manifest.main))) {
      throw new Error(`Build @featurevisor/${name} before running this smoke test`);
    }
    const [{ filename }] = JSON.parse(
      npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], directory),
    );
    return join(temporary, filename);
  });
  writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true }));
  console.log("Installing isolated Vue 3.0.0 consumer (two minute limit)...");
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--fetch-retries=0",
      "--fetch-timeout=30000",
      "vue@3.0.0",
      ...tarballs,
    ],
    temporary,
    120_000,
  );
  copyFileSync(
    join(root, "packages", "vue", "test", "minimum-scopes.cjs"),
    join(temporary, "minimum-scopes.cjs"),
  );
  console.log(run(process.execPath, ["minimum-scopes.cjs"]).trim());
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
