import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsers } from "@featurevisor/parsers";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "../linter/lintProject";
import { testProject } from "../tester/testProject";
import {
  migrateFeature,
  migrateSchema,
  migrateSegment,
  migrateSelector,
  migrateTest,
  migrateVariable,
  Migration,
} from "./definitions";
import { migrateProject, runMigration } from "./run";
import { mergeLines } from "../rewrite/lines";
import { writeDefinition } from "./write";

// The SDK's reader of v3 datafiles, which migration must agree with. Required rather than
// imported, as it sits outside this package.
const { normalizeEntity } = require("../../../sdk/src/normalize");

describe("selectors", () => {
  const entries: Record<string, unknown>[] = [
    { segments: "netherlands" },
    { segments: "*" },
    { segments: ["netherlands", "adults"] },
    { segments: { or: ["netherlands", { not: ["adults"] }] } },
    { segments: [] },
    { segments: { and: [] } },
    { segments: "netherlands", requiredFeatures: "pricing" },
    { segments: ["netherlands"], requiredFeatures: [{ feature: "pricing", variation: "b" }] },
    { conditions: [{ attribute: "country", operator: "equals", value: "nl" }], segments: "adults" },
    {
      conditions: { attribute: "country", operator: "equals", value: "nl" },
      requiredFeatures: ["a", "b"],
    },
    { requiredFeatures: { or: ["a", { feature: "b", enabled: false }] } },
  ];

  it.each(entries)("converts %j as v4 SDKs read it from a v3 datafile", (entry) => {
    const feature = normalizeEntity(
      0,
      "f",
      {
        bucketBy: "userId",
        traffic: [{ key: "r", percentage: 100000, ...entry }],
        force: [{ ...entry, enabled: true }],
        variations: [{ value: "a", variableOverrides: { v: [{ ...entry, value: 1 }] } }],
      },
      true,
    ).value;
    const migration = new Migration();

    expect(migrateSelector({ key: "r", ...entry }, [], "rule", migration)).toEqual({
      key: "r",
      conditions: feature.traffic[0].conditions,
    });
    expect(migrateSelector({ ...entry, enabled: true }, [], "force", migration)).toEqual({
      conditions: feature.force[0].conditions,
      enabled: true,
    });
    expect(
      migrateSelector({ ...entry, value: 1 }, [], "featureVariableOverride", migration),
    ).toEqual({ conditions: feature.variations[0].variableOverrides.v[0].conditions, value: 1 });
  });

  it("writes everyone only as a whole expression, as v4 requires", () => {
    const migration = new Migration();
    const migrate = (entry: Record<string, unknown>) =>
      (migrateSelector(entry, [], "force", migration) as { conditions: unknown }).conditions;

    expect(migrate({ segments: "*", requiredFeatures: "pricing" })).toEqual([
      { feature: "pricing" },
    ]);
    expect(migrate({ segments: { or: ["netherlands", []] } })).toBe("*");
    expect(migrate({ segments: [["netherlands", "adults"], "beta"] })).toEqual([
      { and: ["netherlands", "adults"] },
      "beta",
    ]);
  });

  it("converts required at a feature's root only, where v3 meant required features", () => {
    const migration = new Migration();

    expect(
      migrateFeature({ required: ["checkout", { key: "pricing", variation: "b" }] }, {}, migration),
    ).toEqual({
      conditions: [{ feature: "checkout" }, { feature: "pricing", variation: "b" }],
    });
    expect(migration.notes.map((note) => note.section)).toEqual(["prepare-while-still-on-v3"]);

    const schema = {
      type: "object",
      properties: { currency: { type: "string" } },
      required: ["currency"],
    };
    expect(
      migrateVariable({ ...schema, defaultValue: { currency: "EUR" } }, {}, new Migration()),
    ).toEqual({
      ...schema,
      defaultValue: { currency: "EUR" },
    });
  });

  it("gives a global variable override without a selector conditions that match everyone", () => {
    const migration = new Migration();
    const variable = migrateVariable(
      { type: "string", defaultValue: "a", overrides: [{ key: "b", value: "b" }] },
      {},
      migration,
    );

    expect(variable).toEqual({
      type: "string",
      defaultValue: "a",
      overrides: [{ key: "b", conditions: "*", value: "b" }],
    });
  });
});

