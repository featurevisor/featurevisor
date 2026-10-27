import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject, type LintErrorItem } from "./lintProject";

describe("lint with FEL", () => {
  let root: string;
  let cwd: string;

  function write(file: string, content: string) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }

  function config(extra = "allowFEL: true,") {
    write("featurevisor.config.js", `module.exports = { environments: ["production"], ${extra} };`);
  }

  async function lint() {
    const projectConfig = getProjectConfig(root);
    return lintProject(
      {
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        options: {},
      } as never,
      { json: true },
    );
  }

  const pick = (items: LintErrorItem[] | undefined) =>
    (items || []).map(({ filePath, code, message, line, column, endColumn, hint, path }) => ({
      filePath,
      code,
      message,
      line,
      column,
      endColumn,
      hint,
      path,
    }));

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fel-lint-")));
    cwd = process.cwd();
    process.chdir(root);
    config();
    write("attributes/country.yml", "description: Country\ntype: string\n");
    write("attributes/plan.yml", "description: Plan\ntype: string\n");
    write("attributes/seats.yml", "description: Seats\ntype: integer\n");
    write("attributes/isPremium.yml", "description: Premium\ntype: boolean\n");
    write("attributes/userId.yml", "description: User\ntype: string\n");
    write("attributes/appVersion.yml", "description: App version\ntype: string\nformat: semver\n");
    write("segments/netherlands.yml", "description: Dutch\nconditions: country == 'nl'\n");
    write(
      "features/checkout.yml",
      [
        "description: Checkout",
        "tags: [all]",
        "bucketBy: userId",
        "rules:",
        "  production:",
        "    - key: dutch",
        "      conditions: netherlands and plan == 'paid'",
        "      percentage: 100",
        "",
      ].join("\n"),
    );
    write(
      "variables/limit.yml",
      "description: Limit\ntype: integer\ndefaultValue: 1\nconditions: feature('checkout')\n",
    );
    write("targets/all.yml", "description: All\n");
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts a project written in FEL", async () => {
    const result = await lint();
    expect(pick(result.errors)).toEqual([]);
    expect(pick(result.warnings)).toEqual([]);
  });

  it("points a syntax error to its file, line and column, once", async () => {
    write(
      "segments/dutchPaid.yml",
      [
        "description: Dutch and paid",
        "conditions: |",
        "  # Dutch accounts",
        "  netherlands",
        "  and plan = 'paid'",
        "",
      ].join("\n"),
    );
    const result = await lint();
    expect(pick(result.errors)).toEqual([
      {
        filePath: path.join("segments", "dutchPaid.yml"),
        code: "fel_single_equals",
        message: "A single `=` does not compare.",
        line: 5,
        column: 12,
        endColumn: 13,
        hint: "Use == to compare, such as plan == ...",
        path: ["conditions"],
      },
    ]);
  });

  it("locates problems on compiled leaves", async () => {
    write(
      "segments/broken.yml",
      [
        "description: Broken",
        "conditions:",
        "  - region == 'eu'",
        "  - seats == 'five'",
        "  - netherland",
        "",
      ].join("\n"),
    );
    const errors = pick((await lint()).errors);
    expect(
      errors.map(({ code, message, line, column, endColumn, path }) => ({
        code,
        message,
        line,
        column,
        endColumn,
        path,
      })),
    ).toEqual([
      {
        code: "custom",
        message: 'Unknown attribute "region".',
        line: 3,
        column: 5,
        endColumn: 11,
        path: ["conditions", 0, "attribute"],
      },
      {
        code: "custom",
        message: 'Value does not match the schema of attribute "seats".',
        line: 4,
        column: 14,
        endColumn: 20,
        path: ["conditions", 1, "value"],
      },
      {
        code: "custom",
        message: 'Unknown segment "netherland". Did you mean "netherlands"?',
        line: undefined,
        column: undefined,
        endColumn: undefined,
        path: ["conditions", 2],
      },
    ]);
  });

  it("explains a name that is not a segment in FEL's own terms", async () => {
    write(
      "segments/names.yml",
      "description: Names\nconditions: isPremium or plan or checkout or limit\n",
    );
    write("segments/plain.yml", "description: Plain\nconditions:\n  - checkout\n");
    const messages = pick((await lint()).errors).map((error) => error.message);
    expect(messages).toEqual([
      'Unknown segment "isPremium". "isPremium" is an attribute: compare it, such as isPremium == true.',
      `Unknown segment "plan". "plan" is an attribute: compare it, such as plan == '...'.`,
      `Unknown segment "checkout". "checkout" is a feature: write feature('checkout').`,
      `Unknown segment "limit". "limit" is a global variable: compare it, such as variable('limit') == true.`,
      `Unknown segment "checkout". "checkout" is a feature: write feature('checkout').`,
    ]);
  });

  it("warns about mixed logic, missing values and versions compared as text", async () => {
    write(
      "segments/warnings.yml",
      [
        "description: Warnings",
        "conditions:",
        "  - netherlands or plan == 'paid' and seats > 1",
        "  - not (plan in ['free'])",
        "  - appVersion == '5.5.0'",
        "",
      ].join("\n"),
    );
    const result = await lint();
    expect(pick(result.errors)).toEqual([]);
    expect(pick(result.warnings).map(({ code, line, column }) => ({ code, line, column }))).toEqual(
      [
        { code: "fel_mixed_logic", line: 3, column: 5 },
        { code: "fel_negation_intent", line: 4, column: 5 },
        { code: "fel_semver_text", line: 5, column: 16 },
      ],
    );
    expect(pick(result.warnings)[2].hint).toBe(
      "Write appVersion == semver('5.5.0') to compare versions, so 5.5 matches 5.5.0.",
    );
  });

  it("reports an expression shared through a YAML alias once", async () => {
    config('allowFEL: true, environments: ["staging", "production"]');
    write(
      "features/checkout.yml",
      [
        "description: Checkout",
        "tags: [all]",
        "bucketBy: userId",
        "rules:",
        "  staging: &rules",
        "    - key: dutch",
        "      conditions: region == 'eu'",
        "      percentage: 100",
        "  production: *rules",
        "",
      ].join("\n"),
    );
    const errors = pick((await lint()).errors);
    expect(errors.map(({ message, line }) => ({ message, line }))).toEqual([
      { message: 'Unknown attribute "region".', line: 7 },
    ]);
  });

  it("keeps an invalid definition's errors with it, never with whoever read it", async () => {
    write("segments/broken.yml", "description: Broken\nconditions: country = 'nl'\n");
    write(
      "features/usesBroken.yml",
      [
        "description: Uses broken",
        "tags: [all]",
        "bucketBy: userId",
        "rules:",
        "  production:",
        "    - key: all",
        "      conditions: broken and feature('checkout')",
        "      percentage: 100",
        "",
      ].join("\n"),
    );
    const errors = pick((await lint()).errors);
    expect(errors.map(({ filePath, code }) => ({ filePath, code }))).toEqual([
      { filePath: path.join("segments", "broken.yml"), code: "fel_single_equals" },
    ]);
  });

  it("uses the valid parts of a definition with invalid FEL as a reference", async () => {
    write(
      "features/checkout.yml",
      [
        "description: Checkout",
        "tags: [all]",
        "bucketBy: userId",
        "rules:",
        "  production:",
        "    - key: dutch",
        "      conditions: plan = 'paid'",
        "      percentage: 100",
        "",
      ].join("\n"),
    );
    const errors = pick((await lint()).errors);
    expect(errors.map(({ code }) => code)).toEqual(["fel_single_equals"]);
  });

  it("reports FEL in a project that has not allowed it", async () => {
    config("");
    const errors = pick((await lint()).errors);
    expect(
      errors.map(({ filePath, code, line, column, endColumn }) => ({
        filePath,
        code,
        line,
        column,
        endColumn,
      })),
    ).toEqual([
      {
        filePath: path.join("segments", "netherlands.yml"),
        code: "fel_not_allowed",
        line: 2,
        column: 13,
        endColumn: 28,
      },
      {
        filePath: path.join("features", "checkout.yml"),
        code: "fel_not_allowed",
        line: 7,
        column: 19,
        endColumn: 49,
      },
      {
        filePath: path.join("variables", "limit.yml"),
        code: "fel_not_allowed",
        line: 4,
        column: 13,
        endColumn: 32,
      },
    ]);
    expect(errors[0].hint).toContain("allowFEL: true");
  });

  it("rejects json variables and reads inside open objects, and keeps one type per list", async () => {
    write(
      "variables/payload.yml",
      "description: Payload\ntype: json\ndefaultValue: '{\"ids\":[1]}'\n",
    );
    write("variables/bag.yml", "description: Bag\ntype: object\ndefaultValue: {}\n");
    write(
      "variables/settings.yml",
      [
        "description: Settings",
        "type: object",
        "properties:",
        "  ids:",
        "    oneOf:",
        "      - { type: integer }",
        "      - { type: string }",
        "defaultValue: { ids: 1 }",
        "",
      ].join("\n"),
    );
    write(
      "segments/lists.yml",
      [
        "description: Lists",
        "conditions:",
        "  - variable('payload').ids in [1, 2]",
        "  - variable('settings').ids in [1, 'a']",
        "  - variable('settings').ids in [1, 2, null]",
        "  - seats in [1, 5, 10]",
        "  - variable('bag') notEmpty",
        "  - variable('bag').colour == 'red'",
        "",
      ].join("\n"),
    );
    const errors = pick((await lint()).errors);
    expect(errors.map(({ message, line, column }) => ({ message, line, column }))).toEqual([
      {
        message:
          'Conditions cannot read json variables, since their contents have no declared types. Give global variable "payload" a declared shape, such as type object with properties, to use it here.',
        line: 3,
        column: 5,
      },
      {
        message:
          'when operator is "in", the list mixes strings and numbers. A list holds one type, with null allowed beside it. Quote every value or none.',
        line: 4,
        column: 33,
      },
      {
        message:
          'Conditions cannot read inside objects without declared properties, since their contents have no declared types. Give global variable "bag" properties, or additionalProperties for a map, to use it here.',
        line: 8,
        column: 5,
      },
    ]);
  });

  it("prints a code frame instead of a tree path inside FEL", async () => {
    write("segments/text.yml", "description: Text\nconditions: region == 'eu'\n");
    write(
      "segments/tree.yml",
      "description: Tree\nconditions:\n  - attribute: region\n    operator: equals\n    value: eu\n",
    );
    const printed: string[] = [];
    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    };
    const log = jest.spyOn(console, "log").mockImplementation(capture);
    const error = jest.spyOn(console, "error").mockImplementation(capture);
    try {
      const projectConfig = getProjectConfig(root);
      await lintProject(
        {
          rootDirectoryPath: root,
          projectConfig,
          datasource: new Datasource(projectConfig, root),
          options: {},
        } as never,
        {},
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    const output = printed.join("\n");
    expect(output).toContain(path.join("segments", "text.yml") + ":2:13");
    expect(output).not.toContain("Path: conditions.attribute");
    expect(output).toContain("Path: conditions.0.attribute");
  });

  it("rejects an allowFEL that is not a boolean", () => {
    config('allowFEL: "yes",');
    expect(() => getProjectConfig(root)).toThrow("Invalid allowFEL: yes. It must be a boolean.");
  });

  it("gives positions inside the expression when files have none", async () => {
    write(
      "featurevisor.config.js",
      'module.exports = { parser: "json", environments: ["production"], allowFEL: true };',
    );
    write("attributes/country.json", JSON.stringify({ description: "Country", type: "string" }));
    write(
      "segments/broken.json",
      JSON.stringify({ description: "Broken", conditions: "country == 'nl' and region == 1" }),
    );
    const errors = pick((await lint()).errors).filter((error) => error.filePath.endsWith(".json"));
    expect(errors).toEqual([
      expect.objectContaining({
        message: 'Unknown attribute "region". (line 1, column 21 of the expression)',
        line: undefined,
        path: ["conditions", 1, "attribute"],
      }),
    ]);
  });
});
