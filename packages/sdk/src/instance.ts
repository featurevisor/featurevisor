import { mergeContext } from "./context.js";
import type {
  Context,
  Feature,
  FeatureKey,
  Segment,
  SegmentKey,
  StickyFeatures,
  EvaluatedFeatures,
  EvaluatedFeature,
  VariableValue,
  VariationValue,
  VariableKey,
  DatafileContent,
  DatafileVariable,
  Traffic,
  ObjectValue,
  Condition,
  Conditions,
  VariableCondition,
  StickyVariables,
  EvaluatedVariables,
} from "@featurevisor/types";

import type {
  FeaturevisorModule,
  FeaturevisorModuleApi,
  FeaturevisorModuleUnsubscribe,
} from "./modules.js";
import { evaluateWithModules, beforeEvaluation, afterEvaluation } from "./evaluate.js";
import type {
  Evaluation,
  EvaluateDependencies,
  ForceResult,
  VariableEvaluateOptions,
} from "./evaluate.js";
import { FeaturevisorChildInstance } from "./child.js";
import { applyVariableOperations, copyVariableObject } from "./mutations.js";
import type { EventCallback, EventDetailsByName, EventName } from "./events.js";
import { allConditionsAreMatched, valueIsMatched } from "./conditions.js";
import type {
  FeaturevisorDiagnostic,
  FeaturevisorDiagnosticHandler,
  FeaturevisorLogLevel,
  FeaturevisorModuleDiagnosticOptions,
  FeaturevisorModuleReportedDiagnostic,
} from "./diagnostics.js";
import {
  FEATUREVISOR_DIAGNOSTIC_PREFIX,
  getConsoleMethodForDiagnostic,
  shouldLog,
} from "./diagnostics.js";
import {
  addDatafileDependencyChanges,
  createDatafileDependencyIndex,
  type DatafileDependencyIndex,
} from "./dependencies.js";
import { getValueByType, type VariableGetter } from "./variable.js";
import { getStickyChangeKeys } from "./keys.js";
import { matchGroup } from "./groups.js";
import {
  entityKinds,
  invalidConditions,
  normalizeDatafile,
  normalizeEntity,
  type DatafileEntity,
} from "./normalize.js";
import {
  beginEvaluation,
  endEvaluation,
  inheritEvaluation,
  evaluateDependency,
  trackEvaluationState,
  refreshEvaluationState,
  type StickyState,
  DependencyError,
  evaluateSegment,
} from "./session.js";

const emptyDatafile: DatafileContent = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
  variables: {},
};

function hasOwn(value: object, key: string | number): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Traverse compiled variable paths consistently in evaluations and CLI probes.
 * @internal Shared with the CLI, not a supported application API.
 */
export function getRequiredVariableValueAtPath(
  value: unknown,
  path: string | (string | number)[],
): unknown {
  if (!Array.isArray(path)) throw new Error("Variable requirement path must be compiled");
  for (const part of path) {
    if (part === "__proto__" || part === "prototype" || part === "constructor")
      throw new Error("Unsafe variable requirement path");
    value =
      value !== null &&
      typeof value === "object" &&
      (typeof part !== "number" || (Array.isArray(value) && Number.isInteger(part) && part >= 0)) &&
      hasOwn(value, part)
        ? (value as Record<string | number, unknown>)[part]
        : undefined;
  }
  return value;
}

function createLookup<TValue>(): Record<string, TValue> {
  return Object.create(null) as Record<string, TValue>;
}

function mergeLookup<TValue>(
  previous: Record<string, TValue> | undefined,
  next: Record<string, TValue>,
): Record<string, TValue> {
  return Object.assign(createLookup<TValue>(), previous, next);
}

function assertDatafileContent(datafile: unknown): asserts datafile is DatafileContent {
  if (
    typeof datafile !== "object" ||
    datafile === null ||
    typeof (datafile as DatafileContent).schemaVersion !== "string" ||
    typeof (datafile as DatafileContent).revision !== "string" ||
    typeof (datafile as DatafileContent).segments !== "object" ||
    (datafile as DatafileContent).segments === null ||
    typeof (datafile as DatafileContent).features !== "object" ||
    (datafile as DatafileContent).features === null
  ) {
    throw new Error("Invalid datafile");
  }
}

function mergeStoredDatafile(
  existing: DatafileContent,
  incoming: DatafileContent,
): DatafileContent {
  return {
    schemaVersion: incoming.schemaVersion,
    revision: incoming.revision,
    featurevisorVersion: incoming.featurevisorVersion,
    segments: mergeLookup(existing.segments, incoming.segments),
    features: mergeLookup(existing.features, incoming.features),
    variables: mergeLookup(existing.variables, incoming.variables || {}),
  };
}

function isEmptyLookup(value: object): boolean {
  for (const key in value) if (hasOwn(value, key)) return false;
  return true;
}

function getChangedEntityKeys(
  previous: Record<string, { hash?: string }>,
  next: Record<string, { hash?: string }>,
): string[] {
  if (isEmptyLookup(previous)) return Object.keys(next);
  const keys: string[] = [];
  for (const key of Object.keys(previous)) {
    if (
      !hasOwn(next, key) ||
      !previous[key]?.hash ||
      !next[key]?.hash ||
      previous[key].hash !== next[key].hash
    ) {
      keys.push(key);
    }
  }
  for (const key of Object.keys(next)) {
    if (!hasOwn(previous, key)) keys.push(key);
  }
  return keys;
}

