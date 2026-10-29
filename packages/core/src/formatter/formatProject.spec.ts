import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getBuiltinCLIOptions } from "../cli/options";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { formatProject } from "./formatProject";
import { fmtPlugin } from "./index";
import { FORMAT_ENTITY_TYPES } from "./layout";

// YAML lists are always written in block style, so this needs formatting in any house style
const UNFORMATTED = "tags: [all]\ndescription: Promo banner\n";

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
      fs.writeFileSync(path.join(root, "sets", set, "features", "promoBanner.yml"), UNFORMATTED);
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
    expect(fs.readFileSync(feature("admin"), "utf8")).toBe(UNFORMATTED);

    expect(await run({})).toBeUndefined();
    expect(await run({ check: true })).toBeUndefined();
  });
});
