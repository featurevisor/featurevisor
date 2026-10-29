import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsers, type CustomParser, type FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { buildProjectSets } from "../builder/buildProject";
import { getBuiltinCLIOptions } from "../cli/options";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import {
  canFormat,
  FormatGuardError,
  FormatParseError,
  formatDefinition,
} from "./formatDefinition";
import { fmtPlugin } from "./index";
import { formatProject } from "./formatProject";
import {
  FORMAT_ENTITY_TYPES,
  getFormatLayout,
  getKeyOrder,
  isSpacedList,
  isSpacedMap,
  orderValue,
} from "./layout";
import { unifiedDiff } from "./unifiedDiff";

describe("key order", () => {
  it("puts lifecycle keys first and force before rules in a feature", () => {
    const keys = ["rules", "force", "bucketBy", "description", "archived", "variations", "tags"];

    expect(getKeyOrder("feature", [], keys)).toEqual([
      "archived",
      "description",
      "tags",
      "bucketBy",
      "variations",
      "force",
      "rules",
    ]);
  });

  it("keeps unknown keys after known ones, in their authored order", () => {
    expect(getKeyOrder("segment", [], ["zeta", "conditions", "alpha", "description"])).toEqual([
      "description",
      "conditions",
      "zeta",
      "alpha",
    ]);
  });

  it("orders rules, variations and force entries, flat or by environment", () => {
    const rule = ["percentage", "conditions", "key"];

    expect(getKeyOrder("feature", ["rules", 0], rule)).toEqual(["key", "conditions", "percentage"]);
    expect(getKeyOrder("feature", ["rules", "production", 1], rule)).toEqual([
      "key",
      "conditions",
      "percentage",
    ]);
    expect(getKeyOrder("feature", ["variations", 0], ["weight", "value"])).toEqual([
      "value",
      "weight",
    ]);
    expect(getKeyOrder("feature", ["force", "staging", 0], ["enabled", "conditions"])).toEqual([
      "conditions",
      "enabled",
    ]);
  });

  it("orders checks inside and, or and not groups as it orders checks", () => {
    expect(getKeyOrder("scenario", ["checks", 0], ["or", "key"])).toEqual(["key", "or"]);
    expect(getKeyOrder("scenario", ["checks", 0, "or", 1], ["matches", "segment"])).toEqual([
      "segment",
      "matches",
    ]);
    expect(
      getKeyOrder("test", ["assertions", 0, "checks", 0, "not", 0, "and", 0], ["value", "path"]),
    ).toEqual(["path", "value"]);
  });

  it("never orders maps whose keys belong to the author, or values", () => {
    expect(getKeyOrder("feature", ["rules"], ["production", "staging"])).toBeUndefined();
    expect(getKeyOrder("feature", ["variablesSchema"], ["b", "a"])).toBeUndefined();
    expect(getKeyOrder("feature", ["conditions", 0], ["value", "attribute"])).toBeUndefined();
    expect(
      getKeyOrder("variable", ["compose", "enabled"], ["variation", "feature"]),
    ).toBeUndefined();
    expect(getKeyOrder("variable", ["defaultValue"], ["b", "a"])).toBeUndefined();
    expect(getKeyOrder("test", ["assertions", 0, "context"], ["b", "a"])).toBeUndefined();
  });

  it("orders entries inside variablesSchema and nested global overrides", () => {
    expect(
      getKeyOrder("feature", ["variablesSchema", "color"], ["defaultValue", "type", "description"]),
    ).toEqual(["description", "type", "defaultValue"]);
    expect(
      getKeyOrder("variable", ["overrides", 0, "overrides", 0], ["value", "key", "conditions"]),
    ).toEqual(["key", "conditions", "value"]);
  });

  it("spaces rules and assertions, and packs other lists", () => {
    expect(isSpacedList("feature", ["rules"])).toBe(true);
    expect(isSpacedList("feature", ["rules", "production"])).toBe(true);
    expect(isSpacedList("test", ["assertions"])).toBe(true);
    expect(isSpacedList("scenario", ["children"])).toBe(true);
    expect(isSpacedList("feature", ["variations"])).toBe(false);
    expect(isSpacedList("feature", ["force"])).toBe(false);
    expect(isSpacedList("variable", ["overrides"])).toBe(false);
    expect(isSpacedList("scenario", ["checks"])).toBe(false);
    expect(isSpacedList("feature", ["rules", 0, "conditions"])).toBe(false);
  });

  it("spaces top level keys, and the environments that group rules", () => {
    expect(isSpacedMap("feature", [])).toBe(true);
    expect(isSpacedMap("segment", [])).toBe(true);
    expect(isSpacedMap("test", [])).toBe(true);
    expect(isSpacedMap("feature", ["rules"])).toBe(true);
    expect(isSpacedMap("feature", ["force"])).toBe(false);
    expect(isSpacedMap("variable", ["overrides"])).toBe(false);
    expect(isSpacedMap("feature", ["rules", "production", 0])).toBe(false);
    expect(isSpacedMap("feature", ["variablesSchema"])).toBe(false);
  });

  it("gives parsers one layout with the indent and every rule", () => {
    const layout = getFormatLayout("feature");

    expect(layout.indent).toBe(2);
    expect(layout.spaceEntries(["rules"])).toBe(true);
    expect(layout.spaceItems(["rules", "staging"])).toBe(true);
    expect(layout.orderKeys([], ["rules", "description"])).toEqual(["description", "rules"]);
  });

  it("orders a parsed value the same way", () => {
    const ordered = orderValue("feature", {
      rules: [{ percentage: 100, key: "everyone", conditions: "*" }],
      description: "Checkout",
      variablesSchema: {
        b: { type: "string", defaultValue: "x" },
        a: { defaultValue: 1, type: "integer" },
      },
    });

    expect(JSON.stringify(ordered)).toBe(
      JSON.stringify({
        description: "Checkout",
        variablesSchema: {
          b: { type: "string", defaultValue: "x" },
          a: { type: "integer", defaultValue: 1 },
        },
        rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
      }),
    );
  });
});

