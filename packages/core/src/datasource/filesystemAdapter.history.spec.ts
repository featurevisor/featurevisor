import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import childProcess from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

import { getProjectConfig, getProjectConfigForSet } from "../config";
import { FilesystemAdapter } from "./filesystemAdapter";

const timestamp = "2026-09-30T12:34:56+02:00";

function record(commit: string, files: string[], subject = "Subject", author = "Author") {
  return ["", commit, author, timestamp, subject, "\n" + files[0], ...files.slice(1), ""].join(
    "\0",
  );
}

describe("core: streamed filesystem history", () => {
  let root: string;
  let adapter: FilesystemAdapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-history-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};");
    adapter = new FilesystemAdapter(getProjectConfig(root), root);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function mockChild() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    // The batch reader for historical specs is reported as unavailable, so classification
    // falls back to individual reads that tests can mock.
    const unavailable = () => {
      const batch = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      });
      process.nextTick(() =>
        batch.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" })),
      );
      return batch;
    };
    const spawn = jest
      .spyOn(childProcess, "spawn")
      .mockImplementation(((_command: string, args: string[]) =>
        args[0] === "cat-file" ? unavailable() : child) as unknown as typeof childProcess.spawn);
    return { child, spawn };
  }

  it.each([1, 2, 7, 64, 65536])(
    "preserves raw metadata and filenames in %i byte chunks",
    async (size) => {
      const { child, spawn } = mockChild();
      const raw = jest.spyOn(adapter, "getRawHistory");
      const subject = "Café 😀 | tabs\t and separators\x1e\x1f";
      const author = "Zoë | 作者";
      const names = [
        "space name",
        'quote"name',
        "back\\slash",
        "line\n\nbreak",
        "tab\tname",
        "日本😀",
      ];
      const output = Buffer.from(
        [
          record(
            "abc123",
            names.map((name) => `features/${name}.yml`),
            subject,
            author,
          ),
          record("def456", ["features/ignored.txt"], "Ignore"),
          record("fed321", ["variables/nested/value.yml"], ""),
        ].join("\0"),
      );
      const pending = adapter.listHistoryEntries();
      for (let offset = 0; offset < output.length; offset += size) {
        child.stdout.write(output.subarray(offset, offset + size));
      }
      child.emit("close", 0);
      await expect(pending).resolves.toEqual([
        {
          commit: "abc123",
          author,
          timestamp,
          subject,
          entities: names.map((key) => ({ type: "feature", key })),
        },
        {
          commit: "fed321",
          author: "Author",
          timestamp,
          subject: "",
          entities: [{ type: "variable", key: "nested.value" }],
        },
      ]);
      expect(raw).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "-z",
          "--no-renames",
          "--no-merges",
          "--relative",
          "--encoding=UTF-8",
          "--pretty=format:%x00%h%x00%an%x00%aI%x00%s%x00",
        ]),
        expect.objectContaining({ cwd: root, env: expect.objectContaining({ LC_ALL: "C" }) }),
      );
    },
  );

  it("classifies specs once the log ends, reading individually when the batch is unavailable", async () => {
    const { child } = mockChild();
    const read = jest
      .spyOn(adapter, "readHistoricalTestSpec")
      .mockImplementation((revision) =>
        revision.endsWith("^") ? { feature: "flag", assertions: [] } : { checks: [] },
      );
    const pending = adapter.listHistoryEntries();
    child.stdout.write(record("abc123", ["tests/nested/check.spec.yml"]));
    // Nothing is read per path while the log streams.
    expect(read).not.toHaveBeenCalled();
    child.emit("close", 0);
    await pending;
    expect(read.mock.calls).toEqual([
      ["abc123", "tests/nested/check.spec.yml"],
      ["abc123^", "tests/nested/check.spec.yml"],
    ]);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        entities: [
          { type: "scenario", key: "nested.check" },
          { type: "test", key: "nested.check" },
        ],
      }),
    ]);
  });

  it("preserves all definition kinds and namespace mapping with custom directories", async () => {
    const config = getProjectConfig(root);
    const types = ["attribute", "segment", "feature", "schema", "variable", "target"] as const;
    for (const type of types)
      config[`${type}sDirectoryPath`] = path.join(root, "definitions", type);
    config.namespaceCharacter = "/";
    adapter = new FilesystemAdapter(config, root);
    const { child, spawn } = mockChild();
    const pending = adapter.listHistoryEntries();
    child.stdout.write(
      record(
        "abc123",
        types.map((type) => `definitions/${type}/nested/key.yml`),
      ),
    );
    child.emit("close", 0);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        entities: types.map((type) => ({ type, key: "nested/key" })),
      }),
    ]);
    const args = spawn.mock.calls[0][1] as string[];
    expect(args.slice(args.indexOf("--") + 1)).toEqual([
      "definitions/feature",
      "definitions/attribute",
      "definitions/segment",
      "definitions/schema",
      "definitions/variable",
      "definitions/target",
      "tests",
    ]);
  });

  it("handles a subject spanning many chunks and a final path without a terminator", async () => {
    const { child } = mockChild();
    const subject = "subject 😀 | ".repeat(10000);
    const output = Buffer.from(record("abc123", ["features/flag.yml"], subject).slice(0, -1));
    const pending = adapter.listHistoryEntries();
    for (let offset = 0; offset < output.length; offset += 113) {
      child.stdout.write(output.subarray(offset, offset + 113));
    }
    child.emit("close", 0);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        subject,
        entities: [{ type: "feature", key: "flag" }],
      }),
    ]);
  });

  it("keeps test fallback for missing and malformed historical specs", async () => {
    const { child } = mockChild();
    jest.spyOn(adapter, "readHistoricalTestSpec").mockImplementation((revision, file) => {
      if (file.includes("missing")) return undefined;
      if (revision.endsWith("^")) throw new Error("Invalid YAML");
      return { checks: [] };
    });
    const pending = adapter.listHistoryEntries("test");
    child.stdout.write(record("abc123", ["tests/missing.spec.yml", "tests/broken.spec.yml"]));
    child.emit("close", 0);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        entities: [
          { type: "test", key: "missing" },
          { type: "test", key: "broken" },
        ],
      }),
    ]);
  });

  it("handles a large stream without retaining raw history", async () => {
    const { child, spawn } = mockChild();
    const pending = adapter.listHistoryEntries("feature", "flag");
    for (let index = 0; index < 20000; index++) {
      child.stdout.write((index ? "\0" : "") + record(`hash${index}`, ["features/flag.yml"]));
    }
    child.emit("close", 0);
    const entries = await pending;
    expect(entries).toHaveLength(20000);
    expect(entries[0].commit).toBe("hash0");
    expect(entries[19999].commit).toBe("hash19999");
    const args = spawn.mock.calls[0][1] as string[];
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["features/flag.yml"]);
  });

  it.each([0, 128, null])("handles empty output with exit code %s", async (code) => {
    const { child } = mockChild();
    const pending = adapter.listHistoryEntries();
    child.emit("close", code);
    if (code === 0) await expect(pending).resolves.toEqual([]);
    else await expect(pending).rejects.toBe(code);
  });

  it("rejects partial output on Git failure and forwards stderr", async () => {
    const { child } = mockChild();
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    const pending = adapter.listHistoryEntries();
    child.stdout.write(record("abc123", ["features/flag.yml"]));
    child.stderr.write("fatal: history unavailable");
    child.emit("close", 128);
    await expect(pending).rejects.toBe(128);
    expect(stderr).toHaveBeenCalledWith("fatal: history unavailable");
  });

  it.each([
    "fatal: not a git repository (or any of the parent directories): .git\n",
    "fatal: your current branch 'main' does not have any commits yet\n",
  ])("treats only an absent repository or unborn branch as empty: %s", async (diagnostic) => {
    const { child } = mockChild();
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    const pending = adapter.listHistoryEntries();
    for (const character of diagnostic) child.stderr.write(character);
    child.emit("close", 128);
    await expect(pending).resolves.toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    "fatal: cannot open .git/objects: Permission denied\n",
    "fatal: bad object HEAD\n",
    "fatal: detected dubious ownership in repository\n",
    "fatal: not a git repository (or any of the parent directories): .git\nfatal: additional error\n",
  ])("does not hide Git permissions, corruption or extra diagnostics: %s", async (diagnostic) => {
    const { child } = mockChild();
    jest.spyOn(console, "error").mockImplementation(() => {});
    const pending = adapter.listHistoryEntries();
    child.stderr.write(diagnostic);
    child.emit("close", 128);
    await expect(pending).rejects.toBe(128);
  });

  it.each(["ENOENT", "EACCES"])(
    "distinguishes missing Git from execution permissions: %s",
    async (code) => {
      const { child } = mockChild();
      const pending = adapter.listHistoryEntries();
      const error = Object.assign(new Error(code), { code });
      child.emit("error", error);
      if (code === "ENOENT") await expect(pending).resolves.toEqual([]);
      else await expect(pending).rejects.toBe(error);
    },
  );

  it("browses real projects before Git init and before the initial commit", async () => {
    await expect(adapter.listHistoryEntries()).resolves.toEqual([]);
    childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
    await expect(adapter.listHistoryEntries()).resolves.toEqual([]);
  });

  it("does not mistake a missing working directory for a missing Git executable", async () => {
    fs.rmSync(root, { recursive: true, force: true });
    await expect(adapter.listHistoryEntries()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["process", "stdout", "stderr"])("rejects %s errors", async (source) => {
    const { child } = mockChild();
    const error = new Error("Cannot read Git history");
    const pending = adapter.listHistoryEntries();
    (source === "process" ? child : child[source]).emit("error", error);
    child.emit("close", -1);
    await expect(pending).rejects.toBe(error);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("reads real Git history from a nested project without changing its state", async () => {
    const repository = root;
    const git = (...args: string[]) =>
      childProcess
        .execFileSync("git", args, {
          cwd: repository,
          encoding: "utf8",
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        })
        .trim();
    const write = (file: string, content = "description: flag\n") => {
      const absolutePath = path.join(repository, file);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
    };
    const commit = (subject: string) => {
      git("add", ".");
      git(
        "-c",
        "user.name=Zoë | 作者",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        subject,
      );
      return git("rev-parse", "--short", "HEAD");
    };
    git("init", "-q");
    write(
      "project/featurevisor.config.js",
      'module.exports = { namespaceCharacter: "/", sets: true };',
    );
    const names = [
      "space name",
      'quote"name',
      "back\\slash",
      "line\n\nbreak",
      "tab\tname",
      "日本😀",
    ];
    for (const name of names) write(`project/features/nested/${name}.yml`);
    write("elsewhere/features/other.yml");
    write("project/sets/staging/features/setFlag.yml");
    write("project/sets/staging/tests/check.spec.yml", "checks: []\n");
    const initial = commit("Initial | café 😀");
    write("project/features/plain.yml");
    const latest = commit("Latest subject\n\nBody not included");
    write("project/features/plain.yml", "description: dirty\n");
    write("project/untracked.txt", "untracked");
    const before = git("status", "--porcelain=v1", "-z");
    const head = git("rev-parse", "HEAD");
    const projectRoot = path.join(repository, "project");
    adapter = new FilesystemAdapter(getProjectConfig(projectRoot), projectRoot);
    const entries = await adapter.listHistoryEntries();
    expect(entries.map((entry) => entry.commit)).toEqual([latest, initial]);
    expect(entries.map((entry) => entry.subject)).toEqual(["Latest subject", "Initial | café 😀"]);
    expect(entries[1].author).toBe("Zoë | 作者");
    expect(entries[1].entities).toHaveLength(names.length);
    expect(entries[1].entities).toEqual(
      expect.arrayContaining(names.map((name) => ({ type: "feature", key: `nested/${name}` }))),
    );
    expect(await adapter.listHistoryEntries("variable")).toEqual([]);
    expect(
      (await adapter.listHistoryEntries("feature", "plain")).map((entry) => entry.commit),
    ).toEqual([latest]);
    const raw = await adapter.getRawHistory(["features/plain.yml"]);
    expect(raw).toContain(`${latest}|Zoë | 作者|`);
    expect(raw).toContain("\nfeatures/plain.yml");
    expect(raw).not.toContain("Latest subject");
    const setAdapter = new FilesystemAdapter(
      getProjectConfigForSet(getProjectConfig(projectRoot), "staging"),
      projectRoot,
    );
    expect(await setAdapter.listHistoryEntries()).toEqual([
      expect.objectContaining({
        commit: initial,
        subject: "Initial | café 😀",
        entities: [
          { type: "feature", key: "setFlag" },
          { type: "scenario", key: "check" },
        ],
      }),
    ]);
    expect(git("status", "--porcelain=v1", "-z")).toBe(before);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(fs.readFileSync(path.join(projectRoot, "features/plain.yml"), "utf8")).toBe(
      "description: dirty\n",
    );
  });

  it("classifies historical specs in one batch, including ownership changes and deletions", async () => {
    const git = (...args: string[]) =>
      childProcess
        .execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        })
        .trim();
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    };
    const commit = (subject: string) => {
      git("add", "-A");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        subject,
      );
      return git("rev-parse", "--short", "HEAD");
    };
    git("init", "-q");
    write("tests/flag.spec.yml", "feature: flag\nassertions: []\n");
    write("tests/line\nbreak.spec.yml", "checks: []\n");
    write("tests/broken.spec.yml", "feature: [\n");
    const created = commit("Create specs");
    write("tests/flag.spec.yml", "checks: []\n");
    const converted = commit("Convert to a scenario");
    fs.rmSync(path.join(root, "tests/flag.spec.yml"));
    const deleted = commit("Delete the scenario");

    adapter = new FilesystemAdapter(getProjectConfig(root), root);
    const read = jest.spyOn(adapter, "readHistoricalTestSpec");
    const entries = await adapter.listHistoryEntries();
    const byCommit = Object.fromEntries(entries.map((entry) => [entry.commit, entry.entities]));

    expect(byCommit[created]).toEqual(
      expect.arrayContaining([
        { type: "test", key: "flag" },
        { type: "scenario", key: "line\nbreak" },
        // A spec that cannot be parsed still counts as a test.
        { type: "test", key: "broken" },
      ]),
    );
    expect(byCommit[converted]).toEqual([
      { type: "scenario", key: "flag" },
      { type: "test", key: "flag" },
    ]);
    // A deleted spec is classified from the parent revision.
    expect(byCommit[deleted]).toEqual([{ type: "scenario", key: "flag" }]);
    expect(await adapter.listHistoryEntries("scenario")).toHaveLength(3);
    // Only the path with a line break, which cat-file cannot name, is read individually.
    expect(new Set(read.mock.calls.map(([, file]) => file))).toEqual(
      new Set(["tests/line\nbreak.spec.yml"]),
    );
  });
});
