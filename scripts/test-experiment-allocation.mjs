import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createFeaturevisor } from "@featurevisor/sdk";

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));

export function verifyExperimentAllocation(datafile, environment) {
  for (const key of ["experimentAllocation", "bar", "qux"]) {
    assert.ok(datafile.features[key], `${environment}: missing ${key}`);
    assert.equal("ranges" in datafile.features[key], false, `${key}: legacy ranges emitted`);
  }
  for (const key of ["bar", "qux"]) {
    const encoded = datafile.features[key].conditions;
    const conditions = typeof encoded === "string" ? JSON.parse(encoded) : encoded;
    assert.equal(
      "requiredFeatures" in datafile.features[key],
      false,
      `${key}: legacy gate emitted`,
    );
    assert.deepEqual(conditions, [{ feature: "experimentAllocation", variation: key }]);
  }

  const sdk = createFeaturevisor({ datafile, logLevel: "fatal" });
  const counts = { bar: 0, qux: 0, holdout: 0 };
  try {
    for (let index = 0; index < 20_000; index += 1) {
      const context = { userId: `allocation-user-${index}`, country: "nl" };
      const allocation = sdk.getVariation("experimentAllocation", context);
      assert.ok(Object.hasOwn(counts, allocation), `${environment}: unknown allocation`);
      counts[allocation] += 1;

      // Alternate evaluation order without supplying fixed buckets or sticky state.
      const keys = index % 2 === 0 ? ["bar", "qux"] : ["qux", "bar"];
      const enabled = Object.fromEntries(keys.map((key) => [key, sdk.isEnabled(key, context)]));
      assert.equal(enabled.bar && enabled.qux, false, `${environment}: overlap for ${index}`);
      assert.equal(enabled.bar, allocation === "bar", `${environment}: bar for ${index}`);
      assert.equal(enabled.qux, allocation === "qux", `${environment}: qux for ${index}`);
      assert.equal(sdk.getVariation("experimentAllocation", context), allocation);
    }
    for (const [variation, count] of Object.entries(counts)) {
      const [minimum, maximum] = variation === "holdout" ? [3400, 4600] : [7400, 8600];
      assert.ok(
        count >= minimum && count <= maximum,
        `${environment}: ${variation} count ${count} is outside ${minimum}..${maximum}`,
      );
    }
  } finally {
    sdk.close();
  }
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  for (const environment of ["staging", "production"]) {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "packages", "cli", "bin.js"),
        "build",
        `--root-directory-path=${join(root, "examples", "example-1")}`,
        `--environment=${environment}`,
        "--target=all",
        "--print",
        "--no-state-files",
        "--revision-from-hash",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const counts = verifyExperimentAllocation(JSON.parse(result.stdout), environment);
    console.log(`${environment}: ordinary allocation hashing passed ${JSON.stringify(counts)}`);
  }
}
