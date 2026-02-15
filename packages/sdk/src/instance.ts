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

import { createLogger, Logger, LogLevel } from "./logger";
import { HooksManager, Hook } from "./hooks";
import { Emitter, EventCallback, EventName } from "./emitter";
import { DatafileReader } from "./datafileReader";
import { Evaluation, EvaluateDependencies, evaluateWithHooks } from "./evaluate";
import { FeaturevisorChildInstance } from "./child";
import { getParamsForStickySetEvent, getParamsForDatafileSetEvent } from "./events";
import { getValueByType } from "./helpers";

const emptyDatafile: DatafileContent = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
};

export interface OverrideOptions {
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface InstanceOptions {
  datafile?: DatafileContent | string;
  context?: Context;
  logLevel?: LogLevel;
  logger?: Logger;
  sticky?: StickyFeatures;
  hooks?: Hook[];
}

export class FeaturevisorInstance {
  // from options
  private context: Context = {};
  private logger: Logger;
  private sticky?: StickyFeatures;

  // internally created
  private datafileReader: DatafileReader;
  private hooksManager: HooksManager;
  private emitter: Emitter;

  constructor(options: InstanceOptions) {
    // from options
    this.context = options.context || {};
    this.logger =
      options.logger ||
      createLogger({
        level: options.logLevel || Logger.defaultLevel,
      });
    this.hooksManager = new HooksManager({
      hooks: options.hooks || [],
      logger: this.logger,
    });
    this.emitter = new Emitter();
    this.sticky = options.sticky;

    // datafile
    this.datafileReader = new DatafileReader({
      datafile: emptyDatafile,
      logger: this.logger,
    });
    if (options.datafile) {
      this.datafileReader = new DatafileReader({
        datafile:
          typeof options.datafile === "string" ? JSON.parse(options.datafile) : options.datafile,
        logger: this.logger,
      });
    }

    this.logger.info("Featurevisor SDK initialized");
  }

  setLogLevel(level: LogLevel) {
    this.logger.setLevel(level);
  }

  setDatafile(datafile: DatafileContent | string) {
    try {
      const newDatafileReader = new DatafileReader({
        datafile: typeof datafile === "string" ? JSON.parse(datafile) : datafile,
        logger: this.logger,
      });

      const details = getParamsForDatafileSetEvent(this.datafileReader, newDatafileReader);

      this.datafileReader = newDatafileReader;

      this.logger.info("datafile set", details);
      this.emitter.trigger("datafile_set", details);
    } catch (e) {
      this.logger.error("could not parse datafile", { error: e });
    }
  }

  setSticky(sticky: StickyFeatures, replace = false) {
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

    this.logger.info("sticky features set", params);
    this.emitter.trigger("sticky_set", params);
  }

  getRevision(): string {
    return this.datafileReader.getRevision();
  }

  getFeature(featureKey: string): Feature | undefined {
    return this.datafileReader.getFeature(featureKey);
  }

  addHook(hook: Hook) {
    return this.hooksManager.add(hook);
  }

  on(eventName: EventName, callback: EventCallback) {
    return this.emitter.on(eventName, callback);
  }

  close() {
    this.emitter.clearAll();
  }

  /**
   * Context
   */
  setContext(context: Context, replace = false) {
    if (replace) {
      this.context = context;
    } else {
      this.context = { ...this.context, ...context };
    }

    this.emitter.trigger("context_set", {
      context: this.context,
      replaced: replace,
    });
    this.logger.debug(replace ? "context replaced" : "context updated", {
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

      logger: this.logger,
      hooksManager: this.hooksManager,
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
    return evaluateWithHooks({
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
      this.logger.error("isEnabled", { featureKey, error: e });

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
    return evaluateWithHooks({
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
      this.logger.error("getVariation", { featureKey, error: e });

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
    return evaluateWithHooks({
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
      this.logger.error("getVariable", { featureKey, variableKey, error: e });

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

export function createInstance(options: InstanceOptions = {}): FeaturevisorInstance {
  return new FeaturevisorInstance(options);
}
