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
  ObjectValue,
  Condition,
  VariableType,
  DatafileVariable,
  Required,
  StickyVariables,
  GlobalVariableKey,
} from "@featurevisor/types";

import type {
  FeaturevisorModule,
  FeaturevisorModuleApi,
  FeaturevisorModuleUnsubscribe,
} from "./modules.js";
import { evaluateWithModules } from "./evaluate.js";
import type {
  Evaluation,
  EvaluateDependencies,
  ForceResult,
  GlobalVariableEvaluateOptions,
} from "./evaluate.js";
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
import {
  FEATUREVISOR_DIAGNOSTIC_PREFIX,
  getConsoleMethodForDiagnostic,
  shouldLog,
} from "./diagnostics.js";

const emptyDatafile: DatafileContent = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
  variables: {},
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
    variables: {
      ...(existing.variables || {}),
      ...(incoming.variables || {}),
    },
  };
}

function getStickyChangeDetails(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
  previousStickyVariables: StickyVariables = {},
  newStickyVariables: StickyVariables = {},
) {
  const allKeys = [...Object.keys(previousStickyFeatures), ...Object.keys(newStickyFeatures)];

  return {
    features: allKeys.filter((element, index) => allKeys.indexOf(element) === index),
    variables: [...Object.keys(previousStickyVariables), ...Object.keys(newStickyVariables)].filter(
      (element, index, keys) => keys.indexOf(element) === index,
    ),
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
  const previousVariableKeys = Object.keys(previousDatafile.variables || {});
  const newVariableKeys = Object.keys(newDatafile.variables || {});
  const variables: GlobalVariableKey[] = [];

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

  for (const variableKey of previousVariableKeys) {
    if (
      !newDatafile.variables?.[variableKey] ||
      previousDatafile.variables?.[variableKey]?.hash !== newDatafile.variables[variableKey].hash
    ) {
      variables.push(variableKey);
    }
  }
  for (const variableKey of newVariableKeys) {
    if (previousVariableKeys.indexOf(variableKey) === -1) variables.push(variableKey);
  }

  return {
    revision: newRevision,
    previousRevision,
    revisionChanged: previousRevision !== newRevision,
    features,
    variables,
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
      return typeof value === "number" && Number.isInteger(value) ? value : null;
    }
    case "double": {
      return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface SpawnOptions {
  stickyFeatures?: StickyFeatures;
  /** @deprecated Use `stickyFeatures`. */
  sticky?: StickyFeatures;
  stickyVariables?: StickyVariables;
}

interface InternalOverrideOptions extends OverrideOptions {
  __featurevisorChildStickyFeatures?: StickyFeatures;
  __featurevisorChildStickyVariables?: StickyVariables;
}

export interface FeaturevisorOptions {
  datafile?: DatafileContent | string;
  context?: Context;
  logLevel?: FeaturevisorLogLevel;
  onDiagnostic?: FeaturevisorDiagnosticHandler;
  stickyFeatures?: StickyFeatures;
  /** @deprecated Use `stickyFeatures`. */
  sticky?: StickyFeatures;
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
    this.stickyFeatures = options.stickyFeatures || options.sticky;
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
        details,
      });
      this.trigger("datafile_set", details);
    } catch (e) {
      this.reportDiagnostic({
        level: "error",
        code: "invalid_datafile",
        message: "Could not parse datafile",
        originalError: e,
        details: {},
      });
    }
  }

  setStickyFeatures(stickyFeatures: StickyFeatures, replace = false) {
    if (this.closed) {
      return;
    }

    const previousStickyFeatures = this.stickyFeatures || {};

    if (replace) {
      this.stickyFeatures = { ...stickyFeatures };
    } else {
      this.stickyFeatures = {
        ...this.stickyFeatures,
        ...stickyFeatures,
      };
    }

    const details = getStickyChangeDetails(previousStickyFeatures, this.stickyFeatures, replace);

    this.reportDiagnostic({
      level: "info",
      code: "sticky_features_set",
      message: "Sticky features set",
      details,
    });
    this.trigger("sticky_features_set", {
      features: details.features,
      replaced: replace,
    });
    this.trigger("sticky_set", details);
  }

  /** @deprecated Use `setStickyFeatures`. */
  setSticky(stickyFeatures: StickyFeatures, replace = false) {
    this.setStickyFeatures(stickyFeatures, replace);
  }

  setStickyVariables(stickyVariables: StickyVariables, replace = false) {
    if (this.closed) return;

    const previousStickyVariables = this.stickyVariables || {};
    this.stickyVariables = replace
      ? { ...stickyVariables }
      : { ...this.stickyVariables, ...stickyVariables };
    const details = getStickyChangeDetails(
      {},
      {},
      replace,
      previousStickyVariables,
      this.stickyVariables,
    );

    this.reportDiagnostic({
      level: "info",
      code: "sticky_variables_set",
      message: "Sticky variables set",
      details,
    });
    this.trigger("sticky_variables_set", {
      variables: details.variables,
      replaced: replace,
    });
    this.trigger("sticky_set", details);
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

  getGlobalVariableDefinition(variableKey: GlobalVariableKey): DatafileVariable | undefined {
    return this.datafile.variables?.[variableKey];
  }

  getGlobalVariableKeys(): GlobalVariableKey[] {
    return Object.keys(this.datafile.variables || {});
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
      details: {
        context: this.context,
        replaced: replace,
      },
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

  spawn(context: Context = {}, options: SpawnOptions = {}): FeaturevisorChildInstance {
    return new FeaturevisorChildInstance({
      parent: this,
      context: this.getContext(context),
      stickyFeatures: options.stickyFeatures || options.sticky,
      stickyVariables: options.stickyVariables,
    });
  }

  /**
   * Flag
   */
  private getEvaluationDependencies(
    context: Context,
    options: InternalOverrideOptions = {},
  ): EvaluateDependencies {
    return {
      context: this.getContext(context),

      reportDiagnostic: this.reportDiagnostic,
      modules: this.modules,
      // The evaluator only needs this small datafile/matching adapter shape.
      // The methods are private on the instance, so TypeScript needs this
      // internal cast; avoid widening these helpers into public instance APIs.
      datafile: this as unknown as InstanceEvaluationDataProvider,

      stickyFeatures: options.__featurevisorChildStickyFeatures || this.stickyFeatures,
      defaultVariationValue: options.defaultVariationValue,
      defaultVariableValue: options.defaultVariableValue,
    };
  }

  private requiredFeaturesAreMatched(
    requiredFeatures: Required[] | undefined,
    context: Context,
    options: InternalOverrideOptions,
  ): boolean {
    return (requiredFeatures || []).every((required) => {
      const featureKey = typeof required === "string" ? required : required.key;
      if (!this.isEnabled(featureKey, context, options)) return false;
      return (
        typeof required === "string" ||
        this.getVariation(featureKey, context, options) === required.variation
      );
    });
  }

  evaluateGlobalVariable(
    variableKey: GlobalVariableKey,
    context: Context = {},
    options: InternalOverrideOptions = {},
  ): Evaluation {
    let evaluationOptions: GlobalVariableEvaluateOptions = {
      type: "variable",
      variableKey,
      context: this.getContext(context),
      defaultVariableValue: options.defaultVariableValue,
    };

    try {
      for (const module of this.modules) {
        if (module.beforeEvaluation) {
          evaluationOptions = module.beforeEvaluation(
            evaluationOptions,
          ) as GlobalVariableEvaluateOptions;
        }
      }

      const resolvedVariableKey = evaluationOptions.variableKey;
      const variable = this.getGlobalVariableDefinition(resolvedVariableKey);
      let evaluation: Evaluation = {
        type: "variable",
        variableKey: resolvedVariableKey,
        reason: "variable_not_found",
      };
      const stickyVariables =
        options.__featurevisorChildStickyVariables || this.stickyVariables || {};

      if (Object.prototype.hasOwnProperty.call(stickyVariables, resolvedVariableKey)) {
        evaluation = {
          ...evaluation,
          reason: "sticky",
          variable,
          variableValue: stickyVariables[resolvedVariableKey],
        };
      } else if (variable) {
        if (
          !this.requiredFeaturesAreMatched(
            variable.requiredFeatures,
            evaluationOptions.context,
            options,
          )
        ) {
          evaluation = {
            ...evaluation,
            reason: "required_features_unmet",
            variable,
            variableValue: variable.useDefaultWhenDisabled
              ? variable.defaultValue
              : variable.disabledValue,
          };
        } else {
          const overrides = variable.overrides || [];
          for (let index = 0; index < overrides.length; index++) {
            const override = overrides[index];
            if (
              !this.requiredFeaturesAreMatched(
                override.requiredFeatures,
                evaluationOptions.context,
                options,
              )
            ) {
              continue;
            }
            const segmentsMatch =
              !override.segments ||
              this.allSegmentsAreMatched(
                parseSegmentsIfStringified(override.segments),
                evaluationOptions.context,
              );
            const conditionsMatch =
              !override.conditions ||
              this.allConditionsAreMatched(
                parseConditionsIfStringified(override.conditions, this.reportDiagnostic),
                evaluationOptions.context,
              );
            if (!segmentsMatch || !conditionsMatch) continue;

            evaluation = {
              ...evaluation,
              reason: "variable_override_rule",
              variable,
              variableValue: override.value,
              overrideIndex: index,
              overrideKey: override.key,
            };
            break;
          }

          if (evaluation.reason === "variable_not_found") {
            evaluation = {
              ...evaluation,
              reason: "variable_default",
              variable,
              variableValue: variable.defaultValue,
            };
          }
        }

        if (variable.deprecated) {
          this.reportDiagnostic({
            level: "warn",
            code: "variable_deprecated",
            message: `Variable "${resolvedVariableKey}" is deprecated`,
            details: { variableKey: resolvedVariableKey, evaluation },
          });
        }
      }

      if (
        typeof evaluation.variableValue === "undefined" &&
        typeof evaluationOptions.defaultVariableValue !== "undefined"
      ) {
        evaluation.variableValue = evaluationOptions.defaultVariableValue;
      }

      for (const module of this.modules) {
        if (module.afterEvaluation) {
          evaluation = module.afterEvaluation(evaluation, evaluationOptions) as Evaluation;
        }
      }

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
      this.reportDiagnostic({
        level: "error",
        code: "evaluation_error",
        message: "Global variable evaluation failed",
        originalError: error,
        details: { ...evaluation },
      });
      return evaluation;
    }
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
    return evaluateWithModules({
      ...this.getEvaluationDependencies(context, options),
      type: "variation",
      featureKey,
    });
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): Evaluation;
  evaluateVariable(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: VariableKey | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): Evaluation {
    if (typeof variableKeyOrContext !== "string") {
      return this.evaluateGlobalVariable(
        featureKeyOrVariableKey,
        variableKeyOrContext,
        contextOrOptions as InternalOverrideOptions,
      );
    }

    return evaluateWithModules({
      ...this.getEvaluationDependencies(contextOrOptions as Context, options),
      type: "variable",
      featureKey: featureKeyOrVariableKey,
      variableKey: variableKeyOrContext,
    });
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): TValue | null;
  getVariable<TValue = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
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
          typeof evaluation.variableValue === "string"
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

  /**
   * Explicitly evaluates a global variable.
   *
   * This is equivalent to the two argument `getVariable(variableKey, context)`
   * overload and gives SDK ports without method overloading a shared API name.
   */
  getGlobalVariable<TValue = VariableValue>(
    variableKey: GlobalVariableKey,
    context: Context = {},
    options: OverrideOptions = {},
  ): TValue | null {
    return this.getVariable<TValue>(variableKey, context, options);
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): boolean | null;
  getVariableBoolean(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): boolean | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): string | null;
  getVariableString(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): string | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableInteger(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
          );

    return getValueByType(variableValue, "integer") as number | null;
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableDouble(
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): number | null;
  getVariableDouble(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): number | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
          );

    return getValueByType(variableValue, "double") as number | null;
  }

  /**
   * Returns an array variable after runtime type checking. The item type defaults
   * to string for compatibility. Pass it explicitly for other array item types.
   */
  getVariableArray<T = string>(
    featureKey: FeatureKey,
    variableKey: string,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = string>(
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T[] | null;
  getVariableArray<T = string>(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T[] | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableObject<T = ObjectValue>(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
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
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ): T | null;
  getVariableJSON<T = VariableValue>(
    featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
    variableKeyOrContext: string | Context = {},
    contextOrOptions: Context | OverrideOptions = {},
    options: OverrideOptions = {},
  ): T | null {
    const variableValue =
      typeof variableKeyOrContext === "string"
        ? this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as Context,
            options,
          )
        : this.getVariable(
            featureKeyOrVariableKey,
            variableKeyOrContext,
            contextOrOptions as OverrideOptions,
          );

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

        if (variation !== null) {
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
