import type {
  Context,
  Feature,
  FeatureKey,
  StickyFeatures,
  EvaluatedFeatures,
  EvaluatedFeature,
  VariableValue,
  VariationValue,
  VariableKey,
  DatafileContent,
} from "@featurevisor/types";

import { ModulesManager, FeaturevisorModule, FeaturevisorModuleApi } from "./modules.js";
import { Emitter, EventCallback, EventName } from "./emitter.js";
import { DatafileReader } from "./datafileReader.js";
import { Evaluation, EvaluateDependencies, evaluateWithModules } from "./evaluate.js";
import { FeaturevisorChildInstance } from "./child.js";
import { getParamsForStickySetEvent, getParamsForDatafileSetEvent } from "./events.js";
import { getValueByType } from "./helpers.js";
import {
  FEATUREVISOR_DIAGNOSTIC_PREFIX,
  FeaturevisorDiagnostic,
  FeaturevisorDiagnosticHandler,
  FeaturevisorLogLevel,
  FeaturevisorModuleDiagnosticOptions,
  FeaturevisorModuleReportedDiagnostic,
  getConsoleMethodForDiagnostic,
  shouldLog,
} from "./diagnostics.js";

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

export interface OverrideOptions {
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface InstanceOptions {
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

export class Featurevisor {
  // from options
  private context: Context = {};
  private logLevel: FeaturevisorLogLevel = "info";
  private onDiagnostic?: FeaturevisorDiagnosticHandler;
  private sticky?: StickyFeatures;

  // internally created
  private datafile: DatafileContent = emptyDatafile;
  private datafileReader: DatafileReader;
  private modulesManager: ModulesManager;
  private moduleDiagnosticSubscriptions: FeaturevisorModuleDiagnosticSubscription[] = [];
  private emitter: Emitter;
  private closed = false;

  constructor(options: InstanceOptions) {
    // from options
    this.context = options.context || {};
    this.logLevel = options.logLevel || "info";
    this.onDiagnostic = options.onDiagnostic;
    this.emitter = new Emitter();
    this.sticky = options.sticky;

    // datafile
    this.datafileReader = new DatafileReader({
      datafile: emptyDatafile,
      reportDiagnostic: this.reportDiagnostic,
    });

    this.modulesManager = new ModulesManager({
      modules: options.modules || [],
      reportDiagnostic: this.reportDiagnostic,
      getModuleApi: this.getModuleApi,
      clearModuleDiagnosticSubscriptions: this.clearModuleDiagnosticSubscriptions,
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
      const newDatafileReader = new DatafileReader({
        datafile: storedDatafile,
        reportDiagnostic: this.reportDiagnostic,
      });

      const details = getParamsForDatafileSetEvent(this.datafileReader, newDatafileReader, replace);

      this.datafile = storedDatafile;
      this.datafileReader = newDatafileReader;

      this.reportDiagnostic({
        level: "info",
        code: "datafile_set",
        message: "Datafile set",
        ...details,
      });
      this.emitter.trigger("datafile_set", details);
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

    const params = getParamsForStickySetEvent(previousStickyFeatures, this.sticky, replace);

    this.reportDiagnostic({
      level: "info",
      code: "sticky_set",
      message: "Sticky features set",
      ...params,
    });
    this.emitter.trigger("sticky_set", params);
  }

  getRevision(): string {
    return this.datafileReader.getRevision();
  }

  getFeature(featureKey: string): Feature | undefined {
    return this.datafileReader.getFeature(featureKey);
  }

  addModule(module: FeaturevisorModule) {
    if (this.closed) {
      return;
    }

    return this.modulesManager.add(module);
  }

  removeModule(name: string) {
    if (this.closed) {
      return;
    }

    return this.modulesManager.remove(name);
  }

  on(eventName: EventName, callback: EventCallback) {
    if (this.closed) {
      return () => {};
    }

    return this.emitter.on(eventName, callback);
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.modulesManager.closeAll();
    this.moduleDiagnosticSubscriptions = [];
    this.emitter.clearAll();
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
      this.emitter.trigger("error", { diagnostic });
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

    this.emitter.trigger("context_set", {
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
      modulesManager: this.modulesManager,
      datafileReader: this.datafileReader,

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

    const keys = featureKeys.length > 0 ? featureKeys : this.datafileReader.getFeatureKeys();
    for (const featureKey of keys) {
      // isEnabled
      const evaluatedFeature: EvaluatedFeature = {
        enabled: this.isEnabled(featureKey, context, options),
      };

      // variation
      if (this.datafileReader.hasVariations(featureKey)) {
        const variation = this.getVariation(featureKey, context, options);

        if (variation) {
          evaluatedFeature.variation = variation;
        }
      }

      // variables
      const variableKeys = this.datafileReader.getVariableKeys(featureKey);
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

export function createFeaturevisor(options: InstanceOptions = {}): Featurevisor {
  return new Featurevisor(options);
}
