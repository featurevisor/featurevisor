import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFeaturevisor } from "@featurevisor/sdk";
import type {
  DatafileContent,
  ExistingFeature,
  Rule,
  Traffic,
  Variation,
} from "@featurevisor/types";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { evaluateFeature } from "../evaluate";
import { lintProject } from "../linter";
import { testProject } from "../tester";
import { buildProjectSets } from "./buildProject";
import { getInheritedKeys, resolveForEnvironment } from "./environments";
import { getTraffic } from "./traffic";

const INHERIT = { inheritEnvironments: { dev: { from: "staging" } } };
const RULE = (percentage: number, key = "everyone") => [{ key, conditions: "*", percentage }];
const USER = { userId: "user-1" };

describe("resolving what an environment says", () => {
  it("prefers the environment's own entry, whatever it holds", () => {
    for (const own of [[], false, true, ["web"], [{ key: "own" }]]) {
      expect(resolveForEnvironment({ dev: own, staging: ["x"] }, "dev", INHERIT)).toEqual({
        value: own,
      });
    }
  });

  it("falls to the environment it inherits from, and then to nothing", () => {
    expect(resolveForEnvironment({ staging: ["x"] }, "dev", INHERIT)).toEqual({
      value: ["x"],
      inheritedFrom: "staging",
    });
    expect(resolveForEnvironment({ production: ["x"] }, "dev", INHERIT)).toEqual({});
    expect(resolveForEnvironment(undefined, "dev", INHERIT)).toEqual({});
  });

  it("leaves other environments, and projects without the setting, alone", () => {
    expect(resolveForEnvironment({ dev: ["x"] }, "production", INHERIT)).toEqual({});
    expect(resolveForEnvironment({ staging: ["x"] }, "dev", {})).toEqual({});
  });

  it("names the keys a definition inherits", () => {
    const definition = {
      rules: { dev: [], staging: [] },
      force: { staging: [] },
      expose: { production: false },
      overrides: { staging: [] },
    };
    expect(getInheritedKeys(definition, "dev", INHERIT)).toEqual({
      from: "staging",
      keys: ["force", "overrides"],
    });
    expect(getInheritedKeys(definition, "staging", INHERIT)).toBeUndefined();
    expect(getInheritedKeys({ rules: { dev: [] } }, "dev", INHERIT)).toBeUndefined();
    expect(getInheritedKeys(definition, false, INHERIT)).toBeUndefined();
  });
});

describe("Catalog's copy of the rule", () => {
  // Catalog cannot import Core, so it reads authored lists with its own copy
  const catalog = require("../../../catalog/src/environmentInheritance");
  const maps = [
    undefined,
    {},
    { staging: ["x"] },
    { production: ["x"] },
    { dev: [], staging: ["x"] },
    { dev: ["own"], staging: ["x"] },
    { dev: false, staging: true },
    { staging: false },
    { staging: [] },
  ];

  it.each(
    maps.flatMap((map) =>
      ["dev", "staging", "production"].flatMap((environment) => [
        { map, environment, inherit: INHERIT.inheritEnvironments },
        { map, environment, inherit: undefined },
      ]),
    ),
  )("agrees on $environment of $map, inheriting $inherit", ({ map, environment, inherit }) => {
    const core = resolveForEnvironment<unknown>(map, environment, { inheritEnvironments: inherit });
    expect(catalog.getInheritedFrom(map, environment, inherit)).toBe(core.inheritedFrom);
    expect(catalog.withInherited(map, inherit)?.[environment]).toEqual(core.value);
  });
});

