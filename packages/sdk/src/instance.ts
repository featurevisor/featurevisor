import {
  Context,
  AttributeValue,
  BucketKey,
  BucketValue,
  DatafileContent,
  Feature,
  FeatureKey,
  InitialFeatures,
  OverrideFeature,
  StickyFeatures,
  Traffic,
  VariableType,
  VariableValue,
  VariationValue,
  Variation,
  RuleKey,
  VariableKey,
  VariableSchema,
} from "@featurevisor/types";

import { createLogger, Logger } from "./logger";
import { DatafileReader } from "./datafileReader";
import { Emitter } from "./emitter";
import { getBucketedNumber } from "./bucket";
import { findForceFromFeature, getMatchedTraffic, getMatchedTrafficAndAllocation } from "./feature";
import { allConditionsAreMatched } from "./conditions";
import { allGroupSegmentsAreMatched } from "./segments";

export type ReadyCallback = () => void;

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  context: Context,
  captureContext: Context,
) => void;

export type ConfigureBucketKey = (feature, context, bucketKey: BucketKey) => BucketKey;

export type ConfigureBucketValue = (feature, context, bucketValue: BucketValue) => BucketValue;

export interface Statuses {
  ready: boolean;
  refreshInProgress: boolean;
}

const DEFAULT_BUCKET_KEY_SEPARATOR = ".";

export type InterceptContext = (context: Context) => Context;

export interface InstanceOptions {
  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;
  configureBucketValue?: ConfigureBucketValue;
  datafile?: DatafileContent | string;
  datafileUrl?: string;
  handleDatafileFetch?: (datafileUrl: string) => Promise<DatafileContent>;
  initialFeatures?: InitialFeatures;
  interceptContext?: InterceptContext;
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

export enum EvaluationReason {
  NOT_FOUND = "not_found",
  NO_VARIATIONS = "no_variations",
  OUT_OF_RANGE = "out_of_range",
  FORCED = "forced",
  INITIAL = "initial",
  STICKY = "sticky",
  RULE = "rule",
  ALLOCATED = "allocated",
  DEFAULTED = "defaulted",
  OVERRIDE = "override",
  ERROR = "error",
}

export interface Evaluation {
  // required
  featureKey: FeatureKey;
  reason: EvaluationReason;

  // common
  bucketValue?: BucketValue;
  ruleKey?: RuleKey;
  error?: Error;
  enabled?: boolean;
  traffic?: Traffic;
  sticky?: OverrideFeature;
  initial?: OverrideFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: VariableSchema;
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

type FieldType = string | VariableType;
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
  private interceptContext?: InterceptContext;
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
    this.interceptContext = options.interceptContext;
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
  private getBucketKey(feature: Feature, context: Context): BucketKey {
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
      const attributeValue = context[attributeKey];

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
      return this.configureBucketKey(feature, context, result);
    }

    return result;
  }

  private getBucketValue(feature: Feature, context: Context): BucketValue {
    const bucketKey = this.getBucketKey(feature, context);

    const value = getBucketedNumber(bucketKey);

    if (this.configureBucketValue) {
      return this.configureBucketValue(feature, context, value);
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
   * Flag
   */
  evaluateFlag(featureKey: FeatureKey | Feature, context: Context = {}): Evaluation {
    let evaluation: Evaluation;

    try {
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;

      // sticky
      if (
        this.stickyFeatures &&
        this.stickyFeatures[key] &&
        typeof this.stickyFeatures[key].enabled !== "undefined"
      ) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.STICKY,
          enabled: this.stickyFeatures[key].enabled,
          sticky: this.stickyFeatures[key],
        };

        this.logger.debug("using sticky enabled", evaluation);

        return evaluation;
      }

      // initial
      if (
        this.statuses &&
        !this.statuses.ready &&
        this.initialFeatures &&
        this.initialFeatures[key] &&
        typeof this.initialFeatures[key].enabled !== "undefined"
      ) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.INITIAL,
          enabled: this.initialFeatures[key].enabled,
          initial: this.initialFeatures[key],
        };

        this.logger.debug("using initial enabled", evaluation);

        return evaluation;
      }

      const feature = this.getFeature(featureKey);

