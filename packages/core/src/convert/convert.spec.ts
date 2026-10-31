import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { format } from "node:util";

import { parsers } from "@featurevisor/parsers";
import { isMap, YAMLMap } from "yaml";
import type { Document } from "yaml";

import { getProjectConfig, getProjectConfigForSet } from "../config";
import { Datasource } from "../datasource";
import { getExistingStateFilePath } from "../datasource/filesystemAdapter";
import { checkPlan } from "./check";
import { editConfig } from "./config";
import { load, render, rootMap, setKey, spreadLanes, takeLane } from "./documents";
import { planConversion } from "./plan";
import { readProject } from "./project";
import { runConversion } from "./run";
import { mergeSpecs, specForLane, specForLanes } from "./tests";

const yml = parsers.yml;

/** A document as its file's new text */
const text = (source: string, doc: Document) => render(source, doc, yml)!.text;

/** A YAML file after `edit`, written back over its own lines */
function edited(source: string, edit: (map: YAMLMap) => void) {
  const { doc } = load(source, yml);
  edit(rootMap(doc)!);
  return text(source, doc);
}

describe("lanes in definitions", () => {
  const rules = [
    "rules:",
    "  staging:",
    "    # everyone in staging",
    "    - key: everyone",
    '      conditions: "*"',
    "      percentage: 100",
    "",
    "  production:",
    "    - key: nl",
    "      conditions: netherlands # the Dutch first",
    "      percentage: 100",
    "",
  ].join("\n");

  it("takes one lane's value with its comments", () => {
    expect(edited(rules, (map) => takeLane(map, "rules", "production"))).toBe(
      "rules:\n  - key: nl\n    conditions: netherlands # the Dutch first\n    percentage: 100\n",
    );
    expect(edited(rules, (map) => takeLane(map, "rules", "staging"))).toBe(
      'rules:\n  # everyone in staging\n  - key: everyone\n    conditions: "*"\n    percentage: 100\n',
    );
  });

  it("leaves a lane without a value empty, or without the key", () => {
    const source = "rules:\n  production: []\n\nforce:\n  production: []\n";
    expect(
      edited(source, (map) => {
        takeLane(map, "rules", "staging", []);
        takeLane(map, "force", "staging");
      }),
    ).toBe("rules: []\n");
  });

  it("keeps the comment above the first lane with that lane", () => {
    const source = "rules:\n  # reset on purpose\n  staging: []\n  production: []\n";
    expect(edited(source, (map) => takeLane(map, "rules", "staging"))).toContain(
      "# reset on purpose",
    );
    expect(edited(source, (map) => takeLane(map, "rules", "production"))).not.toContain("reset");
  });

  it("spreads a value across lanes, spaced as the file is", () => {
    const source =
      "bucketBy: userId\n\nrules:\n  - key: all\n    conditions: '*'\n    percentage: 50\n";
    expect(
      edited(source, (map) => spreadLanes(map, "rules", ["staging", "production"], true)),
    ).toBe(
      [
        "bucketBy: userId",
        "",
        "rules:",
        "  staging:",
        "    - key: all",
        "      conditions: '*'",
        "      percentage: 50",
        "",
        "  production:",
        "    - key: all",
        "      conditions: '*'",
        "      percentage: 50",
        "",
      ].join("\n"),
    );
  });

  it("adds a key after the keys it follows, spaced as its neighbours", () => {
    const source = "description: x\n\nrules: []\n\nexpose: false\n";
    expect(edited(source, (map) => setKey(map, "force", new YAMLMap(), ["rules"]))).toBe(
      "description: x\n\nrules: []\n\nforce: {}\n\nexpose: false\n",
    );
  });

  it("keeps a file's line endings and writes aliases out in full", () => {
    const source =
      "rules:\r\n  staging: &rules\r\n    - key: all\r\n      percentage: 100\r\n  production: *rules\r\n";
    const { doc, expanded } = load(source, yml);
    expect(expanded).toBe(true);
    takeLane(rootMap(doc)!, "rules", "production");
    expect(text(source, doc)).toBe("rules:\r\n  - key: all\r\n    percentage: 100\r\n");
  });
});

