import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CustomParser, FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { buildProjectSets } from "../builder/buildProject";
import { getProjectConfig, type ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import {
  expandConditionExpressions,
  ConditionExpressionError,
  getConditionExpressions,
} from "../datasource/expressions";
import { formatProject } from "./formatProject";
import { getKeyOrder } from "./layout";
import { HOUSE_STYLE } from "./style";

// Every example is formatted, and formatting never changes what it builds

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

  // Undoes the house style of expressions without changing their trees: each gets leading
  // spaces and a final line break, which formatting takes away again.
  function unformatExpressions(
    entityType: EntityType,
    value: unknown,
    config: ProjectConfig,
  ): unknown {
    if (!config.allowConditionExpressions) return value;
    if (entityType !== "feature" && entityType !== "segment" && entityType !== "variable") {
      return value;
    }
    const options = { namespaceCharacter: config.namespaceCharacter };
    let records: { path: (string | number)[]; source: string }[];
    try {
      records = getConditionExpressions(expandConditionExpressions(entityType, "", value, options));
    } catch (error) {
      if (!(error instanceof ConditionExpressionError)) throw error;
      records = error.expressions;
    }
    for (const record of records) {
      const parent = record.path
        .slice(0, -1)
        .reduce((at: unknown, part) => (at as Record<string, unknown>)[part], value);
      (parent as Record<string, unknown>)[record.path[record.path.length - 1]] =
        `  ${record.source}\n`;
    }
    return value;
  }

  // Undoes the house layout without changing a value: every map fmt orders gets its keys in
  // reverse house order, every expression loses its house style, and the file is written
  // by the parser's stringify, without blank lines.
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
      const unstyled = unformatExpressions(file.entityType, value, projectConfig);
      fs.writeFileSync(filePath, parser.stringify(reverseOrdered(file.entityType, unstyled)));
    }
  }

  // How many expressions still carry the leading spaces unformatExpressions gives them
  async function unstyledExpressions(root: string) {
    const projectConfig = getProjectConfig(root);
    if (!projectConfig.allowConditionExpressions) return 0;
    const parser = projectConfig.parser as CustomParser;
    const datasource = new Datasource(projectConfig, root);
    const { files } = await formatProject(
      { rootDirectoryPath: root, projectConfig, datasource },
      { check: true },
    );
    let count = 0;
    for (const file of files) {
      if (!["feature", "segment", "variable"].includes(file.entityType)) continue;
      const filePath = path.resolve(file.filePath);
      const value = parser.parse(fs.readFileSync(filePath, "utf8"), filePath);
      const options = { namespaceCharacter: projectConfig.namespaceCharacter };
      const expanded = expandConditionExpressions(file.entityType as "feature", "", value, options);
      count += getConditionExpressions(expanded).filter((record) =>
        record.source.startsWith(" "),
      ).length;
    }
    return count;
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
      const unstyled = await unstyledExpressions(formatted);
      if (getProjectConfig(formatted).allowConditionExpressions)
        expect(unstyled).toBeGreaterThan(0);
      expect((await formatAll(formatted)).errors).toBe(0);
      expect(await formatAll(formatted, true)).toEqual({ changed: 0, errors: 0 });
      // every expression is back in the house style
      expect(await unstyledExpressions(formatted)).toBe(0);

      await build(unformatted);
      await build(formatted);
      const built = outputs(unformatted);
      expect(Object.keys(built).length).toBeGreaterThan(0);
      expect(outputs(formatted)).toEqual(built);
    },
    120000,
  );

  it("writes example-1's condition trees as expressions, building byte identical datafiles", async () => {
    const trees = copy("example-1");
    const converted = copy("example-1");
    const configPath = path.join(converted, "featurevisor.config.js");
    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("module.exports = {");
    fs.writeFileSync(
      configPath,
      config.replace(
        "module.exports = {",
        "module.exports = {\n  allowConditionExpressions: true,",
      ),
    );

    const { changed, errors } = await formatAll(converted);
    expect(errors).toBe(0);
    expect(changed).toBeGreaterThan(50);
    expect(await formatAll(converted, true)).toEqual({ changed: 0, errors: 0 });

    await build(trees);
    await build(converted);
    const built = outputs(trees);
    expect(Object.keys(built).length).toBeGreaterThan(0);
    expect(outputs(converted)).toEqual(built);
  }, 120000);

  it.each(projects)("%s stays as it is when Prettier formats it", async (example) => {
    // Prettier's standalone build, since its main entry loads plugins in a way Jest refuses
    const prettier = require("prettier/standalone");
    const plugins = [
      require("prettier/plugins/yaml"),
      require("prettier/plugins/babel"),
      require("prettier/plugins/estree"),
    ];
    // Prettier set up as the notes in style.ts say
    const options = {
      plugins,
      tabWidth: HOUSE_STYLE.indent,
      // a Windows checkout writes CRLF, which fmt keeps
      endOfLine: HOUSE_STYLE.endOfLine,
      printWidth: HOUSE_STYLE.formats.json.lineWidth,
      singleQuote: (HOUSE_STYLE.formats.yml.quote as string) === "single",
    };
    const parsers: Record<string, string> = { yml: "yaml", json: "json" };
    const root = path.join(examples, example);
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const { files } = await formatProject(
      { rootDirectoryPath: root, projectConfig, datasource },
      { check: true },
    );

    for (const file of files) {
      const parser = parsers[path.extname(file.filePath).slice(1)];
      if (!parser) continue;
      const source = fs.readFileSync(path.resolve(file.filePath), "utf8");
      expect(await prettier.format(source, { ...options, parser })).toBe(source);
    }
  });

  it.each(projects)("%s has an .editorconfig that matches the house style", (example) => {
    const config = fs.readFileSync(path.join(examples, example, ".editorconfig"), "utf8");
    const setting = (name: string) => new RegExp(`^${name}\\s*=\\s*(\\S+)`, "m").exec(config)?.[1];

    expect(setting("indent_style")).toBe("space");
    expect(setting("indent_size")).toBe(String(HOUSE_STYLE.indent));
    expect(setting("insert_final_newline")).toBe("true");
    if (HOUSE_STYLE.endOfLine !== "auto")
      expect(setting("end_of_line")).toBe(HOUSE_STYLE.endOfLine);
  });
});