describe("formatDefinition", () => {
  const yml = parsers.yml;

  it("formats YAML and reports whether it changed", () => {
    const source =
      "bucketBy: userId\ndescription: Checkout\nrules:\n  - percentage: 100\n    key: everyone\n    conditions: '*'\n";

    expect(formatDefinition("feature", source, yml)).toEqual({
      output:
        'description: Checkout\n\nbucketBy: userId\n\nrules:\n  - key: everyone\n    conditions: "*"\n    percentage: 100\n',
      changed: true,
    });
    const formatted = formatDefinition("feature", source, yml).output;
    expect(formatDefinition("feature", formatted, yml)).toEqual({
      output: formatted,
      changed: false,
    });
  });

  it("puts a blank line between rules and between the environments that group them", () => {
    const source =
      "description: Checkout\nbucketBy: userId\nrules:\n  staging:\n    - key: everyone\n      conditions: '*'\n      percentage: 100\n  production:\n    - key: netherlands\n      conditions: netherlands\n      percentage: 100\n    - key: everyone\n      conditions: '*'\n      percentage: 25\n";

    expect(formatDefinition("feature", source, yml).output).toBe(
      [
        "description: Checkout",
        "",
        "bucketBy: userId",
        "",
        "rules:",
        "  staging:",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 100",
        "",
        "  production:",
        "    - key: netherlands",
        "      conditions: netherlands",
        "      percentage: 100",
        "",
        "    - key: everyone",
        '      conditions: "*"',
        "      percentage: 25",
        "",
      ].join("\n"),
    );
  });

  it("formats JSON with the key order and two spaces", () => {
    const source = '{"conditions":"*","description":"Everyone"}';

    expect(formatDefinition("segment", source, parsers.json).output).toBe(
      '{\n  "description": "Everyone",\n  "conditions": "*"\n}\n',
    );
  });

  it("leaves the layout to a custom parser's format, which receives the key order", () => {
    const custom: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify(content),
      format: (source, layout) => JSON.stringify(layout.orderValue(JSON.parse(source))),
    };

    expect(formatDefinition("segment", '{"conditions":"*","description":"x"}', custom).output).toBe(
      '{"description":"x","conditions":"*"}\n',
    );
  });

  it("leaves a file as it is when its parser has no format", () => {
    const source = '# who\n{"conditions":"*","description":"x"}';
    const custom: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content.replace(/^#.*$/m, "")),
      stringify: (content) => JSON.stringify(content),
    };

    expect(canFormat(custom)).toBe(false);
    expect(canFormat(parsers.yml)).toBe(true);
    expect(canFormat(parsers.json)).toBe(true);
    expect(formatDefinition("segment", source, custom)).toEqual({ output: source, changed: false });
  });

  it("reports a parse error with its line", () => {
    let error: unknown;
    try {
      formatDefinition("feature", "description: [unclosed\nbucketBy: userId\n", yml);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(FormatParseError);
    expect((error as FormatParseError).line).toEqual(expect.any(Number));
  });

  it("reports a parser's format that refuses a file, without writing it", () => {
    const refusing: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify(content),
      format: () => {
        throw new Error("Formatting would lose or change a comment.");
      },
    };

    expect(() => formatDefinition("segment", '{"description":"x"}', refusing)).toThrow(
      new FormatGuardError("Formatting would lose or change a comment."),
    );
  });

  it("refuses output that would change the parsed value", () => {
    const lossy: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify(content),
      format: (source) => JSON.stringify({ ...JSON.parse(source), conditions: undefined }),
    };

    expect(() =>
      formatDefinition("segment", '{"conditions":"*","description":"x"}', lossy),
    ).toThrow(FormatGuardError);
  });

  it("refuses output that changes a date", () => {
    const dated: CustomParser = {
      extension: "custom",
      parse: (content) => ({ description: "x", startsAt: new Date(content.trim()) }) as never,
      stringify: (content) => String(content),
      format: () => "1999-01-01",
    };

    expect(() => formatDefinition("segment", "2026-10-28\n", dated)).toThrow(
      new FormatGuardError("Formatting would change the parsed value."),
    );
  });

  it("refuses output that loses a comment, when the parser lists them", () => {
    const commented: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content.replace(/#.*$/gm, "")),
      stringify: (content) => JSON.stringify(content),
      format: (source) => source.replace(/ *#.*$/gm, ""),
      listComments: (source) => source.match(/#.*$/gm) || [],
    };

    expect(() => formatDefinition("segment", '{"description": "x"} # who\n', commented)).toThrow(
      new FormatGuardError("Formatting would lose or change a comment."),
    );
  });

  it("leaves a file as it is when the parser's format declines it", () => {
    const declining: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify(content),
      format: () => undefined,
    };

    expect(formatDefinition("segment", '{"description":"x"}', declining)).toEqual({
      output: '{"description":"x"}',
      changed: false,
      declined: true,
    });
  });

  it("keeps a file's own line endings and byte order mark", () => {
    const source = "\uFEFFbucketBy: userId\r\ndescription: Checkout\r\n";
    const { output } = formatDefinition("feature", source, yml);

    expect(output).toBe("\uFEFFdescription: Checkout\r\n\r\nbucketBy: userId\r\n");
    expect(formatDefinition("feature", output, yml).changed).toBe(false);
  });

  it("reports where a parser that gives a line and column failed", () => {
    const toml: CustomParser = {
      extension: "toml",
      parse: () => {
        throw Object.assign(new Error("Invalid TOML document: invalid value"), {
          line: 1,
          column: 5,
        });
      },
      stringify: (content) => String(content),
      format: (source) => source,
    };

    expect(() => formatDefinition("feature", "a = \n", toml)).toThrow(
      expect.objectContaining({
        name: "FormatParseError",
        message: "Invalid TOML document: invalid value",
        line: 1,
        column: 5,
      }),
    );
  });
});

