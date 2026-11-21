import type {
  EvaluationReads,
  Featurevisor,
  FeaturevisorModuleApi,
  TrackResult,
} from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";

import { copyValue, deepFreeze, isBrowser, sameValue, snapshot } from "./values.js";

/**
 * A value that updates itself. `read` answers now, and `listen` calls back when
 * the value may have changed. This is what `useSyncExternalStore` takes, and
 * what each signals library's adapter wraps.
 */
export interface Source<T> {
  /** Answers now. While nothing the last answer read has changed, it returns that answer again. */
  read(): T;
  /** Calls `changed` when the value may have changed, until the returned function is called. */
  listen(changed: () => void): () => void;
}

/** Runs notifications together, such as Preact's `batch`. */
export type Batch = (run: () => void) => void;

type Track = <T>(callback: () => T) => TrackResult<T>;
type AnyNode = Node<unknown>;

/** What a value follows when the SDK cannot say what it read, as the React and Vue hooks did. */
export interface Follows {
  features?: readonly string[];
  variables?: readonly string[];
}

export interface NodeOptions<T> {
  compute: (context: Context) => T;
  context: () => Context;
  equals: (previous: T, next: T) => boolean;
  /** Asks again only when a change touches what the last answer read. */
  precise: boolean;
  /** Keeps its own copy of each new value, so changing it in place reaches nothing else. */
  copy: boolean;
  /** Freezes each kept value, so changing it in place throws. */
  freeze: boolean;
  batch?: Batch;
  follows?: Follows;
  /** Instance state that no evaluation reads. */
  kind?: "revision" | "status";
}

const engines = new WeakMap<Featurevisor, Engine>();

/** The one engine of an instance, shared by every reader, adapter and hook on it. */
export function getEngine(f: Featurevisor): Engine {
  let engine = engines.get(f);
  if (!engine) engines.set(f, (engine = new Engine(f)));

  return engine;
}

// Index keys: a kind's letter and a key. Attributes by their top level key,
// since a context change names top level keys. Untracked values follow every
// change, and "*" marks values a module may have read any attribute for.
const ATTRIBUTE = "a";
const SEGMENT = "s";
const FEATURE = "f";
const VARIABLE = "v";
const ANY = "*";
const UNTRACKED = "u";
const REVISION = "r";
const STATUS = "t";

function keysOf(node: AnyNode): string[] {
  const kind = node.options.kind;
  if (kind) return [kind === "revision" ? REVISION : STATUS];

  const reads = node.reads;
  const keys: string[] = [];
  if (reads) {
    for (const path of reads.attributes) {
      // Paths such as account.plan and account.id share one top level key.
      const key = path === ANY ? ANY : ATTRIBUTE + path.split(".")[0];
      if (keys.indexOf(key) === -1) keys.push(key);
    }
    for (const key of reads.segments) keys.push(SEGMENT + key);
    for (const key of reads.features) keys.push(FEATURE + key);
    for (const key of reads.variables) keys.push(VARIABLE + key);
  }

  // Without reads to go by, a value follows every change.
  return keys.length > 0 ? keys : [UNTRACKED];
}

function intersects(keys: readonly string[] | undefined, changed: readonly string[]): boolean {
  if (keys) for (const key of keys) if (changed.indexOf(key) !== -1) return true;
  return false;
}

/**
 * Listens to one instance with one set of listeners, only while a value
 * watches, and tells each value when a change touches what it read.
 */
export class Engine {
  /** The SDK's `track`, or undefined on an SDK without it. */
  readonly track: Track | undefined;
  /** Counts the instance's changes while listening, and each stop, so a value can tell whether it may be stale. */
  changes = 0;
  attached = false;
  /** Whether the instance has accepted a datafile. */
  ready: boolean;

  private watching = 0;
  private attributes = 0;
  private stop: Array<() => void> = [];
  private index = new Map<string, Set<AnyNode>>();

