const cachedMethods = new Set([
  "listSets",
  "listFeatures",
  "listSegments",
  "listAttributes",
  "listFlattenedAttributes",
  "listSchemas",
  "listVariables",
  "listTargets",
  "listTests",
  "listScenarios",
  "listDatafiles",
  "listHistoryEntries",
  "readFeature",
  "readSegment",
  "readAttribute",
  "readSchema",
  "readVariable",
  "readTarget",
  "readTest",
  "readScenario",
  "readState",
  "readRevision",
  "readCommit",
  "featureExists",
  "segmentExists",
  "attributeExists",
  "schemaExists",
  "variableExists",
  "targetExists",
  "scenarioExists",
]);

/**
 * Authored definitions and key lists are copied once, deep frozen and shared by every caller.
 * Builders treat them as input only. Other results, such as allocation state that the
 * builder updates in memory between Targets, stay a private copy for each caller.
 */
const sharedMethods = new Set([
  "listSets",
  "listFeatures",
  "listSegments",
  "listAttributes",
  "listFlattenedAttributes",
  "listSchemas",
  "listVariables",
  "listTargets",
  "listTests",
  "listScenarios",
  "readFeature",
  "readSegment",
  "readAttribute",
  "readSchema",
  "readVariable",
  "readTarget",
  "readTest",
  "readScenario",
]);

/**
 * Whether freezing fully protects a value: only plain objects, arrays and primitives.
 * A frozen Date, Map or Set still changes through its methods, so those are not shared.
 */
