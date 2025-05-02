import {
  Context,
  Feature,
  FeatureKey,
  StickyFeatures,
  VariableType,
  VariableValue,
  VariationValue,
  VariableKey,
  DatafileContentV2,
} from "@featurevisor/types";

import { createLogger, Logger, LogLevel } from "./logger";
import { DatafileReader } from "./datafileReader";
import { ConfigureBucketKey, ConfigureBucketValue } from "./bucket";
import { Evaluation, EvaluateDependencies, evaluate } from "./evaluate";

const DEFAULT_BUCKET_KEY_SEPARATOR = ".";

export type InterceptContext = (
  context: Context,
  featureKey: string,
  variableKey?: string,
) => Context;

export interface InstanceOptions {
  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;
  configureBucketValue?: ConfigureBucketValue;
  datafile?: DatafileContentV2 | string;
  context?: Context;
  interceptContext?: InterceptContext;
  logger?: Logger;
  stickyFeatures?: StickyFeatures;
}

const emptyDatafile: DatafileContentV2 = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
};

type FieldType = string | VariableType;
type ValueType = VariableValue;

export function getValueByType(value: ValueType, fieldType: FieldType): ValueType {
  try {
    if (value === undefined) {
      return null;
    }

    switch (fieldType) {
      case "string":
        return typeof value === "string" ? value : null;
      case "integer":
        return parseInt(value as string, 10);
      case "double":
        return parseFloat(value as string);
      case "boolean":
        return value === true;
      case "array":
        return Array.isArray(value) ? value : null;
      case "object":
        return typeof value === "object" ? value : null;
      // @NOTE: `json` is not handled here intentionally
      default:
        return value;
    }
  } catch (e) {
    return null;
  }
}

export interface AdditionalOptions {
  stickyFeatures?: StickyFeatures;
  // @TODO: defaultValue?
}

export interface InstanceWithContextOptions {
  parent: FeaturevisorInstance;
  context: Context;
  stickyFeatures?: StickyFeatures;
}

export class FeaturevisorInstanceWithContext {
  private parent: FeaturevisorInstance;
  private context: Context;
  private stickyFeatures: StickyFeatures;

  constructor(options) {
    this.parent = options.parent;
    this.context = options.context;
    this.stickyFeatures = options.stickyFeatures || {};
  }

  setContext(context: Context, replace = false) {
    if (replace) {
      this.context = context;
    } else {
      this.context = { ...this.context, ...context };
    }

    // @TODO: how to deal with logs inside child instance?
  }

  setStickyFeatures(stickyFeatures: StickyFeatures) {
    this.stickyFeatures = stickyFeatures;
  }