describe("unifiedDiff", () => {
  it("prints changed lines with context", () => {
    expect(unifiedDiff("a.yml", "a.yml", "a: 1\nb: 2\n", "a: 1\n\nb: 2\n")).toBe(
      "--- a.yml\n+++ a.yml\n@@ -1,2 +1,3 @@\n a: 1\n+\n b: 2\n",
    );
  });

  it("splits changes far apart into separate hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 1\n", "line one\n").replace("line 18\n", "line eighteen\n");
    const diff = unifiedDiff("f", "f", before, after);

    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).toContain("-line 1\n+line one\n");
    expect(diff).toContain("-line 18\n+line eighteen\n");
  });
});

describe("written definitions", () => {
  it("are written as the parser writes them, apart from fmt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fmt-write-"));
    try {
      fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
      fs.mkdirSync(path.join(root, "features"));
      const filePath = path.join(root, "features", "checkout.yml");
      fs.writeFileSync(
        filePath,
        "bucketBy: userId\ndescription: Checkout\nrules:\n  - key: netherlands\n    percentage: 100\n    conditions: netherlands\n",
      );
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);

      const feature = await datasource.readFeature("checkout");
      await datasource.writeFeature("checkout", { ...feature, bucketBy: "accountId" });

      // promote and other writes keep the key order and blank lines, and leave layout to fmt
      expect(fs.readFileSync(filePath, "utf8")).toBe(
        "bucketBy: accountId\ndescription: Checkout\nrules:\n  - key: netherlands\n    percentage: 100\n    conditions: netherlands\n",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("formatProject", () => {
  const examples = path.resolve(__dirname, "../../../../examples");
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fmt-sets-"));
    fs.cpSync(path.join(examples, "example-sets"), root, {
      recursive: true,
      filter: (source) =>
        !/node_modules|datafiles|\.featurevisor/.test(path.relative(examples, source)),
    });
    // one unformatted feature in each set
    for (const set of ["admin", "storefront"]) {
      fs.writeFileSync(
        path.join(root, "sets", set, "features", "promoBanner.yml"),
        "bucketBy: userId\ndescription: Promo banner\n",
      );
    }
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
    };
  }

  const feature = (set: string) => path.join(root, "sets", set, "features", "promoBanner.yml");
  const relative = (filePath: string) => path.relative(process.cwd(), filePath);

  it("formats every set in one run, and names each file's set", async () => {
    const result = await formatProject(deps(), { check: true, entityType: "feature" });

    expect(result.changed).toBe(2);
    expect(result.files.map(({ set, status }) => ({ set, status }))).toEqual([
      { set: "admin", status: "changed" },
      { set: "storefront", status: "changed" },
    ]);
  });

  it("matches given paths across sets, and skips a path only when no set has it", async () => {
    const missing = path.join(root, "sets", "storefront", "features", "missing.yml");
    const result = await formatProject(deps(), {
      check: true,
      paths: [feature("storefront"), missing],
    });

    expect(result.files.map((file) => file.filePath)).toEqual([relative(feature("storefront"))]);
    expect(result.skipped).toEqual([relative(missing)]);
  });

  it("formats the files in a given directory", async () => {
    const result = await formatProject(deps(), {
      check: true,
      paths: [path.join(root, "sets", "admin", "features")],
    });

    expect(result.files.map((file) => file.filePath)).toEqual([relative(feature("admin"))]);
    expect(result.skipped).toEqual([]);
  });

  it("offers every kind of definition to --entity-type", () => {
    expect(getBuiltinCLIOptions("fmt")?.entityType.choices).toEqual(FORMAT_ENTITY_TYPES);
  });

  it("fails with --check, with or without --diff, and not with --diff alone", async () => {
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const run = (parsed: Record<string, unknown>) =>
      fmtPlugin.handler({ ...deps(), parsed } as never);

    expect(await run({ diff: true })).toBeUndefined();
    expect(await run({ check: true })).toBe(false);
    expect(await run({ check: true, diff: true })).toBe(false);
    expect(fs.readFileSync(feature("admin"), "utf8")).toBe(
      "bucketBy: userId\ndescription: Promo banner\n",
    );

    expect(await run({})).toBeUndefined();
    expect(await run({ check: true })).toBeUndefined();
  });
});