function isPlainData(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return typeof value !== "function";
  if (seen.has(value)) return true;
  seen.add(value);
  // Compared structurally, since a copy can come from another realm's Object.prototype.
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null)
    return false;
  return Reflect.ownKeys(value).every((key) =>
    isPlainData((value as Record<PropertyKey, unknown>)[key], seen),
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

/** A shared value: one private copy, frozen so that a mutation throws for every consumer. */
interface Shared<T> {
  shared: true;
  value: T;
}
/** A value that freezing cannot protect, copied again for every caller. */
interface Copied<T> {
  shared: false;
  value: T;
}

function own<T>(value: T, share: boolean): Shared<T> | Copied<T> {
  const copy = structuredClone(value);
  return share && isPlainData(copy)
    ? { shared: true, value: deepFreeze(copy) }
    : { shared: false, value: copy };
}

function hand<T>(owned: Shared<T> | Copied<T>): T {
  return owned.shared ? owned.value : structuredClone(owned.value);
}

/** Definition reads that a watch session may carry over between rebuilds, by entity type. */
const definitionTypes: Record<string, string> = {
  readFeature: "feature",
  readSegment: "segment",
  readAttribute: "attribute",
  readSchema: "schema",
  readVariable: "variable",
  readTarget: "target",
  readTest: "test",
  readScenario: "scenario",
};

/**
 * Parsed definitions kept for a whole watch session, keyed by Set, method and key. An entry
 * is reused only while the datasource reports the same fingerprint for its source, so an
 * edit is re-read and every other definition skips reading and parsing.
 */
export interface CatalogDefinitionCache {
  entries: Map<string, { fingerprint: string; owned: Shared<unknown> | Copied<unknown> }>;
}

export function createCatalogDefinitionCache(): CatalogDefinitionCache {
  return { entries: new Map() };
}

/** Drop every entry read from a path the watcher reported, whatever its fingerprint. */
export function invalidateCatalogDefinitions(cache: CatalogDefinitionCache, paths: string[]) {
  if (!paths.length) return;
  const changed = new Set(paths);
  for (const [id, entry] of cache.entries) {
    if (changed.has(entry.fingerprint.slice(0, entry.fingerprint.indexOf("\0")))) {
      cache.entries.delete(id);
    }
  }
}

type Owned = Shared<unknown> | Copied<unknown>;

type Entry =
  | { kind: "value"; value: Owned }
  | { kind: "promise"; value: Promise<Owned> }
  | { kind: "error"; error: unknown };

interface CacheNode {
  children: Map<unknown, CacheNode>;
  entry?: Entry;
}

async function readDefinition(
  definitions: { cache: CatalogDefinitionCache },
  id: string,
  getFingerprint: () => unknown,
  read: () => unknown,
): Promise<Owned> {
  const fingerprint = await getFingerprint();
  const cached = definitions.cache.entries.get(id);
  if (typeof fingerprint === "string" && cached?.fingerprint === fingerprint) return cached.owned;
  const owned = own(await read(), true);
  if (typeof fingerprint === "string") definitions.cache.entries.set(id, { fingerprint, owned });
  else definitions.cache.entries.delete(id);
  return owned;
}

export interface CatalogSnapshotStats {
  hits: number;
  misses: number;
}

/**
 * Capture Catalog inputs on their first read during one export. Create a fresh
 * snapshot for each export and each set, then share it with the Core builder.
 * This is not an atomic transaction across inputs that have not yet been read.
 *
 * Cached results must support structuredClone. Definitions and key lists made only of
 * plain objects, arrays and primitives are copied once, deep frozen and shared, so a
 * consumer that tries to mutate one gets a TypeError. Other results, including allocation
 * state and values holding a Date, Map or Set, are copied for each caller, including the
 * first. Failures remain cached for this snapshot.
 * Only the explicit Catalog read methods with primitive arguments are cached.
 * Configuration, writes, readDatafile and custom methods remain live. forSet
 * remains live too, so wrap its returned datasource separately.
 *
 * Getters and methods use the original datasource as their receiver, including
 * native private fields and frozen own methods. Method wrappers have stable
 * identity while the underlying method is unchanged. Internal calls on this
 * bypass the cache; only calls through the snapshot capture and clone results.
 * Properties remain live. Reflection exposes configurable descriptors on the
 * facade; redefining its properties, prototype or extensibility is unsupported.
 * Optional counters accumulate cached calls only, including pending and failed
 * reads. Initialise both counters to zero before creating the snapshot.
 */
export function createCatalogSnapshot<T extends object>(
  datasource: T,
  stats?: CatalogSnapshotStats,
  definitions?: { cache: CatalogDefinitionCache; scope: string },
): T {
  const cache = new Map<PropertyKey, CacheNode>();
  const methods = new Map<PropertyKey, { original: Function; wrapped: Function }>();

  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      const method = Reflect.get(datasource, property, datasource);
      if (typeof method !== "function") return method;

      const previous = methods.get(property);
      if (previous?.original === method) return previous.wrapped;

      if (typeof property !== "string" || !cachedMethods.has(property)) {
        const wrapped = (...args: unknown[]) => Reflect.apply(method, datasource, args);
        methods.set(property, { original: method, wrapped });
        return wrapped;
      }

      const shared = sharedMethods.has(property);
      const wrapped = (...args: unknown[]) => {
        // Unknown argument shapes must not accidentally share a cache entry.
        if (
          args.some((arg) => (typeof arg === "object" && arg !== null) || typeof arg === "function")
        ) {
          return Reflect.apply(method, datasource, args);
        }

        let node = cache.get(property);
        if (!node) {
          node = { children: new Map() };
          cache.set(property, node);
        }
        for (const arg of args) {
          let child = node.children.get(arg);
          if (!child) {
            child = { children: new Map() };
            node.children.set(arg, child);
          }
          node = child;
        }

        if (!node.entry) {
          if (stats) stats.misses++;
          const entityType = definitionTypes[property];
          const fingerprint = Reflect.get(datasource, "getEntityFingerprint", datasource);
          if (
            definitions &&
            entityType &&
            args.length === 1 &&
            typeof args[0] === "string" &&
            typeof fingerprint === "function"
          ) {
            node.entry = {
              kind: "promise",
              value: readDefinition(
                definitions,
                `${definitions.scope}\0${property}\0${args[0]}`,
                () => Reflect.apply(fingerprint, datasource, [entityType, args[0]]),
                () => Reflect.apply(method, datasource, args),
              ),
            };
            return node.entry.value.then(hand);
          }
          try {
            const result = Reflect.apply(method, datasource, args);
            if (result != null && typeof result.then === "function") {
              node.entry = {
                kind: "promise",
                value: Promise.resolve(result).then((value) => own(value, shared)),
              };
            } else {
              node.entry = { kind: "value", value: own(result, shared) };
            }
          } catch (error) {
            node.entry = { kind: "error", error };
          }
        } else if (stats) {
          stats.hits++;
        }

        const entry = node.entry;
        if (entry.kind === "error") throw entry.error;
        if (entry.kind === "promise") return entry.value.then(hand);
        return hand(entry.value);
      };
      methods.set(property, { original: method, wrapped });
      return wrapped;
    },
    set: (_target, property, value) => Reflect.set(datasource, property, value, datasource),
    has: (_target, property) => Reflect.has(datasource, property),
    ownKeys: () => Reflect.ownKeys(datasource),
    getPrototypeOf: () => Reflect.getPrototypeOf(datasource),
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(datasource, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    deleteProperty: (_target, property) => Reflect.deleteProperty(datasource, property),
    defineProperty: () => false,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
  });
}

/**
 * Map in input order with at most sixteen active callbacks, stopping on failure.
 * Pass only the item so a datasource read can be supplied directly as the mapper.
 * Active callbacks are not cancelled when another callback fails.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  mapper: (item: T) => R | PromiseLike<R>,
  concurrency = 16,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, 16, items.length) }, worker));
  return results;
}