describe("conditions", () => {
  const attributes = {
    age: { type: "integer" },
    country: { type: "string" },
    signedUp: { type: "string", format: "date-time" },
  };

  it("writes in and notIn on numbers as equals groups", () => {
    const migration = new Migration();
    const segment = migrateSegment(
      {
        conditions: [
          { attribute: "age", operator: "in", value: [18, 19] },
          { attribute: "age", operator: "notIn", value: [20] },
          { attribute: "country", operator: "in", value: ["nl"] },
        ],
      },
      attributes,
      migration,
    );

    expect(segment).toEqual({
      conditions: [
        {
          or: [
            { attribute: "age", operator: "equals", value: 18 },
            { attribute: "age", operator: "equals", value: 19 },
          ],
        },
        { not: [{ or: [{ attribute: "age", operator: "equals", value: 20 }] }] },
        { attribute: "country", operator: "in", value: ["nl"] },
      ],
    });
    expect([...migration.changes]).toEqual(["operators"]);
  });

  it("leaves a timestamp compared with equals for a person to rewrite", () => {
    const migration = new Migration();
    const conditions = [
      { attribute: "signedUp", operator: "equals", value: "2026-01-01T00:00:00Z" },
    ];

    expect(migrateSegment({ conditions }, attributes, migration)).toEqual({ conditions });
    expect(migration.notes).toEqual([
      expect.objectContaining({ path: ["conditions", 0], section: "date-attribute-comparisons" }),
    ]);
  });
});

describe("types, specs and mutations", () => {
  it("writes v3 types as JSON Schema types, through nested schemas", () => {
    const migration = new Migration();
    const feature = migrateFeature(
      {
        variablesSchema: {
          discount: { type: "double", defaultValue: 0.5 },
          release: {
            type: "object",
            properties: { at: { type: "date" }, version: { type: "semver" } },
            defaultValue: {},
          },
        },
      },
      {},
      migration,
    );

    expect(feature).toEqual({
      variablesSchema: {
        discount: { type: "number", defaultValue: 0.5 },
        release: {
          type: "object",
          properties: {
            at: { type: "string", format: "date-time" },
            version: { type: "string", format: "semver" },
          },
          defaultValue: {},
        },
      },
    });
  });

  it("renames sticky and removed evaluation fields in specs, children included", () => {
    const migration = new Migration();
    const spec = migrateTest(
      {
        feature: "checkout",
        assertions: [
          {
            sticky: { pricing: { enabled: false } },
            expectedEvaluations: { flag: { reason: "required", requiredFeatures: ["pricing"] } },
            children: [{ sticky: {}, expectedToBeEnabled: true }],
          },
        ],
      },
      migration,
    );

    expect(spec).toEqual({
      feature: "checkout",
      assertions: [
        {
          stickyFeatures: { pricing: { enabled: false } },
          expectedEvaluations: { flag: { reason: "conditions_unmet" } },
          children: [{ stickyFeatures: {}, expectedToBeEnabled: true }],
        },
      ],
    });
    expect([...migration.changes].sort()).toEqual(["evaluations", "stickyFeatures"]);
  });

  it("puts a mutation map whose v4 value differs in the order v3 applied it", () => {
    const migration = new Migration();
    const feature = migrateFeature(
      {
        variablesSchema: {
          config: { type: "object", defaultValue: { theme: "light" } },
        },
        variations: [
          { value: "a", variables: { "config.theme": "dark", config: { theme: "light" } } },
        ],
      },
      {},
      migration,
    ) as { variations: { variables: object }[] };

    expect(Object.keys(feature.variations[0].variables)).toEqual(["config", "config.theme"]);
    expect([...migration.changes]).toEqual(["mutation order"]);
  });
});

