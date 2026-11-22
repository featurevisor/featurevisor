import type { Featurevisor } from "@featurevisor/sdk";
import type {
  Context,
  FeatureKey,
  VariableKey,
  VariableValue,
  VariationValue,
} from "@featurevisor/types";

import { AsyncNode, type AsyncLoad, type AsyncOptions, type AsyncValue } from "./async.js";
import { getEngine, Node, type Batch, type Follows, type Source } from "./engine.js";
import { isDevelopment, mergeContext, sameValue } from "./values.js";

/** Context for a value: an object, or a getter that reads other signals. */
export type ContextSource = Context | (() => Context);

/** Whether the instance has accepted a datafile yet. */
export type InstanceStatus = "pending" | "ready";

/**
 * What each adapter turns a source into, by name. The core's values are plain
 * sources, and each adapter adds its own, such as `preact` for a Preact signal.
 */
export interface Wrapped<T> {
  source: Source<T>;
}

export type WrappedKind = keyof Wrapped<unknown>;

export interface ReaderOptions {
  /**
   * Asks again only when a change touches what the last answer read, the
   * default. Turn it off for an application whose modules read state outside
   * the context, so every value asks again on every change, as before.
   */
  precise?: boolean;
  /**
   * Freezes the values kept and shared between readers, so changing one in
   * place throws where it happens. On by default in development builds only.
   */
  freeze?: boolean;
  /**
   * Gives each value its own copy of what the SDK returned, so changing it in
   * place reaches neither the SDK nor any other value. Framework hooks use it.
   */
  copy?: boolean;
  /**
   * Runs the engine's work together and outside the library's tracking, such
   * as Preact's `batch` with `untracked`. Set by adapters.
   */
  batch?: Batch;
  /**
   * How many ready answers each async value keeps, the most recently used.
   * Every answer by default. An async value's own `keepAnswers` overrides it.
   */
  keepAnswers?: number;
}

export interface FromOptions<T> {
  /** How answers compare. By value by default, so an equal answer keeps the previous one. */
  equals?: (previous: T, next: T) => boolean;
  /** Overrides the reader's `precise` for this value. */
  precise?: boolean;
}

/**
 * Reads an instance as values that update themselves. Each method returns the
 * adapter's own type: a source in the core, a signal in Preact, and so on.
 */
export interface Reader<K extends WrappedKind = "source"> {
  flag(featureKey: FeatureKey, context?: ContextSource): Wrapped<boolean>[K];

  variation<TVariation extends VariationValue = VariationValue>(
    featureKey: FeatureKey,
    context?: ContextSource,
  ): Wrapped<TVariation | null>[K];

  variable<TValue = VariableValue>(
    featureKey: FeatureKey,
    variableKey: VariableKey,
    context?: ContextSource,
  ): Wrapped<TValue | null>[K];
  variable<TValue = VariableValue>(
    variableKey: VariableKey,
    context?: ContextSource,
  ): Wrapped<TValue | null>[K];

  /** One value per feature, in the order of the keys. */
  flags(featureKeys: readonly FeatureKey[], context?: ContextSource): Wrapped<boolean>[K][];

  /** Whether every feature is enabled, evaluated in order and stopping at the first that is not. */
  everyFlag(featureKeys: readonly FeatureKey[], context?: ContextSource): Wrapped<boolean>[K];

  /** Whether any feature is enabled, evaluated in order and stopping at the first that is. */
  someFlag(featureKeys: readonly FeatureKey[], context?: ContextSource): Wrapped<boolean>[K];

  /** The datafile's revision, updating when a datafile brings another. */
  readonly revision: Wrapped<string>[K];

  /** `"pending"` until the instance has accepted a datafile, then `"ready"`. */
  readonly status: Wrapped<InstanceStatus>[K];

  /** A reader whose values all merge `context` under their own, as FeaturevisorScope does. */
  scope(context: ContextSource): Reader<K>;

  /**
   * A value from any function of the effective context, such as a package's
   * getter. It asks again exactly when something its last answer read changes.
   */
  from<T>(
    compute: (context: Context) => T,
    context?: ContextSource,
    options?: FromOptions<T>,
  ): Wrapped<T>[K];

  /**
   * A value a promise away, such as a username check: it waits for a pause,
   * lets the latest input win, keeps answers, and loads nothing on a server.
   */
  async<T, I = unknown>(load: AsyncLoad<T, I>, options: AsyncOptions<I>): Wrapped<AsyncValue<T>>[K];
}

const EMPTY_CONTEXT: Context = {};

interface Settings {
  precise: boolean;
  freeze: boolean;
  copy: boolean;
  batch?: Batch;
  keepAnswers?: number;
}

function flagUntil(
  f: Featurevisor,
  featureKeys: readonly FeatureKey[],
  context: Context,
  stopAt: boolean,
): boolean {
  for (let index = 0; index < featureKeys.length; index++) {
    const featureKey = featureKeys[index];
    // A key listed again was already evaluated and did not stop the loop.
    if (featureKeys.indexOf(featureKey) !== index) continue;
    if (f.isEnabled(featureKey, context) === stopAt) return stopAt;
  }

  return !stopAt;
}

