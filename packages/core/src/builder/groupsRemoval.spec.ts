import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExistingState, Target } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";

import { getProjectConfig, type ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "../linter/lintProject";
import { buildDatafile } from "./buildDatafile";
import { buildTargetDatafile } from "./buildProject";

describe("builder after removing feature Groups", () => {
  let root: string;
  let projectConfig: ProjectConfig;
  let datasource: Datasource;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-groups-removal-"));
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      'module.exports = { parser: "json", tags: ["all", "experiments", "allocation"], stringify: false };',
    );
    const write = (file: string, value: unknown) => {
      const destination = path.join(root, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify(value));
    };
    const rules = [{ key: "everyone", conditions: "*", percentage: 100 }];
    write("attributes/userId.json", { type: "string" });
    write("features/experimentAllocation.json", {
      description: "One shared assignment including a holdout",
      tags: ["allocation"],
      bucketBy: "userId",
      variations: [
        { value: "bar", weight: 40 },
        { value: "qux", weight: 40 },
        { value: "holdout", weight: 20 },
      ],
      rules,
    });
    for (const key of ["bar", "qux", "unrelated"]) {
      write(`features/${key}.json`, {
        description: `${key} experiment`,
        tags: [key === "unrelated" ? "all" : "experiments"],
        bucketBy: "userId",
        ...(key === "unrelated"
          ? {}
          : { conditions: [{ feature: "experimentAllocation", variation: key }] }),
        variations: [
          { value: "control", weight: 50 },
          { value: "treatment", weight: 50 },
        ],
        rules,
      });
    }
    projectConfig = getProjectConfig(root);
    datasource = new Datasource(projectConfig, root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const build = (state: ExistingState = { features: {} }) =>
    buildDatafile(
      projectConfig,
      datasource,
      { environment: false, revision: "groups-removed" },
      state,
    );

  const buildTarget = (target: Target) =>
    buildTargetDatafile({
      projectConfig,
      datasource,
      target,
      environment: false,
      revision: "groups-removed",
      existingState: { features: {} },
    });

  test("resolves the SDK source rather than previously built output", () => {
    expect(require.resolve("@featurevisor/sdk")).toBe(
      path.resolve(__dirname, "../../../sdk/src/index.ts"),
    );
  });

  test("the converted Example 1 features and scenarios pass source project lint", async () => {
    const exampleRoot = path.resolve(__dirname, "../../../../examples/example-1");
    const config = getProjectConfig(exampleRoot);
    const result = await lintProject(
      {
        rootDirectoryPath: exampleRoot,
        projectConfig: config,
        datasource: new Datasource(config, exampleRoot),
        options: {},
      },
      { json: true },
    );
    expect(result.errors).toEqual([]);
    expect(result.hasError).toBe(false);
  });

  test("builds flat variation prerequisites without legacy feature ranges", async () => {
    const result = await build();
    expect(Object.keys(result.features).sort()).toEqual([
      "bar",
      "experimentAllocation",
      "qux",
      "unrelated",
    ]);
    for (const key of ["bar", "qux"]) {
      expect(result.features[key].conditions).toEqual([
        { feature: "experimentAllocation", variation: key },
      ]);
      expect(result.features[key].traffic[0].percentage).toBe(100000);
    }
    for (const feature of Object.values(result.features)) {
      expect(feature).not.toHaveProperty("ranges");
    }
    expect(result.features.experimentAllocation.traffic[0].allocation).toEqual([
      { variation: "bar", range: [0, 40000] },
      { variation: "qux", range: [40000, 80000] },
      { variation: "holdout", range: [80000, 100000] },
    ]);
  });

  test("ordinary hashing has no overlap and honours the holdout for 20,000 users", async () => {
    const sdk = createFeaturevisor({ datafile: await build(), logLevel: "fatal" });
    const counts = { bar: 0, qux: 0, holdout: 0, overlap: 0 };
    try {
      for (let index = 0; index < 20_000; index += 1) {
        const context = { userId: `allocation-user-${index}` };
        const allocation = sdk.getVariation("experimentAllocation", context);
        assert.ok(allocation === "bar" || allocation === "qux" || allocation === "holdout");
        counts[allocation] += 1;
        // No fixed bucket or sticky state. Reverse reads to detect order dependent results.
        const keys = index % 2 === 0 ? ["bar", "qux"] : ["qux", "bar"];
        const enabled = Object.fromEntries(keys.map((key) => [key, sdk.isEnabled(key, context)]));
        if (enabled.bar && enabled.qux) counts.overlap += 1;
        assert.equal(enabled.bar, allocation === "bar", `bar assignment for user ${index}`);
        assert.equal(enabled.qux, allocation === "qux", `qux assignment for user ${index}`);
        assert.equal(sdk.getVariation("experimentAllocation", context), allocation);
      }
      expect(counts.overlap).toBe(0);
      expect(counts.bar + counts.qux + counts.holdout).toBe(20_000);
      for (const key of ["bar", "qux", "holdout"] as const) {
        const [minimum, maximum] = key === "holdout" ? [3400, 4600] : [7400, 8600];
        expect(counts[key]).toBeGreaterThanOrEqual(minimum);
        expect(counts[key]).toBeLessThanOrEqual(maximum);
      }
    } finally {
      sdk.close();
    }
  });

  test.each(["bar", "qux"])(
    "a Target selecting %s includes the shared allocation dependency",
    async (key) => {
      const result = await buildTarget({
        description: "One experiment",
        includeFeatures: [key],
        excludeFeatures: ["experimentAllocation"],
      });
      expect(Object.keys(result.features).sort()).toEqual([key, "experimentAllocation"].sort());
      expect(result.features[key].conditions).toEqual([
        { feature: "experimentAllocation", variation: key },
      ]);
    },
  );

  test("a tagged Target includes the shared dependency without its allocation tag", async () => {
    const result = await buildTarget({ description: "Experiments", tag: "experiments" });
    expect(Object.keys(result.features).sort()).toEqual(["bar", "experimentAllocation", "qux"]);
  });

  test("documents that expose false can omit the allocation dependency and disable both consumers", async () => {
    const allocation = await datasource.readFeature("experimentAllocation");
    await datasource.writeFeature("experimentAllocation", { ...allocation, expose: false });

    // This is existing exposure filtering, not a new migration guard. Allocation features
    // must remain exposed in every datafile whose consumers require their variations.
    const result = await buildTarget({ description: "Experiments", tag: "experiments" });
    expect(Object.keys(result.features).sort()).toEqual(["bar", "qux"]);
    const sdk = createFeaturevisor({ datafile: result, logLevel: "fatal" });
    try {
      for (const key of ["bar", "qux"]) {
        expect(result.features[key].conditions).toEqual([
          { feature: "experimentAllocation", variation: key },
        ]);
        expect(sdk.isEnabled(key, { userId: "customer" })).toBe(false);
        expect(sdk.evaluateFlag(key, { userId: "customer" }).reason).toBe("conditions_unmet");
      }
    } finally {
      sdk.close();
    }
  });

  test("rebuilding writes only current state fields and preserves ordinary variation allocations", async () => {
    const state: ExistingState = { features: {} };
    const initial = await build(state);
    const allocations = structuredClone(state.features.unrelated.traffic);

    // Unknown historical metadata must neither rebucket a feature nor survive
    // the normal state projection. This does not add a legacy reader path.
    Object.assign(state.features.unrelated, { ranges: [[50001, 100000]] });
    await datasource.writeState(false, state);
    const reloaded = await datasource.readState(false);
    expect(await build(reloaded)).toEqual(initial);
    expect(reloaded.features.unrelated.traffic).toEqual(allocations);
    for (const feature of Object.values(reloaded.features)) {
      expect(feature).not.toHaveProperty("ranges");
    }
    await datasource.writeState(false, reloaded);
    expect(await datasource.readState(false)).toEqual(reloaded);
  });

  test.each([50, 100])(
    "real v3 state requires new rule keys when converting at %s percent",
    async (percentage) => {
      const state: ExistingState = JSON.parse(
        fs.readFileSync(path.join(__dirname, "fixtures/v3-group-state.json"), "utf8"),
      );
      const original = structuredClone(state);
      for (const [key, feature] of Object.entries(state.features)) {
        expect(feature).not.toHaveProperty("ranges");
        await datasource.writeFeature(key, {
          key,
          description: key,
          tags: ["all"],
          bucketBy: "userId",
          variations: feature.variations,
          rules: [
            {
              key: feature.traffic[0].key,
              conditions: "*",
              percentage: key === "unrelated" ? 35 : percentage,
            },
          ],
        });
      }

      await expect(build(state)).rejects.toMatchObject({
        code: "invalid_saved_allocation",
        details: { feature: "experimentB", rule: "legacy" },
      });

      // Restart from the actual v3 state after the rejected build.
      await datasource.writeState(false, original);
      const migratedState = await datasource.readState(false);
      for (const key of ["experimentA", "experimentB"]) {
        const feature = await datasource.readFeature(key);
        await datasource.writeFeature(key, {
          ...feature,
          rules: [{ key: "allocated", conditions: "*", percentage }],
        });
      }
      const migrated = await build(migratedState);
      for (const key of ["experimentA", "experimentB"]) {
        expect(migrated.features[key].traffic[0].allocation).toEqual([
          { variation: "control", range: [0, percentage * 500] },
          { variation: "treatment", range: [percentage * 500, percentage * 1000] },
        ]);
      }
      const repaired = createFeaturevisor({
        datafile: migrated,
        logLevel: "fatal",
        modules: [{ name: "fixed-bucket", bucketValue: () => 10000 }],
      });
      try {
        expect(repaired.isEnabled("experimentB", { userId: "user" })).toBe(true);
        expect(repaired.getVariation("experimentB", { userId: "user" })).toBe("control");
      } finally {
        repaired.close();
      }
      // V4 feature hashes differ from v3; saved rollout allocations must not.
      expect(migratedState.features.unrelated.traffic).toEqual(original.features.unrelated.traffic);
      expect(migratedState.features.unrelated.variations).toEqual(
        original.features.unrelated.variations,
      );
      await datasource.writeState(false, migratedState);
      const reloaded = await datasource.readState(false);
      expect(await build(reloaded)).toEqual(migrated);
      expect(reloaded).toEqual(migratedState);
    },
  );
});
