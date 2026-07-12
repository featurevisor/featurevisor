import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getCustomDatafile } from "../builder/buildDatafile";
import { promotePlugin, promoteProjectSets } from "./index";

async function writeFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

async function createProject(options?: { configContent?: string; sets?: string[] }) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "featurevisor-promote-"));
  const configContent =
    options?.configContent ??
    ["module.exports = {", "  sets: true,", "  tags: ['all', 'web'],", "};", ""].join("\n");
  const sets = options?.sets ?? ["dev", "staging"];

  await writeFile(root, "featurevisor.config.js", configContent);

  for (const set of sets) {
    await writeFile(
      root,
      `sets/${set}/attributes/userId.yml`,
      "description: User ID\ntype: string\n",
    );
    await writeFile(root, `sets/${set}/attributes/team.yml`, "description: Team\ntype: string\n");
    await writeFile(
      root,
      `sets/${set}/schemas/payload.yml`,
      "description: Payload\ntype: object\n",
    );
    await writeFile(
      root,
      `sets/${set}/segments/internal.yml`,
      [
        "description: Internal users",
        "conditions:",
        "  - attribute: team",
        "    operator: equals",
        "    value: engineering",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      `sets/${set}/features/checkoutFlow.yml`,
      [
        `description: Checkout flow in ${set}`,
        "tags:",
        "  - all",
        "bucketBy: userId",
        "variablesSchema:",
        "  payload:",
        "    schema: payload",
        "    defaultValue: {}",
        "rules:",
        "  - key: everyone",
        set === "dev" ? "    segments: internal" : '    segments: "*"',
        set === "dev" ? "    percentage: 100" : "    percentage: 0",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      `sets/${set}/tests/features/checkoutFlow.spec.yml`,
      [
        "feature: checkoutFlow",
        "assertions:",
        "  - description: Checkout assertion",
        "    at: 10",
        "    context:",
        '      userId: "user-1"',
        "      team: engineering",
        set === "dev" ? "    expectedToBeEnabled: true" : "    expectedToBeEnabled: false",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      `sets/${set}/tests/segments/internal.spec.yml`,
      [
        "segment: internal",
        "assertions:",
        "  - context:",
        "      team: engineering",
        "    expectedToMatch: true",
        "",
      ].join("\n"),
    );
  }

  return root;
}

describe("promoteProjectSets", function () {
  it("previews by default and applies only with apply", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const preview = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
    });

    expect(preview.apply).toEqual(false);
    expect(preview.files.updated).toEqual(
      expect.arrayContaining([expect.stringContaining("sets/staging/features/checkoutFlow.yml")]),
    );
    expect((await datasource.forSet("staging").readFeature("checkoutFlow")).description).toEqual(
      "Checkout flow in staging",
    );

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      apply: true,
    });
    const feature = await datasource.forSet("staging").readFeature("checkoutFlow");

    expect(result.apply).toEqual(true);
    expect(result.dependencies.feature).toEqual(1);
    expect(result.dependencies.segment).toEqual(1);
    expect(result.dependencies.attribute).toEqual(2);
    expect(result.dependencies.schema).toEqual(1);
    expect(result.dependencies.test).toEqual(2);
    expect(feature.description).toEqual("Checkout flow in dev");
  });

  it("uses all features as the starting set when only excludeFeatures is provided", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/experimentalBanner.yml",
      [
        "description: Experimental banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      excludeFeatures: "experimental*",
    });

    expect(result.dependencies.feature).toEqual(1);
    expect(result.files.updated).toEqual(
      expect.arrayContaining([expect.stringContaining("features/checkoutFlow.yml")]),
    );
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([expect.stringContaining("features/experimentalBanner.yml")]),
    );
  });

  it("selects a target and all definitions needed by its matching features", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/targets/web.yml",
      [
        "description: Web datafile",
        "tags:",
        "  and:",
        "    - web",
        "    - all",
        "includeFeatures:",
        "  - web*",
        "excludeFeatures:",
        "  - webInternal*",
        "",
      ].join("\n"),
    );
    for (const [key, segment] of [
      ["webCheckout", "internal"],
      ["webInternalTools", '"*"'],
    ]) {
      await writeFile(
        root,
        `sets/dev/features/${key}.yml`,
        [
          `description: ${key}`,
          "tags:",
          "  - web",
          "  - all",
          "bucketBy: userId",
          "rules:",
          "  - key: everyone",
          `    segments: ${segment}`,
          "    percentage: 100",
          "",
        ].join("\n"),
      );
    }
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      target: "web",
      apply: true,
    });

    expect(result.filters.targets).toEqual(["web"]);
    expect(result.dependencies.target).toEqual(1);
    expect(result.dependencies.feature).toEqual(1);
    expect(result.dependencies.segment).toEqual(1);
    expect(result.dependencies.attribute).toEqual(2);
    expect(result.files.created).toEqual(
      expect.arrayContaining([
        expect.stringContaining("targets/web.yml"),
        expect.stringContaining("features/webCheckout.yml"),
      ]),
    );
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([expect.stringContaining("features/webInternalTools.yml")]),
    );

    const destinationDatasource = datasource.forSet("staging");
    const target = await destinationDatasource.readTarget("web");
    const datafile = await getCustomDatafile({
      environment: false,
      projectConfig: destinationDatasource.getConfig(),
      datasource: destinationDatasource,
      revision: "test",
      tag: target.tag,
      tags: target.tags,
      includeFeatures: target.includeFeatures,
      excludeFeatures: target.excludeFeatures,
    });
    expect(Object.keys(datafile.features)).toEqual(["webCheckout"]);
    expect(Object.keys(datafile.segments)).toEqual(["internal"]);
  });

  it("selects features by tag and includes exclusion group members", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/webCheckout.yml",
      [
        "description: Web checkout",
        "tags:",
        "  - web",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 50",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/features/checkoutFlow.yml",
      [
        "description: Checkout flow in dev",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        "    segments: internal",
        "    percentage: 50",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/groups/webExperiments.yml",
      [
        "description: Web experiments",
        "slots:",
        "  - feature: webCheckout",
        "    percentage: 50",
        "  - feature: checkoutFlow",
        "    percentage: 50",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
    });

    expect(result.filters.tags).toEqual(["web"]);
    expect(result.dependencies.feature).toEqual(2);
    expect(result.dependencies.group).toEqual(1);
    expect(result.dependencies.segment).toEqual(1);
  });

  it("rejects unknown targets and empty filtered results unless allowEmpty is used", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        target: "missing",
      }),
    ).rejects.toThrow('Unknown source target "missing"');

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        tag: "missing",
      }),
    ).rejects.toThrow('Unknown source tag "missing"');

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        tag: "web",
      }),
    ).rejects.toThrow("No source features matched the promotion filters.");

    const empty = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      allowEmpty: true,
    });
    expect(empty.dependencies.feature).toEqual(0);
  });

  it("validates sets and promotion flow constraints", async function () {
    const root = await createProject({
      sets: ["dev", "staging", "production"],
      configContent: [
        "module.exports = {",
        "  sets: true,",
        "  promotionFlows: [",
        '    { from: "dev", to: "staging" },',
        '    { from: "staging", to: "production" },',
        "  ],",
        "};",
        "",
      ].join("\n"),
    });
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await expect(
      promoteProjectSets(projectConfig, datasource, { from: "dev", to: "dev" }),
    ).rejects.toThrow("--from and --to must be different sets.");
    await expect(
      promoteProjectSets(projectConfig, datasource, { from: "missing", to: "staging" }),
    ).rejects.toThrow('Unknown source set "missing"');
    await expect(
      promoteProjectSets(projectConfig, datasource, { from: "dev", to: "production" }),
    ).rejects.toThrow(
      'Promotion from "dev" to "production" is not allowed by this project\'s configured promotionFlows.',
    );

    const allowed = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
    });

    expect(allowed.from).toEqual("dev");
    expect(allowed.to).toEqual("staging");
  });

  it("blocks all promotions when promotionFlows is empty", async function () {
    const root = await createProject({
      configContent: [
        "module.exports = {",
        "  sets: true,",
        "  promotionFlows: [],",
        "};",
        "",
      ].join("\n"),
    });
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await expect(
      promoteProjectSets(projectConfig, datasource, { from: "dev", to: "staging" }),
    ).rejects.toThrow(
      'Promotion from "dev" to "staging" is not allowed by this project\'s configured promotionFlows.',
    );
  });

  it("skips updates when either existing entity is non-promotable but still creates missing entities", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/checkoutFlow.yml",
      [
        "description: Protected checkout",
        "promotable: false",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/features/mobileBanner.yml",
      [
        "description: Mobile banner",
        "promotable: false",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      apply: true,
    });

    expect(result.files.unchanged).toEqual(
      expect.arrayContaining([expect.stringContaining("sets/staging/features/checkoutFlow.yml")]),
    );
    expect(result.files.created).toEqual(
      expect.arrayContaining([expect.stringContaining("sets/staging/features/mobileBanner.yml")]),
    );
    expect((await datasource.forSet("staging").readFeature("checkoutFlow")).description).toEqual(
      "Checkout flow in staging",
    );
    expect((await datasource.forSet("staging").readFeature("mobileBanner")).promotable).toEqual(
      false,
    );
  });

  it("skips source rules and preserves destination rules marked non-promotable", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/checkoutFlow.yml",
      [
        "description: Checkout flow in dev",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 100",
        "  - key: dev-only",
        "    promotable: false",
        '    segments: "*"',
        "    percentage: 100",
        "  - key: protected",
        '    segments: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/staging/features/checkoutFlow.yml",
      [
        "description: Checkout flow in staging",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    segments: "*"',
        "    percentage: 0",
        "  - key: protected",
        "    promotable: false",
        '    segments: "*"',
        "    percentage: 25",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      apply: true,
    });

    const feature = await datasource.forSet("staging").readFeature("checkoutFlow");
    const rules = feature.rules as any[];

    expect(rules.map((rule) => rule.key)).toEqual(["everyone", "protected"]);
    expect(rules.find((rule) => rule.key === "everyone").percentage).toEqual(100);
    expect(rules.find((rule) => rule.key === "protected").percentage).toEqual(25);
    expect(rules.find((rule) => rule.key === "protected").promotable).toEqual(false);
  });

  it("supports conflict policies", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const destination = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      conflicts: "destination",
      apply: true,
    });

    expect(destination.conflicts.length).toBeGreaterThan(0);
    expect((await datasource.forSet("staging").readFeature("checkoutFlow")).description).toEqual(
      "Checkout flow in staging",
    );

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        includeFeatures: "checkout*",
        conflicts: "fail",
      }),
    ).rejects.toThrow("conflict(s) and --conflicts=fail was used");
  });

  it("writes audit files only in apply mode", async function () {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-19T10:20:30Z"));

    try {
      const root = await createProject();
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);

      const preview = await promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        audit: "markdown",
      });
      const applied = await promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        apply: true,
        audit: "markdown",
      });

      expect(preview.auditFilePath).toBeUndefined();
      expect(applied.auditFilePath).toContain(
        ".featurevisor/promotions/20260419T102030-dev-to-staging.md",
      );

      const audit = await fs.promises.readFile(path.resolve(root, applied.auditFilePath!), "utf8");
      expect(audit).toContain("# Featurevisor Promotion");
      expect(audit).toContain("- Mode: apply");
      expect(audit).toContain("features/checkoutFlow.yml");
    } finally {
      jest.useRealTimers();
    }
  });

  it("prints CLI preview output without unchanged files by default", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await promotePlugin.handler({
        rootDirectoryPath: root,
        projectConfig,
        datasource,
        parsed: {
          _: ["promote"],
          from: "dev",
          to: "staging",
        },
      });

      const output = consoleLogSpy.mock.calls.flat().join("\n");

      expect(output).toContain("Mode: preview");
      expect(output).toContain("Promotion preview complete");
      expect(output).toContain("Unchanged: ");
      expect(output).not.toContain("Unchanged\n");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
