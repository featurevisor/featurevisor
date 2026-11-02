import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintPlugin, lintProject } from "./lintProject";
import { diagnosticParseOptions, suggestKey } from "./diagnostics";
import { getLintIssuesFromZodError } from "./printError";

describe("authoring diagnostics", () => {
  let root: string;
  const write = (name: string, content: string) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const lint = (options = {}) => {
    const projectConfig = getProjectConfig(root);
    return lintProject(
      {
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        options: {},
      },
      { json: true, ...options },
    );
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-diagnostics-"));
    write("featurevisor.config.js", "module.exports = {};");
    write("attributes/userId.yml", "description: User ID\ntype: string\n");
    write("segments/netherlands.yml", 'description: Netherlands\nconditions: "*"\n');
  });
  afterEach(() => {
    fs.rmSync(root, { force: true, recursive: true });
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "prints authored mutation paths once through project lint (ordered: %s)",
    async (ordered) => {
      const mutations = (values: Record<string, unknown>) =>
        ordered ? Object.entries(values).map(([key, value]) => ({ [key]: value })) : values;
      const settings = {
        type: "object",
        properties: {
          methods: { type: "array", items: { type: "string" } },
          currency: { type: "string", enum: ["EUR", "GBP"] },
        },
        defaultValue: { methods: ["card"], currency: "EUR" },
      };
      write("variables/source.yml", JSON.stringify({ description: "Source", ...settings }));
      for (const [key, definition, prefix] of [
        ["v", settings, ""],
        ["alias", { compose: "source" }, ""],
        ["composed", { compose: { policy: { variable: "source" } } }, "policy."],
      ] as const) {
        write(
          `variables/${key}.yml`,
          JSON.stringify({
            description: "Policy",
            ...definition,
            overrides: [
              {
                key: "all",
                conditions: "*",
                mutate: mutations({
                  [`${prefix}methods:append`]: "ideal",
                  [`${prefix}methods.nope`]: 1,
                  [`${prefix}currency`]: "USD",
                }),
              },
            ],
          }),
        );
      }
      const result = await lint();
      expect(result.hasError).toBe(true);
      expect(result.errors).toHaveLength(6);
      for (const key of ["v", "alias", "composed"]) {
        const prefix = key === "composed" ? "policy." : "";
        const issues = result.errors.filter((issue) => issue.key === key);
        expect(issues).toHaveLength(2);
        expect(
          issues.every(
            (issue) =>
              issue.entityType === "variable" &&
              issue.filePath ===
                path.relative(process.cwd(), path.join(root, "variables", `${key}.yml`)),
          ),
        ).toBe(true);
        expect(issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining(`variable "${key}"`),
              path: ["overrides", 0, "mutate", ...(ordered ? [1] : []), `${prefix}methods.nope`],
            }),
            expect.objectContaining({
              message: expect.stringContaining("enum"),
              path: ["overrides", 0, "mutate", ...(ordered ? [2] : []), `${prefix}currency`],
            }),
          ]),
        );
      }
      expect(
        result.errors.some((issue) =>
          /expected an object|value\.methods|variable\.methods/.test(issue.message),
        ),
      ).toBe(false);
    },
  );

  it.each([1, 2])("uses the right noun for %i entities of each type", async (count) => {
    const sources = {
      "features/checkout.yml":
        'description: Checkout\nbucketBy: userId\nrules:\n  - { key: all, conditions: "*", percentage: 100 }\n',
      "variables/limit.yml": "description: Limit\ntype: integer\ndefaultValue: 1\n",
      "schemas/count.yml": "type: integer\n",
      "targets/all.yml": "description: All\n",
      "tests/checkout.spec.yml":
        "feature: checkout\nassertions:\n  - { at: 0, expectedToBeEnabled: true }\n",
      "tests/scenario.spec.yml": "checks:\n  - { variable: limit, operator: equals, value: 1 }\n",
    };
    for (const [file, content] of Object.entries(sources)) write(file, content);
    if (count === 2) {
      for (const file of [
        ...Object.keys(sources),
        "attributes/userId.yml",
        "segments/netherlands.yml",
      ]) {
        write(
          file.replace(/(\.spec)?\.yml$/, "2$1.yml"),
          fs.readFileSync(path.join(root, file), "utf8"),
        );
      }
    }
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await lint({ json: false });
    expect(result.errors).toEqual([]);
    for (const noun of [
      "attribute",
      "segment",
      "feature",
      "variable",
      "schema",
      "target",
      "test",
      "scenario",
    ]) {
      expect(log).toHaveBeenCalledWith(`Linting ${count} ${noun}${count === 1 ? "" : "s"}...\n`);
    }
  });

  it("labels root paths in both feature and other entity output", async () => {
    write(
      "features/typo.yml",
      'description: Typo\nbucketBy: userId\nrule: []\nrules:\n  - { key: all, conditions: "*", percentage: 100 }\n',
    );
    write("segments/typo.yml", 'description: Typo\nconditions: "*"\nextra: true\n');
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await lint({ json: false });
    expect(result.hasError).toBe(true);
    expect(log).toHaveBeenCalledWith("     Path:", "(root)");
    expect(error).toHaveBeenCalledWith("     Path:", "(root)");
    expect(
      result.errors
        .filter((item) => item.code === "unrecognized_keys")
        .every((item) => item.path.length === 0),
    ).toBe(true);
  });

  it.each([false, true])(
    "describes missing rules in the configured shape (environments: %s)",
    async (environments) => {
      if (environments)
        write("featurevisor.config.js", 'module.exports = { environments: ["production"] };');
      write("features/missingRules.yml", "description: Missing rules\nbucketBy: userId\n");
      const result = await lint();
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["rules"],
            message: `Missing required \`rules\`. Expected ${environments ? "an object mapping environments to lists of rules" : "a list of rules"}.`,
          }),
        ]),
      );
    },
  );

  it("keeps confident operator suggestions compact and retains the list for distant typos", async () => {
    write(
      "segments/near.yml",
      "description: Near\nconditions: { attribute: userId, operator: equal, value: hello }\n",
    );
    write(
      "segments/far.yml",
      "description: Far\nconditions: { attribute: userId, operator: totallyUnknown, value: hello }\n",
    );
    const result = await lint();
    const near = result.errors.find((item) => item.key === "near")!;
    expect(near.message).toBe(
      'Unknown operator "equal". Did you mean "equals"? See https://featurevisor.com/docs/operators/.',
    );
    const far = result.errors.find((item) => item.key === "far")!;
    expect(far.message).toContain("Allowed: equals, notEquals,");
    expect(far.message).not.toContain("Did you mean");
  });

  it("uses sentences before suggestions and articles in variable errors", async () => {
    write(
      "features/typo.yml",
      "description: Typo\nbucketBy: userId\nrules:\n  - { key: all, conditions: netherland, percentage: 100 }\n",
    );
    write("variables/wrong.yml", 'description: Wrong\ntype: integer\ndefaultValue: "5"\n');
    write("variables/object.yml", "description: Object\ntype: integer\ndefaultValue: {}\n");
    const result = await lint();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Unknown segment "netherland". Did you mean "netherlands"?',
        }),
        expect.objectContaining({
          message: 'Variable "wrong" (type integer) must be a number, but got a string.',
        }),
        expect.objectContaining({
          message: 'Variable "object" (type integer) must be a number, but got an object.',
        }),
      ]),
    );
  });

  it("uses sentence case and kebab case in lint help examples", () => {
    for (const example of lintPlugin.examples!) {
      expect(example.description).toMatch(/^[A-Z]/);
      expect(example.command).not.toMatch(/--[a-z-]*[A-Z]/);
    }
  });

  it.each([true, false])(
    "reports a parse failure once with its own identity (json: %s)",
    async (json) => {
      write("features/aaaMissing.yml", "description: Missing bucket\n");
      write("features/badYaml.yml", "description: Broken\nrules:\n  - key: a\n broken: value\n");
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      jest.spyOn(console, "error").mockImplementation(() => {});
      const result = await lint({ json });
      const failures = result.errors.filter((error) => error.message.includes("badYaml.yml"));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        entityType: "feature",
        key: "badYaml",
        code: "EntityParseError",
      });
      expect(failures[0].message).toMatch(/badYaml\.yml:4:\d+:/);
      expect(failures[0].message).not.toContain("\n");
      expect(
        result.errors
          .filter((error) => error.key === "aaaMissing")
          .every((error) => !error.message.includes("badYaml")),
      ).toBe(true);
      expect(log.mock.calls.flat().some((value) => value instanceof Error)).toBe(false);
      if (json) expect(log).not.toHaveBeenCalled();
    },
  );

  it("reports a broken prerequisite under its source even during focused lint", async () => {
    write(
      "features/consumer.yml",
      'description: Consumer\nbucketBy: userId\nconditions: { feature: broken }\nrules:\n  - { key: all, conditions: "*", percentage: 100 }\n',
    );
    write("features/broken.yml", "description: : broken\n");
    const result = await lint({ keyPattern: "^consumer$", entityType: "feature" });
    const failures = result.errors.filter((error) => error.code === "EntityParseError");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ entityType: "feature", key: "broken" });
  });

  it("retains parse stacks only in verbose text output", async () => {
    write("features/broken.yml", "description: : broken\n");
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await lint({ json: false, verbose: true });
    expect(log.mock.calls.flat().some((value) => value instanceof Error && value.stack)).toBe(true);
    log.mockClear();
    await lint({ verbose: true });
    expect(log).not.toHaveBeenCalled();
  });

  it("preserves the public test key when reporting malformed spec files", async () => {
    write("tests/broken.spec.yml", "feature: : broken\n");
    const result = await lint();
    expect(result.errors).toEqual([
      expect.objectContaining({
        key: "broken",
        entityType: "test",
        message: expect.stringContaining("tests/broken.spec.yml:1:"),
      }),
    ]);
  });

  it("names missing fields and supported shapes without accepting them", async () => {
    write(
      "features/missing.yml",
      "description: Missing fields\nrules:\n  - { key: all, percentage: 100 }\n",
    );
    const result = await lint();
    expect(result.hasError).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["bucketBy"],
          message: expect.stringContaining(
            "Missing required `bucketBy`. Expected an attribute key",
          ),
        }),
        expect.objectContaining({
          path: ["rules", 0, "conditions"],
          message: expect.stringContaining("A selector must define `conditions`"),
        }),
      ]),
    );
  });

  it("explains unknown operators at the nested operator path", async () => {
    write(
      "segments/typo.yml",
      "description: Typo\nconditions:\n  - and:\n      - { attribute: userId, operator: equal, value: hello }\n",
    );
    const result = await lint();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["conditions", 0, "and", 0, "operator"],
          message: expect.stringContaining('Did you mean "equals"?'),
        }),
      ]),
    );
  });

  it("explains numbers in a list for a string attribute", async () => {
    write(
      "segments/numeric.yml",
      "description: Numeric\nconditions:\n  - { attribute: userId, operator: in, value: [1, 2] }\n",
    );
    const result = await lint();
    expect(result.hasError).toBe(true);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: ["conditions", 0, "value", 0],
        message: 'Value at index 0 does not match the schema of attribute "userId".',
      }),
      expect.objectContaining({
        path: ["conditions", 0, "value", 1],
        message: 'Value at index 1 does not match the schema of attribute "userId".',
      }),
    ]);
    expect(result.errors.some((error) => error.message === "Invalid input")).toBe(false);
  });

  it.each(["in", "notIn"])("accepts %s with numbers for a numeric attribute", async (operator) => {
    write("attributes/age.yml", "description: Age\ntype: integer\n");
    write(
      "segments/numeric.yml",
      `description: Numeric\nconditions:\n  - { attribute: age, operator: ${operator}, value: [18, 21, null] }\n`,
    );
    const result = await lint();
    expect(result.errors).toEqual([]);
  });

  it.each(["in", "notIn"])("keeps one type per list for %s", async (operator) => {
    write("attributes/age.yml", "description: Age\ntype: integer\n");
    write(
      "segments/numeric.yml",
      `description: Numeric\nconditions:\n  - { attribute: age, operator: ${operator}, value: [18, "21"] }\n`,
    );
    const result = await lint();
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: ["conditions", 0, "value", 1],
        message: 'Value at index 1 does not match the schema of attribute "age".',
      }),
    ]);
  });

  it("lists variable types and uses the global key for default and override errors", async () => {
    write("variables/typo.yml", "description: Typo\ntype: strng\ndefaultValue: hello\n");
    write("schemas/typo.yml", "type: strng\n");
    write(
      "variables/anotherDefault.yml",
      'description: Another\ntype: integer\ndefaultValue: "5"\n',
    );
    write(
      "variables/wrongDefault.yml",
      'description: Wrong default\ntype: integer\ndefaultValue: "5"\ndisabledValue: "6"\noverrides:\n  - { key: all, conditions: "*", value: "7" }\n',
    );
    const result = await lint();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "typo",
          path: ["type"],
          message: expect.stringContaining(
            "Allowed: json, boolean, string, integer, number, object, array",
          ),
        }),
        expect.objectContaining({
          entityType: "schema",
          key: "typo",
          path: ["type"],
          message: expect.stringContaining(
            "Allowed: boolean, string, integer, number, object, array",
          ),
        }),
        expect.objectContaining({
          key: "anotherDefault",
          message: expect.stringContaining('Variable "anotherDefault"'),
        }),
      ]),
    );
    const errors = result.errors.filter((error) => error.key === "wrongDefault");
    expect(errors).toHaveLength(3);
    expect(errors.every((error) => error.message.includes('Variable "wrongDefault"'))).toBe(true);
  });

  it("points each duplicate rule key at its second occurrence", async () => {
    write(
      "features/duplicate.yml",
      'description: Duplicate\nbucketBy: userId\nrules:\n  - { key: a, conditions: "*", percentage: 100 }\n  - { key: a, conditions: "*", percentage: 100 }\n  - { key: a, conditions: "*", percentage: 100 }\n',
    );
    const result = await lint();
    const errors = result.errors.filter((error) => error.message.includes("Duplicate rule"));
    expect(errors).toEqual([
      expect.objectContaining({
        path: ["rules", 1, "key"],
        message: 'Duplicate rule key "a". Each rule key must be unique.',
      }),
    ]);
  });

  it("suggests nearby segment, attribute, feature and object keys", async () => {
    write(
      "features/checkout.yml",
      'description: Checkout\nbucketBy: userId\nrules:\n  - { key: all, conditions: "*", percentage: 100 }\n',
    );
    write(
      "features/typo.yml",
      "description: Typo\nbucketBy: userID\nconditions: { feature: checkou }\nrule: []\nrules:\n  - { key: all, conditions: netherland, percentage: 100 }\n",
    );
    const result = await lint();
    const messages = result.errors.map((error) => error.message).join("\n");
    for (const expected of ["userId", "checkout", "rules", "netherlands"]) {
      expect(messages).toContain(`Did you mean "${expected}"?`);
    }
  });

  it("leaves ambiguous union branches unselected", () => {
    const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    const result = schema.safeParse({}, diagnosticParseOptions);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(getLintIssuesFromZodError(result.error)).toEqual([
        expect.objectContaining({ path: [], message: "Invalid input" }),
      ]);
    const ambiguousCondition = z
      .union([z.object({ and: z.array(z.unknown()) }), z.object({ attribute: z.string() })])
      .safeParse({}, diagnosticParseOptions);
    expect(ambiguousCondition.success).toBe(false);
    if (!ambiguousCondition.success)
      expect(getLintIssuesFromZodError(ambiguousCondition.error)).toEqual([
        expect.objectContaining({ path: [], message: "Invalid input" }),
      ]);
    expect(suggestKey("cat", ["bat", "hat"])).toBe("");
    expect(suggestKey("unrelated", ["checkout"])).toBe("");
    expect(suggestKey("a".repeat(10000), ["b".repeat(10000)])).toBe("");
    expect(suggestKey("checkout", Array(1001).fill("checkouts"))).toBe("");
  });
});