describe("specs across lanes", () => {
  const spec = [
    "feature: checkout",
    "",
    "assertions:",
    "  # staging first",
    "  - description: Everyone in staging",
    "    environment: staging",
    "    expectedToBeEnabled: true",
    "",
    "  - description: The Dutch in ${{ environment }}",
    "    matrix:",
    "      environment:",
    "        - staging",
    "        - production",
    "    environment: ${{ environment }}",
    "    expectedToBeEnabled: true",
    "",
    "  - matrix:",
    "      environment: [staging, production]",
    "      at: [10, 90]",
    "    environment: ${{ environment }}",
    "    at: ${{ at }}",
    "    expectedToBeEnabled: false",
    "",
  ].join("\n");

  const narrowed = (lane: string) => {
    const result = specForLane(load(spec, yml).doc, lane);
    return result && text(spec, result);
  };

  it("keeps the assertions of one lane, without their environment", () => {
    expect(narrowed("production")).toBe(
      [
        "feature: checkout",
        "",
        "assertions:",
        "  - description: The Dutch in ${{ environment }}",
        "    matrix:",
        "      environment:",
        "        - production",
        "    expectedToBeEnabled: true",
        "",
        "  - matrix:",
        "      at: [10, 90]",
        "    at: ${{ at }}",
        "    expectedToBeEnabled: false",
        "",
      ].join("\n"),
    );
    expect(narrowed("staging")).toContain(
      "# staging first\n  - description: Everyone in staging\n",
    );
    expect(narrowed("qa")).toBeUndefined();
  });

  it("merges the sets' specs back into the spec they came from", () => {
    const specs = ["staging", "production"].map((lane) => ({
      lane,
      doc: load(narrowed(lane)!, yml).doc,
    }));
    const merged = mergeSpecs(specs, ["staging", "production"], true);
    expect(text(narrowed("staging")!, merged.doc!)).toBe(spec);
  });

  it("gives a spec from a project without environments every lane", () => {
    const source = "feature: checkout\n\nassertions:\n  - at: 10\n    expectedToBeEnabled: true\n";
    const lanes = (names: string[]) =>
      text(source, specForLanes(load(source, yml).doc, names, true));
    expect(lanes(["production"])).toBe(
      "feature: checkout\n\nassertions:\n  - environment: production\n    at: 10\n    expectedToBeEnabled: true\n",
    );
    expect(lanes(["staging", "production"])).toContain(
      "  - matrix:\n      environment: [staging, production]\n    environment: ${{ environment }}\n",
    );
    expect(specForLanes(load(source, yml).doc, ["staging"], false).toString()).toBe(source);
  });

  it("names assertions that differ between sets but share a key", () => {
    const set = (value: number) =>
      load(
        `feature: f\n\nassertions:\n  - key: a\n    at: ${value}\n    expectedToBeEnabled: true\n`,
        yml,
      ).doc;
    const merged = mergeSpecs(
      [
        { lane: "staging", doc: set(10) },
        { lane: "production", doc: set(20) },
      ],
      ["staging", "production"],
      true,
    );
    expect(merged.renamed).toEqual(["a"]);
    expect(merged.doc!.toJS().assertions).toEqual([
      { key: "a-staging", environment: "staging", at: 10, expectedToBeEnabled: true },
      { key: "a-production", environment: "production", at: 20, expectedToBeEnabled: true },
    ]);
  });

  it("refuses scenarios that differ between sets", () => {
    const scenario = (at: number) => load(`description: s\n\nat: ${at}\n\nchecks: []\n`, yml).doc;
    expect(
      mergeSpecs(
        [
          { lane: "staging", doc: scenario(10) },
          { lane: "production", doc: scenario(20) },
        ],
        ["staging", "production"],
        true,
      ).conflict,
    ).toBe("the scenario differs between sets");
  });
});

