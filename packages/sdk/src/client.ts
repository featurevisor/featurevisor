import {
  Attributes,
  VariationValue,
  VariableValue,
  Feature,
  DatafileContent,
  BucketKey,
  BucketValue,
  FeatureKey,
  VariationType,
  VariableType,
} from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import {
  getBucketedVariation,
  getBucketedVariableValue,
  getForcedVariation,
  getForcedVariableValue,
} from "./feature";
import { getBucketedNumber } from "./bucket";
import { createLogger, Logger } from "./logger";

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  attributes: Attributes,
  captureAttributes: Attributes,
) => void;

export type ConfigureBucketValue = (feature, attributes, bucketValue: BucketValue) => BucketValue;

export interface SdkOptions {
  datafile: DatafileContent | string;
  onActivation?: ActivationCallback; // @TODO: move it to FeaturevisorInstance in next breaking semver
  configureBucketValue?: ConfigureBucketValue;
  logger?: Logger; // @TODO: keep it in FeaturevisorInstance only in next breaking semver
  interceptAttributes?: (attributes: Attributes) => Attributes; // @TODO: move it to FeaturevisorInstance in next breaking semver
}

type FieldType = VariationType | VariableType;
type ValueType = VariableValue;

export function getValueByType(value: ValueType, fieldType: FieldType): ValueType {
  if (value === undefined) {
    return undefined;
  }

  switch (fieldType) {
    case "string":
      return typeof value === "string" ? value : undefined;
    case "integer":
      return parseInt(value as string, 10);
    case "double":
      return parseFloat(value as string);
    case "boolean":
      return value === true;
    case "array":
      return Array.isArray(value) ? value : undefined;
    case "object":
      return typeof value === "object" ? value : undefined;
    // @NOTE: `json` is not handled here intentionally
    default:
      return value;
  }
}

// @TODO: change it to FeaturevisorEngine in next breaking semver
// @TODO: move activate*() methods to FeaturevisorInstance in next breaking semver
export class FeaturevisorSDK {
  private onActivation?: ActivationCallback;
  private datafileReader: DatafileReader;
  private configureBucketValue?: ConfigureBucketValue;
  private logger: Logger;
  private interceptAttributes?: (attributes: Attributes) => Attributes;

  constructor(options: SdkOptions) {
    if (options.onActivation) {
      this.onActivation = options.onActivation;
    }

    if (options.configureBucketValue) {
      this.configureBucketValue = options.configureBucketValue;
    }

    this.logger = options.logger || createLogger();

    if (options.interceptAttributes) {
      this.interceptAttributes = options.interceptAttributes;
    }

    this.setDatafile(options.datafile);
  }

  setDatafile(datafile: DatafileContent | string) {
    try {
      this.datafileReader = new DatafileReader(
        typeof datafile === "string" ? JSON.parse(datafile) : datafile,
      );
    } catch (e) {
      this.logger.error("could not parse datafile", { error: e });
    }
  }

  private getFeature(featureKey: string | Feature): Feature | undefined {
    return typeof featureKey === "string"
      ? this.datafileReader.getFeature(featureKey) // only key provided
      : featureKey; // full feature provided
  }

  /**
   * Bucketing
   */

  private getBucketKey(feature: Feature, attributes: Attributes): BucketKey {
    const featureKey = feature.key;

    const prefix =
      typeof feature.bucketBy === "string" ? feature.bucketBy : feature.bucketBy.join("_");

    return `${prefix}_${featureKey}`;
  }

  private getBucketValue(feature: Feature, attributes: Attributes): BucketValue {
    const bucketKey = this.getBucketKey(feature, attributes);

    const value = getBucketedNumber(bucketKey);

    if (this.configureBucketValue) {
      return this.configureBucketValue(feature, attributes, value);
    }

    return value;
  }

  /**
   * Variation
   */

  getVariation(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): VariationValue | undefined {
    try {
      const feature = this.getFeature(featureKey);

      if (!feature) {
        this.logger.warn("feature not found in datafile", { featureKey });

        return undefined;
      }

      const finalAttributes = this.interceptAttributes
        ? this.interceptAttributes(attributes)
        : attributes;

      const forcedVariation = getForcedVariation(feature, finalAttributes, this.datafileReader);

      if (forcedVariation) {
        this.logger.debug("forced variation found", {
          featureKey,
          variation: forcedVariation.value,
        });

        return forcedVariation.value;
      }

      const bucketValue = this.getBucketValue(feature, finalAttributes);

      const variation = getBucketedVariation(
        feature,
        finalAttributes,
        bucketValue,
        this.datafileReader,
        this.logger,
      );

      if (!variation) {
        this.logger.debug("using default variation", {
          featureKey,
          bucketValue,
          variation: feature.defaultVariation,
        });

        return feature.defaultVariation;
      }

      return variation.value;
    } catch (e) {
      this.logger.error("getVariation", { featureKey, error: e });

      return undefined;
    }
  }

