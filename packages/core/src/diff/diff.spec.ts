import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProjectConfig } from "../config";
import { compareValues } from "./compare";
import { DiffGit } from "./git";
import { diffDefinitions, formatDefinitionDiff } from "./index";

describe("core: definition diff", () => {
  let root: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  const diff = (options = {}) => diffDefinitions(root, getProjectConfig(root), options);

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-diff-")));
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    write("featurevisor.config.js", "module.exports = {};\n");
    write("features/checkout.yml", "description: Checkout\nbucketBy: userId\n");
    commit();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("reports no changes on clean main, even if a remote tip differs", () => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("remote", "add", "origin", "https://example.invalid/project.git");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    write("features/checkout.yml", "description: Updated\n");
    commit();
    expect(diff()).toMatchObject({ reason: "primary", changes: [] });
    expect(formatDefinitionDiff(diff())).toContain("No changes on the primary branch.");
  });

  it("compares a clean branch against main's tip, not the merge base", () => {
    git("switch", "-c", "work");
    write("features/checkout.yml", "description: Branch\n");
    commit();
    git("switch", "main");
    write("features/checkout.yml", "description: Primary\n");
    commit();
    git("switch", "work");
    expect(diff()).toMatchObject({
      reason: "branch",
      changes: [{ changes: [{ path: "/description", before: "Primary", after: "Branch" }] }],
    });
  });

  it.each(["main", "work"])("prioritizes uncommitted changes on %s", (branch) => {
    if (branch !== "main") git("switch", "-c", branch);
    write("features/checkout.yml", "description: Committed\n");
    commit();
    write("features/checkout.yml", "description: Local\n");
    expect(diff()).toMatchObject({
      reason: "uncommitted",
      from: { ref: "HEAD" },
      to: { ref: "working-tree" },
      changes: [{ changes: [{ before: "Committed", after: "Local" }] }],
    });
  });

  it("includes staged changes, untracked definitions, and deletions but not ignored files", () => {
    write(".gitignore", "variables/ignored.yml\n");
    write("variables/staged.yml", "type: string\ndefaultValue: staged\n");
    git("add", "variables/staged.yml");
    write("variables/new.yml", "type: boolean\ndefaultValue: true\n");
    write("variables/ignored.yml", "broken: [\n");
    fs.unlinkSync(path.join(root, "features/checkout.yml"));
    const result = diff();
    expect(result.summary).toEqual({ added: 2, removed: 1, changed: 0 });
    expect(result.changes.map((change) => change.key)).toEqual(["checkout", "new", "staged"]);
  });

  it("uses final working files rather than intermediate index content", () => {
    write("features/checkout.yml", "description: Staged\n");
    git("add", ".");
    write("features/checkout.yml", "description: Checkout\nbucketBy: userId\n");
    expect(diff()).toMatchObject({ reason: "uncommitted", changes: [] });
  });

  it("explicit references override dirty defaults and support tags and single endpoints", () => {
    const old = git("rev-parse", "HEAD");
    git("tag", "v1.0.0");
    write("features/checkout.yml", "description: Second\nbucketBy: userId\n");
    commit();
    write("features/checkout.yml", "broken: [\n");
    expect(diff({ from: "v1.0.0", to: "HEAD" })).toMatchObject({
      reason: "explicit",
      from: { commit: old },
      changes: [{ changes: [{ before: "Checkout", after: "Second" }] }],
    });
    expect(diff({ to: "v1.0.0" }).changes[0].changes[0].after).toBe("Checkout");
    write("features/checkout.yml", "description: Third\nbucketBy: userId\n");
    expect(diff({ from: "v1.0.0" }).to.ref).toBe("working-tree");
    expect(diff({ from: "working-tree", to: "HEAD" }).changes[0].changes[0].before).toBe("Third");
  });

  it("recognizes master and configured primary branches", () => {
    git("branch", "-m", "master");
    expect(diff().reason).toBe("primary");
    git("branch", "-m", "trunk");
    git("config", "init.defaultBranch", "trunk");
    expect(diff().reason).toBe("primary");
  });

  it("uses remote HEAD to discover a custom primary, even without a local branch", () => {
    git("remote", "add", "origin", "https://example.invalid/project.git");
    git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    git("branch", "-m", "work");
    expect(diff().from.ref).toBe("refs/remotes/origin/trunk");
  });

  it("falls back to a remote main when remote HEAD and local main are absent", () => {
    git("remote", "add", "origin", "https://example.invalid/project.git");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("branch", "-m", "review");
    expect(diff().from.ref).toBe("refs/remotes/origin/main");
  });

  it("prefers the configured upstream remote's default branch", () => {
    git("remote", "add", "origin", "https://example.invalid/fork.git");
    git("remote", "add", "upstream", "https://example.invalid/upstream.git");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("update-ref", "refs/remotes/upstream/trunk", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git("symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/trunk");
    git("switch", "-c", "review");
    git("config", "branch.review.remote", "upstream");
    expect(diff().from.ref).toBe("refs/remotes/upstream/trunk");
  });

  it("rejects working tree conflicts without blocking explicit commit comparisons", () => {
    git("switch", "-c", "work");
    write("features/checkout.yml", "description: Work\n");
    commit();
    git("switch", "main");
    write("features/checkout.yml", "description: Main\n");
    commit();
    expect(() => git("merge", "work")).toThrow();
    expect(() => diff()).toThrow("Resolve Git merge conflicts");
    expect(diff({ from: "main", to: "work" }).changes).toHaveLength(1);
  });

  it("reads UTF8 blobs and unusual filenames using byte lengths and NUL delimiters", () => {
    write("variables/café\nname.yml", "defaultValue: Héllo 🌍\n");
    const from = commit();
    write("variables/café\nname.yml", "defaultValue: Bonjour 🌍\n");
    const to = commit();
    expect(diff({ from, to }).changes[0]).toMatchObject({
      key: "café\nname",
      changes: [{ before: "Héllo 🌍", after: "Bonjour 🌍" }],
    });
  });

  it("supports detached HEAD, and explains missing history or primary branches", () => {
    git("switch", "--detach");
    expect(diff().reason).toBe("branch");
    git("branch", "-D", "main");
    expect(() => diff()).toThrow("Cannot identify the primary branch");
    expect(diff({ from: "HEAD", to: "HEAD" }).changes).toEqual([]);
    expect(() => diff({ from: "missing", to: "HEAD" })).toThrow("Cannot resolve Git reference");
    expect(() => diff({ from: "--help" })).toThrow("Cannot resolve Git reference");
    expect(() => diff({ from: "" })).toThrow("must not be empty");
  });

  it("ignores comments, mapping order, and YAML formatting but preserves array order", () => {
    write("features/checkout.yml", "# comment\nbucketBy: userId\ndescription: 'Checkout'\n");
    expect(diff().changes).toEqual([]);
    expect(compareValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
    expect(compareValues({ rules: ["one", "two"] }, { rules: ["two", "one"] })).toHaveLength(2);
  });

  it("handles null, empty collections, removals, and escaped JSON Pointer names", () => {
    expect(compareValues({ a: null }, { a: {} })).toEqual([
      { path: "/a", kind: "changed", before: null, after: {} },
    ]);
    expect(compareValues({}, [])).toHaveLength(1);
    expect(compareValues({ "a/b~c": 1 }, { "a/b~c": 2 })[0].path).toBe("/a~1b~0c");
    expect(compareValues([null, 1], [null])).toEqual([{ path: "/1", kind: "removed", before: 1 }]);
    expect(compareValues({}, { value: null })).toEqual([
      { path: "/value", kind: "added", after: null },
    ]);
  });

  it("covers all authored entity types and namespaced keys", () => {
    for (const directory of [
      "variables",
      "segments",
      "attributes",
      "groups",
      "schemas",
      "targets",
      "tests",
    ]) {
      write(`${directory}/nested/example.yml`, "description: New entity\n");
    }
    const result = diff();
    expect(result.changes).toHaveLength(7);
    expect(result.changes.every((entity) => entity.key === "nested.example")).toBe(true);
    const config = getProjectConfig(root);
    config.namespaceCharacter = "/";
    expect(
      diffDefinitions(root, config).changes.every((entity) => entity.key === "nested/example"),
    ).toBe(true);
  });

  it("compares sets from both snapshots, including removed sets", () => {
    const config = { ...getProjectConfig(root), sets: true };
    write("sets/production/variables/config.yml", "defaultValue: 1\n");
    commit();
    fs.rmSync(path.join(root, "sets"), { recursive: true });
    write("sets/staging/variables/config.yml", "defaultValue: 2\n");
    const result = diffDefinitions(root, config);
    expect(result.changes.map((change) => [change.set, change.kind])).toEqual([
      ["production", "removed"],
      ["staging", "added"],
    ]);
    expect(diffDefinitions(root, config, { set: "production" }).changes).toHaveLength(1);
    expect(() => diffDefinitions(root, config, { set: "unknown" })).toThrow("does not exist");
    expect(() => diff({ set: "production" })).toThrow("does not use sets");
  });

  it("supports JSON/custom directory configuration and nested project roots", () => {
    write(
      "project/featurevisor.config.js",
      "module.exports = { parser: 'json', variablesDirectoryPath: '<rootDir>/settings' };\n",
    );
    commit();
    write("project/settings/a b.json", '{"defaultValue":false}');
    write("variables/other.yml", "defaultValue: 1\n");
    const project = path.join(root, "project");
    expect(diffDefinitions(project, getProjectConfig(project)).changes).toMatchObject([
      { entity: "variable", key: "a b", file: "project/settings/a b.json" },
    ]);
  });

  it("warns about historical config without executing it, including equal old endpoints", () => {
    write("featurevisor.config.js", "throw new Error('must not execute');\n");
    const historical = commit();
    write("featurevisor.config.js", "module.exports = {};\n");
    commit();
    expect(diff({ from: historical, to: "HEAD" }).warnings).toHaveLength(1);
    expect(diff({ from: historical, to: historical }).warnings).toHaveLength(1);
  });

  it("reports invalid definitions rather than partial results", () => {
    write("variables/broken.yml", "defaultValue: [\n");
    expect(() => diff()).toThrow("Cannot parse variables/broken.yml at working-tree");
    write("variables/broken.yml", "null\n");
    expect(() => diff()).toThrow("Cannot parse");
    write("variables/broken.yml", "self: &a { self: *a }\n");
    expect(() => diff()).toThrow("Cannot parse");
  });

  it("rejects symlinks in both working tree and commits without following them", () => {
    fs.mkdirSync(path.join(root, "variables"));
    fs.symlinkSync("../features/checkout.yml", path.join(root, "variables/link.yml"));
    expect(() => diff()).toThrow("symbolic link");
    const linked = commit();
    expect(() => diff({ from: linked, to: linked })).toThrow("nonregular definition");
  });

  it("rejects symlinked definition directories instead of silently omitting their contents", () => {
    fs.symlinkSync("features", path.join(root, "variables"));
    expect(() => diff()).toThrow("symbolic link");
    const linked = commit();
    expect(() => diff({ from: linked, to: linked })).toThrow("nonregular definition");
  });

  it("shows additions/removals for renamed definitions and nested rule changes by position", () => {
    const from = git("rev-parse", "HEAD");
    git("mv", "features/checkout.yml", "features/checkoutNew.yml");
    expect(diff().summary).toEqual({ added: 1, removed: 1, changed: 0 });
    write(
      "features/checkoutNew.yml",
      "rules:\n  production:\n    - key: all\n      percentage: 10\n",
    );
    const rulesFrom = commit();
    write(
      "features/checkoutNew.yml",
      "rules:\n  production:\n    - key: all\n      percentage: 50\n",
    );
    expect(diff({ from: rulesFrom }).changes[0].changes).toEqual([
      { path: "/rules/production/0/percentage", kind: "changed", before: 10, after: 50 },
    ]);
    expect(diff({ from, to: rulesFrom }).summary).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it("rejects directories outside Git and unsupported adapters", () => {
    const config = getProjectConfig(root);
    expect(() =>
      diffDefinitions(root, { ...config, featuresDirectoryPath: path.dirname(root) }),
    ).toThrow("inside the Git");
    expect(() => diffDefinitions(root, { ...config, adapter: class {} })).toThrow(
      "filesystem datasource",
    );
  });

  it("does not modify index, worktree, branch, or state and does not need a remote", () => {
    write("variables/new.yml", "defaultValue: 1\n");
    const index = fs.readFileSync(path.join(root, ".git/index"));
    const head = git("rev-parse", "HEAD");
    const status = git("status", "--porcelain=v1");
    const result = diff();
    expect(fs.readFileSync(path.join(root, ".git/index"))).toEqual(index);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain=v1")).toBe(status);
    expect(fs.existsSync(path.join(root, ".featurevisor"))).toBe(false);
    expect(formatDefinitionDiff(result)).toContain("+ variable new");
    expect(formatDefinitionDiff(result)).not.toContain("\x1b[");
    expect(formatDefinitionDiff(result, true)).toContain("\x1b[32m");
  });

  it("reports repositories without commits and directories outside Git clearly", () => {
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    execFileSync("git", ["init", "-b", "main"], { cwd: empty, stdio: "pipe" });
    expect(() => new DiffGit(empty).select()).toThrow("Cannot resolve Git reference");
    expect(() => new DiffGit(os.tmpdir())).toThrow("requires a Featurevisor project");
  });
});
