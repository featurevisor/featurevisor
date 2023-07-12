import {
  Attributes,
  AttributeValue,
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
  Variation,
  RuleKey,
} from "@featurevisor/types";

import { createLogger, Logger } from "./logger";
import { DatafileReader } from "./datafileReader";
import { Emitter } from "./emitter";
import { getBucketedNumber } from "./bucket";
import {
  getBucketedVariableValue,
  getForcedVariableValue,
  findForceFromFeature,
  getMatchedTrafficAndAllocation,
} from "./feature";

export type ReadyCallback = () => void;

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  attributes: Attributes,
  captureAttributes: Attributes,
) => void;

export type ConfigureBucketKey = (feature, attributes, bucketKey: BucketKey) => BucketKey;

export type ConfigureBucketValue = (feature, attributes, bucketValue: BucketValue) => BucketValue;

export interface Statuses {
  ready: boolean;
  refreshInProgress: boolean;
}

const DEFAULT_BUCKET_KEY_SEPARATOR = ".";

export interface InstanceOptions {
  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;
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

export enum VariationEvaluationReason {
  NOT_FOUND = "not_found",
  NOT_MATCHED = "not_matched",
  MATCHED = "matched",
  FORCED = "forced",
  NOT_FORCED = "not_forced",
  INITIAL = "initial",
  STICKY = "sticky",
  RULE = "rule",
  ALLOCATED = "allocated",
  DEFAULT = "default",
  ERROR = "error",

  // should never happen
  NO_MATCHED_VARIATION = "no_matched_variation",
}

export interface VariationEvaluation {
  featureKey: FeatureKey;
  reason: VariationEvaluationReason;
  variation?: Variation;
  variationValue?: VariableValue;
  bucketValue?: BucketValue;
  ruleKey?: RuleKey;
  error?: Error;
}

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
  try {
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
  } catch (e) {
    return undefined;
  }
}

export class FeaturevisorInstance {
  // from options
  private bucketKeySeparator: string;
  private configureBucketKey?: ConfigureBucketKey;
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

  // exposed from emitter
  public on: Emitter["addListener"];
  public addListener: Emitter["addListener"];
  public off: Emitter["removeListener"];
  public removeListener: Emitter["removeListener"];
  public removeAllListeners: Emitter["removeAllListeners"];