describe("formatProject on the examples", () => {
  const examples = path.resolve(__dirname, "../../../../examples");
  const roots: string[] = [];

  beforeAll(() => jest.spyOn(console, "log").mockImplementation(() => undefined));
  afterAll(() => {
    jest.restoreAllMocks();
    roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  });

  function copy(example: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `featurevisor-fmt-${example}-`));
    roots.push(root);
    fs.cpSync(path.join(examples, example), root, {
      recursive: true,
      filter: (source) =>
        !/node_modules|datafiles|\.featurevisor/.test(path.relative(examples, source)),
    });
    // custom parsers, such as example-toml's, require their packages from the project
    fs.symlinkSync(path.resolve(examples, "../node_modules"), path.join(root, "node_modules"));
    return root;
  }

  async function formatAll(root: string, check = false) {
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const { changed, errors } = await formatProject(
      { rootDirectoryPath: root, projectConfig, datasource },
      { check },
    );
    return { changed, errors };
  }

  function reverseOrdered(entityType: EntityType, value: unknown, at: FormatPath = []): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => reverseOrdered(entityType, item, [...at, index]));
    }
    if (!value || typeof value !== "object" || value instanceof Date) return value;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    // the house order reversed, so the formatted copy always differs where fmt orders keys
    const order = [...(getKeyOrder(entityType, at, keys) || keys)];
    if (getKeyOrder(entityType, at, keys)) order.reverse();
    return Object.fromEntries(
      order.map((key) => [key, reverseOrdered(entityType, record[key], [...at, key])]),
    );
  }

  // Undoes the house layout without changing a value: every map fmt orders gets its keys in
  // reverse house order, and the file is written by the parser's stringify, without blank lines.
  async function unformat(root: string) {
    const projectConfig = getProjectConfig(root);
    const parser = projectConfig.parser as CustomParser;
    const datasource = new Datasource(projectConfig, root);
    const { files } = await formatProject(
      { rootDirectoryPath: root, projectConfig, datasource },
      { check: true },
    );
    for (const file of files) {
      const filePath = path.resolve(file.filePath);
      const value = parser.parse(fs.readFileSync(filePath, "utf8"), filePath);
      fs.writeFileSync(filePath, parser.stringify(reverseOrdered(file.entityType, value)));
    }
  }

  async function build(root: string) {
    const projectConfig = getProjectConfig(root);
    await buildProjectSets(
      {
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        options: {},
      },
      { revision: "fmt" },
    );
  }

  function outputs(root: string) {
    const files: Record<string, string> = {};
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    };
    for (const name of ["datafiles", ".featurevisor"]) {
      if (fs.existsSync(path.join(root, name))) walk(path.join(root, name));
    }
    return files;
  }

  const projects = fs
    .readdirSync(examples)
    .filter((name) => fs.existsSync(path.join(examples, name, "featurevisor.config.js")))
    .filter((name) => {
      try {
        getProjectConfig(path.join(examples, name));
        return true;
      } catch {
        return false;
      }
    });

  it.each(projects)(
    "%s is formatted, and formatting it builds byte identical datafiles",
    async (example) => {
      // the example as it is in the repository
      expect(await formatAll(copy(example), true)).toEqual({ changed: 0, errors: 0 });

      // a key order that reached a datafile would build differently in the two copies
      const unformatted = copy(example);
      const formatted = copy(example);
      await unformat(unformatted);
      await unformat(formatted);
      expect((await formatAll(formatted, true)).changed).toBeGreaterThan(0);
      expect((await formatAll(formatted)).errors).toBe(0);
      expect(await formatAll(formatted, true)).toEqual({ changed: 0, errors: 0 });

      await build(unformatted);
      await build(formatted);
      const built = outputs(unformatted);
      expect(Object.keys(built).length).toBeGreaterThan(0);
      expect(outputs(formatted)).toEqual(built);
    },
    120000,
  );
});
