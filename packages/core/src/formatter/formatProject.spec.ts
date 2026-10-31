import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getBuiltinCLIOptions } from "../cli/options";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { formatProject } from "./formatProject";
import { fmtPlugin } from "./index";
import { FORMAT_ENTITY_TYPES } from "./layout";
import { printStdinResult } from "./printFormatResult";

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

  it("leaves a file with the ignore comment at its top as it is", async () => {
    const ignored = `# featurevisor-ignore\n${UNFORMATTED}`;
    fs.writeFileSync(feature("admin"), ignored);
    const result = await formatProject(deps(), { entityType: "feature" });

    expect(result.files.map(({ set, status }) => ({ set, status }))).toEqual([
      { set: "admin", status: "ignored" },
      { set: "storefront", status: "changed" },
    ]);
    expect(result.ignored).toBe(1);
    expect(fs.readFileSync(feature("admin"), "utf8")).toBe(ignored);
  });

  it("formats only the files changed since a Git reference, untracked ones too", async () => {
    const git = (...args: string[]) =>
      childProcess.execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=fmt", "-c", "user.email=test@example.com", "commit", "-qm", "Start");

    fs.writeFileSync(feature("storefront"), `${UNFORMATTED}bucketBy: userId\n`);
    const added = path.join(root, "sets", "admin", "features", "added.yml");
    fs.writeFileSync(added, UNFORMATTED);
    const result = await formatProject(deps(), { check: true, since: "HEAD" });

    expect(result.files.map((file) => file.filePath).sort()).toEqual(
      [relative(added), relative(feature("storefront"))].sort(),
    );
    await expect(formatProject(deps(), { since: "no-such-branch" })).rejects.toMatchObject({
      code: "since_error",
    });
  });

  it("formats source from stdin as the file at its path, and prints it", async () => {
    const written: string[] = [];
    jest.spyOn(process.stdout, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });
    const stdin = { filePath: feature("admin"), source: UNFORMATTED };
    const result = await formatProject(deps(), { stdin });
    printStdinResult(result, { stdin });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ set: "admin", status: "changed" });
    expect(fs.readFileSync(feature("admin"), "utf8")).toBe(UNFORMATTED);
    await formatProject(deps(), { paths: [feature("admin")] });
    expect(written).toEqual([fs.readFileSync(feature("admin"), "utf8")]);
  });

  it("prints source from stdin as it is for a path that holds no definition", async () => {
    const written: string[] = [];
    jest.spyOn(process.stdout, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });
    const stdin = { filePath: path.join(root, "notes.yml"), source: "b: [1]\na: 2\n" };
    const result = await formatProject(deps(), { stdin });
    printStdinResult(result, { stdin });

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([relative(stdin.filePath)]);
    expect(written).toEqual([stdin.source]);
  });

  it("exits with 1 when --check finds files to format, and with 2 on errors", async () => {
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const run = (parsed: Record<string, unknown>) =>
      fmtPlugin.handler({ ...deps(), parsed } as never);

    // --diff alone shows the changes, and --check fails on them, with or without --diff
    expect(await run({ diff: true })).toBe(0);
    expect(await run({ check: true })).toBe(1);
    expect(await run({ check: true, diff: true })).toBe(1);
    expect(fs.readFileSync(feature("admin"), "utf8")).toBe(UNFORMATTED);

    expect(await run({})).toBe(0);
    expect(await run({ check: true })).toBe(0);

    fs.writeFileSync(feature("admin"), "description: [unclosed\n");
    expect(await run({ check: true })).toBe(2);
    expect(await run({ stdinFilepath: feature("admin"), paths: [feature("admin")] })).toBe(2);
  });
});