describe("editConfig", () => {
  const source = [
    "/** @type {import('@featurevisor/core').ProjectConfig} */",
    "module.exports = {",
    "  // environments: ['dev'],",
    "  environments: [",
    "    'staging',",
    "    'production',",
    "  ],",
    "  plugins: [{ environments: true }],",
    "  tags: ['all'],",
    "};",
    "",
  ].join("\n");

  it("removes top level settings and adds new ones after the opening brace", () => {
    expect(
      editConfig(source, {
        remove: ["environments"],
        add: [
          ["sets", "true"],
          ["promotionFlows", ["{ from: 'a', to: 'b' }", "{ from: 'b', to: 'c' }"]],
        ],
      })?.text,
    ).toBe(
      [
        "/** @type {import('@featurevisor/core').ProjectConfig} */",
        "module.exports = {",
        "  sets: true,",
        "  promotionFlows: [",
        "    { from: 'a', to: 'b' },",
        "    { from: 'b', to: 'c' },",
        "  ],",
        "  // environments: ['dev'],",
        "  plugins: [{ environments: true }],",
        "  tags: ['all'],",
        "};",
        "",
      ].join("\n"),
    );
  });

  it("finds a setting wherever it is in the object", () => {
    expect(
      editConfig(
        'module.exports = {\n  namespaceCharacter: "/",\n  environments: ["a"],\n  tags: ["all"],\n};\n',
        { remove: ["environments", "tags"], add: [] },
      ),
    ).toEqual({
      text: 'module.exports = {\n  namespaceCharacter: "/",\n};\n',
      removed: ["environments", "tags"],
    });
  });

  it("says which settings it removed, leaving one in a comment or spread in", () => {
    const spread =
      "module.exports = {\n  ...base,\n  // featuresDirectoryPath: 'src',\n  tags: ['all'],\n};\n";
    expect(
      editConfig(spread, { remove: ["environments", "featuresDirectoryPath", "tags"], add: [] }),
    ).toEqual({
      text: "module.exports = {\n  ...base,\n  // featuresDirectoryPath: 'src',\n};\n",
      removed: ["tags"],
    });
  });

  it("cannot edit a configuration that does not export an object", () => {
    expect(editConfig("module.exports = base;\n", { remove: [], add: [["sets", "true"]] })).toBe(
      undefined,
    );
    expect(editConfig("module.exports = base;\n", { remove: ["environments"], add: [] })).toBe(
      undefined,
    );
  });
});