function getDatafileSetEventDetails(
  previousDatafile: DatafileContent,
  newDatafile: DatafileContent,
  replace = false,
) {
  const previousRevision = previousDatafile.revision;
  const newRevision = newDatafile.revision;

  return {
    revision: newRevision,
    previousRevision,
    revisionChanged: previousRevision !== newRevision,
    features: getChangedEntityKeys(previousDatafile.features, newDatafile.features),
    variables: getChangedEntityKeys(previousDatafile.variables || {}, newDatafile.variables || {}),
    replaced: replace,
  };
}

function hasUnreportedKey(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  reported: string[],
) {
  const reportedKeys = new Set(reported);

  return (
    Object.keys(previous).some((key) => !reportedKeys.has(key)) ||
    Object.keys(next).some((key) => !reportedKeys.has(key))
  );
}

export interface OverrideOptions {
  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface SpawnOptions {
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
}

interface InternalOverrideOptions extends OverrideOptions {
  __featurevisorChildStickyFeatures?: StickyFeatures;
  __featurevisorChildStickyVariables?: StickyVariables;
  __featurevisorReadStickyState?: () => StickyState;
}

export interface FeaturevisorOptions {
  datafile?: DatafileContent | string;
  context?: Context;
  logLevel?: FeaturevisorLogLevel;
  onDiagnostic?: FeaturevisorDiagnosticHandler;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  modules?: FeaturevisorModule[];
}

interface FeaturevisorModuleDiagnosticSubscription {
  module: FeaturevisorModule;
  handler: FeaturevisorDiagnosticHandler;
  logLevel: FeaturevisorLogLevel;
}

type Listeners = {
  [TEventName in EventName]?: EventCallback<TEventName>[];
};

type InstanceEvaluationDataProvider = EvaluateDependencies["datafile"];

export class Featurevisor {
  // from options
  private context: Context = {};
  private logLevel: FeaturevisorLogLevel = "info";
  private onDiagnostic?: FeaturevisorDiagnosticHandler;
  private stickyFeatures?: StickyFeatures;
  private stickyVariables?: StickyVariables;

  // internally created
  private datafile: DatafileContent = emptyDatafile;
  private normalized: Array<Record<string, DatafileEntity>> = [];
  private dependencyIndex?: DatafileDependencyIndex;
  private evaluationGeneration = 0;
  private regexCache: Record<string, RegExp> = {};
  private attributeConditions = new WeakMap<object, boolean>();
  private modules: FeaturevisorModule[] = [];
  private moduleDiagnosticSubscriptions: FeaturevisorModuleDiagnosticSubscription[] = [];
  private listeners: Listeners = {};
  private closed = false;

  constructor(options: FeaturevisorOptions) {
    // from options
    this.context = options.context || {};
    this.logLevel = options.logLevel || "info";
    this.onDiagnostic = options.onDiagnostic;
    this.stickyFeatures = options.stickyFeatures;
    this.stickyVariables = options.stickyVariables;

    (options.modules || []).forEach((module) => {
      this.addModule(module);
    });

    if (options.datafile) {
      this.setDatafile(options.datafile, true);
    }

    this.reportDiagnostic({
      level: "info",
      code: "sdk_initialized",
      message: "SDK initialized",
      details: {},
    });
  }

  setLogLevel(level: FeaturevisorLogLevel) {
    this.logLevel = level;
  }

