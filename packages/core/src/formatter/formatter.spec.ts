import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsers, type CustomParser } from "@featurevisor/parsers";

import { buildProjectSets } from "../builder/buildProject";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getProjectSetExecutions } from "../sets";
import { FormatGuardError, FormatParseError, formatDefinition } from "./formatDefinition";
import { formatProject } from "./formatProject";
import { getKeyOrder, isSpacedList, orderValue } from "./keyOrder";
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

  it("formats JSON with the key order and two spaces", () => {
    const source = '{"conditions":"*","description":"Everyone"}';

    expect(formatDefinition("segment", source, parsers.json).output).toBe(
      '{\n  "description": "Everyone",\n  "conditions": "*"\n}\n',
    );
  });

  it("gives custom parsers the key order and leaves the layout to them", () => {
    const custom: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify(content),
    };

    expect(formatDefinition("segment", '{"conditions":"*","description":"x"}', custom).output).toBe(
      '{"description":"x","conditions":"*"}',
    );
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

  it("refuses output that would change the parsed value", () => {
    const lossy: CustomParser = {
      extension: "custom",
      parse: (content) => JSON.parse(content),
      stringify: (content) => JSON.stringify({ ...content, conditions: undefined }),
    };

    expect(() =>
      formatDefinition("segment", '{"conditions":"*","description":"x"}', lossy),
    ).toThrow(FormatGuardError);
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
  it("are written formatted, as promote writes them", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fmt-write-"));
    try {
      fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};\n");
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const long =
        "A description well past eighty characters, which the writer used to fold onto two lines";

      await datasource.writeFeature("checkout", {
        rules: [{ percentage: 100, conditions: "*", key: "everyone" }],
        bucketBy: "userId",
        description: long,
      } as never);

      expect(fs.readFileSync(path.join(root, "features", "checkout.yml"), "utf8")).toBe(
        `description: ${long}\n\nbucketBy: userId\n\nrules:\n  - key: everyone\n    conditions: "*"\n    percentage: 100\n`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  async function executions(root: string) {
    const projectConfig = getProjectConfig(root);
    return getProjectSetExecutions(projectConfig, new Datasource(projectConfig, root), undefined);
  }

  async function formatAll(root: string, check = false) {
    let changed = 0;
    let errors = 0;
    for (const execution of await executions(root)) {
      const result = await formatProject({ rootDirectoryPath: root, ...execution }, { check });
      changed += result.changed;
      errors += result.errors;
    }
    return { changed, errors };
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
    "%s builds byte identical datafiles after formatting, and stays formatted",
    async (example) => {
      const before = copy(example);
      const after = copy(example);

      expect((await formatAll(after)).errors).toBe(0);
      expect(await formatAll(after, true)).toEqual({ changed: 0, errors: 0 });

      await build(before);
      await build(after);
      const built = outputs(before);
      expect(Object.keys(built).length).toBeGreaterThan(0);
      expect(outputs(after)).toEqual(built);
    },
    120000,
  );
});
