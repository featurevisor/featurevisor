import { createRequire } from "node:module";
import { readdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import process from "node:process";

const require = createRequire(import.meta.url);
const { getProjectConfig, Datasource, buildTargetDatafile } = require("../packages/core/lib");
async function main() {
  const result = {};
  for (const entry of await readdir("examples", { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "example-composition") continue;
    const root = path.resolve("examples", entry.name);
    if (!existsSync(path.join(root, "featurevisor.config.js"))) continue;
    const config = getProjectConfig(root);
    const rootDatasource = new Datasource(config, root);
    for (const set of config.sets ? await rootDatasource.listSets() : [undefined]) {
      const datasource = set ? rootDatasource.forSet(set) : rootDatasource;
      const projectConfig = datasource.getConfig();
      for (const environment of projectConfig.environments || [false]) {
        for (const targetKey of await datasource.listTargets()) {
          const target = await datasource.readTarget(targetKey);
          const state = structuredClone(await datasource.readState(environment));
          result[[entry.name, set || "", environment || "", targetKey].join("/")] = JSON.stringify(
            await buildTargetDatafile({
              projectConfig,
              datasource,
              target,
              environment,
              existingState: state,
              revision: "trial-baseline",
              featurevisorVersion: "trial",
            }),
          );
        }
      }
    }
  }
  if (process.argv[2] === "capture") await writeFile(process.argv[3], JSON.stringify(result));
  else assert.deepEqual(result, JSON.parse(await readFile(process.argv[3], "utf8")));
  console.log(
    `${Object.keys(result).length} existing example Target/environment/Set datafiles ${process.argv[2] === "capture" ? "captured" : "byte identical"}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