  getVariationBoolean(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): boolean | undefined {
    const variationValue = this.getVariation(featureKey, attributes);

    return getValueByType(variationValue, "boolean") as boolean | undefined;
  }

  getVariationString(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): string | undefined {
    const variationValue = this.getVariation(featureKey, attributes);

    return getValueByType(variationValue, "string") as string | undefined;
  }

  getVariationInteger(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): number | undefined {
    const variationValue = this.getVariation(featureKey, attributes);

    return getValueByType(variationValue, "integer") as number | undefined;
  }

  getVariationDouble(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): number | undefined {
    const variationValue = this.getVariation(featureKey, attributes);

    return getValueByType(variationValue, "double") as number | undefined;
  }

  /**
   * Activate
   */
  activate(featureKey: FeatureKey, attributes: Attributes = {}): VariationValue | undefined {
    try {
      const variationValue = this.getVariation(featureKey, attributes);

      if (typeof variationValue === "undefined") {
        return undefined;
      }

      if (this.onActivation) {
        const finalAttributes = this.interceptAttributes
          ? this.interceptAttributes(attributes)
          : attributes;

        const captureAttributes: Attributes = {};

        const attributesForCapturing = this.datafileReader
          .getAllAttributes()
          .filter((a) => a.capture === true);

        attributesForCapturing.forEach((a) => {
          if (typeof finalAttributes[a.key] !== "undefined") {
            captureAttributes[a.key] = attributes[a.key];
          }
        });

        this.onActivation(featureKey, variationValue, finalAttributes, captureAttributes);
      }

      return variationValue;
    } catch (e) {
      this.logger.error("activate", { featureKey, error: e });

      return undefined;
    }
  }

  activateBoolean(featureKey: FeatureKey, attributes: Attributes = {}): boolean | undefined {
    const variationValue = this.activate(featureKey, attributes);

    return getValueByType(variationValue, "boolean") as boolean | undefined;
  }

  activateString(featureKey: FeatureKey, attributes: Attributes = {}): string | undefined {
    const variationValue = this.activate(featureKey, attributes);

    return getValueByType(variationValue, "string") as string | undefined;
  }

  activateInteger(featureKey: FeatureKey, attributes: Attributes = {}): number | undefined {
    const variationValue = this.activate(featureKey, attributes);

    return getValueByType(variationValue, "integer") as number | undefined;
  }

  activateDouble(featureKey: FeatureKey, attributes: Attributes = {}): number | undefined {
    const variationValue = this.activate(featureKey, attributes);

    return getValueByType(variationValue, "double") as number | undefined;
  }

  /**
   * Variable
   */

  getVariable(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): VariableValue | undefined {
    try {
      const feature = this.getFeature(featureKey);

      if (!feature) {
        this.logger.warn("feature not found in datafile", { featureKey, variableKey });

        return undefined;
      }

      const variableSchema = Array.isArray(feature.variablesSchema)
        ? feature.variablesSchema.find((v) => v.key === variableKey)
        : undefined;

      if (!variableSchema) {
        this.logger.warn("variable schema not found", { featureKey, variableKey });

        return undefined;
      }

      const finalAttributes = this.interceptAttributes
        ? this.interceptAttributes(attributes)
        : attributes;

      const forcedVariableValue = getForcedVariableValue(
        feature,
        variableSchema,
        finalAttributes,
        this.datafileReader,
      );

      if (typeof forcedVariableValue !== "undefined") {
        this.logger.debug("forced variable value found", { featureKey, variableKey });

        return forcedVariableValue;
      }

      const bucketValue = this.getBucketValue(feature, finalAttributes);

      return getBucketedVariableValue(
        feature,
        variableSchema,
        finalAttributes,
        bucketValue,
        this.datafileReader,
        this.logger,
      );
    } catch (e) {
      this.logger.error("getVariable", { featureKey, variableKey, error: e });

      return undefined;
    }
  }

  getVariableBoolean(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): boolean | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "boolean") as boolean | undefined;
  }

  getVariableString(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): string | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "string") as string | undefined;
  }

  getVariableInteger(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): number | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "integer") as number | undefined;
  }

  getVariableDouble(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): number | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "double") as number | undefined;
  }

  getVariableArray(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): string[] | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "array") as string[] | undefined;
  }

  getVariableObject<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): T | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "object") as T | undefined;
  }

  getVariableJSON<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    attributes: Attributes = {},
  ): T | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, attributes);

    return getValueByType(variableValue, "json") as T | undefined;
  }
}
