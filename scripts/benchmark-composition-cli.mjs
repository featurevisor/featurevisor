import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import process from "node:process";
const require = createRequire(import.meta.url);
const {
  getProjectConfig,
  Datasource,
  lintProject,
  buildDatafile,
} = require("../packages/core/lib");
async function main() {
  const samples = Number(process.env.SAMPLES || 5);
  const roots = [];
  const output = [];
  const originalLog = console.log;
  const timed = async (operation) => {
    await operation();
    const values = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await operation();
      values.push(performance.now() - start);
    }
    const sorted = [...values].sort((a, b) => a - b);
    return {
      samples: values,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      minMs: sorted[0],
      maxMs: sorted.at(-1),
    };
  };
  try {
    for (const count of [0, 500]) {
      const root = await mkdtemp(path.join(tmpdir(), "featurevisor-compose-cli-"));
      roots.push(root);
      await writeFile(path.join(root, "featurevisor.config.js"), "module.exports={};");
      for (const dir of ["attributes", "features", "variables"]) await mkdir(path.join(root, dir));
      await writeFile(
        path.join(root, "attributes", "userId.yml"),
        JSON.stringify({ description: "User identifier", type: "string" }),
      );
      for (let i = 0; i < 20; i++) {
        await writeFile(
          path.join(root, "features", `feature${i}.yml`),
          JSON.stringify({
            description: "Source",
            bucketBy: "userId",
            variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
            variations: [{ value: "express", weight: 100 }],
            rules: [{ key: "all", conditions: "*", percentage: 100 }],
          }),
        );
        await writeFile(
          path.join(root, "variables", `variable${i}.yml`),
          JSON.stringify({ description: "Policy", type: "integer", defaultValue: i }),
        );
      }
      for (let i = 0; i < count; i++)
        await writeFile(
          path.join(root, "variables", `composition${i}.yml`),
          JSON.stringify({
            description: "Composed",
            compose: Object.fromEntries(
              Array.from({ length: 10 }, (_, j) => [
                `member${j}`,
                j % 4 === 0
                  ? { feature: `feature${j}` }
                  : j % 4 === 1
                    ? { feature: `feature${j}`, variation: true }
                    : j % 4 === 2
                      ? { feature: `feature${j}`, variable: "label" }
                      : { variable: `variable${j}` },
              ]),
            ),
          }),
        );
      const config = getProjectConfig(root);
      console.log = () => {};
      const lint = await timed(async () => {
        const result = await lintProject(
          {
            rootDirectoryPath: root,
            projectConfig: config,
            datasource: new Datasource(config, root),
            options: {},
          },
          { json: true },
        );
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
      });
      const build = await timed(async () => {
        const result = await buildDatafile(
          config,
          new Datasource(config, root),
          { revision: "trial", environment: false },
          { features: {} },
        );
        assert.equal(Object.keys(result.variables).length, 20 + count);
      });
      console.log = originalLog;
      output.push({
        compositions: count,
        membersPerComposition: 10,
        features: 20,
        ordinaryVariables: 20,
        lint,
        build,
      });
    }
    const json = JSON.stringify(
      { unit: "milliseconds per complete operation", samples, output },
      null,
      2,
    );
    if (process.argv[2]) await writeFile(process.argv[2], json + "\n");
    console.log(json);
  } finally {
    console.log = originalLog;
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
