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
  Traffic,
  Allocation,
  GroupSegment,
  Condition,
  VariableType,
} from "@featurevisor/types";

import type {
  FeaturevisorModule,
  FeaturevisorModuleApi,
  FeaturevisorModuleUnsubscribe,
} from "./modules.js";
import { evaluateWithModules } from "./evaluate.js";
import type { Evaluation, EvaluateDependencies, ForceResult } from "./evaluate.js";
import { FeaturevisorChildInstance } from "./child.js";
import type { EventCallback, EventDetailsByName, EventName } from "./events.js";
import {
  allConditionsAreMatched,
  allSegmentsAreMatched,
  parseConditionsIfStringified,
  parseSegmentsIfStringified,
} from "./conditions.js";
import type {
  FeaturevisorDiagnostic,
  FeaturevisorDiagnosticHandler,
  FeaturevisorLogLevel,
  FeaturevisorModuleDiagnosticOptions,
  FeaturevisorModuleReportedDiagnostic,
} from "./diagnostics.js";

const FEATUREVISOR_DIAGNOSTIC_PREFIX = "[Featurevisor]";
const FEATUREVISOR_LOG_LEVELS: FeaturevisorLogLevel[] = ["fatal", "error", "warn", "info", "debug"];

function shouldLog(
  configuredLevel: FeaturevisorLogLevel,
  diagnosticLevel: FeaturevisorLogLevel,
): boolean {
  return (
    FEATUREVISOR_LOG_LEVELS.indexOf(configuredLevel) >=
    FEATUREVISOR_LOG_LEVELS.indexOf(diagnosticLevel)
  );
}

function getConsoleMethodForDiagnostic(level: FeaturevisorLogLevel) {
  if (level === "fatal" || level === "error") {
    return "error";
  }

  if (level === "warn") {
    return "warn";
  }

  if (level === "debug") {
    return "debug";
  }

  return "info";
}

const emptyDatafile: DatafileContent = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
};

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
    segments: {
      ...(existing.segments || {}),
      ...(incoming.segments || {}),
    },
    features: {
      ...(existing.features || {}),
      ...(incoming.features || {}),
    },
  };
}

function getStickySetEventDetails(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
) {
  const allKeys = [...Object.keys(previousStickyFeatures), ...Object.keys(newStickyFeatures)];

  return {
    features: allKeys.filter((element, index) => allKeys.indexOf(element) === index),
    replaced: replace,
  };
}

function getDatafileSetEventDetails(
  previousDatafile: DatafileContent,
  newDatafile: DatafileContent,
  replace = false,
) {
  const previousRevision = previousDatafile.revision;
  const previousFeatureKeys = Object.keys(previousDatafile.features);
  const newRevision = newDatafile.revision;
  const newFeatureKeys = Object.keys(newDatafile.features);
  const features: FeatureKey[] = [];

  for (const previousFeatureKey of previousFeatureKeys) {
    if (newFeatureKeys.indexOf(previousFeatureKey) === -1) {
      features.push(previousFeatureKey);
      continue;
    }

    if (
      previousDatafile.features[previousFeatureKey]?.hash !==
      newDatafile.features[previousFeatureKey]?.hash
    ) {
      features.push(previousFeatureKey);
    }
  }

  for (const newFeatureKey of newFeatureKeys) {
    if (
      previousFeatureKeys.indexOf(newFeatureKey) === -1 &&
      features.indexOf(newFeatureKey) === -1
    ) {
      features.push(newFeatureKey);
    }
  }

  return {
    revision: newRevision,
    previousRevision,
    revisionChanged: previousRevision !== newRevision,
    features,
    replaced: replace,
  };
}

function getValueByType(value: VariableValue, fieldType: string | VariableType): VariableValue {
  if (value === undefined || value === null) {
    return null;
  }

  switch (fieldType) {
    case "string":
      return typeof value === "string" ? value : null;
    case "integer": {
      const result = typeof value === "number" ? value : Number(value);
      return Number.isInteger(result) ? result : null;
    }
    case "double": {
      const result = typeof value === "number" ? value : Number(value);
      return Number.isFinite(result) ? result : null;
    }
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "array":
      return Array.isArray(value) ? value : null;
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? value : null;
    default:
      return value;
  }
}

export interface OverrideOptions {
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface FeaturevisorOptions {
  datafile?: DatafileContent | string;
  context?: Context;
  logLevel?: FeaturevisorLogLevel;
  onDiagnostic?: FeaturevisorDiagnosticHandler;
  sticky?: StickyFeatures;
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

type EvaluationDataProviderAdapter = EvaluateDependencies["datafile"];

export class Featurevisor {
  // from options
  private context: Context = {};
  private logLevel: FeaturevisorLogLevel = "info";
  private onDiagnostic?: FeaturevisorDiagnosticHandler;
  private sticky?: StickyFeatures;

  // internally created
  private datafile: DatafileContent = emptyDatafile;
  private regexCache: Record<string, RegExp> = {};
  private modules: FeaturevisorModule[] = [];
  private moduleDiagnosticSubscriptions: FeaturevisorModuleDiagnosticSubscription[] = [];
  private listeners: Listeners = {};
  private closed = false;

  constructor(options: FeaturevisorOptions) {
    // from options
    this.context = options.context || {};
    this.logLevel = options.logLevel || "info";
    this.onDiagnostic = options.onDiagnostic;
    this.sticky = options.sticky;

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
    });
  }