function createScopedReader<K extends WrappedKind>(
  f: Featurevisor,
  wrap: <T>(source: Source<T>) => Wrapped<T>[K],
  settings: Settings,
  scope: (() => Context) | undefined,
): Reader<K> {
  const engine = getEngine(f);

  const contextOf = (own: ContextSource | undefined): (() => Context) => {
    const read = typeof own === "function" ? own : () => own || EMPTY_CONTEXT;

    return scope ? () => mergeContext(scope(), read()) : read;
  };

  const value = <T>(
    compute: (context: Context) => T,
    context: () => Context,
    equals: (previous: T, next: T) => boolean,
    follows?: Follows,
    kind?: "revision" | "status",
    precise = settings.precise,
  ): Wrapped<T>[K] =>
    wrap(
      new Node<T>(engine, {
        compute,
        context,
        equals,
        precise,
        copy: settings.copy,
        freeze: settings.freeze,
        batch: settings.batch,
        follows,
        kind,
      }),
    );

  let revision: Wrapped<string>[K] | undefined;
  let status: Wrapped<InstanceStatus>[K] | undefined;

  const reader: Reader<K> = {
    flag: (featureKey, context) =>
      value((merged) => f.isEnabled(featureKey, merged), contextOf(context), Object.is, {
        features: [featureKey],
      }),

    variation: <TVariation extends VariationValue = VariationValue>(
      featureKey: FeatureKey,
      context?: ContextSource,
    ) =>
      value<TVariation | null>(
        (merged) => f.getVariation<TVariation>(featureKey, merged),
        contextOf(context),
        Object.is,
        { features: [featureKey] },
      ),

    variable: <TValue = VariableValue>(
      featureKeyOrVariableKey: string,
      variableKeyOrContext?: string | ContextSource,
      context?: ContextSource,
    ) => {
      // Keys are plain strings, so a second argument that is not one is the context.
      if (typeof variableKeyOrContext === "string") {
        const variableKey = variableKeyOrContext;

        return value<TValue | null>(
          (merged) => f.getVariable<TValue>(featureKeyOrVariableKey, variableKey, merged),
          contextOf(context),
          sameValue,
          { features: [featureKeyOrVariableKey] },
        );
      }

      return value<TValue | null>(
        (merged) => f.getVariable<TValue>(featureKeyOrVariableKey, merged),
        contextOf(variableKeyOrContext),
        sameValue,
        { variables: [featureKeyOrVariableKey] },
      );
    },

    flags: (featureKeys, context) =>
      featureKeys.map((featureKey) => reader.flag(featureKey, context)),

    everyFlag: (featureKeys, context) => {
      const keys = featureKeys.slice();

      return value((merged) => flagUntil(f, keys, merged, false), contextOf(context), Object.is, {
        features: keys,
      });
    },

    someFlag: (featureKeys, context) => {
      const keys = featureKeys.slice();

      return value((merged) => flagUntil(f, keys, merged, true), contextOf(context), Object.is, {
        features: keys,
      });
    },

    get revision() {
      return (
        revision ||
        (revision = value(
          () => f.getRevision(),
          contextOf(undefined),
          Object.is,
          undefined,
          "revision",
        ))
      );
    },

    get status() {
      return (
        status ||
        (status = value<InstanceStatus>(
          () => (engine.ready ? "ready" : "pending"),
          contextOf(undefined),
          Object.is,
          undefined,
          "status",
        ))
      );
    },

    scope: (context) => createScopedReader(f, wrap, settings, contextOf(context)),

    from: <T>(
      compute: (context: Context) => T,
      context?: ContextSource,
      options: FromOptions<T> = {},
    ) =>
      value<T>(
        compute,
        contextOf(context),
        options.equals || sameValue,
        undefined,
        undefined,
        options.precise === undefined ? settings.precise : options.precise,
      ),

    async: <T, I = unknown>(load: AsyncLoad<T, I>, options: AsyncOptions<I>) =>
      wrap(new AsyncNode<T, I>(load, options, settings.batch, settings.keepAnswers)),
  };

  return reader;
}

/**
 * Builds a reader for an instance, turning each source into a library's own
 * type through `wrap`. Adapters call it, and so can a library without one.
 */
export function createReader<K extends WrappedKind>(
  f: Featurevisor,
  wrap: <T>(source: Source<T>) => Wrapped<T>[K],
  options: ReaderOptions = {},
): Reader<K> {
  const settings: Settings = {
    precise: options.precise !== false,
    freeze: options.freeze === undefined ? isDevelopment() && !options.copy : options.freeze,
    copy: options.copy === true,
    batch: options.batch,
    keepAnswers: options.keepAnswers,
  };

  return createScopedReader(f, wrap, settings, undefined);
}

/** A reader whose values are plain sources, for any library or for plain code. */
export function createSignals(f: Featurevisor, options: ReaderOptions = {}): Reader<"source"> {
  return createReader<"source">(f, (source) => source, options);
}