  constructor(options: InstanceOptions) {
    // from options
    this.bucketKeySeparator = options.bucketKeySeparator || DEFAULT_BUCKET_KEY_SEPARATOR;
    this.configureBucketKey = options.configureBucketKey;
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

    // register events
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

    // expose emitter methods
    const on = this.emitter.addListener.bind(this.emitter);
    this.on = on;
    this.addListener = on;

    const off = this.emitter.removeListener.bind(this.emitter);
    this.off = off;
    this.removeListener = off;

    this.removeAllListeners = this.emitter.removeAllListeners.bind(this.emitter);

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
      this.statuses.ready = true;

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
   * Bucketing
   */
  private getBucketKey(feature: Feature, attributes: Attributes): BucketKey {
    const featureKey = feature.key;

    let type;
    let attributeKeys;

    if (typeof feature.bucketBy === "string") {
      type = "plain";
      attributeKeys = [feature.bucketBy];
    } else if (Array.isArray(feature.bucketBy)) {
      type = "and";
      attributeKeys = feature.bucketBy;
    } else if (typeof feature.bucketBy === "object" && Array.isArray(feature.bucketBy.or)) {
      type = "or";
      attributeKeys = feature.bucketBy.or;
    } else {
      this.logger.error("invalid bucketBy", { featureKey, bucketBy: feature.bucketBy });

      throw new Error("invalid bucketBy");
    }

    const bucketKey: AttributeValue[] = [];

    attributeKeys.forEach((attributeKey) => {
      const attributeValue = attributes[attributeKey];

      if (typeof attributeValue === "undefined") {
        return;
      }

      if (type === "plain" || type === "and") {
        bucketKey.push(attributeValue);
      } else {
        // or
        if (bucketKey.length === 0) {
          bucketKey.push(attributeValue);
        }
      }
    });

    bucketKey.push(featureKey);

    const result = bucketKey.join(this.bucketKeySeparator);

    if (this.configureBucketKey) {
      return this.configureBucketKey(feature, attributes, result);
    }

    return result;
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
   * Variation
   */
  evaluateVariation(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): VariationEvaluation {
    let evaluation: VariationEvaluation;

    try {
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;
      const feature = this.getFeature(featureKey);

      // not found
      if (!feature) {
        evaluation = {
          featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
          reason: VariationEvaluationReason.NOT_FOUND,
        };

        this.logger.warn("feature not found in datafile", evaluation);

        return evaluation;
      }

      // sticky
      if (this.stickyFeatures && this.stickyFeatures[key]) {
        const variationValue = this.stickyFeatures[key].variation;

        if (typeof variationValue !== "undefined") {
          evaluation = {
            featureKey: key,
            reason: VariationEvaluationReason.STICKY,
            variation: feature.variations.find((v) => v.value === variationValue),
            variationValue,
          };

          this.logger.debug("using sticky variation", evaluation);

          return evaluation;
        }
      }

      const finalAttributes = this.interceptAttributes
        ? this.interceptAttributes(attributes)
        : attributes;

      // forced
      const force = findForceFromFeature(feature, attributes, this.datafileReader);

      if (force && force.variation) {
        const variation = feature.variations.find((v) => v.value === force.variation);

        if (variation) {
          evaluation = {
            featureKey: feature.key,
            reason: VariationEvaluationReason.FORCED,
            variation,
          };

          this.logger.debug("forced variation found", evaluation);

          return evaluation;
        }
      }

      // bucketing
      const bucketValue = this.getBucketValue(feature, finalAttributes);

      const { matchedTraffic, matchedAllocation } = getMatchedTrafficAndAllocation(
        feature.traffic,
        finalAttributes,
        bucketValue,
        this.datafileReader,
        this.logger,
      );

      if (matchedTraffic) {
        // override from rule
        if (matchedTraffic.variation) {
          const variation = feature.variations.find((v) => v.value === matchedTraffic.variation);

          if (variation) {
            evaluation = {
              featureKey: feature.key,
              reason: VariationEvaluationReason.RULE,
              variation,
              bucketValue,
              ruleKey: matchedTraffic.key,
            };

            this.logger.debug("override from rule", evaluation);

            return evaluation;
          }
        }

        // regular allocation
        if (matchedAllocation && matchedAllocation.variation) {
          const variation = feature.variations.find((v) => v.value === matchedAllocation.variation);

          if (variation) {
            evaluation = {
              featureKey: feature.key,
              reason: VariationEvaluationReason.ALLOCATED,
              bucketValue,
              variation,
            };

            this.logger.debug("allocated variation", evaluation);

            return evaluation;
          }
        }
      }

      // fall back to default
      const variation = feature.variations.find((v) => v.value === feature.defaultVariation);

      if (variation) {
        evaluation = {
          featureKey: feature.key,
          reason: VariationEvaluationReason.DEFAULT,
          bucketValue,
          variation,
        };

        this.logger.debug("using default variation", evaluation);

        return evaluation;
      }

      // nothing matched (this should never happen)
      evaluation = {
        featureKey: feature.key,
        reason: VariationEvaluationReason.ERROR,
        bucketValue,
      };

      this.logger.error("no matched variation", evaluation);

      return evaluation;
    } catch (e) {
      evaluation = {
        featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
        reason: VariationEvaluationReason.ERROR,
        error: e,
      };

      return evaluation;
    }
  }

  getVariation(
    featureKey: FeatureKey | Feature,
    attributes: Attributes = {},
  ): VariationValue | undefined {
    try {
      const evaluation = this.evaluateVariation(featureKey, attributes);

      if (evaluation.variation) {
        return evaluation.variation.value;
      }

      return undefined;
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