  setDatafile(datafile: DatafileContent | string, replace = false): boolean {
    if (this.closed) {
      return false;
    }

    try {
      const incoming = typeof datafile === "string" ? JSON.parse(datafile) : datafile;
      assertDatafileContent(incoming);
      const diagnostics: FeaturevisorDiagnostic[] = [];
      const resolvedDatafile =
        incoming.schemaVersion === "2"
          ? normalizeDatafile(incoming, (diagnostic) => diagnostics.push(diagnostic))
          : incoming;

      const storedDatafile = replace
        ? resolvedDatafile
        : mergeStoredDatafile(this.datafile, resolvedDatafile);
      const details = getDatafileSetEventDetails(this.datafile, storedDatafile, replace);
      const segmentKeys = replace
        ? Object.keys(this.datafile.segments).concat(Object.keys(storedDatafile.segments))
        : Object.keys(resolvedDatafile.segments);
      // The first datafile reports every entity, so it needs no comparisons or
      // dependency index. The index is built on demand by the next update.
      const previousIsEmpty =
        isEmptyLookup(this.datafile.features) &&
        isEmptyLookup(this.datafile.variables || {}) &&
        isEmptyLookup(this.datafile.segments);
      const changedSegments = previousIsEmpty
        ? segmentKeys
        : segmentKeys.filter((segmentKey) => {
            const previousSegment = hasOwn(this.datafile.segments, segmentKey)
              ? this.datafile.segments[segmentKey]
              : undefined;
            const nextSegment = hasOwn(storedDatafile.segments, segmentKey)
              ? storedDatafile.segments[segmentKey]
              : undefined;
            return JSON.stringify(previousSegment) !== JSON.stringify(nextSegment);
          });

      if (previousIsEmpty) {
        this.dependencyIndex = undefined;
      } else if (!replace) {
        const hasFeatureDefinitions = Object.keys(resolvedDatafile.features).length > 0;
        const hasVariableDefinitions = Object.keys(resolvedDatafile.variables || {}).length > 0;
        const hasUnreportedDefinitions =
          (hasFeatureDefinitions &&
            hasUnreportedKey({}, resolvedDatafile.features, details.features)) ||
          (hasVariableDefinitions &&
            hasUnreportedKey({}, resolvedDatafile.variables || {}, details.variables));

        if (
          details.features.length > 0 ||
          details.variables.length > 0 ||
          changedSegments.length > 0
        ) {
          if (hasUnreportedDefinitions) {
            addDatafileDependencyChanges(
              details.features,
              details.variables,
              changedSegments,
              this.dependencyIndex || createDatafileDependencyIndex(this.datafile),
            );
          }
          // Segment updates can change edges even without incoming getter definitions.
          this.dependencyIndex = createDatafileDependencyIndex(storedDatafile);
          addDatafileDependencyChanges(
            details.features,
            details.variables,
            changedSegments,
            this.dependencyIndex,
          );
        } else if (hasFeatureDefinitions || hasVariableDefinitions) {
          this.dependencyIndex = undefined;
        }
      } else if (
        details.features.length > 0 ||
        details.variables.length > 0 ||
        changedSegments.length > 0
      ) {
        if (
          hasUnreportedKey(this.datafile.features, storedDatafile.features, details.features) ||
          hasUnreportedKey(
            this.datafile.variables || {},
            storedDatafile.variables || {},
            details.variables,
          )
        ) {
          const previousIndex =
            this.dependencyIndex || createDatafileDependencyIndex(this.datafile);
          const nextIndex = createDatafileDependencyIndex(storedDatafile);
          addDatafileDependencyChanges(
            details.features,
            details.variables,
            changedSegments,
            previousIndex,
          );
          addDatafileDependencyChanges(
            details.features,
            details.variables,
            changedSegments,
            nextIndex,
          );
        }
        this.dependencyIndex = undefined;
      } else {
        this.dependencyIndex = undefined;
      }

      if (replace) {
        this.normalized = [];
      } else {
        for (let kind = 0; kind < 3; kind++) {
          for (const key of Object.keys(incoming[entityKinds[kind]] || {})) {
            if (this.normalized[kind]) delete this.normalized[kind][key];
          }
        }
      }
      this.datafile = storedDatafile;
      this.evaluationGeneration++;
      this.regexCache = {};

      // Report after storage so callbacks can read the newly accepted datafile.
      for (const diagnostic of diagnostics) this.reportDiagnostic(diagnostic);

      this.reportDiagnostic({
        level: "info",
        code: "datafile_set",
        message: "Datafile set",
        details,
      });
      this.trigger("datafile_set", details);
      return true;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "invalid_datafile",
        message: "Could not parse datafile",
        originalError: e,
        details: {},
      });
      return false;
    }
  }

  setStickyFeatures(stickyFeatures: StickyFeatures, replace = false) {
    if (this.closed) {
      return;
    }

    const previousStickyFeatures = this.stickyFeatures || {};
    this.stickyFeatures = mergeLookup(replace ? undefined : this.stickyFeatures, stickyFeatures);
    this.evaluationGeneration++;

    const details = {
      features: getStickyChangeKeys(previousStickyFeatures, this.stickyFeatures),
      replaced: replace,
    };

    this.reportDiagnostic({
      level: "info",
      code: "sticky_features_set",
      message: "Sticky features set",
      details,
    });
    this.trigger("sticky_features_set", details);
  }

  setStickyVariables(stickyVariables: StickyVariables, replace = false) {
    if (this.closed) return;

    const previousStickyVariables = this.stickyVariables || {};
    this.stickyVariables = mergeLookup(replace ? undefined : this.stickyVariables, stickyVariables);
    this.evaluationGeneration++;
    const details = {
      variables: getStickyChangeKeys(previousStickyVariables, this.stickyVariables),
      replaced: replace,
    };

    this.reportDiagnostic({
      level: "info",
      code: "sticky_variables_set",
      message: "Sticky variables set",
      details,
    });
    this.trigger("sticky_variables_set", details);
  }

  getRevision(): string {
    return this.datafile.revision;
  }

  getSchemaVersion(): string {
    return this.datafile.schemaVersion;
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    return this.readEntity(1, segmentKey) as Segment | undefined;
  }

  getFeature(featureKey: string): Feature | undefined {
    return this.readEntity(0, featureKey) as Feature | undefined;
  }

  private readEntity(kind: number, key: string): DatafileEntity | undefined {
    const cache = this.normalized[kind] || (this.normalized[kind] = createLookup());
    const cached = cache[key];
    if (cached) return cached;
    const definitions = this.datafile[entityKinds[kind]];
    if (!definitions || !hasOwn(definitions, key)) return undefined;
    const result = normalizeEntity(kind, key, definitions[key]);
    // Cache before callbacks so diagnostic handlers can safely reenter getters.
    cache[key] = result.value;
    for (const diagnostic of result.errors || []) this.reportDiagnostic(diagnostic);
    return result.value;
  }

  getFeatureKeys(): string[] {
    return Object.keys(this.datafile.features);
  }

  /** Returns global variable keys when called without a feature key. */
  getVariableKeys(): VariableKey[];
  /** Returns the variable keys owned by a feature. */
  getVariableKeys(featureKey: FeatureKey): VariableKey[];
  getVariableKeys(featureKey?: FeatureKey): string[] {
    if (typeof featureKey === "undefined") {
      return Object.keys(this.datafile.variables || {});
    }

    const feature = this.getFeature(featureKey);

    if (!feature) {
      return [];
    }

    return Object.keys(feature.variablesSchema || {});
  }

  hasVariations(featureKey: FeatureKey): boolean {
    const feature = this.getFeature(featureKey);

    if (!feature) {
      return false;
    }

    return Array.isArray(feature.variations) && feature.variations.length > 0;
  }

  private getRegex(regexString: string, regexFlags?: string): RegExp {
    const flags = regexFlags || "";
    const cacheKey = `${regexString}-${flags}`;

    if (this.regexCache[cacheKey]) {
      return this.regexCache[cacheKey];
    }

    const regex = new RegExp(regexString, flags);
    this.regexCache[cacheKey] = regex;

    return regex;
  }

  private allConditionsAreMatched(conditions: Condition[] | Condition, context: Context): boolean {
    return allConditionsAreMatched(
      conditions,
      context,
      (regexString, regexFlags) => this.getRegex(regexString, regexFlags),
      this.reportDiagnostic,
    );
  }

  private isAttributeOnly(conditions: Conditions): boolean {
    if (typeof conditions !== "object" || conditions === null) return false;
    const cached = this.attributeConditions.get(conditions);
    if (cached !== undefined) return cached;
    const result =
      "attribute" in conditions ||
      ((Array.isArray(conditions)
        ? conditions
        : "and" in conditions
          ? conditions.and
          : "or" in conditions
            ? conditions.or
            : "not" in conditions
              ? conditions.not
              : []
      ).every((condition) => this.isAttributeOnly(condition)) &&
        !("feature" in conditions || "variable" in conditions));
    this.attributeConditions.set(conditions, result);
    return result;
  }

  private conditionsAreMatched(
    conditions: Conditions,
    dependencies: EvaluateDependencies,
  ): boolean {
    try {
      return this.matchConditions(conditions, dependencies);
    } catch (error) {
      if (error === invalidConditions) return false;
      throw error;
    }
  }

  private matchConditions(conditions: Conditions, dependencies: EvaluateDependencies): boolean {
    if (conditions === invalidConditions) throw invalidConditions;
    if (conditions === "*") return true;
    if (!conditions) return false;
    if (typeof conditions === "string") {
      const segment = this.getSegment(conditions);
      if (segment?.conditions === invalidConditions) throw invalidConditions;
      if (segment && this.isAttributeOnly(segment.conditions))
        return this.allConditionsAreMatched(segment.conditions, dependencies.context);
      return (
        !!segment &&
        evaluateSegment(dependencies, conditions, () =>
          this.matchConditions(segment.conditions, dependencies),
        )
      );
    }
    // Attribute expressions never allocate or enter the dependency session.
    if (this.isAttributeOnly(conditions))
      return this.allConditionsAreMatched(conditions, dependencies.context);
    if ("variable" in conditions) {
      try {
        let value: unknown = this.evaluateRequiredVariable(conditions, dependencies);
        if (conditions.path !== undefined)
          value = getRequiredVariableValueAtPath(value, conditions.path);
        return valueIsMatched(value, conditions, (pattern, flags) => this.getRegex(pattern, flags));
      } catch (error) {
        throw error instanceof DependencyError ? error : new DependencyError(String(error));
      }
    }
    if ("feature" in conditions) {
      const enabled =
        this.evaluateRequiredFeature("flag", conditions.feature, dependencies).enabled === true;
      if (enabled !== (conditions.enabled ?? true)) return false;
      return (
        conditions.variation === undefined ||
        this.evaluateRequiredFeature("variation", conditions.feature, dependencies)
          .variationValue === conditions.variation
      );
    }
    return matchGroup(
      conditions as Condition[] | { and?: Condition[]; or?: Condition[]; not?: Condition[] },
      (condition: Condition) => this.matchConditions(condition, dependencies),
    );
  }

  private getMatchedTraffic(
    traffic: Traffic[],
    dependencies: EvaluateDependencies,
  ): Traffic | undefined {
    return traffic.find(
      (t) => t.conditions !== undefined && this.conditionsAreMatched(t.conditions, dependencies),
    );
  }

  private getMatchedForce(
    featureKey: FeatureKey | Feature,
    dependencies: EvaluateDependencies,
  ): ForceResult {
    const result: ForceResult = {
      force: undefined,
      forceIndex: undefined,
    };

    const feature = typeof featureKey === "string" ? this.getFeature(featureKey) : featureKey;

    if (!feature || !feature.force) {
      return result;
    }

    for (let i = 0; i < feature.force.length; i++) {
      const currentForce = feature.force[i];

      if (
        currentForce.conditions &&
        this.conditionsAreMatched(currentForce.conditions, dependencies)
      ) {
        result.force = currentForce;
        result.forceIndex = i;
        break;
      }
    }

    return result;
  }

  private async closeModule(module: FeaturevisorModule): Promise<void> {
    try {
      await module.close?.();
    } catch (error) {
      this.reportDiagnostic({
        level: "error",
        code: "module_close_error",
        message: "Module close failed",
        moduleName: module.name,
        originalError: error,
        details: {},
      });
    }
  }

  addModule(module: FeaturevisorModule): FeaturevisorModuleUnsubscribe | undefined {
    if (this.closed) {
      return;
    }

    if (module.name && this.modules.some((existingModule) => existingModule.name === module.name)) {
      this.reportDiagnostic({
        level: "error",
        code: "duplicate_module",
        message: "Duplicate module name",
        moduleName: module.name,
        details: {},
      });

      return;
    }

    try {
      module.setup?.(this.getModuleApi(module));
    } catch (error) {
      this.clearModuleDiagnosticSubscriptions(module);
      this.reportDiagnostic({
        level: "error",
        code: "module_setup_error",
        message: "Module setup failed",
        moduleName: module.name,
        originalError: error,
        details: {},
      });
      void this.closeModule(module);

      return;
    }
    this.modules = this.modules.concat(module);
    this.evaluationGeneration++;

    return async () => {
      const moduleExists = this.modules.indexOf(module) !== -1;
      this.modules = this.modules.filter((existingModule) => existingModule !== module);
      this.evaluationGeneration++;
      this.clearModuleDiagnosticSubscriptions(module);

      if (moduleExists) {
        await this.closeModule(module);
      }
    };
  }

  async removeModule(name: string): Promise<void> {
    if (this.closed) {
      return;
    }

    const removedModules = this.modules.filter((module) => module.name === name);

    this.modules = this.modules.filter((module) => module.name !== name);
    this.evaluationGeneration++;
    for (const module of removedModules) {
      this.clearModuleDiagnosticSubscriptions(module);
      await this.closeModule(module);
    }
  }

  on<TEventName extends EventName>(
    eventName: TEventName,
    callback: EventCallback<TEventName>,
  ): () => void {
    if (this.closed) {
      return () => {};
    }

    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }

    const listeners = this.listeners[eventName] as EventCallback<TEventName>[];
    listeners.push(callback);

    let isActive = true;

    return function unsubscribe() {
      if (!isActive) {
        return;
      }

      isActive = false;

      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  private trigger<TEventName extends EventName>(
    eventName: TEventName,
    details: EventDetailsByName[TEventName],
  ) {
    const listeners = this.listeners[eventName];

    if (!listeners) {
      return;
    }

    listeners.slice().forEach(function (listener) {
      try {
        listener(details as never);
      } catch (err) {
        console.error(err);
      }
    });
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.evaluationGeneration++;
    const modules = this.modules.slice();
    this.modules = [];

    for (const module of modules) {
      this.clearModuleDiagnosticSubscriptions(module);
      await this.closeModule(module);
    }

    this.moduleDiagnosticSubscriptions = [];
    this.listeners = {};
    this.dependencyIndex = undefined;
  }

  private reportDiagnostic = (
    diagnostic: FeaturevisorDiagnostic,
    sourceModule?: FeaturevisorModule,
  ): void => {
    const normalizedDiagnostic: FeaturevisorDiagnostic = {
      ...diagnostic,
      details: diagnostic.details || {},
    };
    if (normalizedDiagnostic.module === undefined) {
      delete normalizedDiagnostic.module;
    }
    if (normalizedDiagnostic.moduleName === undefined) {
      delete normalizedDiagnostic.moduleName;
    }
    if (normalizedDiagnostic.originalError === undefined) {
      delete normalizedDiagnostic.originalError;
    }

    this.moduleDiagnosticSubscriptions.slice().forEach((subscription) => {
      if (subscription.module === sourceModule) {
        return;
      }

      if (!shouldLog(subscription.logLevel, normalizedDiagnostic.level)) {
        return;
      }

      try {
        subscription.handler(normalizedDiagnostic);
      } catch (error) {
        console.error(FEATUREVISOR_DIAGNOSTIC_PREFIX, "Diagnostic handler failed", error);
      }
    });

    if (shouldLog(this.logLevel, normalizedDiagnostic.level)) {
      if (this.onDiagnostic) {
        try {
          this.onDiagnostic(normalizedDiagnostic);
        } catch (error) {
          console.error(FEATUREVISOR_DIAGNOSTIC_PREFIX, "Diagnostic handler failed", error);
        }
      } else {
        const method = getConsoleMethodForDiagnostic(normalizedDiagnostic.level);
        console[method](
          FEATUREVISOR_DIAGNOSTIC_PREFIX,
          normalizedDiagnostic.message,
          normalizedDiagnostic,
        );
      }
    }

    if (normalizedDiagnostic.level === "error") {
      this.trigger("error", { diagnostic: normalizedDiagnostic });
    }
  };

  private getModuleApi = (module: FeaturevisorModule): FeaturevisorModuleApi => {
    const onDiagnostic = (
      handler: FeaturevisorDiagnosticHandler,
      options: FeaturevisorModuleDiagnosticOptions = {},
    ) => {
      const subscription: FeaturevisorModuleDiagnosticSubscription = {
        module,
        handler,
        logLevel: options.logLevel || "info",
      };

      this.moduleDiagnosticSubscriptions.push(subscription);

      return () => {
        this.moduleDiagnosticSubscriptions = this.moduleDiagnosticSubscriptions.filter(
          (currentSubscription) => currentSubscription !== subscription,
        );
      };
    };

    const reportDiagnostic = (diagnostic: FeaturevisorModuleReportedDiagnostic) => {
      const moduleDiagnostic: FeaturevisorDiagnostic = {
        ...diagnostic,
        details: diagnostic.details || {},
      };

      if (module.name) {
        moduleDiagnostic.module = module.name;
      }

      this.reportDiagnostic(moduleDiagnostic, module);
    };

    return {
      getRevision: () => this.getRevision(),
      onDiagnostic,
      reportDiagnostic,
    };
  };

  private clearModuleDiagnosticSubscriptions = (module: FeaturevisorModule): void => {
    this.moduleDiagnosticSubscriptions = this.moduleDiagnosticSubscriptions.filter(
      (subscription) => subscription.module !== module,
    );
  };

  /**
   * Context
   */
  setContext(context: Context, replace = false) {
    if (this.closed) {
      return;
    }

    if (replace) {
      this.context = context;
    } else {
      this.context = mergeContext(this.context, context);
    }
    this.evaluationGeneration++;

    this.trigger("context_set", {
      context: this.context,
      replaced: replace,
    });
    this.reportDiagnostic({
      level: "debug",
      code: "context_set",
      message: replace ? "Context replaced" : "Context updated",
      details: {
        context: this.context,
        replaced: replace,
      },
    });
  }

  getContext(context?: Context): Context {
    return context ? mergeContext(this.context, context) : this.context;
  }

  spawn(context: Context = {}, options: SpawnOptions = {}): FeaturevisorChildInstance {
    return new FeaturevisorChildInstance({
      parent: this,
      context: this.getContext(context),
      stickyFeatures: options.stickyFeatures,
      stickyVariables: options.stickyVariables,
    });
  }

  /**
   * Flag
   */
  private getEvaluationDependencies<
    T extends {
      type: "flag" | "variation" | "variable";
      featureKey?: string;
      variableKey?: string;
    },
  >(context: Context, options: InternalOverrideOptions = {}, params: T): EvaluateDependencies & T {
    const dependencies = Object.assign(
      {
        context: this.getContext(context),

        reportDiagnostic: this.reportDiagnostic,
        modules: this.modules,
        // The evaluator only needs this small datafile/matching adapter shape.
        // The methods are private on the instance, so TypeScript needs this
        // internal cast; avoid widening these helpers into public instance APIs.
        datafile: this as unknown as InstanceEvaluationDataProvider,

        stickyFeatures: options.__featurevisorChildStickyFeatures || this.stickyFeatures,
        stickyVariables: options.__featurevisorChildStickyVariables || this.stickyVariables,
        defaultVariationValue: options.defaultVariationValue,
        defaultVariableValue: options.defaultVariableValue,
      },
      params,
    );
    return this.modules.length || this.onDiagnostic
      ? trackEvaluationState(
          dependencies,
          options.__featurevisorReadStickyState || this.readStickyState,
        )
      : dependencies;
  }

  private readStickyState = (): StickyState => ({
    stickyFeatures: this.stickyFeatures,
    stickyVariables: this.stickyVariables,
  });

  private evaluateRequiredFeature(
    type: "flag" | "variation",
    featureKey: FeatureKey,
    dependencies: EvaluateDependencies,
    borrowed = false,
  ): Evaluation {
    const options = Object.assign({}, dependencies, {
      type,
      featureKey,
      variableKey: undefined,
      modules: this.modules,
      defaultVariableValue: undefined,
      defaultVariationValue: undefined,
    });
    return evaluateDependency(
      dependencies,
      options,
      () => this.evaluationGeneration,
      () => {
        const evaluation = evaluateWithModules(options);
        if (evaluation.error instanceof DependencyError) throw evaluation.error;
        return {
          type,
          featureKey,
          reason: evaluation.reason,
          enabled: evaluation.enabled === true,
          variationValue:
            typeof evaluation.variationValue !== "undefined"
              ? evaluation.variationValue
              : evaluation.variation?.value,
        };
      },
      borrowed,
    );
  }

  private evaluateRequiredVariable(
    required: Pick<VariableCondition, "feature" | "variable">,
    dependencies: EvaluateDependencies,
    borrowed = false,
  ): VariableValue | null {
    const options = Object.assign({}, dependencies, {
      type: "variable" as const,
      featureKey: required.feature,
      variableKey: required.variable,
      modules: this.modules,
      defaultVariableValue: undefined,
      defaultVariationValue: undefined,
    });
    return evaluateDependency(
      dependencies,
      options,
      () => this.evaluationGeneration,
      () => {
        const evaluation =
          required.feature === undefined
            ? this.evaluateVariableWithoutFeature(options)
            : evaluateWithModules(options as typeof options & { featureKey: FeatureKey });
        if (evaluation.error instanceof DependencyError) throw evaluation.error;
        const value = evaluation.variableValue;
        if (value === undefined) return null;
        if (
          (evaluation.variableSchema?.type === "json" || evaluation.variable?.type === "json") &&
          typeof value === "string" &&
          !evaluation.variable?.compose
        ) {
          try {
            return JSON.parse(value) as VariableValue;
          } catch (error) {
            this.reportDiagnostic({
              level: "error",
              code: "evaluation_error",
              message: "getVariable failed",
              originalError: error,
              details: { featureKey: required.feature, variableKey: required.variable },
            });
            return null;
          }
        }
        return value;
      },
      borrowed,
    );
  }

  private evaluateVariableWithoutFeature(
    initialOptions: VariableEvaluateOptions & EvaluateDependencies,
  ): Evaluation {
    let evaluationOptions = initialOptions;
    let moduleOptions: VariableEvaluateOptions | undefined;

    try {
      if (this.modules.length) {
        if (this.modules.some((module) => module.beforeEvaluation)) beginEvaluation(initialOptions);
        moduleOptions = {
          type: "variable" as const,
          variableKey: initialOptions.variableKey,
          context: initialOptions.context,
          defaultVariableValue: initialOptions.defaultVariableValue,
        };
        if (initialOptions.dependencyOf) moduleOptions.dependencyOf = initialOptions.dependencyOf;
        if (initialOptions.dependencyPurpose)
          moduleOptions.dependencyPurpose = initialOptions.dependencyPurpose;
        moduleOptions = beforeEvaluation(
          this.modules,
          inheritEvaluation(initialOptions, moduleOptions),
        );
        evaluationOptions = Object.assign(initialOptions, moduleOptions);
        refreshEvaluationState(evaluationOptions);
      }

      const resolvedVariableKey = evaluationOptions.variableKey;
      const variable = this.readEntity(2, resolvedVariableKey) as DatafileVariable | undefined;
      let evaluation: Evaluation = {
        type: "variable",
        variableKey: resolvedVariableKey,
        reason: "variable_not_found",
      };
      const stickyVariables = evaluationOptions.stickyVariables || {};

      if (hasOwn(stickyVariables, resolvedVariableKey)) {
        evaluation.reason = "sticky";
        evaluation.variable = variable;
        evaluation.variableValue = stickyVariables[resolvedVariableKey];
      } else if (variable) {
        if (
          variable.conditions !== undefined &&
          !this.conditionsAreMatched(variable.conditions, evaluationOptions)
        ) {
          evaluation.reason = "conditions_unmet";
          evaluation.conditions = variable.conditions;
          evaluation.variable = variable;
          evaluation.variableValue =
            !variable.compose && variable.useDefaultWhenDisabled
              ? variable.defaultValue
              : variable.compose
                ? (variable.disabledValue ?? null)
                : variable.disabledValue;
          if (Array.isArray(variable.compose) && evaluation.variableValue !== null)
            evaluation.variableValue = copyVariableObject(
              evaluation.variableValue as Record<string, VariableValue>,
            );
        } else if (variable.compose) {
          let value: VariableValue;
          if (typeof variable.compose === "string") {
            value = this.evaluateRequiredVariable(
              { variable: variable.compose },
              evaluationOptions,
              true,
            );
          } else {
            const members: Record<string, VariableValue | null> = {};
            for (const entry of variable.compose) {
              if (["__proto__", "prototype", "constructor"].indexOf(entry.key) !== -1)
                throw new DependencyError("Invalid composition property");
              members[entry.key] =
                entry.variable !== undefined
                  ? this.evaluateRequiredVariable(
                      { feature: entry.feature, variable: entry.variable },
                      evaluationOptions,
                      true,
                    )
                  : entry.variation
                    ? (this.evaluateRequiredFeature(
                        "variation",
                        entry.feature!,
                        evaluationOptions,
                        true,
                      ).variationValue ?? null)
                    : this.evaluateRequiredFeature("flag", entry.feature!, evaluationOptions, true)
                        .enabled === true;
            }
            value = members;
          }
          evaluation.reason = "variable_composed";
          evaluation.variable = variable;
          evaluation.variableValue = value;
        }
        if (
          evaluation.reason === "variable_not_found" ||
          (evaluation.reason === "variable_composed" && variable.overrideProgram)
        ) {
          const program = variable.overrideProgram;
          const overrides = program || variable.overrides || [];
          const appliedPaths: string[][] | undefined = program ? [] : undefined;
          let accumulatedValue: VariableValue = variable.compose
            ? evaluation.variableValue!
            : variable.defaultValue!;
          for (let index = 0; index < overrides.length; ) {
            const override = overrides[index];
            const matched =
              override.conditions === undefined ||
              this.conditionsAreMatched(override.conditions, evaluationOptions);
            if (matched) {
              if (program) {
                accumulatedValue = applyVariableOperations(
                  accumulatedValue,
                  program[index].operations,
                );
                // Map compositions own their outer object. String compositions
                // retain the ordinary getter ownership of their source.
                if (
                  variable.compose &&
                  typeof variable.compose !== "string" &&
                  program[index].operations.some((op) => op.op === "set" && op.path.length === 0)
                ) {
                  accumulatedValue = copyVariableObject(
                    accumulatedValue as Record<string, VariableValue>,
                  );
                }
                appliedPaths!.push(override.keyPath || [override.key]);
              }
              // No callbacks observe intermediate matches. Keep one result while
              // accumulating, then publish it after the complete program succeeds.
              evaluation.reason = "variable_override_rule";
              evaluation.variable = variable;
              evaluation.variableValue = program
                ? accumulatedValue
                : variable.overrides![index].value;
              evaluation.variableOverrideIndex = index;
              evaluation.variableOverrideKey = override.key;
              evaluation.variableOverridePath = override.keyPath;
              if (program) evaluation.variableOverridePaths = appliedPaths;
              if (!program) break;
            }
            const next = program
              ? matched
                ? program[index].onMatch
                : program[index].onMiss
              : index + 1;
            if (program && (!Number.isInteger(next) || next <= index || next > overrides.length)) {
              throw new Error("Invalid variable override program jump");
            }
            index = next;
          }

          if (evaluation.reason === "variable_not_found") {
            evaluation.reason = "variable_default";
            evaluation.variable = variable;
            evaluation.variableValue = variable.defaultValue;
          }
        }
        if (variable.deprecated) {
          this.reportDiagnostic({
            level: "warn",
            code: "deprecated_variable",
            message: `Variable "${resolvedVariableKey}" is deprecated`,
            details: { variableKey: resolvedVariableKey, evaluation },
          });
        }
      }

      evaluation = afterEvaluation(
        this.modules,
        evaluation,
        moduleOptions ||
          (this.modules.length
            ? {
                type: "variable",
                variableKey: evaluationOptions.variableKey,
                context: evaluationOptions.context,
                defaultVariableValue: evaluationOptions.defaultVariableValue,
                ...(evaluationOptions.dependencyOf && {
                  dependencyOf: evaluationOptions.dependencyOf,
                  dependencyPurpose: evaluationOptions.dependencyPurpose,
                }),
              }
            : evaluationOptions),
      );

      this.reportDiagnostic({
        level: "debug",
        code: evaluation.reason,
        message: "Global variable evaluated",
        details: { ...evaluation },
      });
      return evaluation;
    } catch (error) {
      const evaluation: Evaluation = {
        type: "variable",
        variableKey: evaluationOptions.variableKey,
        reason: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
      // Nested getters rethrow dependency failures, so only the public call reports them.
      if (!(error instanceof DependencyError && evaluationOptions.dependencyOf)) {
        this.reportDiagnostic({
          level: "error",
          code: "evaluation_error",
          message: "Global variable evaluation failed",
          originalError: error,
          details: { ...evaluation },
        });
      }
      return evaluation;
    } finally {
      endEvaluation(evaluationOptions);
    }
  }

  evaluateFlag(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return evaluateWithModules(
      this.getEvaluationDependencies(context, options, {
        type: "flag",
        featureKey,
      }),
    );
  }

  isEnabled(featureKey: FeatureKey, context: Context = {}, options: OverrideOptions = {}): boolean {
    try {
      const evaluation = this.evaluateFlag(featureKey, context, options);

      return evaluation.enabled === true;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "isEnabled failed",
        originalError: e,
        details: { featureKey },
      });

      return false;
    }
  }

  /**
   * Variation
   */
  evaluateVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return evaluateWithModules(
      this.getEvaluationDependencies(context, options, {
        type: "variation",
        featureKey,
      }),
    );
  }

  /**
   * Returns the evaluated variation. The optional type parameter narrows the
   * compile time result and does not validate or transform the runtime value.
   */
  getVariation<TVariation extends VariationValue = VariationValue>(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): TVariation | null {
    try {
      const evaluation = this.evaluateVariation(featureKey, context, options);

      if (typeof evaluation.variationValue !== "undefined") {
        return evaluation.variationValue as TVariation;
      }

      if (evaluation.variation) {
        return evaluation.variation.value as TVariation;
      }

      return null;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "getVariation failed",
        originalError: e,
        details: { featureKey },
      });

      return null;
    }
  }

  /**
   * Variable
   */
  evaluateVariable(
    featureKey: FeatureKey,
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): Evaluation;
  evaluateVariable(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): Evaluation;
  evaluateVariable(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: VariableKey | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): Evaluation {
    if (typeof variableKeyOrContext !== "string") {
      return this.evaluateVariableWithoutFeature(
        this.getEvaluationDependencies(
          variableKeyOrContext,
          contextOrOptions as InternalOverrideOptions,
          {
            type: "variable",
            variableKey: featureKeyOrVariableKey,
          },
        ),
      );
    }

    return evaluateWithModules(
      this.getEvaluationDependencies(contextOrOptions as Context, options, {
        type: "variable",
        featureKey: featureKeyOrVariableKey,
        variableKey: variableKeyOrContext,
      }),
    );
  }

  /**
   * Returns the evaluated variable. The optional type parameter describes the
   * expected compile time result and does not validate or transform the runtime
   * value.
   *
   * TValue is intentionally unconstrained. TypeScript interfaces with known
   * properties do not implicitly satisfy ObjectValue because they do not declare
   * an index signature.
   */
  getVariable<TValue = VariableValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): TValue | null {
    try {
      const evaluation =
        typeof variableKeyOrContext === "string"
          ? this.evaluateVariable(
              featureKeyOrVariableKey,
              variableKeyOrContext,
              contextOrOptions as Context,
              options,
            )
          : this.evaluateVariable(featureKeyOrVariableKey, variableKeyOrContext, contextOrOptions);

      if (typeof evaluation.variableValue !== "undefined") {
        if (
          (evaluation.variableSchema?.type === "json" || evaluation.variable?.type === "json") &&
          typeof evaluation.variableValue === "string" &&
          !evaluation.variable?.compose
        ) {
          return JSON.parse(evaluation.variableValue) as TValue;
        }

        return evaluation.variableValue as TValue;
      }

      return null;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "getVariable failed",
        originalError: e,
        details: {
          featureKey:
            typeof variableKeyOrContext === "string" ? featureKeyOrVariableKey : undefined,
          variableKey:
            typeof variableKeyOrContext === "string"
              ? variableKeyOrContext
              : featureKeyOrVariableKey,
        },
      });

      return null;
    }
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): boolean | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "boolean") as boolean | null;
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): string | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "string") as string | null;
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "integer") as number | null;
  }

  /** Returns a number variable after runtime type checking, whole or fractional. */
  getVariableNumber(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableNumber(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableNumber(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "number") as number | null;
  }

  /**
   * Returns an array variable after runtime type checking. Pass an item type
   * explicitly when its structure is known; otherwise items have type unknown.
   */
  getVariableArray<T = unknown>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = unknown>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = unknown>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T[] | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "array") as T[] | null;
  }

  /** Returns an object variable after runtime type checking. */
  getVariableObject<T = ObjectValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "object") as T | null;
  }

  /** Returns and parses a JSON variable. */
  getVariableJSON<T = VariableValue>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | VariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue = (this.getVariable as VariableGetter<OverrideOptions>)(
      featureKeyOrVariableKey,
      variableKeyOrContext,
      contextOrOptions,
      options,
    );

    return getValueByType(variableValue, "json") as T | null;
  }

  /** Returns evaluated feature snapshots for all or selected feature keys. */
  getFeatureEvaluations(
    context: Context = {},
    featureKeys: string[] = [],
    options: OverrideOptions = {},
  ): EvaluatedFeatures {
    const result = createLookup<EvaluatedFeature>() as EvaluatedFeatures;

    const keys = featureKeys.length > 0 ? featureKeys : this.getFeatureKeys();
    for (const featureKey of keys) {
      // isEnabled
      const evaluatedFeature: EvaluatedFeature = {
        enabled: this.isEnabled(featureKey, context, options),
      };

      // variation
      if (this.hasVariations(featureKey)) {
        const variation = this.getVariation(featureKey, context, options);

        if (variation !== null) {
          evaluatedFeature.variation = variation;
        }
      }

      // variables
      const variableKeys = this.getVariableKeys(featureKey);
      if (variableKeys.length > 0) {
        evaluatedFeature.variables = createLookup();

        for (const variableKey of variableKeys) {
          evaluatedFeature.variables[variableKey] = this.getVariable(
            featureKey,
            variableKey,
            context,
            options,
          );
        }
      }

      result[featureKey] = evaluatedFeature;
    }

    return result;
  }

  /** Returns evaluated global variable values for all or selected variable keys. */
  getVariableEvaluations(
    context: Context = {},
    variableKeys: VariableKey[] = [],
    options: OverrideOptions = {},
  ): EvaluatedVariables {
    const result = createLookup<VariableValue | null>() as EvaluatedVariables;
    const keys = variableKeys.length > 0 ? variableKeys : this.getVariableKeys();

    for (const variableKey of keys) {
      result[variableKey] = this.getVariable(variableKey, context, options);
    }

    return result;
  }
}

export function createFeaturevisor(options: FeaturevisorOptions = {}): Featurevisor {
  return new Featurevisor(options);
}
