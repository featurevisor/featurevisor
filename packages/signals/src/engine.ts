import type {
  EvaluationReads,
  Featurevisor,
  FeaturevisorModuleApi,
  TrackResult,
} from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";

import { copyValue, deepFreeze, isClient, sameValue, snapshot } from "./values.js";

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

/**
 * Runs the engine's work for one library's values together and outside its
 * tracking, such as Preact's `batch` with `untracked`, so a change made inside
 * an effect neither ties that effect to what the values read nor runs it again.
 */
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

type Nodes = Set<AnyNode>;
type Index = Map<string, Nodes>;

/** What the SDK records when a module may have read any attribute. */
const ANY = "*";

/** A context change names top level keys, so attributes are filed by theirs. */
function topKey(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

function file(index: Index, key: string, node: AnyNode): void {
  let nodes = index.get(key);
  if (!nodes) index.set(key, (nodes = new Set()));
  nodes.add(node);
}

function unfile(index: Index, key: string, node: AnyNode): void {
  const nodes = index.get(key);
  if (nodes && nodes.delete(node) && nodes.size === 0) index.delete(key);
}

function collect(nodes: Nodes | undefined, touched: Nodes): void {
  if (nodes) nodes.forEach((node) => touched.add(node));
}

function readsNothing(reads: EvaluationReads): boolean {
  return (
    reads.attributes.length === 0 &&
    reads.segments.length === 0 &&
    reads.features.length === 0 &&
    reads.variables.length === 0
  );
}

function sameList(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

/** Whether two answers read the same, in the same order, as the SDK records an unchanged evaluation. */
function sameReads(
  first: EvaluationReads | undefined,
  second: EvaluationReads | undefined,
): boolean {
  if (!first || !second) return first === second;

  return (
    sameList(first.attributes, second.attributes) &&
    sameList(first.segments, second.segments) &&
    sameList(first.features, second.features) &&
    sameList(first.variables, second.variables)
  );
}

function run(batch: Batch | undefined, work: () => void): void {
  if (batch) batch(work);
  else work();
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
  private stop: Array<() => void> = [];
  // Listening values, filed by what their last answers read, each key as the
  // SDK names it, so filing builds no strings.
  private attributes: Index = new Map();
  private segments: Index = new Map();
  private features: Index = new Map();
  private variables: Index = new Map();
  /** Values a module may have read any attribute for, which every context change touches. */
  private anyAttribute: Nodes = new Set();
  /** Values without reads to go by, which follow every change. */
  private untracked: Nodes = new Set();
  private revision: Nodes = new Set();
  private status: Nodes = new Set();

  constructor(readonly f: Featurevisor) {
    let api: FeaturevisorModuleApi | undefined;
    const instance = f as Partial<Featurevisor>;
    // A frozen module without hooks costs evaluations nothing. It has no name,
    // so two copies of this package on one instance never clash. A child
    // instance has no modules, so its values follow every change, as before.
    if (typeof instance.addModule === "function") {
      instance.addModule(Object.freeze({ setup: (moduleApi) => void (api = moduleApi) }));
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
        const touched = this.touch();
        collect(this.anyAttribute, touched);
        collect(this.untracked, touched);
        // Only an index with attributes in it needs the keys, which the SDK works out when asked.
        if (this.attributes.size > 0) {
          const keys = details.keys;
          if (Array.isArray(keys)) {
            for (const key of keys) collect(this.attributes.get(key), touched);
          } else {
            this.attributes.forEach((nodes) => collect(nodes, touched));
          }
        }
        this.update(touched);
      }),
      f.on("datafile_set", (details) => {
        const touched = this.touch();
        if (!this.ready) collect(this.status, touched);
        this.ready = true;
        if (details.revisionChanged) collect(this.revision, touched);
        for (const key of details.features) collect(this.features.get(key), touched);
        for (const key of details.variables) collect(this.variables.get(key), touched);
        for (const key of details.segments || []) collect(this.segments.get(key), touched);
        this.untracked.forEach((node) => {
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
      f.on("sticky_features_set", ({ features }) => this.sticky(this.features, features)),
      f.on("sticky_variables_set", ({ variables }) => this.sticky(this.variables, variables)),
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

  /** Files a listening value by what its last answer read. */
  add(node: AnyNode): void {
    const kind = node.options.kind;
    const reads = node.reads;
    if (kind || !reads || readsNothing(reads)) {
      // Instance state, or a value without reads to go by, which follows every change.
      const nodes = kind === "revision" ? this.revision : kind ? this.status : this.untracked;
      nodes.add(node);
      node.indexed = nodes;
      return;
    }

    node.indexed = reads;
    for (const path of reads.attributes) {
      if (path === ANY) this.anyAttribute.add(node);
      else file(this.attributes, topKey(path), node);
    }
    for (const key of reads.segments) file(this.segments, key, node);
    for (const key of reads.features) file(this.features, key, node);
    for (const key of reads.variables) file(this.variables, key, node);
  }

  remove(node: AnyNode): void {
    const indexed = node.indexed;
    node.indexed = undefined;
    if (!indexed) return;
    if (indexed instanceof Set) {
      indexed.delete(node);
      return;
    }

    for (const path of indexed.attributes) {
      if (path === ANY) this.anyAttribute.delete(node);
      else unfile(this.attributes, topKey(path), node);
    }
    for (const key of indexed.segments) unfile(this.segments, key, node);
    for (const key of indexed.features) unfile(this.features, key, node);
    for (const key of indexed.variables) unfile(this.variables, key, node);
  }

  private sticky(index: Index, keys: readonly string[]): void {
    const touched = this.touch();
    if (keys.length > 0) {
      for (const key of keys) collect(index.get(key), touched);
      // Without reads, any sticky change may reach a value through its dependencies.
      collect(this.untracked, touched);
    }
    this.update(touched);
  }

  /** Counts a change, and starts the set of values it touches. */
  private touch(): Nodes {
    this.changes++;
    return new Set<AnyNode>();
  }

  /**
   * Asks each touched value again, once all are known, since answering
   * reindexes it. Every value answers before any listener is told, so a
   * listener reading another value sees its new answer. Both steps run inside
   * each library's batch.
   */
  private update(touched: Set<AnyNode>): void {
    const groups: Array<[Batch | undefined, AnyNode[]]> = [];
    touched.forEach((node) => {
      const batch = node.options.batch;
      let group = groups.find(([candidate]) => candidate === batch);
      if (!group) groups.push((group = [batch, []]));
      group[1].push(node);
    });

    const changed = groups.map(([batch, nodes]): AnyNode[] => {
      const answered: AnyNode[] = [];
      run(batch, () => nodes.forEach((node) => node.invalidate() && answered.push(node)));
      return answered;
    });

    groups.forEach(([batch], index) => {
      const nodes = changed[index];
      if (nodes.length > 0) run(batch, () => nodes.forEach((node) => node.emit()));
    });
  }
}

/** A value of one instance: what it computes, what it last read, and who listens. */
export class Node<T> implements Source<T> {
  /** What the last evaluation read, and what the engine filed it by while listening. */
  reads: EvaluationReads | undefined;
  indexed: EvaluationReads | Set<AnyNode> | undefined;

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

    // On a client, listening from the first read lets an answer be trusted
    // until the instance changes, and covers the moment before a value listens,
    // so a value read while rendering does not evaluate again once it listens.
    if (!engine.attached && isClient()) engine.attach();

    // Reads and the context matter only while the engine listens. Without it,
    // as on a server, no answer is trusted, and a value that starts listening
    // asks again, so neither is kept.
    const attached = engine.attached;
    let result: T;
    let reads: EvaluationReads | undefined;
    if (attached && options.precise && engine.track && !options.kind) {
      const tracked = engine.track(() => options.compute(context));
      result = tracked.result;
      reads = tracked.reads;
    } else {
      result = options.compute(context);
    }

    this.lastContext = attached ? snapshot(context) : undefined;
    this.dirty = false;
    this.evaluatedAt = engine.changes;
    this.evaluatedAttached = attached;

    if (!this.has || !options.equals(this.value as T, result)) {
      let kept = result;
      if (options.copy || options.freeze) kept = copyValue(result);
      if (options.freeze) deepFreeze(kept);
      this.value = kept;
      this.has = true;
    }

    // An answer usually reads what the last one did, which keeps its index keys.
    const reindex = !sameReads(this.reads, reads);
    this.reads = reads;
    if (reindex && this.listeners.length > 0) {
      engine.remove(this as AnyNode);
      engine.add(this as AnyNode);
    }

    return this.value as T;
  }
}
