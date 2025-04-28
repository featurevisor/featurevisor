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
import { Evaluation, evaluate } from "./evaluate";

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

export class FeaturevisorInstance {
  // from options
  private bucketKeySeparator: string;
  private configureBucketKey?: ConfigureBucketKey;
  private configureBucketValue?: ConfigureBucketValue;
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

  // @TODO: context methods
  //
  // - setContext(context, replace = false)
  // - getContext()
  //
  // - withContext(context)

  /**
   * Flag
   */
  evaluateFlag(featureKey: FeatureKey | Feature, context: Context = {}): Evaluation {
    return evaluate({
      type: "flag",

      featureKey,
      context,

      logger: this.logger,
      datafileReader: this.datafileReader,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    });
  }

  isEnabled(featureKey: FeatureKey | Feature, context: Context = {}): boolean {
    try {
      const evaluation = this.evaluateFlag(featureKey, context);

      return evaluation.enabled === true;
    } catch (e) {
      this.logger.error("isEnabled", { featureKey, error: e });

      return false;
    }
  }

  /**
   * Variation
   */
  evaluateVariation(featureKey: FeatureKey | Feature, context: Context = {}): Evaluation {
    return evaluate({
      type: "variation",

      featureKey,
      context,

      logger: this.logger,
      datafileReader: this.datafileReader,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    });
  }

  // @TODO: consider default value as optional argument
  getVariation(featureKey: FeatureKey | Feature, context: Context = {}): VariationValue | null {
    try {
      const evaluation = this.evaluateVariation(featureKey, context);

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
    featureKey: FeatureKey | Feature,
    variableKey: VariableKey,
    context: Context = {},
  ): Evaluation {
    return evaluate({
      type: "variable",

      featureKey,
      variableKey,
      context,

      logger: this.logger,
      datafileReader: this.datafileReader,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    });
  }

  // @TODO: consider default value as optional argument
  getVariable(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): VariableValue | null {
    try {
      const evaluation = this.evaluateVariable(featureKey, variableKey, context);

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
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): boolean | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "boolean") as boolean | null;
  }

  getVariableString(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): string | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "string") as string | null;
  }

  getVariableInteger(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "integer") as number | null;
  }

  getVariableDouble(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): number | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "double") as number | null;
  }

  getVariableArray(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): string[] | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "array") as string[] | null;
  }

  getVariableObject<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "object") as T | null;
  }

  getVariableJSON<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): T | null {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "json") as T | null;
  }
}

export function createInstance(options: InstanceOptions): FeaturevisorInstance {
  return new FeaturevisorInstance(options);
}