  isEnabled(featureKey: FeatureKey, context: Context = {}): boolean {
    return this.parent.isEnabled(
      featureKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariation(featureKey: FeatureKey, context: Context = {}): VariationValue | null {
    return this.parent.getVariation(
      featureKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): VariableValue | null {
    return this.parent.getVariable(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableBoolean(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): boolean | null {
    return this.parent.getVariableBoolean(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): string | null {
    return this.parent.getVariableString(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): number | null {
    return this.parent.getVariableInteger(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): number | null {
    return this.parent.getVariableDouble(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableArray(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): string[] | null {
    return this.parent.getVariableArray(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableObject<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
  ): T | null {
    return this.parent.getVariableObject<T>(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }

  getVariableJSON<T>(featureKey: FeatureKey, variableKey: string, context: Context = {}): T | null {
    return this.parent.getVariableJSON<T>(
      featureKey,
      variableKey,
      {
        ...this.context,
        ...context,
      },
      {
        stickyFeatures: this.stickyFeatures,
      },
    );
  }
}

export class FeaturevisorInstance {
  // from options
  private bucketKeySeparator: string;
  private configureBucketKey?: ConfigureBucketKey;
  private configureBucketValue?: ConfigureBucketValue;
  private context: Context = {};
  private interceptContext?: InterceptContext;
  private logger: Logger;
  private stickyFeatures?: StickyFeatures;

  // internally created
  private datafileReader: DatafileReader;

  constructor(options: InstanceOptions) {
    // from options
    this.bucketKeySeparator = options.bucketKeySeparator || DEFAULT_BUCKET_KEY_SEPARATOR;
    this.configureBucketKey = options.configureBucketKey;
    this.configureBucketValue = options.configureBucketValue;
    this.context = options.context || {};
    this.interceptContext = options.interceptContext;
    this.logger = options.logger || createLogger();
    this.stickyFeatures = options.stickyFeatures;

    // datafile
    if (options.datafile) {
      this.setDatafile(options.datafile as DatafileContentV2 | string);
    }

    this.logger.info("Featurevisor SDK initialized");
  }

  setLogLevels(levels: LogLevel[]) {
    this.logger.setLevels(levels);
  }

  setDatafile(datafile: DatafileContentV2 | string) {
    try {
      this.datafileReader = new DatafileReader(
        typeof datafile === "string" ? JSON.parse(datafile) : datafile,
      );

      this.logger.info("datafile set", { revision: this.datafileReader.getRevision() });
    } catch (e) {
      this.logger.error("could not parse datafile", { error: e });
    }
  }

  setStickyFeatures(stickyFeatures: StickyFeatures | undefined) {
    this.stickyFeatures = stickyFeatures;
  }

  getRevision(): string {
    return this.datafileReader.getRevision();
  }

  getFeature(featureKey: string | Feature): Feature | undefined {
    return typeof featureKey === "string"
      ? this.datafileReader.getFeature(featureKey) // only key provided
      : featureKey; // full feature provided
  }

  // @TODO: bring "on" method back
  //
  // needed for at least listening to:
  //
  // - datafile updates
  // - context changes (if we are setting context)

  /**
   * Context
   */
  setContext(context: Context, replace = false) {
    if (replace) {
      this.context = context;
    } else {
      this.context = { ...this.context, ...context };
    }

    this.logger.debug(replace ? "context replaced" : "context updated", { context: this.context });
  }

  getContext(context?: Context, featureKey?: FeatureKey, variableKey?: VariableKey): Context {
    let result: Context = {};

    if (context) {
      result = { ...context };
    }

    if (this.context) {
      result = {
        ...this.context,
        ...result,
      };
    }

    // @TODO: before/after hooks?
    if (this.interceptContext) {
      result = this.interceptContext(result, featureKey || "", variableKey);
    }

    return result;
  }

  withContext(context: Context, options: AdditionalOptions = {}): FeaturevisorInstanceWithContext {
    return new FeaturevisorInstanceWithContext({
      parent: this,
      context: this.getContext(context),
      stickyFeatures: options.stickyFeatures,
    });
  }

  /**
   * Flag
   */
  private getEvaluationDependencies(
    featureKey: FeatureKey,
    context: Context,
    options: AdditionalOptions = {},
  ): EvaluateDependencies {
    return {
      context: this.getContext(context, featureKey as string),

      logger: this.logger,
      datafileReader: this.datafileReader,

      stickyFeatures: options.stickyFeatures
        ? {
            ...this.stickyFeatures,
            ...options.stickyFeatures,
          }
        : this.stickyFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    };
  }

  evaluateFlag(
    featureKey: FeatureKey,
    context: Context = {},
    options: AdditionalOptions = {},
  ): Evaluation {
    return evaluate(
      {
        type: "flag",
        featureKey,
      },
      this.getEvaluationDependencies(featureKey, context, options),
    );
  }

  isEnabled(
    featureKey: FeatureKey,
    context: Context = {},
    options: AdditionalOptions = {},
  ): boolean {
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
    options: AdditionalOptions = {},
  ): Evaluation {
    return evaluate(
      {
        type: "variation",
        featureKey,
      },
      this.getEvaluationDependencies(featureKey, context, options),
    );
  }

  // @TODO: consider default value as optional argument
  getVariation(
    featureKey: FeatureKey,
    context: Context = {},
    options: AdditionalOptions = {},
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
    options: AdditionalOptions = {},
  ): Evaluation {
    return evaluate(
      {
        type: "variable",
        featureKey,
        variableKey,
      },
      this.getEvaluationDependencies(featureKey, context, options),
    );
  }

  // @TODO: consider default value as optional argument
  getVariable(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
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
    options: AdditionalOptions = {},
  ): boolean | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "boolean") as boolean | null;
  }

  getVariableString(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): string | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "string") as string | null;
  }

  getVariableInteger(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "integer") as number | null;
  }

  getVariableDouble(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "double") as number | null;
  }

  getVariableArray(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): string[] | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "array") as string[] | null;
  }

  getVariableObject<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "object") as T | null;
  }

  getVariableJSON<T>(
    featureKey: FeatureKey,
    variableKey: string,
    context: Context = {},
    options: AdditionalOptions = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context, options);

    return getValueByType(variableValue, "json") as T | null;
  }
}

export function createInstance(options: InstanceOptions): FeaturevisorInstance {
  return new FeaturevisorInstance(options);
}