  constructor(readonly f: Featurevisor) {
    let api: FeaturevisorModuleApi | undefined;
    const instance = f as Partial<Featurevisor>;
    // A module without hooks costs evaluations nothing. It has no name, so two
    // copies of this package on one instance never clash. A child instance has
    // no modules, so its values follow every change, as before.
    if (typeof instance.addModule === "function") {
      instance.addModule({ setup: (moduleApi) => void (api = moduleApi) });
    }
    this.track = api && typeof api.track === "function" ? api.track : undefined;
    // A child shares its parent's datafile, so only a root instance can be waiting for one.
    this.ready =
      typeof instance.getRevision === "function" ? instance.getRevision() !== "unknown" : true;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const f = this.f;
    this.stop = [
      f.on("context_set", (details) => {
        const touched = this.touch([ANY, UNTRACKED]);
        // Only an index with attributes in it needs the keys, which the SDK works out when asked.
        if (this.attributes > 0) {
          const keys = details.keys;
          if (Array.isArray(keys)) {
            for (const key of keys) this.collect(ATTRIBUTE + key, touched);
          } else {
            this.index.forEach((nodes, key) => {
              if (key[0] === ATTRIBUTE) nodes.forEach((node) => touched.add(node));
            });
          }
        }
        this.update(touched);
      }),
      f.on("datafile_set", (details) => {
        const touched = this.touch([]);
        if (!this.ready) this.collect(STATUS, touched);
        this.ready = true;
        if (details.revisionChanged) this.collect(REVISION, touched);
        for (const key of details.features) this.collect(FEATURE + key, touched);
        for (const key of details.variables) this.collect(VARIABLE + key, touched);
        for (const key of details.segments || []) this.collect(SEGMENT + key, touched);
        this.index.get(UNTRACKED)?.forEach((node) => {
          const follows = node.options.follows;
          if (
            !follows ||
            intersects(follows.features, details.features) ||
            intersects(follows.variables, details.variables)
          ) {
            touched.add(node);
          }
        });
        this.update(touched);
      }),
      f.on("sticky_features_set", ({ features }) => this.sticky(FEATURE, features)),
      f.on("sticky_variables_set", ({ variables }) => this.sticky(VARIABLE, variables)),
    ];
  }

  watch(node: AnyNode): void {
    this.watching++;
    this.attach();
    this.add(node);
  }

  /**
   * Stops listening a microtask after the last value stops watching, so
   * StrictMode and Activity, which stop and start effects at once, do not churn.
   */
  unwatch(node: AnyNode): void {
    this.remove(node);
    if (--this.watching > 0) return;

    Promise.resolve().then(() => {
      if (this.watching > 0 || !this.attached) return;
      this.attached = false;
      for (const stop of this.stop) stop();
      this.stop = [];
      this.changes++;
    });
  }

  /** Indexes a listening value by what its last answer read. */
  add(node: AnyNode): void {
    const keys = keysOf(node);
    node.indexed = keys;
    for (const key of keys) {
      let nodes = this.index.get(key);
      if (!nodes) this.index.set(key, (nodes = new Set()));
      nodes.add(node);
      if (key[0] === ATTRIBUTE) this.attributes++;
    }
  }

  remove(node: AnyNode): void {
    for (const key of node.indexed) {
      const nodes = this.index.get(key);
      if (nodes && nodes.delete(node)) {
        if (key[0] === ATTRIBUTE) this.attributes--;
        if (nodes.size === 0) this.index.delete(key);
      }
    }
    node.indexed = [];
  }

  private sticky(kind: string, keys: readonly string[]): void {
    const touched = this.touch([]);
    if (keys.length > 0) {
      for (const key of keys) this.collect(kind + key, touched);
      // Without reads, any sticky change may reach a value through its dependencies.
      this.collect(UNTRACKED, touched);
    }
    this.update(touched);
  }

  /** Counts a change, and starts the set of values it touches with these index keys. */
  private touch(keys: string[]): Set<AnyNode> {
    this.changes++;
    const touched = new Set<AnyNode>();
    for (const key of keys) this.collect(key, touched);

    return touched;
  }

  private collect(key: string, touched: Set<AnyNode>): void {
    this.index.get(key)?.forEach((node) => touched.add(node));
  }