describe("writing", () => {
  it("merges changes into the file's own lines, leaving the rest as written", () => {
    const source = [
      "description:   Checkout # spacing kept",
      "meta: { owner: growth }",
      "rules:",
      "  # Dutch users",
      "  - key: nl",
      "    segments: netherlands # first",
      "    requiredFeatures:",
      "      # pricing must be on",
      "      - pricing",
      "    percentage: 100",
      "",
    ].join("\n");
    const before = parsers.yml.parse(source) as { rules: Record<string, unknown>[] };
    const migration = new Migration();
    const after = {
      ...before,
      rules: [migrateSelector(before.rules[0], ["rules", 0], "rule", migration)],
    };

    expect(writeDefinition(source, before, after, migration.renames, parsers.yml)).toBe(
      [
        "description:   Checkout # spacing kept",
        "meta: { owner: growth }",
        "rules:",
        "  # Dutch users",
        "  - key: nl",
        "    # pricing must be on",
        "    conditions: # first",
        "      - netherlands",
        "      - feature: pricing",
        "    percentage: 100",
        "",
      ].join("\n"),
    );
  });

  it("keeps a renamed key's comments and its value's layout", () => {
    const source =
      "rules:\n  - key: a\n    # all of them\n    segments: [netherlands, adults] # both\n";
    const before = parsers.yml.parse(source) as { rules: Record<string, unknown>[] };
    const migration = new Migration();
    const after = { rules: [migrateSelector(before.rules[0], ["rules", 0], "rule", migration)] };

    expect(writeDefinition(source, before, after, migration.renames, parsers.yml)).toBe(
      "rules:\n  - key: a\n    # all of them\n    conditions: [netherlands, adults] # both\n",
    );
  });

  it("spaces a key it adds as the keys around it are spaced", () => {
    const source = "description: App version\n\ntype: semver\n";
    const before = parsers.yml.parse(source);
    const after = migrateSchema(before, [], new Migration());

    expect(writeDefinition(source, before, after, [], parsers.yml)).toBe(
      "description: App version\n\ntype: string\n\nformat: semver\n",
    );
  });

  it("keeps a file's line endings and byte order mark", () => {
    const lf = "description: x\n\n# Dutch users\nrules:\n  - key: nl\n    segments: netherlands\n";
    const source = `\uFEFF${lf.replace(/\n/g, "\r\n")}`;
    const before = parsers.yml.parse(source) as { rules: Record<string, unknown>[] };
    const migration = new Migration();
    const after = {
      ...before,
      rules: [migrateSelector(before.rules[0], ["rules", 0], "rule", migration)],
    };

    expect(writeDefinition(source, before, after, migration.renames, parsers.yml)).toBe(
      source.replace("segments:", "conditions:"),
    );
  });

  it("applies a change only where the rendered and written lines agree", () => {
    expect(mergeLines("a\nB\nc\n", "a\nb\nc\n", "a\nb\nC\n")).toBe("a\nB\nC\n");
    expect(mergeLines("a\nB\nc\n", "a\nb\nc\n", "a\nX\nc\n")).toBeUndefined();
  });

  it("writes JSON and custom parsers' files too", () => {
    const source = '{\n  "rules": [{ "key": "a", "segments": "*" }]\n}\n';
    const before = JSON.parse(source);
    const migration = new Migration();
    const after = { rules: [migrateSelector(before.rules[0], ["rules", 0], "rule", migration)] };

    expect(
      JSON.parse(writeDefinition(source, before, after, migration.renames, parsers.json)),
    ).toEqual(after);
  });
});