      // not found
      if (!feature) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NOT_FOUND,
        };

        this.logger.warn("feature not found", evaluation);

        return evaluation;
      }

      const finalContext = this.interceptContext ? this.interceptContext(context) : context;

      // forced
      const force = findForceFromFeature(feature, context, this.datafileReader);

      if (force && typeof force.enabled !== "undefined") {
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.FORCED,
          enabled: force.enabled,
        };

        this.logger.debug("forced enabled found", evaluation);

        return evaluation;
      }

      // bucketing
      const bucketValue = this.getBucketValue(feature, finalContext);

      const matchedTraffic = getMatchedTraffic(feature.traffic, finalContext, this.datafileReader);

      if (matchedTraffic) {
        // check if mutually exclusive
        if (feature.ranges && feature.ranges.length > 0) {
          const matchedRange = feature.ranges.find((range) => {
            return bucketValue >= range[0] && bucketValue < range[1];
          });

          // matched
          if (matchedRange) {
            evaluation = {
              featureKey: feature.key,
              reason: EvaluationReason.ALLOCATED,
              enabled:
                typeof matchedTraffic.enabled === "undefined" ? true : matchedTraffic.enabled,
              bucketValue,
            };

            return evaluation;
          }

          // no match
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.OUT_OF_RANGE,
            enabled: false,
            bucketValue,
          };

          this.logger.debug("not matched", evaluation);

          return evaluation;
        }

        // override from rule
        if (typeof matchedTraffic.enabled !== "undefined") {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.OVERRIDE,
            enabled: matchedTraffic.enabled,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
          };

          this.logger.debug("override from rule", evaluation);

          return evaluation;
        }

        // treated as enabled because of matched traffic
        if (bucketValue < matchedTraffic.percentage) {
          // @TODO: verify if range check should be inclusive or not
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.RULE,
            enabled: true,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
          };

          return evaluation;
        }
      }

      // nothing matched
      evaluation = {
        featureKey: feature.key,
        reason: EvaluationReason.ERROR,
        enabled: false,
        bucketValue,
      };

      return evaluation;
    } catch (e) {
      evaluation = {
        featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
        reason: EvaluationReason.ERROR,
        error: e,
      };

      return evaluation;
    }
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
    let evaluation: Evaluation;

    try {
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;

      // sticky
      if (this.stickyFeatures && this.stickyFeatures[key]) {
        const variationValue = this.stickyFeatures[key].variation;

        if (typeof variationValue !== "undefined") {
          evaluation = {
            featureKey: key,
            reason: EvaluationReason.STICKY,
            variationValue,
          };

          this.logger.debug("using sticky variation", evaluation);

          return evaluation;
        }
      }

      // initial
      if (
        this.statuses &&
        !this.statuses.ready &&
        this.initialFeatures &&
        this.initialFeatures[key] &&
        typeof this.initialFeatures[key].variation !== "undefined"
      ) {
        const variationValue = this.initialFeatures[key].variation;

        evaluation = {
          featureKey: key,
          reason: EvaluationReason.INITIAL,
          variationValue,
        };

        this.logger.debug("using initial variation", evaluation);

        return evaluation;
      }

      const feature = this.getFeature(featureKey);

      // not found
      if (!feature) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NOT_FOUND,
        };

        this.logger.warn("feature not found", evaluation);

        return evaluation;
      }

      // no variations
      if (!feature.variations || feature.variations.length === 0) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NO_VARIATIONS,
        };

        this.logger.warn("no variations", evaluation);

        return evaluation;
      }

      const finalContext = this.interceptContext ? this.interceptContext(context) : context;

      // forced
      const force = findForceFromFeature(feature, context, this.datafileReader);

      if (force && force.variation) {
        const variation = feature.variations.find((v) => v.value === force.variation);

        if (variation) {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.FORCED,
            variation,
          };

          this.logger.debug("forced variation found", evaluation);

          return evaluation;
        }
      }

      // bucketing
      const bucketValue = this.getBucketValue(feature, finalContext);

      const { matchedTraffic, matchedAllocation } = getMatchedTrafficAndAllocation(
        feature.traffic,
        finalContext,
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
              reason: EvaluationReason.RULE,
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
              reason: EvaluationReason.ALLOCATED,
              bucketValue,
              variation,
            };

            this.logger.debug("allocated variation", evaluation);

            return evaluation;
          }
        }
      }

      // nothing matched
      evaluation = {
        featureKey: feature.key,
        reason: EvaluationReason.ERROR,
        bucketValue,
      };

      this.logger.debug("no matched variation", evaluation);

      return evaluation;
    } catch (e) {
      evaluation = {
        featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
        reason: EvaluationReason.ERROR,
        error: e,
      };

      return evaluation;
    }
  }

  getVariation(
    featureKey: FeatureKey | Feature,
    context: Context = {},
  ): VariationValue | undefined {
    try {
      const evaluation = this.evaluateVariation(featureKey, context);

      if (typeof evaluation.variationValue !== "undefined") {
        return evaluation.variationValue;
      }

      if (evaluation.variation) {
        return evaluation.variation.value;
      }

      return undefined;
    } catch (e) {
      this.logger.error("getVariation", { featureKey, error: e });

      return undefined;
    }
  }

  /**
   * Activate
   */
  activate(featureKey: FeatureKey, context: Context = {}): VariationValue | undefined {
    try {
      const evaluation = this.evaluateVariation(featureKey, context);
      const variationValue = evaluation.variation
        ? evaluation.variation.value
        : evaluation.variationValue;

      if (typeof variationValue === "undefined") {
        return undefined;
      }

      const finalContext = this.interceptContext ? this.interceptContext(context) : context;

      const captureContext: Context = {};

      const attributesForCapturing = this.datafileReader
        .getAllAttributes()
        .filter((a) => a.capture === true);

      attributesForCapturing.forEach((a) => {
        if (typeof finalContext[a.key] !== "undefined") {
          captureContext[a.key] = context[a.key];
        }
      });

      this.emitter.emit(
        "activation",
        featureKey,
        variationValue,
        finalContext,
        captureContext,
        evaluation,
      );

      return variationValue;
    } catch (e) {
      this.logger.error("activate", { featureKey, error: e });

      return undefined;
    }
  }

  activateBoolean(featureKey: FeatureKey, context: Context = {}): boolean | undefined {
    const variationValue = this.activate(featureKey, context);

    return getValueByType(variationValue, "boolean") as boolean | undefined;
  }

  activateString(featureKey: FeatureKey, context: Context = {}): string | undefined {
    const variationValue = this.activate(featureKey, context);

    return getValueByType(variationValue, "string") as string | undefined;
  }

  activateInteger(featureKey: FeatureKey, context: Context = {}): number | undefined {
    const variationValue = this.activate(featureKey, context);

    return getValueByType(variationValue, "integer") as number | undefined;
  }

  activateDouble(featureKey: FeatureKey, context: Context = {}): number | undefined {
    const variationValue = this.activate(featureKey, context);

    return getValueByType(variationValue, "double") as number | undefined;
  }

  /**
   * Variable
   */
  evaluateVariable(
    featureKey: FeatureKey | Feature,
    variableKey: VariableKey,
    context: Context = {},
  ): Evaluation {
    let evaluation: Evaluation;

    try {
      const key = typeof featureKey === "string" ? featureKey : featureKey.key;

      // sticky
      if (this.stickyFeatures && this.stickyFeatures[key]) {
        const variables = this.stickyFeatures[key].variables;

        if (variables) {
          const result = variables[variableKey];

          if (typeof result !== "undefined") {
            evaluation = {
              featureKey: key,
              reason: EvaluationReason.STICKY,
              variableKey,
              variableValue: result,
            };

            this.logger.debug("using sticky variable", evaluation);

            return evaluation;
          }
        }
      }

      // initial
      if (
        this.statuses &&
        !this.statuses.ready &&
        this.initialFeatures &&
        this.initialFeatures[key]
      ) {
        const variables = this.initialFeatures[key].variables;

        if (variables) {
          if (typeof variables[variableKey] !== "undefined") {
            evaluation = {
              featureKey: key,
              reason: EvaluationReason.INITIAL,
              variableKey,
              variableValue: variables[variableKey],
            };

            this.logger.debug("using initial variable", evaluation);

            return evaluation;
          }
        }
      }

      const feature = this.getFeature(featureKey);

      // not found
      if (!feature) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NOT_FOUND,
          variableKey,
        };

        this.logger.warn("feature not found in datafile", evaluation);

        return evaluation;
      }

      const variableSchema = Array.isArray(feature.variablesSchema)
        ? feature.variablesSchema.find((v) => v.key === variableKey)
        : undefined;

      // variable schema not found
      if (!variableSchema) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NOT_FOUND,
          variableKey,
        };

        this.logger.warn("variable schema not found", evaluation);

        return evaluation;
      }

      const finalContext = this.interceptContext ? this.interceptContext(context) : context;

      // forced
      const force = findForceFromFeature(feature, context, this.datafileReader);

      if (force && force.variables && typeof force.variables[variableKey] !== "undefined") {
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.FORCED,
          variableKey,
          variableSchema,
          variableValue: force.variables[variableKey],
        };

        this.logger.debug("forced variable", evaluation);

        return evaluation;
      }

      // bucketing
      const bucketValue = this.getBucketValue(feature, finalContext);

      const { matchedTraffic, matchedAllocation } = getMatchedTrafficAndAllocation(
        feature.traffic,
        finalContext,
        bucketValue,
        this.datafileReader,
        this.logger,
      );

      if (matchedTraffic) {
        // override from rule
        if (
          matchedTraffic.variables &&
          typeof matchedTraffic.variables[variableKey] !== "undefined"
        ) {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.RULE,
            variableKey,
            variableSchema,
            variableValue: matchedTraffic.variables[variableKey],
            bucketValue,
            ruleKey: matchedTraffic.key,
          };

          this.logger.debug("override from rule", evaluation);

          return evaluation;
        }

        // regular allocation
        if (matchedAllocation && matchedAllocation.variation && Array.isArray(feature.variations)) {
          const variation = feature.variations.find((v) => v.value === matchedAllocation.variation);

          if (variation && variation.variables) {
            const variableFromVariation = variation.variables.find((v) => v.key === variableKey);

            if (variableFromVariation) {
              if (variableFromVariation.overrides) {
                const override = variableFromVariation.overrides.find((o) => {
                  if (o.conditions) {
                    return allConditionsAreMatched(
                      typeof o.conditions === "string" ? JSON.parse(o.conditions) : o.conditions,
                      finalContext,
                    );
                  }

                  if (o.segments) {
                    return allGroupSegmentsAreMatched(
                      typeof o.segments === "string" && o.segments !== "*"
                        ? JSON.parse(o.segments)
                        : o.segments,
                      finalContext,
                      this.datafileReader,
                    );
                  }

                  return false;
                });

                if (override) {
                  evaluation = {
                    featureKey: feature.key,
                    reason: EvaluationReason.OVERRIDE,
                    variableKey,
                    variableSchema,
                    variableValue: override.value,
                    bucketValue,
                    ruleKey: matchedTraffic.key,
                  };

                  this.logger.debug("variable override", evaluation);

                  return evaluation;
                }
              }

              if (typeof variableFromVariation.value !== "undefined") {
                evaluation = {
                  featureKey: feature.key,
                  reason: EvaluationReason.ALLOCATED,
                  variableKey,
                  variableSchema,
                  variableValue: variableFromVariation.value,
                  bucketValue,
                  ruleKey: matchedTraffic.key,
                };

                this.logger.debug("allocated variable", evaluation);

                return evaluation;
              }
            }
          }
        }
      }

      // fall back to default
      evaluation = {
        featureKey: feature.key,
        reason: EvaluationReason.DEFAULTED,
        variableKey,
        variableSchema,
        variableValue: variableSchema.defaultValue,
        bucketValue,
      };

      this.logger.debug("using default value", evaluation);

      return evaluation;
    } catch (e) {
      evaluation = {
        featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
        reason: EvaluationReason.ERROR,
        variableKey,
        error: e,
      };

      return evaluation;
    }
  }

  getVariable(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): VariableValue | undefined {
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

      return undefined;
    } catch (e) {
      this.logger.error("getVariable", { featureKey, variableKey, error: e });

      return undefined;
    }
  }

  getVariableBoolean(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): boolean | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "boolean") as boolean | undefined;
  }

  getVariableString(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): string | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "string") as string | undefined;
  }

  getVariableInteger(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): number | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "integer") as number | undefined;
  }

  getVariableDouble(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): number | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "double") as number | undefined;
  }

  getVariableArray(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): string[] | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "array") as string[] | undefined;
  }

  getVariableObject<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): T | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "object") as T | undefined;
  }

  getVariableJSON<T>(
    featureKey: FeatureKey | Feature,
    variableKey: string,
    context: Context = {},
  ): T | undefined {
    const variableValue = this.getVariable(featureKey, variableKey, context);

    return getValueByType(variableValue, "json") as T | undefined;
  }
}

export function createInstance(options: InstanceOptions): FeaturevisorInstance {
  return new FeaturevisorInstance(options);
}
