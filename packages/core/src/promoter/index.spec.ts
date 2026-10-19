import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CustomParser } from "@featurevisor/parsers";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { FilesystemAdapter } from "../datasource/filesystemAdapter";
import { getCustomDatafile } from "../builder/buildDatafile";
import { createFeaturevisor } from "@featurevisor/sdk";
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
        set === "dev" ? "    conditions: internal" : '    conditions: "*"',
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
  describe("atomic condition expressions", () => {
    it.each(["source", "destination", "fail"] as const)(
      "keeps variables and rules named conditions distinct from selectors under %s policy",
      async (policy) => {
        const root = await createProject();
        try {
          for (const set of ["dev", "staging"]) {
            await writeFile(
              root,
              `sets/${set}/features/checkoutFlow.yml`,
              JSON.stringify({
                description: "Checkout",
                tags: ["web"],
                bucketBy: "userId",
                variablesSchema: {
                  conditions: {
                    type: "string",
                    defaultValue: "same",
                    ...(set === "dev" ? { minLength: 1 } : { description: "Destination metadata" }),
                  },
                },
                rules: [
                  {
                    key: "conditions",
                    conditions: "*",
                    percentage: 100,
                    ...(set === "dev"
                      ? { variables: { conditions: "same" } }
                      : { description: "Destination rule" }),
                  },
                ],
              }),
            );
            await writeFile(
              root,
              `sets/${set}/tests/features/checkoutFlow.spec.yml`,
              JSON.stringify({
                feature: "checkoutFlow",
                assertions: [{ at: 10, context: {}, expectedToBeEnabled: true }],
              }),
            );
          }
          const config = getProjectConfig(root);
          const datasource = new Datasource(config, root);
          const result = await promoteProjectSets(config, datasource, {
            from: "dev",
            to: "staging",
            tag: "web",
            conflicts: policy,
            apply: true,
          });
          expect(
            (await datasource.forSet("staging").readFeature("checkoutFlow")).variablesSchema
              ?.conditions,
          ).toEqual({
            type: "string",
            defaultValue: "same",
            minLength: 1,
            description: "Destination metadata",
          });
          expect(result.conflicts).toEqual([]);
          expect((await datasource.forSet("staging").readFeature("checkoutFlow")).rules).toEqual([
            {
              key: "conditions",
              conditions: "*",
              percentage: 100,
              variables: { conditions: "same" },
              description: "Destination rule",
            },
          ]);
        } finally {
          await fs.promises.rm(root, { recursive: true, force: true });
        }
      },
    );
    const attribute = { attribute: "team", operator: "equals", value: "engineering" };
    const feature = { feature: "gate" };
    const cases = [
      ...[
        "feature",
        "segment",
        "rule",
        "feature override",
        "global variable",
        "global override",
      ].map((scope) => ({ scope, before: attribute, after: feature, label: "leaf kind" })),
      {
        scope: "feature",
        before: { and: [attribute, feature] },
        after: { or: [attribute, feature] },
        label: "group kind",
      },
      {
        scope: "feature",
        before: { feature: "gate", variable: "limit", operator: "exists" },
        after: { variable: "limit", operator: "exists" },
        label: "variable ownership",
      },
      {
        scope: "feature",
        before: { feature: "gate", enabled: false },
        after: feature,
        label: "removed optional selector fields",
      },
      {
        scope: "feature",
        before: { attribute: "team", operator: "matches", value: "engineering", regexFlags: "i" },
        after: { attribute: "team", operator: "isNull" },
        label: "matches to isNull without stale value or regex flags",
      },
      {
        scope: "feature",
        before: attribute,
        after: { attribute: "team", operator: "exists" },
        label: "equals to exists without a stale value",
      },
      {
        scope: "feature",
        before: { attribute: "team", operator: "matches", value: "engineering", regexFlags: "i" },
        after: { attribute: "team", operator: "matches", value: "engineering" },
        label: "matches without stale regex flags",
      },
    ];
    for (const policy of ["source", "destination", "fail"] as const) {
      it.each(cases)(
        `uses ${policy} policy for $scope $label changes`,
        async ({ scope, before, after }) => {
          const root = await createProject();
          for (const set of ["dev", "staging"]) {
            const condition = set === "dev" ? after : before;
            const definition: any = {
              description: "Checkout",
              tags: ["web"],
              bucketBy: "userId",
              variablesSchema: { payload: { type: "object", defaultValue: {} } },
              rules: [{ key: "all", conditions: "*", percentage: 100 }],
            };
            let variable: any;
            if (scope === "feature") definition.conditions = condition;
            if (scope === "segment") {
              definition.conditions = "audience";
              await writeFile(
                root,
                `sets/${set}/segments/audience.yml`,
                JSON.stringify({ description: "Audience", conditions: condition }),
              );
            }
            if (scope === "rule") definition.rules[0].conditions = condition;
            if (scope === "feature override")
              definition.rules[0].variableOverrides = {
                payload: [{ key: "targeted", conditions: condition, value: {} }],
              };
            if (scope.startsWith("global")) {
              variable = {
                description: "Settings",
                tags: ["web"],
                type: "boolean",
                defaultValue: true,
              };
              if (scope === "global variable") variable.conditions = condition;
              else variable.overrides = [{ key: "targeted", conditions: condition, value: false }];
              await writeFile(root, `sets/${set}/variables/settings.yml`, JSON.stringify(variable));
            }
            await writeFile(
              root,
              `sets/${set}/features/checkoutFlow.yml`,
              JSON.stringify(definition),
            );
            await writeFile(
              root,
              `sets/${set}/features/gate.yml`,
              JSON.stringify({
                description: "Gate",
                bucketBy: "userId",
                variablesSchema: { limit: { type: "boolean", defaultValue: true } },
                rules: [{ key: "all", conditions: "*", percentage: 100 }],
              }),
            );
            await writeFile(
              root,
              `sets/${set}/variables/limit.yml`,
              JSON.stringify({ description: "Limit", type: "boolean", defaultValue: true }),
            );
          }
          const config = getProjectConfig(root);
          const datasource = new Datasource(config, root);
          const destination = datasource.forSet("staging");
          const readCondition = async () => {
            if (scope === "segment") return (await destination.readSegment("audience")).conditions;
            if (scope.startsWith("global")) {
              const variable = await destination.readVariable("settings");
              return scope === "global variable"
                ? variable.conditions
                : (variable.overrides as any[])[0].conditions;
            }
            const definition = await destination.readFeature("checkoutFlow");
            if (scope === "feature") return definition.conditions;
            const rule = (definition.rules as any[])[0];
            return scope === "rule"
              ? rule.conditions
              : rule.variableOverrides.payload[0].conditions;
          };
          const promotion = promoteProjectSets(config, datasource, {
            from: "dev",
            to: "staging",
            tag: "web",
            conflicts: policy,
            apply: true,
          });
          if (policy === "fail") {
            await expect(promotion).rejects.toThrow("conflict(s)");
            expect(await readCondition()).toEqual(before);
          } else {
            const result = await promotion;
            expect(await readCondition()).toEqual(policy === "source" ? after : before);
            expect(result.conflicts).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  path: expect.stringMatching(
                    scope === "feature override"
                      ? /conditions$|variableOverrides\.payload$/
                      : /conditions$/,
                  ),
                }),
              ]),
            );
          }
        },
      );
    }

    it("does not treat literal payload properties named conditions as selectors", async () => {
      const root = await createProject();
      for (const set of ["dev", "staging"])
        await writeFile(
          root,
          `sets/${set}/variables/payload.yml`,
          JSON.stringify({
            description: "Payload",
            tags: ["web"],
            type: "object",
            properties: {
              conditions: {
                type: "object",
                properties: { source: { type: "boolean" }, destination: { type: "boolean" } },
              },
            },
            defaultValue: { conditions: set === "dev" ? { source: true } : { destination: true } },
          }),
        );
      const config = getProjectConfig(root);
      const datasource = new Datasource(config, root);
      await promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        tag: "web",
        apply: true,
      });
      expect((await datasource.forSet("staging").readVariable("payload")).defaultValue).toEqual({
        conditions: { source: true, destination: true },
      });
    });
  });
  it("carries mixed dependencies through segments while excluding protected rule branches", async () => {
    const root = await createProject();
    const writeDefinition = (directory: string, key: string, value: unknown) =>
      writeFile(root, `sets/dev/${directory}/${key}.yml`, JSON.stringify(value));
    await writeDefinition("features", "selected", {
      description: "Selected",
      tags: ["web"],
      bucketBy: "userId",
      conditions: "audience",
      rules: [
        { key: "all", conditions: "*", percentage: 100 },
        {
          key: "protected",
          promotable: false,
          conditions: { feature: "protectedSource" },
          percentage: 100,
        },
      ],
    });
    for (const key of ["source", "protectedSource"])
      await writeDefinition("features", key, {
        description: key,
        bucketBy: "userId",
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
    await writeDefinition("variables", "permission", {
      description: "Permission",
      type: "boolean",
      defaultValue: true,
      conditions: { feature: "source" },
    });
    await writeDefinition("segments", "member", {
      description: "Member",
      conditions: { variable: "permission", operator: "equals", value: true },
    });
    await writeDefinition("segments", "audience", {
      description: "Audience",
      conditions: ["member", { attribute: "team", operator: "equals", value: "engineering" }],
    });
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });
    const destination = datasource.forSet("staging");
    for (const key of ["selected", "source"])
      expect(await destination.featureExists(key)).toBe(true);
    for (const key of ["audience", "member"])
      expect(await destination.segmentExists(key)).toBe(true);
    expect(await destination.variableExists("permission")).toBe(true);
    expect(await destination.featureExists("protectedSource")).toBe(false);
  });
  describe("string composition promotion", () => {
    const kinds = ["ordinary", "alias", "map"] as const;
    const changes = kinds.flatMap((source) =>
      kinds
        .filter((destination) => source !== destination)
        .flatMap((destination) =>
          (["source", "destination", "fail"] as const).map(
            (policy) => [source, destination, policy] as const,
          ),
        ),
    );
    test.each(changes)(
      "resolves %s to %s atomically with %s policy",
      async (sourceKind, destinationKind, conflicts) => {
        const root = await createProject();
        try {
          const definition = (kind: (typeof kinds)[number], set: string) => ({
            description: `${set} ${kind}`,
            tags: ["web"],
            ...(kind === "ordinary"
              ? { type: "integer", defaultValue: 1 }
              : { compose: kind === "alias" ? "source" : { count: { variable: "source" } } }),
            overrides: [{ key: set, conditions: "*", value: kind === "map" ? { count: 2 } : 2 }],
          });
          const source = definition(sourceKind, "dev");
          const destination = definition(destinationKind, "staging");
          for (const set of ["dev", "staging"]) {
            await writeFile(
              root,
              `sets/${set}/variables/source.yml`,
              JSON.stringify({ description: "Source", type: "integer", defaultValue: 1 }),
            );
            await writeFile(
              root,
              `sets/${set}/variables/config.yml`,
              JSON.stringify(set === "dev" ? source : destination),
            );
          }
          const config = getProjectConfig(root);
          const datasource = new Datasource(config, root);
          const options = { from: "dev", to: "staging", conflicts, apply: true };
          if (conflicts === "fail")
            await expect(promoteProjectSets(config, datasource, options)).rejects.toThrow(
              /conflict/,
            );
          else await promoteProjectSets(config, datasource, options);
          const result = await datasource.forSet("staging").readVariable("config");
          expect(result).toEqual(conflicts === "source" ? source : destination);
        } finally {
          await fs.promises.rm(root, { recursive: true, force: true });
        }
      },
    );
    test.each(["source", "destination", "fail"] as const)(
      "resolves alias keys as whole strings with %s policy",
      async (conflicts) => {
        const root = await createProject();
        try {
          for (const set of ["dev", "staging"]) {
            for (const key of ["one", "another"])
              await writeFile(
                root,
                `sets/${set}/variables/${key}.yml`,
                JSON.stringify({ description: key, type: "boolean", defaultValue: false }),
              );
            await writeFile(
              root,
              `sets/${set}/variables/config.yml`,
              JSON.stringify({ description: "Alias", compose: set === "dev" ? "one" : "another" }),
            );
          }
          const config = getProjectConfig(root);
          const datasource = new Datasource(config, root);
          const options = { from: "dev", to: "staging", conflicts, apply: true };
          if (conflicts === "fail")
            await expect(promoteProjectSets(config, datasource, options)).rejects.toThrow(
              /conflict/,
            );
          else await promoteProjectSets(config, datasource, options);
          const result = await datasource.forSet("staging").readVariable("config");
          expect(result.compose).toBe(conflicts === "source" ? "one" : "another");
        } finally {
          await fs.promises.rm(root, { recursive: true, force: true });
        }
      },
    );
  });
  describe.each([false, true])(
    "composed override promotion with environments=%s",
    (environments) => {
      test.each(["source", "destination", "fail"] as const)(
        "uses keyed merge, metadata and protection with %s policy",
        async (conflicts) => {
          const root = await createProject({
            configContent: `module.exports = { sets: true, tags: ['all', 'web']${environments ? ", environments: ['production']" : ""} };`,
          });
          try {
            for (const set of ["dev", "staging"]) {
              const source = set === "dev";
              if (environments) {
                await writeFile(
                  root,
                  `sets/${set}/features/checkoutFlow.yml`,
                  JSON.stringify({
                    description: "Checkout",
                    tags: ["all"],
                    bucketBy: "userId",
                    variablesSchema: { payload: { schema: "payload", defaultValue: {} } },
                    rules: { production: [{ key: "everyone", conditions: "*", percentage: 100 }] },
                  }),
                );
                await writeFile(
                  root,
                  `sets/${set}/tests/features/checkoutFlow.spec.yml`,
                  JSON.stringify({
                    feature: "checkoutFlow",
                    assertions: [
                      {
                        environment: "production",
                        at: 10,
                        context: { userId: "user-1" },
                        expectedToBeEnabled: true,
                      },
                    ],
                  }),
                );
              }
              const mutation = { enabled: source };
              const entry = (key: string) => ({
                key,
                conditions: "*",
                mutate: mutation,
                continue: true,
              });
              const rows = [
                entry(source ? "tail" : "regional"),
                { ...entry("locked"), promotable: !source ? false : true },
                entry(source ? "regional" : "tail"),
                {
                  ...entry("parent"),
                  overrides: [
                    {
                      ...entry("child"),
                      description: source ? "Source child" : "Destination child",
                    },
                    { ...entry("protectedChild"), promotable: false },
                    ...(source ? [{ ...entry("blockedChild"), promotable: false }] : []),
                  ],
                },
                ...(source ? [entry("new"), { ...entry("blocked"), promotable: false }] : []),
              ];
              await writeFile(
                root,
                `sets/${set}/variables/config.yml`,
                JSON.stringify({
                  description: source ? "Source composition" : "Destination composition",
                  tags: ["web"],
                  compose: { enabled: { feature: "checkoutFlow" } },
                  overrides: environments ? { production: rows } : rows,
                }),
              );
            }
            const config = getProjectConfig(root);
            const datasource = new Datasource(config, root);
            const destinationPath = path.join(root, "sets/staging/variables/config.yml");
            const before = await fs.promises.readFile(destinationPath, "utf8");
            const promotion = promoteProjectSets(config, datasource, {
              from: "dev",
              to: "staging",
              tag: "web",
              conflicts,
              apply: true,
            });
            if (conflicts === "fail") {
              await expect(promotion).rejects.toThrow("conflict(s)");
              expect(await fs.promises.readFile(destinationPath, "utf8")).toBe(before);
              return;
            }
            const result = await promotion;
            expect(result.conflicts).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  type: "variable",
                  key: "config",
                  path: "overrides.order",
                }),
                expect.objectContaining({ path: "overrides.parent.overrides.child.description" }),
              ]),
            );
            const variable = await datasource.forSet("staging").readVariable("config");
            const rows = Array.isArray(variable.overrides)
              ? variable.overrides
              : variable.overrides!.production;
            expect(rows.map((row) => row.key)).toEqual(
              conflicts === "source"
                ? ["tail", "locked", "regional", "parent", "new"]
                : ["regional", "locked", "tail", "parent", "new"],
            );
            expect(rows[1]).toMatchObject({ promotable: false, mutate: { enabled: false } });
            const parent = rows.find((row) => row.key === "parent")!;
            expect(parent).toMatchObject({
              continue: true,
              mutate: { enabled: conflicts === "source" },
            });
            expect(parent.overrides?.map((row) => row.key)).toEqual(["child", "protectedChild"]);
            expect(parent.overrides?.[0].description).toBe(
              conflicts === "source" ? "Source child" : "Destination child",
            );
            expect(parent.overrides?.[1]).toMatchObject({
              promotable: false,
              mutate: { enabled: false },
            });
            expect(variable.description).toBe(
              conflicts === "source" ? "Source composition" : "Destination composition",
            );
            expect(variable).not.toHaveProperty("defaultValue");
            expect(variable.compose).toEqual({ enabled: { feature: "checkoutFlow" } });
          } finally {
            await fs.promises.rm(root, { recursive: true, force: true });
          }
        },
      );
    },
  );

  test.each([false, true])(
    "promotes override only dependency closure and excludes protected subtrees, composed=%s",
    async (composed) => {
      const root = await createProject();
      try {
        for (const key of ["policy", "gate", "blockedPolicy"]) {
          await writeFile(
            root,
            `sets/dev/variables/${key}.yml`,
            JSON.stringify({
              description: key,
              type: "boolean",
              defaultValue: true,
              ...(key === "gate" ? { conditions: [{ feature: "overrideFeature" }] } : {}),
            }),
          );
        }
        for (const key of ["overrideFeature", "blockedFeature"]) {
          await writeFile(
            root,
            `sets/dev/features/${key}.yml`,
            JSON.stringify({
              description: key,
              bucketBy: "userId",
              rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
            }),
          );
        }
        for (const key of ["overrideUsers", "blockedUsers"]) {
          await writeFile(
            root,
            `sets/dev/segments/${key}.yml`,
            JSON.stringify({
              description: key,
              conditions: [{ attribute: "team", operator: "equals", value: key }],
            }),
          );
        }
        const child = {
          key: "eligible",
          conditions: [
            "overrideUsers",
            { feature: "checkoutFlow" },
            { variable: "gate", operator: "equals", value: true },
          ],

          mutate: { enabled: false },
        };
        await writeFile(
          root,
          "sets/dev/variables/config.yml",
          JSON.stringify({
            description: "Config",
            tags: ["web"],
            ...(composed
              ? { compose: { enabled: { variable: "policy" } } }
              : {
                  type: "object",
                  properties: { enabled: { type: "boolean" } },
                  defaultValue: { enabled: true },
                  conditions: [{ variable: "policy", operator: "equals", value: true }],
                }),
            overrides: [
              {
                key: "parent",
                conditions: "*",
                continue: true,
                mutate: { enabled: true },
                overrides: [
                  child,
                  {
                    ...child,
                    key: "blocked",
                    promotable: false,
                    conditions: [
                      "blockedUsers",
                      { feature: "blockedFeature" },
                      { variable: "blockedPolicy", operator: "equals", value: true },
                    ],

                    overrides: [
                      {
                        ...child,
                        key: "blockedDescendant",
                        conditions: [
                          { feature: "blockedFeature" },
                          { variable: "blockedPolicy", operator: "equals", value: true },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        await promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          tag: "web",
          apply: true,
        });
        const destination = datasource.forSet("staging");
        expect(await destination.listVariables()).toEqual(["config", "gate", "policy"]);
        expect(await destination.listFeatures()).toEqual(["checkoutFlow", "overrideFeature"]);
        expect(await destination.listSegments()).toEqual(["internal", "overrideUsers"]);
        const variable = await destination.readVariable("config");
        expect(
          Array.isArray(variable.overrides) &&
            variable.overrides[0].overrides?.map((row) => row.key),
        ).toEqual(["eligible"]);
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
  );

  test.each(["source", "destination", "fail"] as const)(
    "promotes composition metadata with %s policy and preserves independent aliases",
    async (conflicts) => {
      const root = await createProject();
      try {
        for (const set of ["dev", "staging"]) {
          await writeFile(
            root,
            `sets/${set}/variables/policy.yml`,
            JSON.stringify({
              description: "Policy",
              type: "boolean",
              defaultValue: true,
            }),
          );
          await writeFile(
            root,
            `sets/${set}/variables/config.yml`,
            JSON.stringify({
              description: set,
              tags: ["web"],
              deprecated: set === "staging",
              archived: false,
              promotable: true,
              compose: { shared: { variable: "policy" }, [set]: { variable: "policy" } },
            }),
          );
        }
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const destinationPath = path.join(root, "sets/staging/variables/config.yml");
        const before = await fs.promises.readFile(destinationPath, "utf8");
        const promotion = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          tag: "web",
          conflicts,
          apply: true,
        });
        if (conflicts === "fail") {
          await expect(promotion).rejects.toThrow();
          expect(await fs.promises.readFile(destinationPath, "utf8")).toBe(before);
          return;
        }
        await promotion;
        expect(await datasource.forSet("staging").readVariable("config")).toEqual({
          description: conflicts === "source" ? "dev" : "staging",
          tags: ["web"],
          deprecated: conflicts === "destination",
          archived: false,
          promotable: true,
          compose: {
            shared: { variable: "policy" },
            dev: { variable: "policy" },
            staging: { variable: "policy" },
          },
        });
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
  );
  test("rejects a composition whose protected source leaves a missing feature variable before writing", async () => {
    const root = await createProject({
      configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
    });
    try {
      await writeFile(
        root,
        "sets/dev/features/checkoutFlow.yml",
        JSON.stringify({
          description: "Protected source",
          bucketBy: "userId",
          promotable: false,
          variablesSchema: { label: { type: "string", defaultValue: "Source label" } },
          rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
        }),
      );
      await writeFile(
        root,
        "sets/dev/variables/config.yml",
        JSON.stringify({
          description: "Composition",
          tags: ["web"],
          compose: { label: { feature: "checkoutFlow", variable: "label" } },
        }),
      );
      const protectedPath = path.join(root, "sets/staging/features/checkoutFlow.yml");
      const before = await fs.promises.readFile(protectedPath, "utf8");
      const config = getProjectConfig(root);
      const datasource = new Datasource(config, root);
      await expect(
        promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          tag: "web",
          apply: true,
        }),
      ).rejects.toThrow(
        /Set "staging \(promotion result\)" failed preflight lint[\s\S]*Unknown feature variable "label"/,
      );
      expect(await fs.promises.readFile(protectedPath, "utf8")).toBe(before);
      expect(await datasource.forSet("staging").listVariables()).not.toContain("config");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test("creates a missing protected composition dependency under the existing entity policy", async () => {
    const root = await createProject({
      configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
    });
    try {
      await writeFile(
        root,
        "sets/dev/variables/config.yml",
        JSON.stringify({
          description: "Composition",
          tags: ["web"],
          compose: { policy: { variable: "policy" } },
        }),
      );
      await writeFile(
        root,
        "sets/dev/variables/policy.yml",
        JSON.stringify({
          description: "Protected policy",
          type: "string",
          defaultValue: "source",
          promotable: false,
        }),
      );
      const config = getProjectConfig(root);
      const datasource = new Datasource(config, root);
      await promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        tag: "web",
        apply: true,
      });
      expect(await datasource.forSet("staging").readVariable("policy")).toMatchObject({
        defaultValue: "source",
        promotable: false,
      });
      expect((await datasource.forSet("staging").readVariable("config")).compose).toBeDefined();
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test.each(["source", "destination", "fail"] as const)(
    "composition to ordinary uses %s policy without hybrid definitions",
    async (conflicts) => {
      const root = await createProject({
        configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
      });
      try {
        await writeFile(
          root,
          "sets/dev/variables/config.yml",
          JSON.stringify({
            description: "Ordinary",
            type: "string",
            defaultValue: "source",
            overrides: [{ key: "everyone", conditions: "*", value: "override" }],
          }),
        );
        await writeFile(
          root,
          "sets/staging/variables/config.yml",
          JSON.stringify({
            description: "Composition",
            compose: { enabled: { feature: "checkoutFlow" } },
            overrides: [{ key: "composed", conditions: "*", value: { enabled: true } }],
          }),
        );
        const before = await fs.promises.readFile(
          path.join(root, "sets/staging/variables/config.yml"),
          "utf8",
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        if (conflicts === "fail") {
          await expect(
            promoteProjectSets(config, datasource, {
              from: "dev",
              to: "staging",
              conflicts,
              apply: true,
            }),
          ).rejects.toThrow(/conflict/);
          expect(
            await fs.promises.readFile(
              path.join(root, "sets/staging/variables/config.yml"),
              "utf8",
            ),
          ).toBe(before);
        } else {
          await promoteProjectSets(config, datasource, {
            from: "dev",
            to: "staging",
            conflicts,
            apply: true,
          });
          const result = await datasource.forSet("staging").readVariable("config");
          if (conflicts === "source") {
            expect(result.defaultValue).toBe("source");
            expect(result.overrides).toHaveLength(1);
            expect(result).not.toHaveProperty("compose");
          } else {
            expect(result.compose).toBeDefined();
            expect(result).not.toHaveProperty("defaultValue");
            expect(result).not.toHaveProperty("type");
            expect(result.overrides).toEqual([
              { key: "composed", conditions: "*", value: { enabled: true } },
            ]);
          }
        }
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
  );
  test.each(["source", "destination", "fail"] as const)(
    "composition member named conditions switches source forms atomically with %s policy",
    async (conflicts) => {
      const root = await createProject({
        configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
      });
      try {
        for (const set of ["dev", "staging"]) {
          const featurePath = `sets/${set}/features/checkoutFlow.yml`;
          const source = await fs.promises.readFile(path.join(root, featurePath), "utf8");
          await writeFile(
            root,
            featurePath,
            `${source}\nvariations:\n  - value: control\n    weight: 100\n`,
          );
        }
        await writeFile(
          root,
          "sets/dev/variables/policy.yml",
          JSON.stringify({ description: "Policy", type: "boolean", defaultValue: true }),
        );
        await writeFile(
          root,
          "sets/staging/variables/policy.yml",
          JSON.stringify({ description: "Policy", type: "boolean", defaultValue: false }),
        );
        await writeFile(
          root,
          "sets/dev/variables/config.yml",
          JSON.stringify({
            description: "Composition",
            compose: { conditions: { variable: "policy" } },
          }),
        );
        await writeFile(
          root,
          "sets/staging/variables/config.yml",
          JSON.stringify({
            description: "Composition",
            compose: { conditions: { feature: "checkoutFlow", variation: true } },
          }),
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const promotion = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          conflicts,
          apply: true,
        });
        if (conflicts === "fail") {
          await expect(promotion).rejects.toThrow("conflict(s)");
        } else {
          const promoted = await promotion;
          expect(promoted.conflicts).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "compose.conditions" })]),
          );
        }
        const result = await datasource.forSet("staging").readVariable("config");
        expect(typeof result.compose === "object" ? result.compose.conditions : undefined).toEqual(
          conflicts === "source"
            ? { variable: "policy" }
            : { feature: "checkoutFlow", variation: true },
        );
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
  );
  test("promotes a selected composition's graph dependencies and preserves protected sources", async () => {
    const root = await createProject({
      configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
    });
    try {
      await writeFile(
        root,
        "sets/dev/variables/config.yml",
        JSON.stringify({
          description: "Composition",
          tags: ["web"],
          compose: {
            enabled: { feature: "checkoutFlow" },
            policy: { variable: "policy" },
            protected: { variable: "protected" },
          },
        }),
      );
      await writeFile(
        root,
        "sets/dev/variables/policy.yml",
        JSON.stringify({ description: "Policy", type: "string", defaultValue: "source" }),
      );
      for (const set of ["dev", "staging"]) {
        await writeFile(
          root,
          `sets/${set}/variables/protected.yml`,
          JSON.stringify({
            description: "Protected",
            type: "string",
            defaultValue: set,
            promotable: false,
          }),
        );
      }
      const config = getProjectConfig(root);
      const datasource = new Datasource(config, root);
      await promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        tag: "web",
        apply: true,
      });
      const destination = datasource.forSet("staging");
      expect((await destination.readVariable("config")).compose).toBeDefined();
      expect(await destination.readVariable("config")).not.toHaveProperty("defaultValue");
      expect((await destination.readVariable("policy")).defaultValue).toBe("source");
      expect((await destination.readVariable("protected")).defaultValue).toBe("staging");
      expect(await destination.listFeatures()).toContain("checkoutFlow");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  test.each(["source", "destination", "fail"] as const)(
    "changing variable kind uses %s conflict policy without hybrid definitions",
    async (conflicts) => {
      const root = await createProject({
        configContent: "module.exports = { sets: true, tags: ['all', 'web'] };",
      });
      try {
        await writeFile(
          root,
          "sets/dev/variables/config.yml",
          JSON.stringify({
            description: "Composition",
            compose: { enabled: { feature: "checkoutFlow" } },
            overrides: [{ key: "composed", conditions: "*", mutate: { enabled: false } }],
          }),
        );
        await writeFile(
          root,
          "sets/staging/variables/config.yml",
          JSON.stringify({ description: "Ordinary", type: "string", defaultValue: "original" }),
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        if (conflicts === "fail") {
          await expect(
            promoteProjectSets(config, datasource, {
              from: "dev",
              to: "staging",
              conflicts,
              apply: true,
            }),
          ).rejects.toThrow();
        } else {
          await promoteProjectSets(config, datasource, {
            from: "dev",
            to: "staging",
            conflicts,
            apply: true,
          });
          const result = await datasource.forSet("staging").readVariable("config");
          if (conflicts === "source") {
            expect(result.compose).toBeDefined();
            expect(result.overrides).toEqual([
              { key: "composed", conditions: "*", mutate: { enabled: false } },
            ]);
            expect(result).not.toHaveProperty("defaultValue");
            expect(result).not.toHaveProperty("type");
          } else {
            expect(result.defaultValue).toBe("original");
            expect(result).not.toHaveProperty("compose");
          }
        }
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
  );
  describe("ordered mutation promotion", () => {
    const cases = [
      {
        name: "whole lists with repeated paths",
        source: [{ count: 1 }, { count: 2 }],
        destination: [{ count: 3 }, { count: 4 }],
      },
      {
        name: "reordered lists",
        source: [{ count: 1 }, { count: 2 }],
        destination: [{ count: 2 }, { count: 1 }],
      },
      { name: "map to list", source: [{ count: 1 }], destination: { count: 1 } },
      { name: "list to map", source: { count: 1 }, destination: [{ count: 1 }] },
      { name: "empty replacement lists", source: [], destination: [{ count: 1 }] },
    ];
    describe.each(cases)("$name", ({ source, destination }) => {
      it.each(["source", "destination", "fail"] as const)(
        "uses %s policy across all override locations",
        async (conflicts) => {
          const root = await createProject({
            configContent:
              "module.exports = { sets: true, tags: ['all', 'web'], environments: ['production'] };",
          });
          try {
            const override = (mutate: unknown) => ({
              key: "regional",
              conditions: "*",
              promotable: true,
              mutate,
            });
            const paths = ["variables/policy.yml", "features/checkoutFlow.yml"];
            for (const [set, mutate] of [
              ["dev", source],
              ["staging", destination],
            ] as const) {
              await writeFile(
                root,
                `sets/${set}/schemas/payload.yml`,
                JSON.stringify({
                  description: "Payload",
                  type: "object",
                  properties: { count: { type: "integer" } },
                }),
              );
              await writeFile(
                root,
                `sets/${set}/tests/features/checkoutFlow.spec.yml`,
                JSON.stringify({
                  feature: "checkoutFlow",
                  assertions: [{ environment: "production", at: 10, expectedToBeEnabled: true }],
                }),
              );
              await writeFile(
                root,
                `sets/${set}/${paths[0]}`,
                JSON.stringify({
                  description: "Policy",
                  type: "object",
                  properties: { count: { type: "integer" } },
                  defaultValue: { count: 0 },
                  overrides: {
                    production: [
                      {
                        key: "parent",
                        conditions: "*",
                        mutate,
                        continue: true,
                        overrides: [override(mutate)],
                      },
                    ],
                  },
                }),
              );
              await writeFile(
                root,
                `sets/${set}/${paths[1]}`,
                JSON.stringify({
                  description: "Checkout",
                  tags: ["all"],
                  bucketBy: "userId",
                  variablesSchema: { payload: { schema: "payload", defaultValue: { count: 0 } } },
                  rules: {
                    production: [
                      {
                        key: "everyone",
                        conditions: "*",
                        percentage: 100,
                        variables: { payload: { count: 0 } },
                        variableOverrides: { payload: [override(mutate)] },
                      },
                    ],
                  },
                  variations: [
                    {
                      value: "control",
                      weight: 100,
                      variables: { payload: { count: 0 } },
                      variableOverrides: { payload: [override(mutate)] },
                    },
                  ],
                }),
              );
            }
            const config = getProjectConfig(root);
            const datasource = new Datasource(config, root);
            const before = paths.map((file) =>
              fs.readFileSync(path.join(root, "sets/staging", file), "utf8"),
            );
            const operation = promoteProjectSets(config, datasource, {
              from: "dev",
              to: "staging",
              conflicts,
              apply: true,
            });
            if (conflicts === "fail") {
              await expect(operation).rejects.toThrow("mutate");
              expect(
                paths.map((file) => fs.readFileSync(path.join(root, "sets/staging", file), "utf8")),
              ).toEqual(before);
            } else {
              const result = await operation;
              const mutationConflicts = result.conflicts.filter((entry) =>
                entry.path.endsWith(".mutate"),
              );
              expect(mutationConflicts).toHaveLength(4);
              mutationConflicts.forEach((entry) =>
                expect(entry).toMatchObject({ source, destination }),
              );
              const expected = conflicts === "source" ? source : destination;
              const variable = await datasource.forSet("staging").readVariable("policy");
              const parent =
                !Array.isArray(variable.overrides) && variable.overrides?.production[0];
              expect(parent).toMatchObject({ mutate: expected, overrides: [{ mutate: expected }] });
              const feature = await datasource.forSet("staging").readFeature("checkoutFlow");
              const rules = !Array.isArray(feature.rules) ? (feature.rules?.production ?? []) : [];
              expect(rules[0].variableOverrides?.payload[0].mutate).toEqual(expected);
              expect(feature.variations?.[0].variableOverrides?.payload[0].mutate).toEqual(
                expected,
              );
            }
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        },
      );
    });
  });

  it.each([false, true])(
    "preserves the adapter project root with nested Sets (apply=%s)",
    async (apply) => {
      const root = await createProject({
        configContent:
          "module.exports = { sets: true, tags: ['all', 'web'], setsDirectoryPath: '<rootDir>/definitions/sets' };",
      });
      try {
        fs.mkdirSync(path.join(root, "definitions"));
        fs.renameSync(path.join(root, "sets"), path.join(root, "definitions/sets"));
        const roots: Array<string | undefined> = [];
        class RootAwareAdapter extends FilesystemAdapter {
          constructor(...args: ConstructorParameters<typeof FilesystemAdapter>) {
            super(...args);
            roots.push(args[1]);
            if (args[1] !== root) throw new Error("Adapter received a different project root");
          }
        }
        const config = { ...getProjectConfig(root), adapter: RootAwareAdapter };
        const destination = path.join(root, "definitions/sets/staging/features/checkoutFlow.yml");
        const before = fs.readFileSync(destination, "utf8");
        await promoteProjectSets(config, new Datasource(config, root), {
          from: "dev",
          to: "staging",
          conflicts: "source",
          apply,
        });
        expect(roots.length).toBeGreaterThanOrEqual(4);
        expect(roots.every((value) => value === root)).toBe(true);
        expect(fs.readFileSync(destination, "utf8") === before).toBe(!apply);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["source", "destination", "fail"] as const)(
    "preserves protected slots while merging nested override order with %s policy",
    async (conflicts) => {
      const root = await createProject();
      try {
        const item = (key: string, promotable = true) => ({
          key,
          conditions: "*",
          value: key,
          continue: true,
          ...(promotable ? {} : { promotable: false }),
        });
        const definition = (source: boolean) => ({
          description: "Policy",
          type: "string",
          defaultValue: "base",
          overrides: [
            {
              key: "parent",
              conditions: "*",
              value: "parent",
              overrides: source
                ? [
                    item("second"),
                    item("first"),
                    item("new"),
                    item("locked"),
                    item("ignored", false),
                  ]
                : [item("first"), item("locked", false), item("local"), item("second")],
            },
          ],
        });
        // JSON is valid YAML and retains the shape of these nested fixtures clearly.
        await writeFile(root, "sets/dev/variables/policy.yml", JSON.stringify(definition(true)));
        await writeFile(
          root,
          "sets/staging/variables/policy.yml",
          JSON.stringify(definition(false)),
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const operation = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          conflicts,
          apply: true,
        });
        if (conflicts === "fail") await expect(operation).rejects.toThrow("conflict(s)");
        else {
          const result = await operation;
          expect(result.conflicts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ path: "overrides.parent.overrides.order" }),
            ]),
          );
          const variable = await datasource.forSet("staging").readVariable("policy");
          const overrides = Array.isArray(variable.overrides)
            ? variable.overrides[0].overrides
            : [];
          expect(overrides?.map((entry) => entry.key)).toEqual(
            conflicts === "source"
              ? ["second", "locked", "local", "first", "new"]
              : ["first", "locked", "local", "second", "new"],
          );
          expect(overrides?.[1]).toMatchObject({ key: "locked", promotable: false });
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it.each(
    [false, true].flatMap((composed) =>
      (["source", "destination", "fail"] as const).map(
        (conflicts) => [composed, conflicts] as const,
      ),
    ),
  )(
    "handles mutually exclusive override forms, composed=%s with %s policy",
    async (composed, conflicts) => {
      const root = await createProject();
      try {
        if (composed) {
          for (const set of ["dev", "staging"])
            await writeFile(
              root,
              `sets/${set}/variables/countValue.yml`,
              "description: Count\ntype: integer\ndefaultValue: 0\n",
            );
        }
        const prefix =
          "description: Policy\n" +
          (composed
            ? "compose:\n  count: { variable: countValue }\n"
            : "type: object\nproperties:\n  count:\n    type: integer\ndefaultValue: { count: 0 }\n") +
          "overrides:\n  - key: regional\n";
        await writeFile(
          root,
          "sets/dev/variables/policy.yml",
          prefix + "    conditions: '*'\n    value: { count: 2 }\n",
        );
        await writeFile(
          root,
          "sets/staging/variables/policy.yml",
          prefix +
            "    conditions: { attribute: team, operator: equals, value: engineering }\n    mutate: { count: 1 }\n",
        );
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const before = fs.readFileSync(
          path.join(root, "sets/staging/variables/policy.yml"),
          "utf8",
        );
        const operation = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          conflicts,
          apply: true,
        });
        if (conflicts === "fail") {
          await expect(operation).rejects.toThrow("conflict(s)");
          expect(
            fs.readFileSync(path.join(root, "sets/staging/variables/policy.yml"), "utf8"),
          ).toBe(before);
        } else {
          await operation;
          const result = await datasource.forSet("staging").readVariable("policy");
          const override = Array.isArray(result.overrides) && result.overrides[0];
          if (conflicts === "source") {
            expect(override).toMatchObject({ value: { count: 2 }, conditions: "*" });
            expect(override).not.toHaveProperty("mutate");
            expect(override).not.toHaveProperty("segments");
          } else {
            expect(override).toMatchObject({ mutate: { count: 1 } });
            expect(override).not.toHaveProperty("value");
            expect(override).not.toHaveProperty("segments");
          }
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["source", "destination", "fail"] as const)(
    "treats override order as a semantic conflict with %s policy",
    async (conflicts) => {
      const root = await createProject();
      try {
        const body = (keys: string[]) =>
          "description: Policy\ntype: integer\ndefaultValue: 0\noverrides:\n" +
          keys
            .map(
              (key) =>
                `  - key: ${key}\n    conditions: '*'\n    continue: true\n    value: ${key === "first" ? 1 : 2}\n`,
            )
            .join("");
        await writeFile(root, "sets/dev/variables/policy.yml", body(["second", "first"]));
        await writeFile(root, "sets/staging/variables/policy.yml", body(["first", "second"]));
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const operation = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          conflicts,
          apply: true,
        });
        if (conflicts === "fail") await expect(operation).rejects.toThrow("conflict(s)");
        else {
          const result = await operation;
          expect(result.conflicts).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "overrides.order" })]),
          );
          const scoped = datasource.forSet("staging");
          const datafile = await getCustomDatafile({
            projectConfig: scoped.getConfig(),
            datasource: scoped,
            environment: false,
            variableKey: "policy",
          });
          const f = createFeaturevisor({ datafile, logLevel: "fatal" });
          expect(f.getVariable("policy")).toBe(conflicts === "source" ? 1 : 2);
          f.close();
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])(
    "rejects an invalid merged destination before writes (apply=%s)",
    async (apply) => {
      const root = await createProject();
      try {
        await writeFile(
          root,
          "sets/dev/variables/policy.yml",
          "description: Policy\ntype: integer\nminimum: 10\ndefaultValue: 12\n",
        );
        await writeFile(
          root,
          "sets/staging/variables/policy.yml",
          "description: Policy\ntype: integer\nmaximum: 5\ndefaultValue: 2\n",
        );
        const files = fs
          .readdirSync(path.join(root, "sets/staging"), { recursive: true })
          .filter((file) => fs.statSync(path.join(root, "sets/staging", String(file))).isFile())
          .map(String);
        const before = files.map((file) =>
          fs.readFileSync(path.join(root, "sets/staging", file), "utf8"),
        );
        const config = getProjectConfig(root);
        await expect(
          promoteProjectSets(config, new Datasource(config, root), {
            from: "dev",
            to: "staging",
            apply,
          }),
        ).rejects.toThrow("promotion result");
        expect(
          files.map((file) => fs.readFileSync(path.join(root, "sets/staging", file), "utf8")),
        ).toEqual(before);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it("round trips promoted definitions with the documented TOML parser", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "featurevisor-promote-toml-"));
    try {
      const exampleConfig = path.resolve(
        __dirname,
        "../../../../examples/example-toml/featurevisor.config.js",
      );
      await writeFile(
        root,
        "featurevisor.config.js",
        `module.exports = { ...require(${JSON.stringify(exampleConfig)}), sets: true, environments: undefined };`,
      );
      const config = getProjectConfig(root);
      const parser = config.parser as CustomParser;
      const feature = {
        description: "Checkout with nested configuration",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: {
          label: { type: "string", defaultValue: "Continue" },
        },
        rules: [{ key: "everyone", conditions: "*", percentage: 100, variables: { label: "Pay" } }],
      };
      for (const set of ["dev", "staging"]) {
        await writeFile(
          root,
          `sets/${set}/attributes/userId.toml`,
          parser.stringify({ description: "User ID", type: "string" }),
        );
        await writeFile(
          root,
          `sets/${set}/features/checkout.toml`,
          parser.stringify(set === "dev" ? feature : { ...feature, description: "Old checkout" }),
        );
      }
      const destination = path.join(root, "sets/staging/features/checkout.toml");
      const before = await fs.promises.readFile(destination, "utf8");
      const datasource = new Datasource(config, root);
      await promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        apply: false,
        conflicts: "source",
      });
      expect(await fs.promises.readFile(destination, "utf8")).toBe(before);
      await promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        apply: true,
        conflicts: "source",
      });
      expect(parser.parse(await fs.promises.readFile(destination, "utf8"))).toEqual(feature);
      expect(
        await new Datasource(config, root).forSet("staging").readFeature("checkout"),
      ).toMatchObject(feature);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it.each(["source", "destination", "fail"] as const)(
    "resolves changes of spec kind at the same path using the %s policy",
    async (conflicts) => {
      for (const sourceIsScenario of [true, false]) {
        const root = await createProject();
        const scenario = "checks:\n  - feature: checkoutFlow\n    enabled: true\n";
        const entity =
          "feature: checkoutFlow\nassertions:\n  - at: 10\n    context: {}\n    expectedToBeEnabled: true\n";
        const source = sourceIsScenario ? scenario : entity;
        const destination = sourceIsScenario ? entity : scenario;
        const relative = "tests/journeys/checkout.spec.yml";
        await writeFile(root, `sets/dev/${relative}`, source);
        await writeFile(root, `sets/staging/${relative}`, destination);
        const config = getProjectConfig(root);
        const datasource = new Datasource(config, root);
        const operation = promoteProjectSets(config, datasource, {
          from: "dev",
          to: "staging",
          apply: true,
          conflicts,
        });
        if (conflicts === "fail") {
          await expect(operation).rejects.toThrow("conflict(s)");
          expect(
            await fs.promises.readFile(path.join(root, `sets/staging/${relative}`), "utf8"),
          ).toBe(destination);
        } else {
          await operation;
          const spec = await datasource.forSet("staging").readTest("journeys.checkout");
          const isScenario = conflicts === "source" ? sourceIsScenario : !sourceIsScenario;
          expect(spec).toHaveProperty(isScenario ? "checks" : "assertions");
          expect(spec).not.toHaveProperty(isScenario ? "assertions" : "checks");
        }
      }
    },
  );

  it("promotes mixed variable dependencies and selector segments but skips protected branches", async () => {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/segments/internal.yml",
      [
        "description: Internal users",
        "conditions:",
        "  attribute: team",
        "  operator: equals",
        "  value: internal",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/features/policySource.yml",
      [
        "description: Policy source",
        "bucketBy: userId",
        "variablesSchema:",
        "  config.policy:",
        "    type: string",
        "    defaultValue: standard",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "    variableOverrides:",
        "      config.policy:",
        "        - key: internal",
        "          conditions: internal",
        "          value: priority",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/variables/policy.yml",
      [
        "description: Policy",
        "type: string",
        "defaultValue: standard",
        "conditions:",
        "  feature: policySource",
        "  variable: config.policy",
        "  operator: equals",
        "  value: priority",
        "overrides:",
        "  - key: protected",
        "    promotable: false",
        "    conditions: { feature: protectedDependency }",
        "    value: protected",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/features/selectedFeature.yml",
      [
        "description: Selected feature",
        "tags: [web]",
        "bucketBy: userId",
        "conditions:",
        "  variable: policy",
        "  operator: equals",
        "  value: priority",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/features/protectedDependency.yml",
      [
        "description: Protected",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );

    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });
    const destination = datasource.forSet("staging");
    expect(await destination.featureExists("selectedFeature")).toBe(true);
    expect(await destination.variableExists("policy")).toBe(true);
    expect(await destination.featureExists("policySource")).toBe(true);
    expect(await destination.segmentExists("internal")).toBe(true);
    expect(await destination.featureExists("protectedDependency")).toBe(false);
  });

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
        '    conditions: "*"',
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
        "includeVariables:",
        "  - web*",
        "excludeVariables:",
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
          `    conditions: ${segment}`,
          "    percentage: 100",
          "",
        ].join("\n"),
      );
    }
    for (const key of ["webSettings", "webInternalSettings"]) {
      await writeFile(
        root,
        `sets/dev/variables/${key}.yml`,
        [
          `description: ${key}`,
          "tags:",
          "  - web",
          "  - all",
          "type: string",
          `defaultValue: ${key}`,
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
    expect(result.dependencies.variable).toEqual(1);
    expect(result.dependencies.segment).toEqual(1);
    expect(result.dependencies.attribute).toEqual(2);
    expect(result.files.created).toEqual(
      expect.arrayContaining([
        expect.stringContaining("targets/web.yml"),
        expect.stringContaining("features/webCheckout.yml"),
        expect.stringContaining("variables/webSettings.yml"),
      ]),
    );
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([expect.stringContaining("features/webInternalTools.yml")]),
    );
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([expect.stringContaining("variables/webInternalSettings.yml")]),
    );

    const destinationDatasource = datasource.forSet("staging");
    const target = await destinationDatasource.readTarget("web");
    expect(await destinationDatasource.listVariables()).toEqual(["webSettings"]);
    const promotedVariable = await destinationDatasource.readVariable("webSettings");
    expect(promotedVariable).toEqual(expect.objectContaining({ defaultValue: "webSettings" }));
    expect(promotedVariable.overrides).toBeUndefined();
    const datafile = await getCustomDatafile({
      environment: false,
      projectConfig: destinationDatasource.getConfig(),
      datasource: destinationDatasource,
      revision: "test",
      tag: target.tag,
      tags: target.tags,
      includeFeatures: target.includeFeatures,
      excludeFeatures: target.excludeFeatures,
      includeVariables: target.includeVariables,
      excludeVariables: target.excludeVariables,
    });
    expect(Object.keys(datafile.features)).toEqual(["webCheckout"]);
    expect(Object.keys(datafile.variables || {})).toEqual(["webSettings"]);
    expect(Object.keys(datafile.segments)).toEqual(["internal"]);
  });

  it.each([
    "  - { feature: checkoutFlow }",
    "  or: [{feature: checkoutFlow}, {not: [{feature: checkoutFlow}]}]",
  ])("promotes tagged variables with grouped dependencies: %s", async function (requirement) {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/protectedDependency.yml",
      [
        "description: Protected dependency",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/segments/protectedUsers.yml",
      [
        "description: Protected users",
        "conditions:",
        "  - attribute: team",
        "    operator: equals",
        "    value: protected",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/variables/checkoutSettings.yml",
      [
        "description: Checkout settings",
        "tags:",
        "  - web",
        "type: object",
        "defaultValue:",
        "  enabled: true",
        "conditions:",
        requirement,
        "overrides:",
        "  - key: internal",
        "    conditions: internal",
        "    value:",
        "      enabled: false",
        "    overrides:",
        "      - key: nested",
        "        conditions: internal",
        "        value:",
        "          enabled: true",
        "      - key: nested-protected",
        "        promotable: false",
        "        conditions: [protectedUsers, { feature: protectedDependency }]",
        "        value:",
        "          enabled: true",
        "  - key: protected",
        "    promotable: false",
        "    conditions: [protectedUsers, { feature: protectedDependency }]",
        "    value:",
        "      enabled: true",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });

    expect(result.dependencies.variable).toBe(1);
    expect(result.dependencies.feature).toBe(1);
    expect(result.dependencies.segment).toBe(1);
    expect(result.dependencies.attribute).toBe(2);
    const variable = await datasource.forSet("staging").readVariable("checkoutSettings");
    expect(Array.isArray(variable.overrides) && variable.overrides.map((item) => item.key)).toEqual(
      ["internal"],
    );
    expect(
      Array.isArray(variable.overrides) && variable.overrides[0].overrides?.map((item) => item.key),
    ).toEqual(["nested"]);
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("features/protectedDependency.yml"),
        expect.stringContaining("segments/protectedUsers.yml"),
      ]),
    );
  });

  it("promotes keyed feature variable overrides with item-level protection", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/checkoutDependency.yml",
      [
        "description: Checkout dependency",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/segments/protectedUsers.yml",
      [
        "description: Protected users",
        "conditions:",
        "  - attribute: team",
        "    operator: equals",
        "    value: protected",
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
        "variablesSchema:",
        "  payload:",
        "    schema: payload",
        "    defaultValue: {}",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "    variableOverrides:",
        "      payload:",
        "        - key: internal",
        "          conditions: [internal, { feature: checkoutDependency }]",
        "          value: {}",
        "        - key: protected",
        "          promotable: false",
        "          conditions: protectedUsers",
        "          value: {}",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });

    const feature = await datasource.forSet("staging").readFeature("checkoutFlow");
    const rules = Array.isArray(feature.rules) ? feature.rules : [];
    expect(rules[0].variableOverrides?.payload.map((override) => override.key)).toEqual([
      "internal",
    ]);
    expect(result.files.created).toEqual(
      expect.arrayContaining([expect.stringContaining("features/checkoutDependency.yml")]),
    );
    expect(result.files.created).not.toEqual(
      expect.arrayContaining([expect.stringContaining("segments/protectedUsers.yml")]),
    );
  });

  it("merges nested global variable overrides by key and preserves protected children", async () => {
    const root = await createProject();
    const variable = (parent: string, open: string, protectedValue: string, protect = false) =>
      [
        "description: Nested settings",
        "tags:",
        "  - web",
        "type: string",
        "defaultValue: default",
        "overrides:",
        "  - key: country",
        '    conditions: "*"',
        `    value: ${parent}`,
        "    overrides:",
        "      - key: open",
        "        conditions:",
        "          attribute: team",
        "          operator: equals",
        "          value: open",
        `        value: ${open}`,
        "      - key: protected",
        ...(protect ? ["        promotable: false"] : []),
        "        conditions:",
        "          attribute: team",
        "          operator: equals",
        "          value: protected",
        `        value: ${protectedValue}`,
        "",
      ].join("\n");

    await writeFile(
      root,
      "sets/dev/variables/nestedSettings.yml",
      variable("source-parent", "source-open", "source-protected"),
    );
    await writeFile(
      root,
      "sets/staging/variables/nestedSettings.yml",
      variable("destination-parent", "destination-open", "destination-protected", true),
    );

    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });

    const promoted = await datasource.forSet("staging").readVariable("nestedSettings");
    expect(Array.isArray(promoted.overrides)).toBe(true);
    const country = Array.isArray(promoted.overrides) ? promoted.overrides[0] : undefined;
    expect(country?.value).toBe("source-parent");
    expect(country?.overrides?.map((entry) => [entry.key, entry.value])).toEqual([
      ["open", "source-open"],
      ["protected", "destination-protected"],
    ]);
  });

  it("promotes nested reusable schemas without treating runtime schema keys as references", async function () {
    const root = await createProject();
    await writeFile(root, "sets/dev/schemas/inner.yml", "description: Inner value\ntype: string\n");
    await writeFile(
      root,
      "sets/dev/schemas/outer.yml",
      [
        "description: Outer value",
        "type: object",
        "properties:",
        "  value:",
        "    schema: inner",
        "  schema:",
        "    type: string",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/variables/schemaSettings.yml",
      [
        "description: Schema settings",
        "tags:",
        "  - web",
        "schema: outer",
        "defaultValue:",
        "  value: configured",
        "  schema: not-a-project-reference",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });

    expect(result.dependencies.variable).toBe(1);
    expect(result.dependencies.schema).toBe(2);
    expect(result.files.created).toEqual(
      expect.arrayContaining([
        expect.stringContaining("schemas/inner.yml"),
        expect.stringContaining("schemas/outer.yml"),
        expect.stringContaining("variables/schemaSettings.yml"),
      ]),
    );
  });

  it("rejects removed Groups in the source set before promotion", async function () {
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
        '    conditions: "*"',
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
        "    conditions: internal",
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

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        tag: "web",
      }),
    ).rejects.toThrow("Groups were removed in v4");
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
    ).rejects.toThrow("No source features or variables matched the promotion filters.");

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
        '    conditions: "*"',
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
        '    conditions: "*"',
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
        '    conditions: "*"',
        "    percentage: 100",
        "  - key: dev-only",
        "    promotable: false",
        '    conditions: "*"',
        "    percentage: 100",
        "  - key: protected",
        '    conditions: "*"',
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
        '    conditions: "*"',
        "    percentage: 0",
        "  - key: protected",
        "    promotable: false",
        '    conditions: "*"',
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

  it("skips source assertions and preserves destination assertions marked non-promotable", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/tests/features/checkoutFlow.spec.yml",
      [
        "feature: checkoutFlow",
        "assertions:",
        "  - key: shared",
        "    at: 10",
        "    context:",
        '      userId: "user-1"',
        "    expectedToBeEnabled: true",
        "  - key: dev-only",
        "    promotable: false",
        "    at: 20",
        "    context:",
        '      userId: "user-2"',
        "    expectedToBeEnabled: true",
        "  - key: protected",
        "    at: 30",
        "    context:",
        '      userId: "user-3"',
        "    expectedToBeEnabled: true",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/staging/tests/features/checkoutFlow.spec.yml",
      [
        "feature: checkoutFlow",
        "assertions:",
        "  - key: shared",
        "    at: 10",
        "    context:",
        '      userId: "user-1"',
        "    expectedToBeEnabled: false",
        "  - key: protected",
        "    promotable: false",
        "    at: 30",
        "    context:",
        '      userId: "user-3"',
        "    expectedToBeEnabled: false",
        "  - key: staging-only",
        "    at: 40",
        "    context:",
        '      userId: "user-4"',
        "    expectedToBeEnabled: false",
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

    const test = await datasource.forSet("staging").readTest("features.checkoutFlow");
    expect(test.assertions.map((assertion) => assertion.key)).toEqual([
      "shared",
      "protected",
      "staging-only",
    ]);
    expect(test.assertions.find((assertion) => assertion.key === "shared")).toMatchObject({
      expectedToBeEnabled: true,
    });
    expect(test.assertions.find((assertion) => assertion.key === "protected")).toMatchObject({
      promotable: false,
      expectedToBeEnabled: false,
    });
  });

  it("applies assertion protection to segment test specs", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/tests/segments/internal.spec.yml",
      [
        "segment: internal",
        "assertions:",
        "  - key: engineering",
        "    context:",
        "      team: engineering",
        "    expectedToMatch: true",
        "  - key: dev-only",
        "    promotable: false",
        "    context:",
        "      team: development",
        "    expectedToMatch: true",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/staging/tests/segments/internal.spec.yml",
      [
        "segment: internal",
        "assertions:",
        "  - key: engineering",
        "    context:",
        "      team: engineering",
        "    expectedToMatch: false",
        "  - key: staging-only",
        "    promotable: false",
        "    context:",
        "      team: support",
        "    expectedToMatch: true",
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

    const test = await datasource.forSet("staging").readTest("segments.internal");
    expect(test.assertions.map((assertion) => assertion.key)).toEqual([
      "engineering",
      "staging-only",
    ]);
    expect(test.assertions.find((assertion) => assertion.key === "engineering")).toMatchObject({
      expectedToMatch: true,
    });
    expect(test.assertions.find((assertion) => assertion.key === "staging-only")).toMatchObject({
      promotable: false,
      expectedToMatch: true,
    });
  });

  it("applies assertion protection to global variable test specs", async function () {
    const root = await createProject();
    for (const set of ["dev", "staging"]) {
      await writeFile(
        root,
        `sets/${set}/variables/supportEmail.yml`,
        [
          "description: Support email",
          "tags:",
          "  - web",
          "type: string",
          `defaultValue: ${set}@example.com`,
          "",
        ].join("\n"),
      );
    }
    await writeFile(
      root,
      "sets/dev/tests/variables/supportEmail.spec.yml",
      [
        "variable: supportEmail",
        "assertions:",
        "  - key: shared",
        "    expectedValue: source@example.com",
        "  - key: dev-only",
        "    promotable: false",
        "    expectedValue: dev@example.com",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/staging/tests/variables/supportEmail.spec.yml",
      [
        "variable: supportEmail",
        "assertions:",
        "  - key: shared",
        "    expectedValue: destination@example.com",
        "  - key: protected",
        "    promotable: false",
        "    expectedValue: protected@example.com",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });

    const test = await datasource.forSet("staging").readTest("variables.supportEmail");
    expect(test.assertions.map((assertion) => assertion.key)).toEqual(["shared", "protected"]);
    expect(test.assertions.find((assertion) => assertion.key === "shared")).toMatchObject({
      expectedValue: "source@example.com",
    });
    expect(test.assertions.find((assertion) => assertion.key === "protected")).toMatchObject({
      promotable: false,
      expectedValue: "protected@example.com",
    });
  });

  it("promotes scenarios only when their check references survive filtering", async function () {
    const root = await createProject({ sets: ["dev", "staging", "full"] });
    for (const set of ["dev", "staging", "full"]) {
      await writeFile(
        root,
        `sets/${set}/variables/supportEmail.yml`,
        [
          "description: Support email",
          "tags:",
          "  - web",
          "type: string",
          `defaultValue: ${set}@example.com`,
          "",
        ].join("\n"),
      );
      await writeFile(
        root,
        `sets/${set}/variables/internalEmail.yml`,
        [
          "description: Internal email",
          "tags:",
          "  - all",
          "type: string",
          `defaultValue: internal-${set}@example.com`,
          "",
        ].join("\n"),
      );
    }
    await writeFile(
      root,
      "sets/dev/variables/sourceOnlyEmail.yml",
      [
        "description: Source only email",
        "tags:",
        "  - all",
        "type: string",
        "defaultValue: source-only@example.com",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/support.spec.yml",
      [
        "description: Support contact is configured",
        "matrix:",
        "  variable: [supportEmail]",
        "  feature: [checkoutFlow]",
        "  childVariable: [internalEmail]",
        "checks:",
        '  - variable: "${{ variable }}"',
        "    operator: contains",
        '    value: "@"',
        "  - and:",
        '      - feature: "${{ feature }}"',
        "        enabled: true",
        "children:",
        "  - checks:",
        '      - variable: "${{ childVariable }}"',
        "        operator: contains",
        '        value: "@"',
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/internal.spec.yml",
      [
        "description: All contacts are configured",
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "  - variable: internalEmail",
        "    operator: contains",
        '    value: "@"',
        "  - feature: checkoutFlow",
        "    variable: payload",
        "    operator: exists",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/source-only.spec.yml",
      [
        "description: Source only contact is configured",
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "  - variable: sourceOnlyEmail",
        "    operator: contains",
        '    value: "@"',
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/dev-only.spec.yml",
      [
        "description: Development only scenario",
        "promotable: false",
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/locked.spec.yml",
      [
        "description: Source scenario",
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/staging/tests/scenarios/locked.spec.yml",
      [
        "description: Destination scenario",
        "promotable: false",
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/variables/supportEmail-check.spec.yml",
      [
        "variable: supportEmail",
        "assertions:",
        "  - checks:",
        "      - operator: notEquals",
        "        compareTo:",
        "          variable: internalEmail",
        "",
      ].join("\n"),
    );

    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const filtered = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      tag: "web",
      apply: true,
    });

    expect(await datasource.forSet("staging").listScenarios()).toEqual(
      expect.arrayContaining(["scenarios.support", "scenarios.internal", "scenarios.locked"]),
    );
    expect(await datasource.forSet("staging").listScenarios()).not.toEqual(
      expect.arrayContaining(["scenarios.source-only", "scenarios.dev-only"]),
    );
    const stagingTests = await datasource.forSet("staging").listTests();
    expect(stagingTests).toEqual(expect.arrayContaining(["variables.supportEmail-check"]));
    expect(stagingTests.every((test) => !test.startsWith("scenarios."))).toBe(true);
    expect(await datasource.forSet("staging").readScenario("scenarios.locked")).toMatchObject({
      description: "Destination scenario",
      promotable: false,
    });
    expect(filtered.dependencies.scenario).toBe(3);

    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "full",
      apply: true,
    });
    expect(await datasource.forSet("full").listScenarios()).toEqual(
      expect.arrayContaining([
        "scenarios.support",
        "scenarios.internal",
        "scenarios.source-only",
        "scenarios.locked",
      ]),
    );
    expect(await datasource.forSet("full").listScenarios()).not.toEqual(
      expect.arrayContaining(["scenarios.dev-only"]),
    );
    const fullTests = await datasource.forSet("full").listTests();
    expect(fullTests).toEqual(expect.arrayContaining(["variables.supportEmail-check"]));
    expect(fullTests.every((test) => !test.startsWith("scenarios."))).toBe(true);
  });

  it("promotes a literal scenario target required by a filtered promotion", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/targets/web.yml",
      'description: Web target\nincludeFeatures: "*"\n',
    );
    await writeFile(root, "sets/dev/targets/unrelated.yml", "description: Unrelated target\n");
    await writeFile(
      root,
      "sets/dev/features/unrelatedBanner.yml",
      [
        "description: Unrelated banner",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/checkout.spec.yml",
      [
        "description: Checkout on web",
        "target: web",
        "checks:",
        "  - feature: checkoutFlow",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    const result = await promoteProjectSets(config, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });

    expect(result.dependencies.target).toBe(1);
    expect(await datasource.forSet("staging").listTargets()).toEqual(["web"]);
    expect(await datasource.forSet("staging").featureExists("unrelatedBanner")).toBe(false);
    expect(await datasource.forSet("staging").readScenario("scenarios.checkout")).toMatchObject({
      target: "web",
    });
  });

  it("promotes every matrix expanded scenario target", async function () {
    const root = await createProject();
    await writeFile(root, "sets/dev/targets/mobile.yml", "description: Mobile target\n");
    await writeFile(root, "sets/dev/targets/web.yml", "description: Web target\n");
    await writeFile(
      root,
      "sets/dev/tests/scenarios/checkout-matrix.spec.yml",
      [
        "description: Checkout on every client",
        "matrix:",
        "  client: [web, mobile]",
        'target: "${{ client }}"',
        "checks:",
        "  - feature: checkoutFlow",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    const result = await promoteProjectSets(config, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });

    expect(result.dependencies.target).toBe(2);
    expect(await datasource.forSet("staging").listTargets()).toEqual(["mobile", "web"]);
  });

  it("uses an existing protected destination target without promoting over it", async function () {
    const root = await createProject();
    await writeFile(root, "sets/dev/targets/web.yml", "description: Source web target\n");
    await writeFile(
      root,
      "sets/staging/targets/web.yml",
      "description: Protected staging target\npromotable: false\n",
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/checkout.spec.yml",
      [
        "description: Checkout on web",
        "target: web",
        "checks:",
        "  - feature: checkoutFlow",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    const result = await promoteProjectSets(config, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });

    expect(result.dependencies.target).toBe(0);
    expect(await datasource.forSet("staging").readTarget("web")).toMatchObject({
      description: "Protected staging target",
      promotable: false,
    });
    expect(await datasource.forSet("staging").readScenario("scenarios.checkout")).toMatchObject({
      target: "web",
    });
  });

  it("fails before writing when a selected scenario references a missing target", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/tests/scenarios/checkout.spec.yml",
      [
        "description: Checkout on a missing target",
        "target: missing",
        "checks:",
        "  - feature: checkoutFlow",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const destinationFeaturePath = path.join(root, "sets/staging/features/checkoutFlow.yml");
    const destinationBefore = await fs.promises.readFile(destinationFeaturePath, "utf8");
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(
      promoteProjectSets(config, datasource, {
        from: "dev",
        to: "staging",
        includeFeatures: "checkoutFlow",
        apply: true,
      }),
    ).rejects.toThrow('Unknown target "missing"');

    expect(await fs.promises.readFile(destinationFeaturePath, "utf8")).toBe(destinationBefore);
    expect(await datasource.forSet("staging").listScenarios()).not.toContain("scenarios.checkout");
  });

  it("closes targets over selected entity assertions without widening protected scope", async function () {
    const root = await createProject();
    for (const target of ["assertion", "scenario", "protected", "unrelated"]) {
      await writeFile(root, `sets/dev/targets/${target}.yml`, `description: ${target} target\n`);
    }
    await writeFile(
      root,
      "sets/dev/tests/features/checkout-targets.spec.yml",
      [
        "feature: checkoutFlow",
        "assertions:",
        "  - key: portable",
        "    target: assertion",
        "    at: 10",
        "    context: {}",
        "    expectedToBeEnabled: true",
        "  - key: protected",
        "    promotable: false",
        "    target: protected",
        "    at: 10",
        "    context: {}",
        "    expectedToBeEnabled: true",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/scenarios/checkout.spec.yml",
      [
        "description: Checkout scenario",
        "target: scenario",
        "checks:",
        "  - feature: checkoutFlow",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    const result = await promoteProjectSets(config, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });

    expect(result.dependencies.target).toBe(2);
    expect(await datasource.forSet("staging").listTargets()).toEqual(["assertion", "scenario"]);
    const test = await datasource.forSet("staging").readTest("features.checkout-targets");
    expect(test.assertions).toHaveLength(1);
    expect(test.assertions[0]).toMatchObject({ key: "portable", target: "assertion" });
  });

  it("promotes segment checks only when every reference survives the destination", async function () {
    const root = await createProject();
    for (const [key, sets] of Object.entries({
      existing: ["dev", "staging"],
      sourceOnly: ["dev"],
    })) {
      for (const set of sets) {
        await writeFile(
          root,
          `sets/${set}/segments/${key}.yml`,
          'description: Independent audience\nconditions: "*"\n',
        );
      }
      await writeFile(
        root,
        `sets/dev/tests/journeys/${key}.spec.yml`,
        `checks:\n  - segment: internal\n    matches: true\n  - not:\n      - segment: ${key}\n        matches: false\n`,
      );
    }
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);
    await promoteProjectSets(config, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkoutFlow",
      apply: true,
    });
    expect(await datasource.forSet("staging").listScenarios()).toEqual(["journeys.existing"]);
    expect(await datasource.forSet("staging").listSegments()).not.toContain("sourceOnly");
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("omits non-promotable assertions when creating a missing test spec", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/dev/features/mobileBanner.yml",
      [
        "description: Mobile banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  - key: everyone",
        '    conditions: "*"',
        "    percentage: 100",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "sets/dev/tests/features/mobileBanner.spec.yml",
      [
        "feature: mobileBanner",
        "assertions:",
        "  - key: portable",
        "    at: 10",
        "    context:",
        '      userId: "user-1"',
        "    expectedToBeEnabled: true",
        "  - key: dev-only",
        "    promotable: false",
        "    at: 20",
        "    context:",
        '      userId: "user-2"',
        "    expectedToBeEnabled: true",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "mobileBanner",
      apply: true,
    });

    const test = await datasource.forSet("staging").readTest("features.mobileBanner");
    expect(test.assertions.map((assertion) => assertion.key)).toEqual(["portable"]);
  });

  it("keeps legacy unkeyed assertion replacement behaviour", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      apply: true,
    });

    const test = await datasource.forSet("staging").readTest("features.checkoutFlow");
    expect(test.assertions).toHaveLength(1);
    expect(test.assertions[0]).toMatchObject({ expectedToBeEnabled: true });
    expect(test.assertions[0].key).toBeUndefined();
  });

  it("rejects protected assertion merging when only one set uses assertion keys", async function () {
    const root = await createProject();
    await writeFile(
      root,
      "sets/staging/tests/features/checkoutFlow.spec.yml",
      [
        "feature: checkoutFlow",
        "assertions:",
        "  - key: protected",
        "    promotable: false",
        "    at: 10",
        "    context:",
        '      userId: "user-1"',
        "    expectedToBeEnabled: false",
        "",
      ].join("\n"),
    );
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        includeFeatures: "checkout*",
      }),
    ).rejects.toThrow("assertion keys are present in only one set");
  });

  it("writes promoted features without fields they do not have", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);

    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      apply: true,
    });

    const written = await fs.promises.readFile(
      path.join(root, "sets/staging/features/checkoutFlow.yml"),
      "utf8",
    );
    expect(written).not.toMatch(/variations/);
    expect(written).not.toMatch(/: null$/m);
    expect(await datasource.forSet("staging").readFeature("checkoutFlow")).not.toHaveProperty(
      "variations",
    );
    // Reported paths are the files written, including their .spec suffix
    expect(result.files.updated).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sets/staging/tests/features/checkoutFlow.spec.yml"),
      ]),
    );
  });

  it("lints the written form of promoted definitions before writing", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const parser = projectConfig.parser as CustomParser;
    // A parser that loses a required field on write. The in memory plan is
    // valid, so only linting what will be written catches it.
    projectConfig.parser = {
      ...parser,
      stringify: (content, filePath) => {
        const { bucketBy, ...rest } = content;
        return parser.stringify(
          typeof bucketBy === "undefined" || !("rules" in content) ? content : rest,
          filePath,
        );
      },
    };
    const datasource = new Datasource(projectConfig, root);
    const destination = path.join(root, "sets/staging/features/checkoutFlow.yml");
    const before = await fs.promises.readFile(destination, "utf8");

    await expect(
      promoteProjectSets(projectConfig, datasource, {
        from: "dev",
        to: "staging",
        includeFeatures: "checkout*",
        apply: true,
      }),
    ).rejects.toThrow("failed preflight lint");
    expect(await fs.promises.readFile(destination, "utf8")).toBe(before);
  });

  async function writeCheckoutRules(root: string, set: string, rules: string[]) {
    await writeFile(
      root,
      `sets/${set}/features/checkoutFlow.yml`,
      [
        "description: Checkout flow",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "variablesSchema:",
        "  payload:",
        "    schema: payload",
        "    defaultValue: {}",
        "rules:",
        ...rules,
        "",
      ].join("\n"),
    );
  }

  const rule = (key: string, segments: string, percentage: number) => [
    `  - key: ${key}`,
    `    conditions: ${JSON.stringify(segments)}`,
    `    percentage: ${percentage}`,
  ];

  async function promotedRuleKeys(root: string, conflicts: "source" | "destination" = "source") {
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const result = await promoteProjectSets(projectConfig, datasource, {
      from: "dev",
      to: "staging",
      includeFeatures: "checkout*",
      conflicts,
      apply: true,
    });
    const feature = await datasource.forSet("staging").readFeature("checkoutFlow");
    return {
      result,
      rules: (feature.rules as Array<{ key: string; percentage: number }>).map(
        (entry) => `${entry.key}:${entry.percentage}`,
      ),
    };
  }

  it("keeps rules only the destination has in their slots", async function () {
    const root = await createProject();
    await writeCheckoutRules(root, "dev", [...rule("everyone", "*", 100)]);
    await writeCheckoutRules(root, "staging", [
      ...rule("internal", "internal", 100),
      ...rule("everyone", "*", 0),
    ]);

    const { result, rules } = await promotedRuleKeys(root);

    expect(rules).toEqual(["internal:100", "everyone:100"]);
    expect(result.conflicts.some((conflict) => conflict.path === "rules.order")).toBe(false);
  });

  it("places a new source rule before the rule that follows it in the source", async function () {
    const root = await createProject();
    await writeCheckoutRules(root, "dev", [
      ...rule("beta", "internal", 100),
      ...rule("everyone", "*", 100),
    ]);
    await writeCheckoutRules(root, "staging", [...rule("everyone", "*", 0)]);

    const { rules } = await promotedRuleKeys(root);

    expect(rules).toEqual(["beta:100", "everyone:100"]);
  });

  it("reports reordered rules as a conflict resolved by the conflict policy", async function () {
    const reorder = async (conflicts: "source" | "destination") => {
      const root = await createProject();
      await writeCheckoutRules(root, "dev", [
        ...rule("internal", "internal", 100),
        ...rule("everyone", "*", 50),
      ]);
      await writeCheckoutRules(root, "staging", [
        ...rule("everyone", "*", 50),
        ...rule("internal", "internal", 100),
      ]);
      return { root, ...(await promotedRuleKeys(root, conflicts)) };
    };

    const source = await reorder("source");
    expect(source.rules).toEqual(["internal:100", "everyone:50"]);
    expect(source.result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "feature",
          key: "checkoutFlow",
          path: "rules.order",
          source: ["internal", "everyone"],
          destination: ["everyone", "internal"],
        }),
      ]),
    );

    const destination = await reorder("destination");
    expect(destination.rules).toEqual(["everyone:50", "internal:100"]);

    const failing = await reorder("destination");
    const projectConfig = getProjectConfig(failing.root);
    await writeCheckoutRules(failing.root, "staging", [
      ...rule("everyone", "*", 50),
      ...rule("internal", "internal", 100),
    ]);
    await expect(
      promoteProjectSets(projectConfig, new Datasource(projectConfig, failing.root), {
        from: "dev",
        to: "staging",
        includeFeatures: "checkout*",
        conflicts: "fail",
      }),
    ).rejects.toThrow("conflict(s) and --conflicts=fail was used");
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
      expect(audit).toContain("- Variables: 0");
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

  it("accepts --audit without an explicit format", async function () {
    const root = await createProject();
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(
        promotePlugin.handler({
          rootDirectoryPath: root,
          projectConfig,
          datasource,
          parsed: {
            _: ["promote"],
            from: "dev",
            to: "staging",
            audit: "",
          },
        }),
      ).resolves.toBeUndefined();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