describe("migrateProject", () => {
  let root: string;
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-migrate-"));
    write(
      "featurevisor.config.js",
      'module.exports = {\n  environments: ["staging", "production"],\n  allowFeatureAndGlobalVariableKeyCollisions: false,\n};\n',
    );
    write("attributes/userId.yml", "type: string\ndescription: User\n");
    write("attributes/country.yml", "type: string\ndescription: Country\n");
    write("attributes/age.yml", "type: integer\ndescription: Age\n");
    write("attributes/score.yml", "type: double\ndescription: Score\n");
    write(
      "segments/netherlands.yml",
      "description: Dutch\nconditions:\n  - attribute: country\n    operator: equals\n    value: nl\n",
    );
    write(
      "segments/adults.yml",
      "description: Adults\nconditions:\n  - attribute: age\n    operator: in\n    value: [18, 19, 20]\n",
    );
    write(
      "features/pricing.yml",
      'description: Pricing\ntags: [all]\nbucketBy: userId\nrules:\n  staging:\n    - key: all\n      segments: "*"\n      percentage: 100\n  production:\n    - key: all\n      segments: "*"\n      percentage: 100\n',
    );
    write(
      "features/checkout.yml",
      [
        "description: Checkout",
        "tags: [all]",
        "bucketBy: userId",
        "# pricing must be live first",
        "requiredFeatures: pricing",
        "variablesSchema:",
        "  discount:",
        "    type: double",
        "    defaultValue: 0.1",
        "rules:",
        "  staging:",
        "    - key: all",
        '      segments: "*"',
        "      percentage: 100",
        "  production:",
        "    - key: nl",
        "      segments: [netherlands, adults] # adults in the Netherlands",
        "      percentage: 100",
        "      variables:",
        "        discount: 0.2",
        "    - key: everyone",
        '      segments: "*"',
        "      percentage: 0",
        "",
      ].join("\n"),
    );
    write(
      "variables/supportEmail.yml",
      [
        "description: Support",
        "type: string",
        "defaultValue: help@example.com",
        "requiredFeatures: checkout",
        "disabledValue: none@example.com",
        "overrides:",
        "  production:",
        "    - key: nl",
        "      segments: netherlands",
        "      value: nl@example.com",
        "",
      ].join("\n"),
    );
    write(
      "tests/checkout.spec.yml",
      [
        "feature: checkout",
        "assertions:",
        "  - environment: production",
        "    at: 50",
        "    context: { country: nl, age: 19 }",
        "    expectedToBeEnabled: true",
        "    expectedVariables:",
        "      discount: 0.2",
        "  - environment: production",
        "    at: 50",
        "    context: { country: nl, age: 30 }",
        "    expectedToBeEnabled: false",
        "  - environment: production",
        "    at: 50",
        "    sticky:",
        "      pricing:",
        "        enabled: false",
        "    context: { country: nl, age: 19 }",
        "    expectedToBeEnabled: false",
        "    expectedEvaluations:",
        "      flag:",
        "        reason: required",
        "        requiredFeatures:",
        "          - pricing",
        "",
      ].join("\n"),
    );
    write(
      "tests/supportEmail.spec.yml",
      [
        "variable: supportEmail",
        "assertions:",
        "  - environment: production",
        "    context: { country: nl, age: 19 }",
        "    expectedValue: nl@example.com",
        "  - environment: production",
        "    stickyFeatures:",
        "      checkout:",
        "        enabled: false",
        "    expectedValue: none@example.com",
        "    expectedEvaluation:",
        "      reason: required_features_unmet",
        "",
      ].join("\n"),
    );
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function deps() {
    const projectConfig = getProjectConfig(root);
    return {
      rootDirectoryPath: root,
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      options: {},
    };
  }

  it("migrates a v3 project that v4 then lints and tests as v3 did", async () => {
    const result = migrateProject(root);

    expect(result.errors).toBe(0);
    expect(
      result.files.map((file) => [
        path.relative(root, path.resolve(file.filePath)).split(path.sep).join("/"),
        file.changes,
      ]),
    ).toEqual([
      ["attributes/score.yml", ["types"]],
      ["segments/adults.yml", ["operators"]],
      ["features/checkout.yml", ["conditions", "types"]],
      ["features/pricing.yml", ["conditions"]],
      ["variables/supportEmail.yml", ["conditions"]],
      ["tests/checkout.spec.yml", ["stickyFeatures", "evaluations"]],
      ["tests/supportEmail.spec.yml", ["evaluations"]],
      ["featurevisor.config.js", ["allowFeatureAndVariableKeyCollisions"]],
    ]);
    expect(read("features/checkout.yml")).toContain(
      "# pricing must be live first\nconditions:\n  - feature: pricing\n",
    );
    expect(read("features/checkout.yml")).toContain(
      "      conditions: [netherlands, adults] # adults in the Netherlands\n",
    );

    const lint = await lintProject(deps(), { json: true });
    expect(lint.errors).toEqual([]);
    // testProject resolves to whether anything failed
    await expect(testProject(deps(), { onlyFailures: true, quiet: true })).resolves.toBe(false);

    // a second run finds nothing left
    expect(migrateProject(root)).toMatchObject({ migrated: 0, errors: 0 });
  });

  it("writes nothing when checking, and exits with 1, or 0 once migrated", async () => {
    const before = read("features/checkout.yml");

    expect(await runMigration(root, { _: [], check: true })).toBe(1);
    expect(read("features/checkout.yml")).toBe(before);
    expect(await runMigration(root, { _: [] })).toBe(0);
    expect(await runMigration(root, { _: [], check: true })).toBe(0);
  });

  it("stops before writing anything while the project has Groups", async () => {
    write("groups/exclusive.yml", "description: x\nslots: []\n");
    const before = read("features/checkout.yml");

    expect(await runMigration(root, { _: [] })).toBe(2);
    expect(read("features/checkout.yml")).toBe(before);
  });

  it("removes environments: [] from the configuration", () => {
    write("featurevisor.config.js", "module.exports = {\n  environments: [],\n};\n");
    for (const file of [
      "features/pricing.yml",
      "features/checkout.yml",
      "variables/supportEmail.yml",
    ]) {
      fs.rmSync(path.join(root, file));
    }
    fs.rmSync(path.join(root, "tests"), { recursive: true });

    migrateProject(root);
    expect(read("featurevisor.config.js")).toBe("module.exports = {\n};\n");
  });
});
