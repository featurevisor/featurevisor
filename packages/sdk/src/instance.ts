import {
  Context,
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
  VariationValue,
  VariableKey,
} from "@featurevisor/types";

import { createLogger, Logger, LogLevel } from "./logger";
import { DatafileReader } from "./datafileReader";
import { Emitter } from "./emitter";
import { getBucketedNumber, ConfigureBucketKey, ConfigureBucketValue } from "./bucket";
import { Evaluation, evaluate } from "./evaluate";

export type ReadyCallback = () => void;

export type ActivationCallback = (
  featureName: string,
  variation: VariationValue,
  context: Context,
  captureContext: Context,
) => void;

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

  setLogLevels(levels: LogLevel[]) {
    this.logger.setLevels(levels);
  }

  onReady(): Promise<FeaturevisorInstance> {
    return new Promise((resolve) => {
      if (this.statuses.ready) {
        return resolve(this);
      }

      const cb = () => {
        this.emitter.removeListener("ready", cb);

        resolve(this);
      };

      this.emitter.addListener("ready", cb);
    });
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

  getFeature(featureKey: string | Feature): Feature | undefined {
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

  private getBucketValue(
    feature: Feature,
    context: Context,
  ): { bucketKey: BucketKey; bucketValue: BucketValue } {
    const bucketKey = this.getBucketKey(feature, context);

    const value = getBucketedNumber(bucketKey);

    if (this.configureBucketValue) {
      const configuredValue = this.configureBucketValue(feature, context, value);

      return {
        bucketKey,
        bucketValue: configuredValue,
      };
    }

    return {
      bucketKey,
      bucketValue: value,
    };
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
    return evaluate({
      type: "flag",

      featureKey,
      context,

      logger: this.logger,
      datafileReader: this.datafileReader,
      statuses: this.statuses,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,
      initialFeatures: this.initialFeatures,

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
      statuses: this.statuses,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,
      initialFeatures: this.initialFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    });
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
      statuses: this.statuses,
      interceptContext: this.interceptContext,

      stickyFeatures: this.stickyFeatures,
      initialFeatures: this.initialFeatures,

      bucketKeySeparator: this.bucketKeySeparator,
      configureBucketKey: this.configureBucketKey,
      configureBucketValue: this.configureBucketValue,
    });
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
