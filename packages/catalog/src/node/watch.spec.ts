import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { setTimeout as delay } from "timers/promises";

import { getCatalogInputWatchPaths, watchCatalogInputs } from "./watch";

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    watch: jest.fn(),
    statSync: jest.fn(actual.statSync),
    lstatSync: jest.fn(actual.lstatSync),
  };
});

interface Registration {
  directory: string;
  recursive: boolean;
  emitter: EventEmitter;
  close: jest.Mock;
  event: (event: string, filename: string | Buffer | null) => void;
}

describe("Catalog input watching", () => {
  let root: string;
  let stop: (() => void) | undefined;
  let registrations: Registration[];
  const changed = jest.fn();
  const config = () => ({ featuresDirectoryPath: path.join(root, "features") });
  const write = (name: string, content = "one") => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  const active = (directory: string) =>
    [...registrations]
      .reverse()
      .find((entry) => entry.directory === directory && !entry.close.mock.calls.length)!;
  const received = () => changed.mock.calls.flatMap(([paths]) => paths);
  async function until(predicate: () => boolean) {
    for (let attempt = 0; attempt < 400 && !predicate(); attempt++) {
      await delay(10);
    }
    expect(predicate()).toBe(true);
  }
  function fakeNative() {
    return jest.spyOn(require("fs"), "watch").mockImplementation(((
      directory: string,
      options: { recursive: boolean },
      event: Registration["event"],
    ) => {
      const emitter = new EventEmitter();
      const close = jest.fn();
      registrations.push({ directory, recursive: options.recursive, emitter, close, event });
      return Object.assign(emitter, { close });
    }) as any);
  }
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "catalog-watch-")));
    registrations = [];
    changed.mockClear();
    jest.mocked(fs.watch).mockReset();
    jest.mocked(fs.statSync).mockReset().mockImplementation(jest.requireActual("fs").statSync);
    jest.mocked(fs.lstatSync).mockReset().mockImplementation(jest.requireActual("fs").lstatSync);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("preserves input selection for flat and Sets projects", () => {
    expect(getCatalogInputWatchPaths(root, config())).toEqual([
      path.join(root, "featurevisor.config.js"),
      path.join(root, "features"),
    ]);
    expect(
      getCatalogInputWatchPaths(root, { ...config(), sets: true, setsDirectoryPath: "sets" }),
    ).toEqual([path.join(root, "featurevisor.config.js"), "sets"]);
  });

  it("uses recursive inputs and nonrecursive sentinels without scanning the project", () => {
    write("features/nested/a.yml");
    fakeNative();
    const read = jest.spyOn(fs.promises, "readdir");
    stop = watchCatalogInputs(root, config(), [], changed);
    expect(active(root).recursive).toBe(false);
    expect(active(path.join(root, "features")).recursive).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("reports every native content event without comparing size or timestamps", () => {
    const file = write("features/a.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    const watcher = active(path.dirname(file));
    watcher.event("change", Buffer.from("a.yml"));
    watcher.event("change", "a.yml");
    expect(changed.mock.calls).toEqual([[[file]], [[file]]]);
  });

  it("keeps paths through partial config edits and discovers missing nested inputs", () => {
    const file = write("featurevisor.config.js");
    const input = path.join(root, "missing", "nested", "features");
    fakeNative();
    stop = watchCatalogInputs(root, { featuresDirectoryPath: input }, [], changed);
    fs.writeFileSync(file, "module.exports = {");
    active(root).event("change", "featurevisor.config.js");
    fs.mkdirSync(path.dirname(input), { recursive: true });
    active(root).event("rename", "missing");
    expect(active(path.dirname(input)).recursive).toBe(false);
    fs.mkdirSync(input);
    active(path.dirname(input)).event("rename", "features");
    expect(active(input).recursive).toBe(true);
    expect(received()).toEqual(expect.arrayContaining([file, input]));
  });

  it("rearms removed and recreated directories and rejects late events", () => {
    write("features/a.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    const directory = path.join(root, "features");
    const old = active(directory);
    fs.rmSync(directory, { recursive: true });
    active(root).event("rename", "features");
    expect(old.close).toHaveBeenCalledTimes(1);
    write("features/b.yml");
    active(root).event("rename", "features");
    expect(active(directory)).not.toBe(old);
    changed.mockClear();
    old.event("change", "a.yml");
    active(directory).event("change", "b.yml");
    expect(received()).toEqual([path.join(directory, "b.yml")]);
  });

  it("handles unknown filenames and atomic config replacement", () => {
    write("features/a.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    active(root).event("rename", "featurevisor.config.js");
    active(root).event("rename", null);
    expect(received()).toEqual(expect.arrayContaining(getCatalogInputWatchPaths(root, config())));
    expect(active(path.join(root, "features"))).toBeDefined();
  });

  it("rearms a recreated input with a recycled inode and reports its later file edit", async () => {
    const directory = path.join(root, "features");
    write("features/old.yml");
    let birthtimeMs = 1000;
    const stat = jest.requireActual("fs").statSync;
    const lstat = jest.requireActual("fs").lstatSync;
    const withRecycledInode = (entry: fs.PathLike, value: fs.Stats) => {
      if (entry.toString() === directory) {
        value.ino = 42;
        value.birthtimeMs = birthtimeMs;
      }
      return value;
    };
    jest
      .spyOn(fs, "statSync")
      .mockImplementation(((entry: fs.PathLike) => withRecycledInode(entry, stat(entry))) as any);
    jest
      .spyOn(fs, "lstatSync")
      .mockImplementation(((entry: fs.PathLike) => withRecycledInode(entry, lstat(entry))) as any);
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    const old = active(directory);
    fs.rmSync(directory, { recursive: true });
    const file = write("features/replacement.yml");
    birthtimeMs = 2000;
    // The parent only delivers the final rename, not the intervening removal.
    active(root).event("rename", "features");
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(active(directory)).not.toBe(old);
    await until(() => received().includes(file));
    changed.mockClear();
    old.event("change", "old.yml");
    fs.writeFileSync(file, "later edit");
    active(directory).event("change", "replacement.yml");
    expect(received()).toEqual([file]);
    expect(fs.readFileSync(file, "utf8")).toBe("later edit");
  });

  it.each(["features", "features/new"])(
    "attaches before scanning %s created with files already inside",
    async (relative) => {
      fs.mkdirSync(path.join(root, "features"));
      if (relative === "features") fs.rmdirSync(path.join(root, "features"));
      fakeNative();
      stop = watchCatalogInputs(root, config(), [], changed);
      const file = write(`${relative}/nested/already.yml`);
      const directory = path.join(root, relative);
      const list = jest.spyOn(fs.promises, "readdir");
      const parent = active(path.dirname(directory));
      parent.event("rename", path.basename(directory));
      expect(active(directory)).toBeDefined();
      const watchCalls = jest.mocked(fs.watch).mock.invocationCallOrder;
      expect(list.mock.invocationCallOrder[0]).toBeGreaterThan(watchCalls[watchCalls.length - 1]);
      await until(() => received().includes(file));
      expect(active(path.dirname(file))).toBeDefined();
      expect(list.mock.calls.map(([entry]) => entry)).toEqual([directory, path.dirname(file)]);

      const count = registrations.length;
      parent.event("rename", path.basename(directory));
      active(directory).event("rename", "nested");
      active(path.dirname(file)).event("change", "already.yml");
      expect(registrations).toHaveLength(count);
      expect(list).toHaveBeenCalledTimes(2);
      expect(registrations.every((entry) => entry.close.mock.calls.length === 0)).toBe(true);

      const discovered = [active(directory), active(path.dirname(file))];
      fs.rmSync(directory, { recursive: true });
      parent.event("rename", path.basename(directory));
      expect(active(directory)).toBeUndefined();
      expect(active(path.dirname(file))).toBeUndefined();
      expect(discovered.every((entry) => entry.close.mock.calls.length === 1)).toBe(true);
      stop();
      stop();
      expect(registrations.every((entry) => entry.close.mock.calls.length === 1)).toBe(true);
    },
  );

  it("keeps unchanged input subscriptions on duplicate and unknown directory notifications", () => {
    write("features/a.yml");
    fakeNative();
    const list = jest.spyOn(fs.promises, "readdir");
    stop = watchCatalogInputs(root, config(), [], changed);
    const input = active(path.join(root, "features"));
    const parent = active(root);
    write("features/b.yml");
    parent.event("rename", "features");
    parent.event("rename", "features");
    parent.event("rename", null);
    input.event("change", "a.yml");
    expect(active(root)).toBe(parent);
    expect(active(path.join(root, "features"))).toBe(input);
    expect(parent.close).not.toHaveBeenCalled();
    expect(input.close).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("scans only the new subtree without traversing ignored directories or symlinks", async () => {
    write("features/existing/a.yml");
    write("outside/deep/private.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), ["features/new/generated"], changed);
    const file = write("features/new/visible.yml");
    write("features/new/generated/ignored.yml");
    fs.symlinkSync(path.join(root, "outside"), path.join(root, "features/new/link"), "dir");
    fs.symlinkSync(path.join(root, "features/new"), path.join(root, "features/new/cycle"), "dir");
    const list = jest.spyOn(fs.promises, "readdir");
    const parent = active(path.join(root, "features"));
    parent.event("rename", "new");
    await until(() => received().includes(file));
    parent.event("rename", "new/link/deep");
    parent.event("rename", "new/generated");
    expect(list.mock.calls.map(([entry]) => entry)).toEqual([path.join(root, "features/new")]);
    expect(received()).not.toContain(path.join(root, "features/new/link/deep/private.yml"));
    expect(received()).not.toContain(path.join(root, "features/new/generated/ignored.yml"));
    expect(active(path.join(root, "features/new/link/deep"))).toBeUndefined();
    expect(active(path.join(root, "features/new/generated"))).toBeUndefined();
  });

  it.each(["stop", "replacement"])(
    "discards an unfinished new directory scan after %s",
    async (action) => {
      write("features/a.yml");
      fakeNative();
      stop = watchCatalogInputs(root, config(), [], changed);
      write("features/new/already.yml");
      const directory = path.join(root, "features/new");
      const children = fs.readdirSync(directory, { withFileTypes: true });
      let release!: (children: fs.Dirent[]) => void;
      jest.spyOn(fs.promises, "readdir").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }) as any,
      );
      active(path.join(root, "features")).event("rename", "new");
      const old = active(directory);
      if (action === "stop") {
        stop();
      } else {
        fs.renameSync(directory, `${directory}-old`);
        const replacement = write("features/new/current.yml");
        active(path.join(root, "features")).event("rename", "new");
        await until(() => received().includes(replacement));
        expect(active(directory)).not.toBe(old);
      }
      expect(old.close).toHaveBeenCalledTimes(1);
      changed.mockClear();
      release(children);
      await delay(10);
      expect(changed).not.toHaveBeenCalled();
    },
  );

  it("still invalidates a new directory when its recovery listing fails", async () => {
    write("features/a.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    write("features/new/already.yml");
    const list = jest.spyOn(fs.promises, "readdir").mockRejectedValue(new Error("unreadable"));
    active(path.join(root, "features")).event("rename", "new");
    await delay(10);
    expect(received()).toContain(path.join(root, "features/new"));
    expect(list).toHaveBeenCalledTimes(1);
    expect(active(path.join(root, "features/new"))).toBeDefined();
  });

  it("recovers when a sentinel parent itself is removed", () => {
    const input = path.join(root, "nested", "features");
    fs.mkdirSync(path.dirname(input));
    fakeNative();
    stop = watchCatalogInputs(root, { featuresDirectoryPath: input }, [], changed);
    const sentinel = active(path.dirname(input));
    fs.rmSync(path.dirname(input), { recursive: true });
    sentinel.event("rename", "nested");
    expect(sentinel.close).toHaveBeenCalledTimes(1);
    expect(received()).toContain(input);
    fs.mkdirSync(input, { recursive: true });
    active(root).event("rename", "nested");
    expect(active(input).recursive).toBe(true);
  });

  it("scopes ignores and allows only exact extra files inside ignored directories", () => {
    const report = write("output/report.json");
    const head = write(".git/HEAD");
    const ref = path.join(root, ".git", "refs", "heads", "main");
    write("features/generated/a.yml");
    write("features/generated-other/b.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [".git", "output", "features/generated"], changed, [
      head,
      ref,
      report,
    ]);
    expect(active(path.dirname(head)).recursive).toBe(false);
    expect(active(path.dirname(report)).recursive).toBe(false);
    active(path.dirname(head)).event("change", "HEAD");
    active(path.dirname(head)).event("change", "index");
    active(path.dirname(report)).event("change", "report.json");
    active(path.dirname(report)).event("change", "bundle.js");
    active(path.join(root, "features")).event("change", "generated/a.yml");
    active(path.join(root, "features")).event("change", "generated-other/b.yml");
    write(".git/refs/heads/main");
    active(path.dirname(head)).event("rename", "refs");
    expect(active(path.dirname(ref)).recursive).toBe(false);
    expect(received()).toEqual([
      head,
      report,
      path.join(root, "features/generated-other/b.yml"),
      ref,
    ]);
  });

  it("falls back once on runtime errors, closes watchers and polls only selected metadata", async () => {
    jest.useFakeTimers();
    const file = write("features/a.yml");
    const report = write("output/report.json");
    write("output/bundle.js");
    write("node_modules/package/index.js");
    fakeNative();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const read = jest.spyOn(fs.promises, "readFile");
    const list = jest.spyOn(fs.promises, "readdir");
    const stat = jest.spyOn(fs.promises, "lstat");
    stop = watchCatalogInputs(root, config(), ["output"], changed, [report]);
    const old = active(root);
    old.emitter.emit("error", new Error("unavailable"));
    old.emitter.emit("error", new Error("again"));
    await until(() => received().includes(file));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(registrations.every((entry) => entry.close.mock.calls.length === 1)).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
    changed.mockClear();
    write("features/a.yml", "longer");
    write("output/report.json", "updated report");
    await jest.advanceTimersByTimeAsync(1000);
    await until(() => received().includes(report));
    expect(received()).toContain(file);
    expect(read).not.toHaveBeenCalled();
    expect(list.mock.calls.map(([entry]) => entry)).not.toContain(root);
    expect(stat.mock.calls.map(([entry]) => entry)).not.toContain(
      path.join(root, "output/bundle.js"),
    );
    changed.mockClear();
    stop();
    stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(5000);
    expect(changed).not.toHaveBeenCalled();
  });

  it("falls back on unsupported recursive watching and detects later creation and removal", async () => {
    jest.useFakeTimers();
    fakeNative().mockImplementation(() => {
      throw new Error("unsupported");
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    stop = watchCatalogInputs(root, config(), [], changed);
    await delay(30);
    const file = write("features/a.yml");
    await jest.advanceTimersByTimeAsync(1000);
    await until(() => received().includes(file));
    changed.mockClear();
    fs.rmSync(path.dirname(file), { recursive: true });
    await jest.advanceTimersByTimeAsync(1000);
    await until(() => received().includes(file));
  });

  it("does not overlap polls or notify when stopped during a pending scan", async () => {
    jest.useFakeTimers();
    fakeNative().mockImplementation(() => {
      throw new Error("unsupported");
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    let resolve!: (value: fs.Stats) => void;
    const stat = jest.spyOn(fs.promises, "lstat").mockImplementation(
      () =>
        new Promise<fs.Stats>((done) => {
          resolve = done;
        }) as any,
    );
    stop = watchCatalogInputs(root, config(), [], changed);
    await jest.advanceTimersByTimeAsync(5000);
    expect(stat).toHaveBeenCalledTimes(1);
    stop();
    resolve(fs.statSync(root));
    await delay(10);
    expect(changed).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not create a recursive project root registration", async () => {
    jest.useFakeTimers();
    fakeNative();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    stop = watchCatalogInputs(root, { featuresDirectoryPath: root }, [], changed);
    expect(registrations.some((entry) => entry.directory === root && entry.recursive)).toBe(false);
    await until(() => changed.mock.calls.length > 0);
  });

  it("closes native watchers idempotently and ignores queued events after stop", () => {
    write("features/a.yml");
    fakeNative();
    stop = watchCatalogInputs(root, config(), [], changed);
    stop();
    stop();
    for (const registration of registrations) {
      expect(registration.close).toHaveBeenCalledTimes(1);
      registration.event("change", null);
      registration.emitter.emit("error", new Error("late"));
    }
    expect(changed).not.toHaveBeenCalled();
  });
});