describe("building an environment that inherits", () => {
  let root: string;
  let logged: string[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-inherit-"));
    logged = [];
    jest.spyOn(console, "log").mockImplementation((...args) => void logged.push(args.join(" ")));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(file: string, value: unknown) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(value));
  }

  function configure(settings: Record<string, unknown> = INHERIT, environments?: string[]) {
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      `module.exports = ${JSON.stringify({
        parser: "json",
        tags: ["all", "checkout"],
        environments: environments || ["dev", "staging", "production"],
        ...settings,
      })}`,
    );
  }

  function project(settings?: Record<string, unknown>, environments?: string[], prefix = "") {
    configure(settings, environments);
    write(prefix + "attributes/userId.json", { description: "User", type: "string" });
    write(prefix + "targets/all.json", { description: "All" });
    write(prefix + "targets/checkout.json", { description: "Checkout", tag: "checkout" });
  }

  function feature(key: string, definition: Record<string, unknown>, prefix = "") {
    write(`${prefix}features/${key}.json`, {
      description: key,
      tags: ["all", "checkout"],
      bucketBy: "userId",
      ...definition,
    });
  }

  function deps() {
    // the configuration as it is now, not as an earlier require of it cached it
    jest.resetModules();
    const projectConfig = getProjectConfig(root);
    return {
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      rootDirectoryPath: root,
      options: {},
    };
  }

  const build = (options: Record<string, unknown> = {}) =>
    buildProjectSets(deps() as never, options as never);

  const datafile = (
    environment: string,
    target = "all",
    directory = "datafiles",
  ): DatafileContent =>
    JSON.parse(
      fs.readFileSync(
        path.join(root, directory, environment, `featurevisor-${target}.json`),
        "utf8",
      ),
    );

  const sdk = (environment: string) =>
    createFeaturevisor({ datafile: datafile(environment), logLevel: "fatal" });

  function teams() {
    feature("sidebar", { rules: { staging: RULE(100), production: RULE(0) } });
    feature("discount", {
      conditions: { feature: "sidebar" },
      rules: { staging: RULE(100), production: RULE(0) },
    });
    feature("showHeader", { rules: { staging: RULE(100), production: RULE(100) } });
    write("variables/headerMessage.json", {
      description: "Header message",
      type: "string",
      defaultValue: "Welcome",
      disabledValue: "Header unavailable",
      conditions: { feature: "showHeader" },
      overrides: {
        staging: [{ key: "everyone", conditions: "*", value: "Welcome to staging" }],
      },
    });
  }

  describe("with nothing written for it", () => {
    it("builds the datafiles of the environment it inherits from", async () => {
      project();
      teams();
      await build();

      for (const target of ["all", "checkout"]) {
        expect(datafile("dev", target)).toEqual(datafile("staging", target));
      }
    });

    it("builds staging and production as it would without the setting", async () => {
      project({});
      teams();
      await build();
      const staging = JSON.stringify(datafile("staging"));
      const production = JSON.stringify(datafile("production"));

      project();
      await build();
      const strip = (text: string) => text.replace(/"revision":"\d+"/, "");
      expect(strip(JSON.stringify(datafile("staging")))).toBe(strip(staging));
      expect(strip(JSON.stringify(datafile("production")))).toBe(strip(production));
    });

    it("leaves everything off without the setting", async () => {
      project({});
      teams();
      await build();

      expect(sdk("staging").isEnabled("showHeader", USER)).toBe(true);
      expect(sdk("dev").isEnabled("showHeader", USER)).toBe(false);
    });
  });

  describe("across teams", () => {
    it("lets a feature's own rules work on top of a dependency nobody touched", async () => {
      teams();
      feature("discount", {
        conditions: { feature: "sidebar" },
        rules: { dev: RULE(100), staging: RULE(0), production: RULE(0) },
      });

      project({});
      await build();
      expect(sdk("dev").isEnabled("discount", USER)).toBe(false);

      project();
      await build();
      expect(sdk("dev").isEnabled("discount", USER)).toBe(true);
    });

    it("gives a global variable tied to a feature the value it has in staging", async () => {
      teams();

      project({});
      await build();
      expect(sdk("dev").getVariable("headerMessage", USER)).toBe("Header unavailable");

      project();
      await build();
      expect(sdk("dev").getVariable("headerMessage", USER)).toBe("Welcome to staging");
    });

    it("keeps a feature out of the datafiles staging keeps it out of", async () => {
      teams();
      feature("sidebar", {
        rules: { staging: RULE(100) },
        expose: { staging: ["all"] },
      });
      feature("hidden", { rules: { staging: RULE(100) }, expose: { staging: false } });

      project({});
      await build();
      expect(datafile("dev", "checkout").features.sidebar).toBeDefined();
      expect(datafile("dev").features.hidden).toBeDefined();

      project();
      await build();
      expect(datafile("dev", "checkout").features.sidebar).toBeUndefined();
      expect(datafile("dev", "all").features.sidebar).toBeDefined();
      expect(datafile("dev").features.hidden).toBeUndefined();
    });
  });

  describe("each key on its own", () => {
    const forced = [
      {
        conditions: { attribute: "userId", operator: "equals", value: "user-1" },
        enabled: true,
      },
    ];

    it("mixes its own rules with inherited force entries", async () => {
      project();
      feature("checkout", {
        rules: { dev: RULE(0), staging: RULE(50) },
        force: { staging: forced },
      });
      await build();

      expect(sdk("dev").isEnabled("checkout", USER)).toBe(true);
      expect(sdk("dev").isEnabled("checkout", { userId: "user-2" })).toBe(false);
      expect(datafile("dev").features.checkout.traffic[0].percentage).toBe(0);
    });

    it("mixes its own exposure with inherited rules", async () => {
      project();
      feature("checkout", {
        rules: { staging: RULE(100) },
        expose: { dev: true, staging: false },
      });
      await build();

      expect(datafile("staging").features.checkout).toBeUndefined();
      expect(sdk("dev").isEnabled("checkout", USER)).toBe(true);
    });

    it("takes an empty list as nothing, not as inheriting", async () => {
      project();
      feature("checkout", {
        rules: { dev: [], staging: RULE(100) },
      });
      feature("forced", {
        rules: { staging: RULE(0) },
        force: { dev: [], staging: forced },
      });
      write("variables/supportEmail.json", {
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
        overrides: {
          dev: [],
          staging: [{ key: "everyone", conditions: "*", value: "staging@example.com" }],
        },
      });
      await build();

      expect(datafile("dev").features.checkout.traffic).toEqual([]);
      expect(sdk("dev").isEnabled("checkout", USER)).toBe(false);
      expect(sdk("dev").isEnabled("forced", USER)).toBe(false);
      expect(sdk("staging").isEnabled("forced", USER)).toBe(true);
      expect(sdk("dev").getVariable("supportEmail", USER)).toBe("support@example.com");
      expect(sdk("staging").getVariable("supportEmail", USER)).toBe("staging@example.com");
    });

    it("has nothing to inherit when staging has nothing either", async () => {
      project();
      feature("checkout", { rules: { production: RULE(100) } });
      feature("noRules", {});
      await build();

      expect(sdk("dev").isEnabled("checkout", USER)).toBe(false);
      expect(sdk("dev").isEnabled("noRules", USER)).toBe(false);
      expect(sdk("production").isEnabled("noRules", USER)).toBe(false);
    });
  });

  describe("allocation", () => {
    const VARIATIONS = [
      { value: "control", weight: 50 },
      { value: "treatment", weight: 50 },
    ];
    const rollout = (percentage: number, own?: unknown) =>
      feature("rollout", {
        variations: VARIATIONS,
        rules: {
          ...(own !== undefined ? { dev: own } : {}),
          staging: RULE(percentage),
          production: RULE(percentage),
        },
      });
    const allocation = (environment: string, directory?: string) =>
      datafile(environment, "all", directory).features.rollout.traffic[0].allocation;
    const stateFile = (environment: string) =>
      path.join(root, ".featurevisor", `existing-state-${environment}.json`);
    const HISTORY = [
      { variation: "control", range: [0, 20000] },
      { variation: "treatment", range: [20000, 40000] },
      { variation: "control", range: [40000, 60000] },
      { variation: "treatment", range: [60000, 80000] },
    ];

    async function withHistory() {
      rollout(40);
      await build();
      rollout(80);
    }

    it.each([
      ["before", ["dev", "staging", "production"]],
      ["after", ["staging", "dev", "production"]],
    ])("follows a rollout's history when listed %s its parent", async (_, environments) => {
      project(INHERIT, environments);
      await withHistory();
      await build();

      expect(allocation("staging")).toEqual(HISTORY);
      expect(allocation("dev")).toEqual(HISTORY);
    });

    it("differs after a history without inheriting, which is why it reads the state", async () => {
      project({});
      await withHistory();
      rollout(80, RULE(80));
      await build();

      expect(allocation("staging")).toEqual(HISTORY);
      expect(allocation("dev")).toEqual([
        { variation: "control", range: [0, 40000] },
        { variation: "treatment", range: [40000, 80000] },
      ]);
    });

    it("gets the same result building it alone, and leaves the parent's state alone", async () => {
      project();
      await withHistory();
      const before = fs.readFileSync(stateFile("staging"), "utf8");

      await build({ environment: "dev" });

      expect(allocation("dev")).toEqual(HISTORY);
      expect(fs.readFileSync(stateFile("staging"), "utf8")).toBe(before);
    });

    it("gets the same result without writing state files", async () => {
      project();
      await withHistory();
      await build({ stateFiles: false });

      expect(allocation("dev")).toEqual(HISTORY);
      expect(allocation("staging")).toEqual(HISTORY);
    });

    it("saves what it allocated to its own state", async () => {
      project();
      await withHistory();
      await build();

      const saved = JSON.parse(fs.readFileSync(stateFile("dev"), "utf8"));
      expect(saved.features.rollout.traffic[0].allocation).toEqual(HISTORY);
    });

    it("keeps users in their variations when a team writes rules of its own", async () => {
      project();
      await withHistory();
      await build();

      rollout(80, RULE(100));
      await build();

      expect(allocation("dev").slice(0, 4)).toEqual(HISTORY);
      expect(allocation("dev")).toEqual([
        ...HISTORY,
        { variation: "control", range: [80000, 90000] },
        { variation: "treatment", range: [90000, 100000] },
      ]);
    });

    it("follows the parent again once a team removes its rules", async () => {
      project();
      await withHistory();
      rollout(80, RULE(70, "own"));
      await build();
      expect(allocation("dev")).toEqual([
        { variation: "control", range: [0, 35000] },
        { variation: "treatment", range: [35000, 70000] },
      ]);

      rollout(80);
      await build();
      expect(allocation("dev")).toEqual(HISTORY);
    });

    it("saves empty traffic for an empty list and when the setting is removed", async () => {
      project();
      await withHistory();
      await build();

      rollout(80, []);
      await build();
      let saved = JSON.parse(fs.readFileSync(stateFile("dev"), "utf8"));
      expect(saved.features.rollout.traffic).toEqual([]);

      rollout(80);
      await build();
      configure({});
      await build();
      saved = JSON.parse(fs.readFileSync(stateFile("dev"), "utf8"));
      expect(saved.features.rollout.traffic).toEqual([]);
      expect(datafile("dev").features.rollout.traffic).toEqual([]);
    });

    it("names the parent's state file when its saved allocation is invalid", async () => {
      project();
      rollout(80);
      write(".featurevisor/existing-state-staging.json", {
        features: {
          rollout: {
            variations: VARIATIONS,
            traffic: [
              {
                key: "everyone",
                percentage: 40000,
                allocation: [{ variation: "control", range: [0, 99000] }],
              },
            ],
          },
        },
      });

      await expect(build({ environment: "dev" })).rejects.toMatchObject({
        code: "invalid_saved_allocation",
        details: expect.objectContaining({
          stateFile: path.join(".featurevisor", "existing-state-staging.json"),
        }),
      });
    });

    it("reads the state of the same set, with sets and environments together", async () => {
      project({ ...INHERIT, sets: true }, undefined, "sets/web/");
      const rules = (percentage: number) => ({
        variations: VARIATIONS,
        rules: { staging: RULE(percentage) },
      });
      feature("rollout", rules(40), "sets/web/");
      await build();
      feature("rollout", rules(80), "sets/web/");
      await build();

      expect(allocation("staging", "datafiles/web")).toEqual(HISTORY);
      expect(allocation("dev", "datafiles/web")).toEqual(HISTORY);
    });

    it("rebuilds to the same traffic from state saved before or after a build", () => {
      // Why a build may read a parent's state whether or not the parent was built yet
      let seed = 20261103;
      const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
      const variationLists: Array<Variation[] | undefined> = [
        undefined,
        VARIATIONS,
        [
          { value: "control", weight: 25 },
          { value: "treatment", weight: 75 },
        ],
      ];
      const saved = (variations: Variation[] | undefined, traffic: Traffic[]) =>
        ({
          variations: variations?.map(({ value, weight }) => ({ value, weight })),
          traffic: traffic.map(({ key, percentage, allocation }) => ({
            key,
            percentage,
            allocation,
          })),
        }) as ExistingFeature;

      for (let run = 0; run < 3000; run++) {
        let state: ExistingFeature | undefined;
        for (let step = 0; step < 4; step++) {
          const variations: Variation[] | undefined =
            state && random() < 0.85 ? (state.variations as Variation[]) : pick(variationLists);
          const rules = ["netherlands", "germany", "everyone"]
            .filter(() => random() < 0.7)
            .map((key) => {
              const rule: Record<string, unknown> = {
                key,
                conditions: "*",
                percentage: pick([0, 5, 25, 40, 50, 80, 100]),
              };
              if (variations && random() < 0.1) {
                rule.variationWeights = { control: 60, treatment: 40 };
              }
              return rule as unknown as Rule;
            });

          const before = getTraffic(variations, rules, state);
          const after = getTraffic(variations, rules, saved(variations, before));
          expect(after).toEqual(before);
          state = saved(variations, before);
        }
      }
    });
  });

  describe("the commands around it", () => {
    it("lints a project using every form", async () => {
      project();
      feature("checkout", { rules: { dev: [], staging: RULE(100) } });
      feature("noRules", {});
      feature("mixed", {
        rules: { staging: RULE(100) },
        force: { dev: [] },
        expose: { dev: true },
      });
      write("variables/supportEmail.json", {
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
        overrides: { dev: [] },
      });

      const result = await lintProject(deps() as never, { json: true });
      expect(result.errors).toEqual([]);
    });

    it("tests dev assertions against what it inherits", async () => {
      project();
      feature("checkout", { rules: { staging: RULE(100) } });
      write("tests/checkout.spec.json", {
        feature: "checkout",
        assertions: [
          {
            environment: "dev",
            at: 50,
            context: USER,
            expectedToBeEnabled: true,
          },
        ],
      });

      const failed = () => testProject(deps() as never, { json: true } as never);
      expect(await failed()).toBe(false);

      project({});
      expect(await failed()).toBe(true);
    });

    function output() {
      return JSON.parse(logged.filter((line) => line.startsWith("{")).pop()!);
    }

    it("says what a feature inherits when explaining an evaluation", async () => {
      project();
      feature("checkout", {
        rules: { staging: RULE(100) },
        force: { dev: [] },
      });

      await evaluateFeature(deps() as never, {
        environment: "dev",
        feature: "checkout",
        context: USER,
        json: true,
        explain: true,
      });

      expect(output().explanation.flag.evidence).toContainEqual({
        basis: "definition",
        title: "Inherited from another environment",
        details: { from: "staging", keys: ["rules"] },
      });
    });

    it("names what is inherited once in the terminal, and in every section of the JSON", async () => {
      project();
      feature("checkout", {
        variablesSchema: {
          label: { type: "string", defaultValue: "Buy" },
          colour: { type: "string", defaultValue: "#111827" },
        },
        rules: { staging: RULE(100) },
      });
      const evaluate = (json: boolean) =>
        evaluateFeature(deps() as never, {
          environment: "dev",
          feature: "checkout",
          context: USER,
          json,
          explain: true,
        });

      await evaluate(false);
      expect(logged.filter((line) => line.includes("Inherited from staging:"))).toHaveLength(1);

      await evaluate(true);
      const { explanation } = output();
      const titles = (section: { evidence: Array<{ title: string }> }) =>
        section.evidence.map((entry) => entry.title);
      for (const section of [explanation.flag, explanation.variables.label]) {
        expect(titles(section)).toContain("Inherited from another environment");
      }
    });

    it("says nothing about inheriting in an environment that does not", async () => {
      project();
      feature("checkout", { rules: { staging: RULE(100) } });

      await evaluateFeature(deps() as never, {
        environment: "staging",
        feature: "checkout",
        context: USER,
        json: true,
        explain: true,
      });

      expect(JSON.stringify(output())).not.toContain("Inherited from");
    });

    it("finds the authored override behind an inherited value", async () => {
      project();
      write("variables/supportEmail.json", {
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
        overrides: {
          staging: [{ key: "everyone", conditions: "*", value: "staging@example.com" }],
        },
      });

      await evaluateFeature(deps() as never, {
        environment: "dev",
        variable: "supportEmail",
        context: USER,
        json: true,
        explain: true,
      });

      const result = output();
      expect(result.variableValue).toBe("staging@example.com");
      const titles = result.explanation.evidence.map((entry: { title: string }) => entry.title);
      expect(titles).toContain("Authored value construction (build time)");
      expect(result.explanation.limitations.join(" ")).not.toContain("could not be mapped");
    });
  });
});
