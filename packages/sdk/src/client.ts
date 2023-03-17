import {
  Attributes,
  VariationValue,
  VariableValue,
  Feature,
  DatafileContent,
  BucketKey,
  BucketValue,
  FeatureKey,
  VariableObjectValue,
} from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import {
  getBucketedVariation,
  getBucketedVariableValue,
  getForcedVariation,
  getForcedVariableValue,
} from "./feature";
import { getBucketedNumber } from "./bucket";

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  attributes: Attributes,
  captureAttributes: Attributes,
) => void;

export type ConfigureBucketValue = (feature, attributes, bucketValue: BucketValue) => BucketValue;
export interface SdkOptions {
  datafile: DatafileContent | string;
  onActivation?: ActivationCallback;
  configureBucketValue?: ConfigureBucketValue;
}

// union of VariableValue and VariationValue
type FieldType = "string" | "integer" | "double" | "boolean" | "array" | "object";
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
    default:
      return value;
  }
}

export class FeaturevisorSDK {
  private onActivation?: ActivationCallback;
  private datafileReader: DatafileReader;
  private configureBucketValue?: ConfigureBucketValue;

  constructor(options: SdkOptions) {
    if (options.onActivation) {
      this.onActivation = options.onActivation;
    }

    if (options.configureBucketValue) {
      this.configureBucketValue = options.configureBucketValue;
    }

    try {
      this.datafileReader = new DatafileReader(
        typeof options.datafile === "string" ? JSON.parse(options.datafile) : options.datafile,
      );
    } catch (e) {
      console.error(`Featurevisor could not parse the datafile`);
      console.error(e);
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
        return undefined;
      }

      const forcedVariation = getForcedVariation(feature, attributes, this.datafileReader);

      if (forcedVariation) {
        return forcedVariation.value;
      }

      const bucketValue = this.getBucketValue(feature, attributes);

      const variation = getBucketedVariation(feature, attributes, bucketValue, this.datafileReader);

      if (!variation) {
        return undefined;
      }

      return variation.value;
    } catch (e) {
      console.error("[Featurevisor]", e);

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

      if (!variationValue) {
        return undefined;
      }

      if (this.onActivation) {
        const captureAttributes: Attributes = {};

        const attributesForCapturing = this.datafileReader
          .getAllAttributes()
          .filter((a) => a.capture === true);

        attributesForCapturing.forEach((a) => {
          if (typeof attributes[a.key] !== "undefined") {
            captureAttributes[a.key] = attributes[a.key];
          }
        });

        this.onActivation(featureKey, variationValue, attributes, captureAttributes);
      }

      return variationValue;
    } catch (e) {
      console.error("[Featurevisor]", e);

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
        return undefined;
      }

      const forcedVariableValue = getForcedVariableValue(
        feature,
        variableKey,
        attributes,
        this.datafileReader,
      );

      if (typeof forcedVariableValue !== "undefined") {
        return forcedVariableValue;
      }

      const bucketValue = this.getBucketValue(feature, attributes);

      return getBucketedVariableValue(
        feature,
        variableKey,
        attributes,
        bucketValue,
        this.datafileReader,
      );
    } catch (e) {
      console.error("[Featurevisor]", e);

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
}
