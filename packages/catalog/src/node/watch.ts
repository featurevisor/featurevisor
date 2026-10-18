import * as fs from "fs";
import * as path from "path";

function isWithinDirectory(directoryPath: string, candidatePath: string) {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      !relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== "..")
  );
}

/** Watch authored inputs, with metadata polling only when native watching fails. */
export function watchCatalogInputs(
  rootDirectoryPath: string,
  projectConfig: any,
  ignoredDirectoryPaths: string[],
  onChange: (changedPaths: string[]) => void,
  extraPaths: string[] = [],
): () => void {
  const root = path.resolve(rootDirectoryPath);
  const ignored = ignoredDirectoryPaths.map((entry) => path.resolve(root, entry));
  const extras = new Set(extraPaths.filter(Boolean).map((entry) => path.resolve(root, entry)));
  const shouldIgnore = (entry: string) =>
    !extras.has(entry) && ignored.some((directory) => isWithinDirectory(directory, entry));
  // Keep these paths even while an editor temporarily removes or invalidates config.
  const inputs = Array.from(
    new Set(
      [...getCatalogInputWatchPaths(root, projectConfig), ...extras]
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .map((entry) => path.resolve(root, entry))
        .filter((entry) => !shouldIgnore(entry)),
    ),
  );
  const shouldWatch = (entry: string) =>
    !shouldIgnore(entry) &&
    inputs.some(
      (input) => input === entry || (!extras.has(input) && isWithinDirectory(input, entry)),
    );
  const watchers = new Map<
    string,
    { watcher: fs.FSWatcher; recursive: boolean; identity: string }
  >();
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;
  let firstPoll = true;
  let previous = new Map<string, string>();

  function closeWatchers() {
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  }

  async function snapshot() {
    const next = new Map<string, string>();
    const visited = new Set<string>();
    async function visit(entry: string): Promise<void> {
      if (stopped || shouldIgnore(entry) || visited.has(entry)) return;
      visited.add(entry);
      try {
        // Do not follow directory symlinks outside the selected inputs or into cycles.
        const stat = await fs.promises.lstat(entry);
        if (stopped) return;
        next.set(
          entry,
          `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
        );
        if (stat.isDirectory() && !extras.has(entry)) {
          for (const child of await fs.promises.readdir(entry)) {
            await visit(path.join(entry, child));
          }
        }
      } catch (error) {
        // Missing files are changes. Unreadable subtrees retain their last known state.
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) {
          for (const [oldPath, signature] of previous) {
            if (isWithinDirectory(entry, oldPath)) next.set(oldPath, signature);
          }
        }
      }
    }
    for (const input of inputs) await visit(input);
    return next;
  }

  async function poll() {
    if (stopped || checking) return;
    checking = true;
    try {
      const next = await snapshot();
      if (stopped) return;
      const changed = new Set<string>(firstPoll ? inputs : []);
      firstPoll = false;
      for (const [entry, signature] of next) {
        if (previous.get(entry) !== signature) changed.add(entry);
      }
      for (const entry of previous.keys()) {
        if (!next.has(entry)) changed.add(entry);
      }
      previous = next;
      if (changed.size > 0) onChange(Array.from(changed));
    } finally {
      checking = false;
    }
  }

  function usePolling(error: unknown) {
    if (stopped || polling) return;
    polling = true;
    closeWatchers();
    console.warn(
      "Catalog native watching unavailable; using polling.",
      error instanceof Error ? error.message : "",
    );
    // The first scan also invalidates existing inputs, covering the transition gap.
    void poll();
    timer = setInterval(() => void poll(), 1000);
  }

  function directoryIdentity(entry: string): string | undefined {
    try {
      const stat = fs.statSync(entry);
      // Inodes can be recycled after removal. Birth time stays stable across content edits.
      if (stat.isDirectory()) return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    } catch {
      // The nearest existing ancestor will cover a missing directory.
    }
    return undefined;
  }

  function inputDirectoryIdentity(entry: string): string | undefined {
    const input = inputs.find((input) => !extras.has(input) && isWithinDirectory(input, entry));
    if (!input || shouldIgnore(entry)) return;
    let identity: string | undefined;
    try {
      // Reject symlinks in every component below the selected input, not just the leaf.
      for (let current = entry; ; current = path.dirname(current)) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory()) return;
        if (current === entry) identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (current === input) return identity;
      }
    } catch {
      // Creation and removal can race with the notification.
    }
    return undefined;
  }

  async function scanNewDirectory(directory: string) {
    const registration = watchers.get(directory);
    if (!registration) return;
    const current = () =>
      !stopped &&
      !polling &&
      watchers.get(directory) === registration &&
      inputDirectoryIdentity(directory) === registration.identity;
    const changed = [directory];
    try {
      // Attach before listing to cover files written before native subscription delivery.
      const children = await fs.promises.readdir(directory, { withFileTypes: true });
      if (!current()) return;
      for (const child of children) {
        const entry = path.join(directory, child.name);
        if (!shouldWatch(entry)) continue;
        if (child.isDirectory()) {
          const identity = inputDirectoryIdentity(entry);
          if (identity !== undefined) {
            attach(entry, { recursive: true, identity }, true);
            changed.push(entry);
          }
        } else if (child.isFile()) {
          changed.push(entry);
        }
      }
    } catch {
      // The directory notification still invalidates inputs if listing is unavailable.
    }
    if (current()) onChange(changed);
  }

  function attach(
    directory: string,
    target: { recursive: boolean; identity: string },
    recover: boolean,
  ) {
    const existing = watchers.get(directory);
    if (existing?.identity === target.identity && existing.recursive === target.recursive) return;
    if (existing) {
      watchers.delete(directory);
      existing.watcher.close();
    }
    if (stopped || polling) return;
    try {
      const watcher = fs.watch(directory, { recursive: target.recursive }, (event, filename) => {
        if (stopped || polling || watchers.get(directory)?.watcher !== watcher) return;
        const replaced = event === "rename" && directoryIdentity(directory) !== target.identity;
        const changedPath =
          filename && !replaced ? path.resolve(directory, filename.toString()) : directory;
        const affected = inputs.filter((input) => isWithinDirectory(changedPath, input));
        if (shouldIgnore(changedPath) && affected.length === 0) return;
        if (
          !filename ||
          (event === "rename" &&
            (affected.length > 0 ||
              watchers.has(changedPath) ||
              inputDirectoryIdentity(changedPath) !== undefined))
        ) {
          reconcile(changedPath);
        }
        // Native events are authoritative even if size and timestamps are unchanged.
        const changed = shouldWatch(changedPath) ? [changedPath] : affected;
        if (changed.length > 0 && !stopped) onChange(changed);
      });
      watchers.set(directory, { watcher, ...target });
      watcher.on("error", (error) => {
        if (watchers.get(directory)?.watcher === watcher) usePolling(error);
      });
      if (recover && target.recursive && inputDirectoryIdentity(directory) === target.identity) {
        void scanNewDirectory(directory);
      }
    } catch (error) {
      usePolling(error);
    }
  }

  function reconcile(appearedPath?: string) {
    if (stopped || polling) return;
    const desired = new Map<string, { recursive: boolean; identity: string }>();
    const add = (entry: string, recursive: boolean) => {
      const identity = directoryIdentity(entry);
      if (identity === undefined) return false;
      desired.set(entry, { recursive: recursive || !!desired.get(entry)?.recursive, identity });
      return true;
    };
    for (const input of inputs) {
      let ancestor = path.dirname(input);
      while (!add(ancestor, false)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      // A project root input must not create a recursive project root watcher.
      if (input === root && directoryIdentity(input) !== undefined) {
        usePolling(new Error("Project root input requires scoped polling"));
        return;
      }
      if (!extras.has(input)) add(input, true);
    }
    // Keep discovered subtree subscriptions stable across duplicate directory events.
    for (const [directory, registration] of watchers) {
      if (!registration.recursive || desired.has(directory)) continue;
      const identity = inputDirectoryIdentity(directory);
      if (identity !== undefined) desired.set(directory, { recursive: true, identity });
    }
    if (appearedPath) {
      const identity = inputDirectoryIdentity(appearedPath);
      if (identity !== undefined) desired.set(appearedPath, { recursive: true, identity });
    }
    for (const [directory, registration] of watchers) {
      const target = desired.get(directory);
      if (
        !target ||
        target.recursive !== registration.recursive ||
        target.identity !== registration.identity
      ) {
        watchers.delete(directory);
        registration.watcher.close();
      }
    }
    for (const [directory, target] of desired) {
      attach(directory, target, appearedPath !== undefined);
      if (polling) return;
    }
  }

  reconcile();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    closeWatchers();
  };
}

export function getCatalogInputWatchPaths(rootDirectoryPath: string, projectConfig: any) {
  const paths = [path.join(rootDirectoryPath, "featurevisor.config.js")];

  if (projectConfig.sets) {
    paths.push(projectConfig.setsDirectoryPath);
    return paths;
  }

  paths.push(
    projectConfig.featuresDirectoryPath,
    projectConfig.segmentsDirectoryPath,
    projectConfig.attributesDirectoryPath,
    projectConfig.targetsDirectoryPath,
    projectConfig.schemasDirectoryPath,
    projectConfig.variablesDirectoryPath,
    projectConfig.testsDirectoryPath,
  );

  const validPaths = paths.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );

  return validPaths.filter(
    (entry, index) =>
      validPaths.findIndex((candidate) => isWithinDirectory(candidate, entry)) === index,
  );
}
