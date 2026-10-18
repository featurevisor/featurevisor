import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { setTimeout as delay } from "timers/promises";

import { watchCatalogInputs } from "./watch";

jest.setTimeout(20_000);

describe("Catalog native filesystem watching", () => {
  let root: string;
  let deadline: number;
  let stop: (() => void) | undefined;
  let warn: jest.SpyInstance;
  const events = new EventEmitter();
  const changed = jest.fn((paths: string[]) => events.emit("change", paths));
  const config = () => ({ featuresDirectoryPath: path.join(root, "features") });
  const write = (name: string, content = "one") => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  function waitForEvent(
    emitter: EventEmitter,
    label: string,
    matches: (paths: string[]) => boolean,
    mutate: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        emitter.off("change", listener);
        if (error) reject(error);
        else resolve();
      };
      const listener = (paths: string[]) => {
        if (matches(paths)) finish();
      };
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reject(new Error(`Native watcher deadline exceeded before ${label}`));
        return;
      }
      const timer = setTimeout(
        () => finish(new Error(`Native watcher deadline exceeded waiting for ${label}`)),
        remaining,
      );
      emitter.on("change", listener);
      try {
        mutate();
      } catch (error) {
        finish(error as Error);
      }
    });
  }

  const expectChange = (label: string, expected: string[], mutate: () => void) =>
    waitForEvent(events, label, (paths) => paths.some((entry) => expected.includes(entry)), mutate);

  function waitForQuiet(): Promise<void> {
    return new Promise((resolve, reject) => {
      let quiet: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        clearTimeout(quiet);
        clearTimeout(timeout);
        events.off("change", onChange);
        if (error) reject(error);
        else resolve();
      };
      const onChange = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => finish(), 1000);
      };
      const timeout = setTimeout(
        () => finish(new Error("Native watcher did not settle before the deadline")),
        Math.max(0, deadline - Date.now()),
      );
      events.on("change", onChange);
      onChange();
    });
  }

  beforeEach(() => {
    expect(jest.isMockFunction(fs.watch)).toBe(false);
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "catalog-native-watch-")));
    deadline = Date.now() + 18_000;
    changed.mockClear();
    warn = jest.spyOn(console, "warn");
  });

  afterEach(() => {
    try {
      stop?.();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      stop = undefined;
      events.removeAllListeners();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("observes real temporary filesystem edits and directory recreation", async () => {
    const file = write("features/a.yml");
    const directory = path.dirname(file);
    stop = watchCatalogInputs(root, config(), [], changed);
    // Settle fixture creation events before measuring a distinct content edit.
    await waitForQuiet();

    await expectChange("file edit", [file, directory], () => fs.writeFileSync(file, "two"));
    await expectChange("directory removal", [directory], () =>
      fs.rmSync(directory, { recursive: true }),
    );
    await expectChange("directory recreation", [directory], () => fs.mkdirSync(directory));

    // A nested edit requires the recursive input watcher to have been rearmed.
    const nested = path.join(directory, "nested");
    await expectChange("nested directory creation", [nested, directory], () =>
      fs.mkdirSync(nested),
    );
    const replacement = path.join(nested, "b.yml");
    await expectChange("file creation in recreated input", [replacement, nested], () =>
      fs.writeFileSync(replacement, "new content"),
    );
    // Recovery notifications can precede native file delivery. Settle creation before a distinct edit.
    await waitForQuiet();
    await expectChange("file edit in recreated input", [replacement], () =>
      fs.writeFileSync(replacement, "updated content"),
    );
    expect(fs.readFileSync(replacement, "utf8")).toBe("updated content");
  });

  it("reports files created inside an input before its watcher can be attached", async () => {
    stop = watchCatalogInputs(root, config(), [], changed);
    await waitForQuiet();
    const file = path.join(root, "features/new/nested/already.yml");
    await expectChange("file already inside new input", [file], () => {
      write("features/new/nested/already.yml", "created with directory");
    });
    await waitForQuiet();
    await expectChange("later edit in discovered directory", [file], () =>
      fs.writeFileSync(file, "edited after attachment"),
    );
    expect(fs.readFileSync(file, "utf8")).toBe("edited after attachment");
  });

  it("delivers final content to a debounced reader after an immediate edit in a recreated input", async () => {
    const initial = write("features/a.yml");
    const directory = path.dirname(initial);
    const file = path.join(directory, "nested/b.yml");
    const reads = new EventEmitter();
    let edited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    stop = watchCatalogInputs(root, config(), [], (paths) => {
      changed(paths);
      if (!edited && paths.includes(file)) {
        edited = true;
        queueMicrotask(() => fs.writeFileSync(file, "immediate final content"));
      }
      clearTimeout(timer);
      // Match the Catalog dev consumer's debounce, not a promise of one event per write.
      timer = setTimeout(() => {
        if (fs.existsSync(file)) reads.emit("change", [fs.readFileSync(file, "utf8")]);
      }, 250);
    });
    try {
      await waitForQuiet();
      await expectChange("input removal before immediate edit", [directory], () =>
        fs.rmSync(directory, { recursive: true }),
      );
      await expectChange("input recreation before immediate edit", [directory], () =>
        fs.mkdirSync(directory),
      );
      await waitForEvent(
        reads,
        "debounced final content after creation callback",
        (contents) => contents.includes("immediate final content"),
        () => {
          write("features/nested/b.yml", "initial content");
        },
      );
      expect(edited).toBe(true);
      await waitForQuiet();
      await expectChange("distinct edit after immediate edit settles", [file], () =>
        fs.writeFileSync(file, "distinct later content"),
      );
      expect(fs.readFileSync(file, "utf8")).toBe("distinct later content");
    } finally {
      clearTimeout(timer);
    }
  });

  it.each([".featurevisor/sets/dev", "custom/allocation/sets/dev"])(
    "watches exact state files through ignored %s directories without revision loops",
    async (directory) => {
      const state = write(`${directory}/existing-state.json`, '{"features":{}}');
      const revision = write(`${directory}/REVISION`, "1");
      const unrelated = write(`${directory}/unrelated.json`, "{}");
      // Observe ignored writes independently so silence cannot pass without filesystem events.
      const rawEvents = new EventEmitter();
      const observed = new Set<string>();
      const observer = fs.watch(path.dirname(state), (_event, filename) => {
        if (filename) observed.add(filename.toString());
        rawEvents.emit("change", [...observed]);
      });
      try {
        stop = watchCatalogInputs(root, config(), [path.join(root, directory)], changed, [state]);
        // Start both native observers before waiting for fixture events to settle.
        await waitForQuiet();
        await expectChange("initial exact state edit", [state], () =>
          fs.writeFileSync(state, '{"features":{"flag":{"traffic":[]}}}'),
        );
        await waitForQuiet();
        changed.mockClear();
        observed.clear();

        await waitForEvent(
          rawEvents,
          "ignored revision and unrelated file events",
          (names) => names.includes("REVISION") && names.includes("unrelated.json"),
          () => {
            fs.writeFileSync(revision, "2");
            fs.writeFileSync(unrelated, '{"ignored":true}');
          },
        );
        // Allow delayed notifications, without polling or retrying mutations.
        await delay(Math.min(1000, Math.max(0, deadline - Date.now())));
        expect(changed).not.toHaveBeenCalled();

        await expectChange("exact state edit", [state], () =>
          fs.writeFileSync(state, '{"features":{"flag":{"traffic":[1]}}}'),
        );
        await expectChange("exact state removal", [state], () => fs.rmSync(state));
        await expectChange("exact state recreation", [state], () =>
          fs.writeFileSync(state, '{"features":{}}'),
        );
        const received = changed.mock.calls.flatMap(([paths]) => paths);
        expect(received).not.toContain(revision);
        expect(received).not.toContain(unrelated);
      } finally {
        observer.close();
      }
    },
  );
});