  setLogLevel(level: FeaturevisorLogLevel) {
    this.logLevel = level;
  }

  setDatafile(datafile: DatafileContent | string, replace = false) {
    if (this.closed) {
      return;
    }

    try {
      const resolvedDatafile = typeof datafile === "string" ? JSON.parse(datafile) : datafile;
      assertDatafileContent(resolvedDatafile);

      const storedDatafile = replace
        ? resolvedDatafile
        : mergeStoredDatafile(this.datafile, resolvedDatafile);
      const details = getDatafileSetEventDetails(this.datafile, storedDatafile, replace);

      this.datafile = storedDatafile;
      this.regexCache = {};

      this.reportDiagnostic({
        level: "info",
        code: "datafile_set",
        message: "Datafile set",
        ...details,
      });
      this.trigger("datafile_set", details);
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "invalid_datafile",
        message: "Could not parse datafile",
        originalError: e,
      });
    }
  }

  setSticky(sticky: StickyFeatures, replace = false) {
    if (this.closed) {
      return;
    }

    const previousStickyFeatures = this.sticky || {};

    if (replace) {
      this.sticky = { ...sticky };
    } else {
      this.sticky = {
        ...this.sticky,
        ...sticky,
      };
    }

    const params = getStickySetEventDetails(previousStickyFeatures, this.sticky, replace);

    this.reportDiagnostic({
      level: "info",
      code: "sticky_set",
      message: "Sticky features set",
      ...params,
    });
    this.trigger("sticky_set", params);
  }

  getRevision(): string {
    return this.datafile.revision;
  }

  getSchemaVersion(): string {
    return this.datafile.schemaVersion;
  }

  getSegment(segmentKey: SegmentKey): Segment | undefined {
    const segment = this.datafile.segments[segmentKey];

    if (!segment) {
      return undefined;
    }

    segment.conditions = parseConditionsIfStringified(segment.conditions, this.reportDiagnostic);

    return segment;
  }

  getFeature(featureKey: string): Feature | undefined {
    return this.datafile.features[featureKey];
  }

  getFeatureKeys(): string[] {
    return Object.keys(this.datafile.features);
  }

  getVariableKeys(featureKey: FeatureKey): string[] {
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

  private allSegmentsAreMatched(
    groupSegments: GroupSegment | GroupSegment[] | "*",
    context: Context,
  ): boolean {
    return allSegmentsAreMatched(
      groupSegments,
      context,
      (segmentKey) => this.getSegment(segmentKey),
      (regexString, regexFlags) => this.getRegex(regexString, regexFlags),
      this.reportDiagnostic,
    );
  }

  private getMatchedTraffic(traffic: Traffic[], context: Context): Traffic | undefined {
    return traffic.find((t) => {
      if (!this.allSegmentsAreMatched(parseSegmentsIfStringified(t.segments), context)) {
        return false;
      }

      return true;
    });
  }

  private getMatchedAllocation(traffic: Traffic, bucketValue: number): Allocation | undefined {
    if (!traffic.allocation) {
      return undefined;
    }

    for (const allocation of traffic.allocation) {
      const [start, end] = allocation.range;

      if (allocation.range && start <= bucketValue && end >= bucketValue) {
        return allocation;
      }
    }

    return undefined;
  }

  private getMatchedForce(featureKey: FeatureKey | Feature, context: Context): ForceResult {
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
        this.allConditionsAreMatched(
          parseConditionsIfStringified(currentForce.conditions, this.reportDiagnostic),
          context,
        )
      ) {
        result.force = currentForce;
        result.forceIndex = i;
        break;
      }

      if (
        currentForce.segments &&
        this.allSegmentsAreMatched(parseSegmentsIfStringified(currentForce.segments), context)
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
      });

      return;
    }

    module.setup?.(this.getModuleApi(module));
    this.modules.push(module);

    return async () => {
      const moduleExists = this.modules.indexOf(module) !== -1;
      this.modules = this.modules.filter((existingModule) => existingModule !== module);
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
    const modules = this.modules.slice();
    this.modules = [];

    for (const module of modules) {
      this.clearModuleDiagnosticSubscriptions(module);
      await this.closeModule(module);
    }

    this.moduleDiagnosticSubscriptions = [];
    this.listeners = {};
  }

  private reportDiagnostic = (
    diagnostic: FeaturevisorDiagnostic,
    sourceModule?: FeaturevisorModule,
  ): void => {
    this.moduleDiagnosticSubscriptions.slice().forEach((subscription) => {
      if (subscription.module === sourceModule) {
        return;
      }

      if (!shouldLog(subscription.logLevel, diagnostic.level)) {
        return;
      }

      subscription.handler(diagnostic);
    });

    if (shouldLog(this.logLevel, diagnostic.level)) {
      if (this.onDiagnostic) {
        this.onDiagnostic(diagnostic);
      } else {
        const method = getConsoleMethodForDiagnostic(diagnostic.level);
        console[method](FEATUREVISOR_DIAGNOSTIC_PREFIX, diagnostic.message, diagnostic);
      }
    }

    if (diagnostic.level === "error") {
      this.trigger("error", { diagnostic });
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
      const moduleDiagnostic: FeaturevisorDiagnostic = { ...diagnostic };

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
      this.context = { ...this.context, ...context };
    }

    this.trigger("context_set", {
      context: this.context,
      replaced: replace,
    });
    this.reportDiagnostic({
      level: "debug",
      code: "context_set",
      message: replace ? "Context replaced" : "Context updated",
      context: this.context,
      replaced: replace,
    });
  }

  getContext(context?: Context): Context {
    return context
      ? {
          ...this.context,
          ...context,
        }
      : this.context;
  }

  spawn(context: Context = {}, options: OverrideOptions = {}): FeaturevisorChildInstance {
    return new FeaturevisorChildInstance({
      parent: this,
      context: this.getContext(context),
      sticky: options.sticky,
    });
  }

  /**
   * Flag
   */
  private getEvaluationDependencies(
    context: Context,
    options: OverrideOptions = {},
  ): EvaluateDependencies {
    return {
      context: this.getContext(context),

      reportDiagnostic: this.reportDiagnostic,
      modules: this.modules,
      // The evaluator only needs this small datafile/matching adapter shape.
      // The methods are private on the instance, so TypeScript needs this
      // internal cast; avoid widening these helpers into public instance APIs.
      datafile: this as unknown as EvaluationDataProviderAdapter,

      // OverrideOptions
      sticky: options.sticky
        ? {
            ...this.sticky,
            ...options.sticky,
          }
        : this.sticky,
      defaultVariationValue: options.defaultVariationValue,
      defaultVariableValue: options.defaultVariableValue,
    };
  }

  evaluateFlag(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return evaluateWithModules({
      ...this.getEvaluationDependencies(context, options),
      type: "flag",
      featureKey,
    });
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
        featureKey,
        originalError: e,
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
    return evaluateWithModules({
      ...this.getEvaluationDependencies(context, options),
      type: "variation",
      featureKey,
    });
  }

  getVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): VariationValue | null {
    try {
      const evaluation = this.evaluateVariation(featureKey, context, options);

      if (typeof evaluation.variationValue !== "undefined") {
        return evaluation.variationValue;
      }

      if (evaluation.variation) {
        return evaluation.variation.value;
      }

      return null;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "getVariation failed",
        featureKey,
        originalError: e,
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
    context: Context = {},
    options: OverrideOptions = {},
  ): Evaluation {
    return evaluateWithModules({
      ...this.getEvaluationDependencies(context, options),
      type: "variable",
      featureKey,
      variableKey,
    });
  }

  getVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): VariableValue | null {
    try {
      const evaluation = this.evaluateVariable(featureKey, variableKey, context, options);

      if (typeof evaluation.variableValue !== "undefined") {
        if (
          evaluation.variableSchema &&
          evaluation.variableSchema.type === "json" &&
          typeof evaluation.variableValue === "string"
        ) {
          return JSON.parse(evaluation.variableValue);
        }

        return evaluation.variableValue;
      }

      return null;
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "getVariable failed",
        featureKey,
        variableKey,
        originalError: e,
      });

      return null;
    }
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): boolean | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "boolean") as boolean | null;
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): string | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "string") as string | null;
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "integer") as number | null;
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "double") as number | null;
  }

  getVariableArray<T = string>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T[] | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "array") as T[] | null;
  }

  getVariableObject<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "object") as T | null;
  }

  getVariableJSON<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "json") as T | null;
  }

  getAllEvaluations(
    context: Context = {},
    featureKeys: string[] = [],
    options: OverrideOptions = {},
  ): EvaluatedFeatures {
    const result: EvaluatedFeatures = {};

    const keys = featureKeys.length > 0 ? featureKeys : this.getFeatureKeys();
    for (const featureKey of keys) {
      // isEnabled
      const evaluatedFeature: EvaluatedFeature = {
        enabled: this.isEnabled(featureKey, context, options),
      };

      // variation
      if (this.hasVariations(featureKey)) {
        const variation = this.getVariation(featureKey, context, options);

        if (variation) {
          evaluatedFeature.variation = variation;
        }
      }

      // variables
      const variableKeys = this.getVariableKeys(featureKey);
      if (variableKeys.length > 0) {
        evaluatedFeature.variables = {};

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
}

export function createFeaturevisor(options: FeaturevisorOptions = {}): Featurevisor {
  return new Featurevisor(options);
}
