import {
  Attributes,
  BucketKey,
  BucketValue,
  DatafileContent,
  Feature,
  FeatureKey,
  InitialFeatures,
  StickyFeatures,
  VariableType,
  VariableValue,
  VariationType,
  VariationValue,
} from "@featurevisor/types";

import { createLogger, Logger } from "./logger";
import { DatafileReader } from "./datafileReader";
import { Emitter } from "./emitter";
import { getBucketedNumber } from "./bucket";
import {
  getBucketedVariation,
  getBucketedVariableValue,
  getForcedVariation,
  getForcedVariableValue,
} from "./feature";

export type ReadyCallback = () => void;

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  attributes: Attributes,
  captureAttributes: Attributes,
) => void;

export type ConfigureBucketValue = (feature, attributes, bucketValue: BucketValue) => BucketValue;

export interface Statuses {
  ready: boolean;
  refreshInProgress: boolean;
}

export type Event = "ready" | "refresh" | "update" | "activation";

interface Listeners {
  [key: string]: Function[];
}

export interface InstanceOptions {
  configureBucketValue?: ConfigureBucketValue;
  datafile?: DatafileContent | string;
  datafileUrl?: string;
  handleDatafileFetch?: (datafileUrl: string) => Promise<DatafileContent>;
  initialFeatures?: InitialFeatures;
  interceptAttributes?: (attributes: Attributes) => Attributes;
  logger?: Logger;
  onActivation?: ActivationCallback;
  onReady?: ReadyCallback;
  onRefresh?: () => void;
  onUpdate?: () => void;
  refreshInterval?: number; // seconds
  stickyFeatures?: StickyFeatures;
}

const emptyDatafile: DatafileContent = {
  schemaVersion: "1",
  revision: "unknown",
  attributes: [],
  segments: [],
  features: [],
};

export type DatafileFetchHandler = (datafileUrl: string) => Promise<DatafileContent>;