  /**
   * Asks each touched value again, once all are known, since answering
   * reindexes it, then tells the listeners of those whose answers changed,
   * inside each library's batch.
   */
  private update(touched: Set<AnyNode>): void {
    const batches: Array<[Batch | undefined, AnyNode[]]> = [];
    touched.forEach((node) => {
      if (!node.invalidate()) return;
      const batch = node.options.batch;
      let group = batches.find(([candidate]) => candidate === batch);
      if (!group) batches.push((group = [batch, []]));
      group[1].push(node);
    });

    for (const [batch, nodes] of batches) {
      const run = () => nodes.forEach((node) => node.emit());
      if (batch) batch(run);
      else run();
    }
  }
}

/** A value of one instance: what it computes, what it last read, and who listens. */
export class Node<T> implements Source<T> {
  /** What the last evaluation read, and the index keys the engine filed it under while listening. */
  reads: EvaluationReads | undefined;
  indexed: string[] = [];

  private value: T | undefined;
  private has = false;
  private dirty = false;
  private evaluatedAt = -1;
  private evaluatedAttached = false;
  /**
   * A copy of the context the last answer was for, so a context changed in
   * place and given again still reads as changed. Undefined for one that
   * contains itself, which is then never trusted.
   */
  private lastContext: Context | undefined;
  private listeners: Array<() => void> = [];

  constructor(
    private readonly engine: Engine,
    readonly options: NodeOptions<T>,
  ) {}

  read = (): T => {
    const context = this.options.context();
    const engine = this.engine;

    // A listening value hears about every change. One that is not listening can
    // trust its answer while the instance has not changed since.
    if (
      this.has &&
      !this.dirty &&
      this.lastContext !== undefined &&
      sameValue(context, this.lastContext) &&
      (this.listeners.length > 0 ||
        (engine.attached && this.evaluatedAttached && this.evaluatedAt === engine.changes))
    ) {
      return this.value as T;
    }

    return this.evaluate(context);
  };

  listen = (changed: () => void): (() => void) => {
    const engine = this.engine;
    this.listeners.push(changed);

    if (this.listeners.length === 1) {
      engine.watch(this as AnyNode);

      // A change since the last answer, while nothing listened, would be
      // missed, whether it was heard or the instance was not followed then.
      if (
        this.has &&
        (this.dirty || !this.evaluatedAttached || this.evaluatedAt !== engine.changes)
      ) {
        this.dirty = true;
        Promise.resolve().then(() => {
          if (this.listeners.length > 0 && this.dirty && this.invalidate()) this.emit();
        });
      }
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.splice(this.listeners.indexOf(changed), 1);
      if (this.listeners.length === 0) engine.unwatch(this as AnyNode);
    };
  };

  /**
   * A change touched what the value read. One that nobody listens to answers
   * again when next read. One that is listened to answers again now, and its
   * listeners are told only if the answer differs.
   */
  invalidate(): boolean {
    if (this.listeners.length === 0) {
      this.dirty = true;
      return false;
    }

    const previous = this.value;
    try {
      this.evaluate(this.options.context());
    } catch {
      // The next read throws where the library can report it.
      this.dirty = true;
      return true;
    }

    return !Object.is(previous, this.value);
  }

  emit(): void {
    for (const listener of this.listeners.slice()) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  private evaluate(context: Context): T {
    const engine = this.engine;
    const options = this.options;

    // In a browser, listening from the first read lets an answer be trusted
    // until the instance changes, and covers the moment before a value listens.
    if (!engine.attached && isBrowser()) engine.attach();

    let result: T;
    let reads: EvaluationReads | undefined;
    if (options.precise && engine.track && !options.kind) {
      const tracked = engine.track(() => options.compute(context));
      result = tracked.result;
      reads = tracked.reads;
    } else {
      result = options.compute(context);
    }

    this.lastContext = snapshot(context);
    this.dirty = false;
    this.evaluatedAt = engine.changes;
    this.evaluatedAttached = engine.attached;

    if (!this.has || !options.equals(this.value as T, result)) {
      let kept = result;
      if (options.copy || options.freeze) kept = copyValue(result);
      if (options.freeze) deepFreeze(kept);
      this.value = kept;
      this.has = true;
    }

    this.reads = reads;
    if (this.listeners.length > 0) {
      engine.remove(this as AnyNode);
      engine.add(this as AnyNode);
    }

    return this.value as T;
  }
}