describe("convert", () => {
  let root: string;
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const exists = (file: string) => fs.existsSync(path.join(root, file));

  /** Every file in the project, by path, for comparing whole projects */
  const snapshot = (directory = root): Record<string, string> =>
    Object.fromEntries(
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return Object.entries(snapshot(fullPath));
        return [[path.relative(root, fullPath), fs.readFileSync(fullPath, "utf8")]];
      }),
    );

  /** The configuration as it is now, not as an earlier require of it cached it */
  const config = () => {
    jest.resetModules();
    return getProjectConfig(root);
  };

  /** What the last run printed, without colours */
  let printed = "";

  const run = async (parsed: Record<string, unknown>) => {
    const projectConfig = config();
    const lines: string[] = [];
    const log = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
    try {
      return await runConversion({
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        parsed: { _: ["convert"], ...parsed },
      });
    } finally {
      log.mockRestore();
      printed = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    }
  };

  const environmentsProject = () => {
    write(
      "featurevisor.config.js",
      'module.exports = {\n  environments: ["staging", "production"],\n  tags: ["all"],\n};\n',
    );
    write("attributes/userId.yml", "description: User ID\n\ntype: string\n");
    write("attributes/country.yml", "description: Country\n\ntype: string\n");
    write(
      "segments/netherlands.yml",
      "description: The Netherlands\n\nconditions:\n  - attribute: country\n    operator: equals\n    value: nl\n",
    );
    write("targets/all.yml", "description: Everything\n");
    write(
      "features/checkout.yml",
      [
        "description: Checkout",
        "",
        "tags:",
        "  - all",
        "",
        "bucketBy: userId",
        "",
        "rules:",
        "  staging:",
        "    # everyone sees it in staging first",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 100",
        "",
        "  production:",
        "    - key: nl",
        "      conditions: netherlands # the Dutch first",
        "      percentage: 100",
        "",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 0",
        "",
      ].join("\n"),
    );
    write(
      "features/banner.yml",
      'description: Banner\n\ntags:\n  - all\n\nbucketBy: userId\n\nrules:\n  production:\n    - key: everyone\n      conditions: "*"\n      percentage: 100\n',
    );
    write(
      "variables/supportEmail.yml",
      [
        "description: Support email",
        "",
        "tags:",
        "  - all",
        "",
        "type: string",
        "",
        "defaultValue: help@example.com",
        "",
        "overrides:",
        "  production:",
        "    - key: nl",
        "      conditions: netherlands",
        "      value: hulp@example.com",
        "",
      ].join("\n"),
    );
    write(
      "tests/checkout.spec.yml",
      [
        "feature: checkout",
        "",
        "assertions:",
        "  - description: Everyone in staging",
        "    environment: staging",
        "    at: 90",
        "    context:",
        "      country: us",
        "    expectedToBeEnabled: true",
        "",
        "  - description: The Dutch in ${{ environment }}",
        "    matrix:",
        "      environment:",
        "        - staging",
        "        - production",
        "    environment: ${{ environment }}",
        "    at: 10",
        "    context:",
        "      country: nl",
        "    expectedToBeEnabled: true",
        "",
        "  - description: Not Americans in production",
        "    environment: production",
        "    at: 90",
        "    context:",
        "      country: us",
        "    expectedToBeEnabled: false",
        "",
      ].join("\n"),
    );
    write(
      "tests/banner.spec.yml",
      "feature: banner\n\nassertions:\n  - environment: production\n    at: 50\n    expectedToBeEnabled: true\n",
    );
    write(
      "tests/supportEmail.spec.yml",
      "variable: supportEmail\n\nassertions:\n  - environment: production\n    context:\n      country: nl\n    expectedValue: hulp@example.com\n",
    );
    write(
      "tests/netherlands.spec.yml",
      "segment: netherlands\n\nassertions:\n  - context:\n      country: nl\n    expectedToMatch: true\n",
    );
    write(
      "tests/scenarios/dutch.spec.yml",
      [
        "description: The Dutch get checkout in ${{ environment }}",
        "",
        "matrix:",
        "  environment:",
        "    - staging",
        "    - production",
        "",
        "environment: ${{ environment }}",
        "",
        "target: all",
        "",
        "context:",
        "  country: nl",
        "  userId: user-1",
        "",
        "checks:",
        "  - feature: checkout",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    write(".featurevisor/existing-state-production.json", '{"features":{}}\n');
  };

  const flatProject = () => {
    write("featurevisor.config.js", "module.exports = {\n  tags: ['all'],\n};\n");
    write("attributes/userId.yml", "description: User ID\n\ntype: string\n");
    write("targets/all.yml", "description: Everything\n");
    write(
      "features/checkout.yml",
      'description: Checkout\n\ntags:\n  - all\n\nbucketBy: userId\n\nrules:\n  - key: everyone\n    conditions: "*"\n    percentage: 50\n',
    );
    write(
      "tests/checkout.spec.yml",
      "feature: checkout\n\nassertions:\n  - at: 10\n    expectedToBeEnabled: true\n\n  - at: 90\n    expectedToBeEnabled: false\n",
    );
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-convert-spec-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("previews without writing anything", async () => {
    environmentsProject();
    const before = snapshot();

    expect(await run({ to: "sets" })).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("turns each environment into a set, and back to the same files", async () => {
    environmentsProject();
    const before = snapshot();

    expect(await run({ to: "sets", apply: true })).toBe(0);
    expect(read("featurevisor.config.js")).toBe(
      'module.exports = {\n  sets: true,\n  promotionFlows: [{ from: "staging", to: "production" }],\n  tags: ["all"],\n};\n',
    );
    expect(read("sets/staging/features/banner.yml")).toContain("rules: []\n");
    expect(read("sets/production/features/checkout.yml")).toContain(
      "rules:\n  - key: nl\n    conditions: netherlands # the Dutch first\n",
    );
    expect(read("sets/staging/variables/supportEmail.yml")).not.toContain("overrides");
    expect(exists("sets/staging/tests/banner.spec.yml")).toBe(false);
    expect(read("sets/staging/tests/scenarios/dutch.spec.yml")).toContain(
      "matrix:\n  environment:\n    - staging\n\ntarget: all\n",
    );
    expect(exists("features")).toBe(false);

    const setsConfig = config();
    expect(
      read(
        path.relative(
          root,
          getExistingStateFilePath(getProjectConfigForSet(setsConfig, "production"), false),
        ),
      ),
    ).toBe('{"features":{}}\n');

    expect(await run({ to: "environments", apply: true })).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("gives a project without environments some, and keeps one of them again", async () => {
    flatProject();
    const before = snapshot();

    expect(await run({ to: "environments", apply: true })).toBe(0);
    expect(read("features/checkout.yml")).toContain("rules:\n  staging:\n    - key: everyone\n");
    expect(read("featurevisor.config.js")).toContain("environments: ['staging', 'production'],");

    expect(await run({ to: "flat", apply: true })).toBe(2);
    expect(await run({ to: "flat", keep: "production", apply: true })).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("gives a project without environments sets, and keeps one of them again", async () => {
    flatProject();
    const before = snapshot();

    expect(await run({ to: "sets", sets: "next,live", apply: true })).toBe(0);
    expect(read("sets/next/features/checkout.yml")).toBe(read("sets/live/features/checkout.yml"));
    expect(read("featurevisor.config.js")).toContain(
      "promotionFlows: [{ from: 'next', to: 'live' }],",
    );

    expect(await run({ to: "flat", keep: "live", apply: true })).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("keeps the configuration's line endings", async () => {
    flatProject();
    write("featurevisor.config.js", "module.exports = {\r\n  tags: ['all'],\r\n};\r\n");

    expect(await run({ to: "environments", apply: true })).toBe(0);
    expect(read("featurevisor.config.js")).toBe(
      "module.exports = {\r\n  environments: ['staging', 'production'],\r\n  tags: ['all'],\r\n};\r\n",
    );
  });

  it("refuses what it cannot convert, and writes nothing", async () => {
    environmentsProject();
    const project = () => readProject(root, config());

    expect(planConversion(project(), { to: "environments" }).conflicts).toEqual([
      "The project already has environments.",
    ]);
    expect(planConversion(project(), { to: "sets", keep: "staging" }).conflicts).toEqual([
      "--keep applies only to --to=flat.",
    ]);
    expect(planConversion(project(), { to: "sets", lanes: ["a"] }).conflicts).toEqual([
      "The project's environments name the lanes, so leave out --environments.",
    ]);

    await run({ to: "sets", apply: true });
    fs.rmSync(path.join(root, "sets/staging/variables"), { recursive: true });
    const before = snapshot();
    expect(planConversion(project(), { to: "environments" }).conflicts).toEqual([
      "The global variable supportEmail.yml is only in sets production. With environments, it would reach every environment's datafiles.",
    ]);
    expect(await run({ to: "environments", apply: true })).toBe(2);
    expect(snapshot()).toEqual(before);
  });

  it("says only what it changed in the configuration", async () => {
    flatProject();
    write(
      "featurevisor.config.js",
      "module.exports = {\n  tags: ['all'],\n  // featuresDirectoryPath: 'src/features',\n};\n",
    );
    const plan = planConversion(readProject(root, config()), { to: "sets" });

    expect(plan.config.edits).toEqual([
      "adds sets: true",
      "adds promotionFlows staging to production",
    ]);
    expect(plan.writes.get(path.join(root, "featurevisor.config.js"))).toContain(
      "// featuresDirectoryPath: 'src/features',",
    );
  });

  it("converts the rest, and says how to edit a configuration it cannot edit", async () => {
    environmentsProject();
    write("base.config.js", 'module.exports = { environments: ["staging", "production"] };\n');
    const spread = 'module.exports = {\n  ...require("./base.config.js"),\n  tags: ["all"],\n};\n';
    write("featurevisor.config.js", spread);
    const plan = planConversion(readProject(root, config()), { to: "flat", keep: "production" });

    expect(plan.conflicts).toEqual([]);
    expect(plan.config.byHand).toBe(
      "it sets environments where convert cannot edit it, such as in an object spread into its settings",
    );
    expect(plan.config.edits).toEqual(["removes environments"]);
    expect(plan.writes.has(path.join(root, "featurevisor.config.js"))).toBe(false);

    expect(await run({ to: "flat", keep: "production", apply: true })).toBe(0);
    expect(read("featurevisor.config.js")).toBe(spread);
    expect(read("features/checkout.yml")).toContain("rules:\n  - key: nl\n");
    expect(printed).toContain(
      [
        "Edit featurevisor.config.js by hand, since it sets environments where convert cannot edit it, such as in an object spread into its settings:",
        "  - Remove environments",
        "  Until then, Featurevisor reads the project in its old shape. Run lint once it is edited.",
      ].join("\n"),
    );
    expect(printed).toContain("✔ Converted, except featurevisor.config.js");

    // the edit it asks for completes the conversion
    write("base.config.js", "module.exports = {};\n");
    expect(readProject(root, config()).shape).toBe("flat");
  });

  it("gives the settings to add when the configuration is not an object it can edit", async () => {
    flatProject();
    const own = "const config = { tags: ['all'] };\n\nmodule.exports = config;\n";
    write("featurevisor.config.js", own);

    expect(await run({ to: "sets", apply: true })).toBe(0);
    expect(read("featurevisor.config.js")).toBe(own);
    expect(exists("sets/production/features/checkout.yml")).toBe(true);
    expect(printed).toContain(
      [
        "Edit featurevisor.config.js by hand, since it does not set module.exports to an object convert can edit:",
        "  - Add these settings to the object it exports:",
        "",
        "      sets: true,",
        "      promotionFlows: [{ from: 'staging', to: 'production' }],",
      ].join("\n"),
    );
  });

  it("leaves a configuration its edits do not convert to the user", async () => {
    environmentsProject();
    const twice =
      'module.exports = {\n  environments: ["staging", "production"],\n  tags: ["all"],\n};\n\nmodule.exports.environments = ["staging", "production"];\n';
    write("featurevisor.config.js", twice);

    expect(await run({ to: "flat", keep: "production", apply: true })).toBe(0);
    expect(read("featurevisor.config.js")).toBe(twice);
    expect(printed).toContain(
      "Edit featurevisor.config.js by hand, since its settings still give the old shape after convert's edits:\n  - Remove environments",
    );
  });

  it("refuses a project with sets and environments together", async () => {
    write(
      "featurevisor.config.js",
      "module.exports = {\n  sets: true,\n  environments: ['staging', 'production'],\n};\n",
    );
    const plan = planConversion(readProject(root, config()), { to: "environments" });
    expect(plan.from).toBe("sets and environments");
    expect(plan.conflicts).toHaveLength(1);
  });

  describe("checks", () => {
    const planned = () => {
      const projectConfig = config();
      return {
        config: projectConfig,
        plan: planConversion(readProject(root, projectConfig), { to: "sets" }),
      };
    };

    it("pass a faithful conversion, naming the dependencies a lane stops carrying", async () => {
      environmentsProject();
      const { config, plan } = planned();
      const result = await checkPlan(plan, root, config);

      expect(result.problems).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.carried).toEqual([
        "staging datafiles no longer carry segment netherlands, which only other lanes' rules use.",
      ]);
    });

    it("catch a conversion that changes how a feature builds", async () => {
      environmentsProject();
      const { config, plan } = planned();
      const target = path.join(root, "sets/production/features/checkout.yml");
      plan.writes.set(target, plan.writes.get(target)!.replace("percentage: 0", "percentage: 1"));
      const result = await checkPlan(plan, root, config);

      expect(result.passed).toBe(false);
      expect(result.problems).toContain(
        "production: featurevisor-all.json changes the feature checkout.",
      );
    });

    it("catch a conversion that loses a feature from a lane", async () => {
      environmentsProject();
      const { config, plan } = planned();
      plan.writes.delete(path.join(root, "sets/staging/features/checkout.yml"));
      const result = await checkPlan(plan, root, config);

      expect(result.passed).toBe(false);
      expect(result.problems).toEqual([
        'Lint after converting: sets/staging/tests/checkout.spec.yml feature: Unknown feature "checkout".',
        'Lint after converting: sets/staging/tests/scenarios/dutch.spec.yml checks: Unknown feature "checkout".',
      ]);
    });

    it("catch a lost feature that no test reads", async () => {
      environmentsProject();
      fs.rmSync(path.join(root, "tests/banner.spec.yml"));
      const { config, plan } = planned();
      plan.writes.delete(path.join(root, "sets/production/features/banner.yml"));
      const result = await checkPlan(plan, root, config);

      expect(result.problems).toEqual([
        "production: featurevisor-all.json no longer has the feature banner.",
      ]);
    });

    it("refuse to check a project whose tests already fail", async () => {
      environmentsProject();
      write(
        "tests/banner.spec.yml",
        "feature: banner\n\nassertions:\n  - environment: production\n    at: 50\n    expectedToBeEnabled: false\n",
      );
      const { config, plan } = planned();
      const result = await checkPlan(plan, root, config);

      expect(result.problems).toEqual([
        "Tests fail before converting. Fix them first, so the conversion can be checked.",
      ]);
    });
  });

  it("converts JSON definitions, keeping fmt's layout", async () => {
    write(
      "featurevisor.config.js",
      'module.exports = {\n  environments: ["staging", "production"],\n  parser: "json",\n};\n',
    );
    write("attributes/userId.json", '{\n  "description": "User ID",\n\n  "type": "string"\n}\n');
    write("targets/all.json", '{\n  "description": "Everything"\n}\n');
    write(
      "features/checkout.json",
      [
        "{",
        '  "description": "Checkout",',
        "",
        '  "bucketBy": "userId",',
        "",
        '  "rules": {',
        '    "staging": [',
        "      {",
        '        "key": "all",',
        '        "conditions": "*",',
        '        "percentage": 100',
        "      }",
        "    ],",
        "",
        '    "production": [',
        "      {",
        '        "key": "all",',
        '        "conditions": "*",',
        '        "percentage": 0',
        "      }",
        "    ]",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const before = snapshot();

    expect(await run({ to: "sets", apply: true })).toBe(0);
    expect(JSON.parse(read("sets/staging/features/checkout.json")).rules).toEqual([
      { key: "all", conditions: "*", percentage: 100 },
    ]);
    expect(await run({ to: "environments", apply: true })).toBe(0);
    const after = snapshot();
    expect(after["features/checkout.json"]).toBe(before["features/checkout.json"]);
    expect(isMap(load(after["features/checkout.json"], parsers.json).doc.get("rules"))).toBe(true);
  });
});