function fetchDatafileContent(
  datafileUrl,
  handleDatafileFetch?: DatafileFetchHandler,
): Promise<DatafileContent> {
  if (handleDatafileFetch) {
    return handleDatafileFetch(datafileUrl);
  }

  return fetch(datafileUrl).then((res) => res.json());
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

export class FeaturevisorInstance {
  // from options
  private configureBucketValue?: ConfigureBucketValue;
  private datafileUrl?: string;
  private handleDatafileFetch?: DatafileFetchHandler;
  private initialFeatures?: InitialFeatures;
  private interceptAttributes?: (attributes: Attributes) => Attributes;
  private logger: Logger;
  private refreshInterval?: number; // seconds
  private stickyFeatures?: StickyFeatures;

  // internally created
  private datafileReader: DatafileReader;
  private emitter: Emitter;
  private statuses: Statuses;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(options: InstanceOptions) {
    // from options
    this.configureBucketValue = options.configureBucketValue;
    this.datafileUrl = options.datafileUrl;
    this.handleDatafileFetch = options.handleDatafileFetch;
    this.initialFeatures = options.initialFeatures;
    this.interceptAttributes = options.interceptAttributes;
    this.logger = options.logger || createLogger();
    this.refreshInterval = options.refreshInterval;
    this.stickyFeatures = options.stickyFeatures;

    // internal
    this.emitter = new Emitter();
    this.statuses = {
      ready: false,
      refreshInProgress: false,
    };

    // events
    if (options.onReady) {
      this.emitter.addListener("ready", options.onReady);
    }

    if (options.onRefresh) {
      this.emitter.addListener("refresh", options.onRefresh);
    }

    if (options.onUpdate) {
      this.emitter.addListener("update", options.onUpdate);
    }

    if (options.onActivation) {
      this.emitter.addListener("activation", options.onActivation);
    }

    // datafile
    if (options.datafileUrl) {
      this.setDatafile(options.datafile || emptyDatafile);

      fetchDatafileContent(options.datafileUrl, options.handleDatafileFetch)
        .then((datafile) => {
          this.setDatafile(datafile);

          this.statuses.ready = true;
          this.emitter.emit("ready");

          if (this.refreshInterval) {
            this.startRefreshing();
          }
        })
        .catch((e) => {
          this.logger.error("failed to fetch datafile", { error: e });
        });
    } else if (options.datafile) {
      this.setDatafile(options.datafile);
      setTimeout(() => {
        this.emitter.emit("ready");
      }, 0);
    } else {
      throw new Error(
        "Featurevisor SDK instance cannot be created without both `datafile` and `datafileUrl` options",
      );
    }
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

  setStickyFeatures(stickyFeatures: StickyFeatures | undefined) {
    this.stickyFeatures = stickyFeatures;
  }

  getRevision(): string {
    return this.datafileReader.getRevision();
  }

  private getFeature(featureKey: string | Feature): Feature | undefined {
    return typeof featureKey === "string"
      ? this.datafileReader.getFeature(featureKey) // only key provided
      : featureKey; // full feature provided
  }

  /**
   * Statuses
   */
  isReady(): boolean {
    return this.statuses.ready;
  }

  /**
   * Refresh
   */
  refresh() {
    this.logger.debug("refreshing datafile");

    if (this.statuses.refreshInProgress) {
      return this.logger.warn("refresh in progress, skipping");
    }

    if (!this.datafileUrl) {
      return this.logger.error("cannot refresh since `datafileUrl` is not provided");
    }

    this.statuses.refreshInProgress = true;

    fetchDatafileContent(this.datafileUrl, this.handleDatafileFetch)
      .then((datafile) => {
        const currentRevision = this.getRevision();
        const newRevision = datafile.revision;
        const isNotSameRevision = currentRevision !== newRevision;

        this.setDatafile(datafile);
        this.logger.info("refreshed datafile");

        this.emitter.emit("refresh");

        if (isNotSameRevision) {
          this.emitter.emit("update");
        }

        this.statuses.refreshInProgress = false;
      })
      .catch((e) => {
        this.logger.error("failed to refresh datafile", { error: e });
        this.statuses.refreshInProgress = false;
      });
  }

  startRefreshing() {
    if (!this.datafileUrl) {
      return this.logger.error("cannot start refreshing since `datafileUrl` is not provided");
    }

    if (this.intervalId) {
      return this.logger.warn("refreshing has already started");
    }

    if (!this.refreshInterval) {
      return this.logger.warn("no `refreshInterval` option provided");
    }

    this.intervalId = setInterval(() => {
      this.refresh();
    }, this.refreshInterval * 1000);
  }

  stopRefreshing() {
    if (!this.intervalId) {
      return this.logger.warn("refreshing has not started yet");
    }

    clearInterval(this.intervalId);
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
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;

      if (this.stickyFeatures && this.stickyFeatures[key]) {
        const result = this.stickyFeatures[key].variation;

        if (typeof result !== "undefined") {
          this.logger.debug("using sticky variation", {
            featureKey: key,
            variation: result,
          });

          return result;
        }
      }

      if (
        this.statuses &&
        !this.statuses.ready &&
        this.initialFeatures &&
        this.initialFeatures[key]
      ) {
        const result = this.initialFeatures[key].variation;

        if (typeof result !== "undefined") {
          this.logger.debug("using initial variation", {
            featureKey: key,
            variation: result,
          });

          return result;
        }
      }

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

      this.emitter.emit(
        "activation",
        featureKey,
        variationValue,
        finalAttributes,
        captureAttributes,
      );

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
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;

      if (this.stickyFeatures && this.stickyFeatures[key] && this.stickyFeatures[key].variables) {
        const result = this.stickyFeatures[key].variables[variableKey];

        if (typeof result !== "undefined") {
          this.logger.debug("using sticky variable", {
            featureKey: key,
            variableKey,
          });

          return result;
        }
      }

      if (
        this.statuses &&
        !this.statuses.ready &&
        this.initialFeatures &&
        this.initialFeatures[key] &&
        this.initialFeatures[key].variables
      ) {
        const result = this.initialFeatures[key].variables[variableKey];

        if (typeof result !== "undefined") {
          this.logger.debug("using initial variable", {
            featureKey: key,
            variableKey,
          });

          return result;
        }
      }

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

export function createInstance(options: InstanceOptions): FeaturevisorInstance {
  return new FeaturevisorInstance(options);
}
