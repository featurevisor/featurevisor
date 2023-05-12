import { DatafileContent, Attributes, StickyFeatures } from "@featurevisor/types";
import { FeaturevisorSDK, ConfigureBucketValue, ActivationCallback } from "./client";
import { createLogger, Logger } from "./logger";
import { Emitter } from "./emitter";

export type ReadyCallback = () => void;

export interface InstanceOptions {
  // from SdkOptions
  datafile?: DatafileContent | string; // optional here, but not in SdkOptions
  onActivation?: ActivationCallback;
  configureBucketValue?: ConfigureBucketValue;

  // additions
  datafileUrl?: string;
  onReady?: ReadyCallback;
  handleDatafileFetch?: (datafileUrl: string) => Promise<DatafileContent>;
  logger?: Logger;
  interceptAttributes?: (attributes: Attributes) => Attributes;
  refreshInterval?: number; // seconds
  onRefresh?: () => void;
  onUpdate?: () => void;
  stickyFeatures?: StickyFeatures;
}

export type Event = "ready" | "refresh" | "update" | "activation";

// @TODO: consider renaming it to FeaturevisorSDK in next breaking semver
export interface FeaturevisorInstance {
  /**
   * From FeaturevisorSDK
   */

  // variation
  getVariation: FeaturevisorSDK["getVariation"];
  getVariationBoolean: FeaturevisorSDK["getVariationBoolean"];
  getVariationInteger: FeaturevisorSDK["getVariationInteger"];
  getVariationDouble: FeaturevisorSDK["getVariationDouble"];
  getVariationString: FeaturevisorSDK["getVariationString"];

  // activate
  activate: FeaturevisorSDK["activate"];
  activateBoolean: FeaturevisorSDK["activateBoolean"];
  activateInteger: FeaturevisorSDK["activateInteger"];
  activateDouble: FeaturevisorSDK["activateDouble"];
  activateString: FeaturevisorSDK["activateString"];

  // variable
  getVariable: FeaturevisorSDK["getVariable"];
  getVariableBoolean: FeaturevisorSDK["getVariableBoolean"];
  getVariableInteger: FeaturevisorSDK["getVariableInteger"];
  getVariableDouble: FeaturevisorSDK["getVariableDouble"];
  getVariableString: FeaturevisorSDK["getVariableString"];
  getVariableArray: FeaturevisorSDK["getVariableArray"];
  getVariableObject: FeaturevisorSDK["getVariableObject"];

  /**
   * Additions
   */
  setLogLevels: Logger["setLevels"];
  setStickyFeatures: FeaturevisorSDK["setStickyFeatures"];

  refresh: () => void;
  startRefreshing: () => void;
  stopRefreshing: () => void;

  addListener: Emitter["addListener"];
  on: Emitter["addListener"];
  removeListener: Emitter["removeListener"];
  off: Emitter["removeListener"];
  removeAllListeners: Emitter["removeAllListeners"];

  isReady: () => boolean;
}

function fetchDatafileContent(datafileUrl, options: InstanceOptions): Promise<DatafileContent> {
  if (options.handleDatafileFetch) {
    return options.handleDatafileFetch(datafileUrl);
  }

  return fetch(datafileUrl).then((res) => res.json());
}

interface Listeners {
  [key: string]: Function[];
}

interface Statuses {
  ready: boolean;
  refreshInProgress: boolean;
}

function getInstanceFromSdk(
  sdk: FeaturevisorSDK,
  options: InstanceOptions,
  logger: Logger,
  emitter: Emitter,
  statuses: Statuses,
): FeaturevisorInstance {
  let intervalId;

  const on = emitter.addListener.bind(emitter);
  const off = emitter.removeListener.bind(emitter);

  const instance: FeaturevisorInstance = {
    // variation
    getVariation: sdk.getVariation.bind(sdk),
    getVariationBoolean: sdk.getVariationBoolean.bind(sdk),
    getVariationInteger: sdk.getVariationInteger.bind(sdk),
    getVariationDouble: sdk.getVariationDouble.bind(sdk),
    getVariationString: sdk.getVariationString.bind(sdk),

    // activate
    activate: sdk.activate.bind(sdk),
    activateBoolean: sdk.activateBoolean.bind(sdk),
    activateInteger: sdk.activateInteger.bind(sdk),
    activateDouble: sdk.activateDouble.bind(sdk),
    activateString: sdk.activateString.bind(sdk),

    // variable
    getVariable: sdk.getVariable.bind(sdk),
    getVariableBoolean: sdk.getVariableBoolean.bind(sdk),
    getVariableInteger: sdk.getVariableInteger.bind(sdk),
    getVariableDouble: sdk.getVariableDouble.bind(sdk),
    getVariableString: sdk.getVariableString.bind(sdk),
    getVariableArray: sdk.getVariableArray.bind(sdk),
    getVariableObject: sdk.getVariableObject.bind(sdk),

    // additions
    setLogLevels: logger.setLevels.bind(logger),
    setStickyFeatures: sdk.setStickyFeatures.bind(sdk),

    // emitter
    on: on,
    addListener: on,
    off: off,
    removeListener: off,
    removeAllListeners: emitter.removeAllListeners.bind(emitter),

    // refresh
    refresh() {
      logger.debug("refreshing datafile");

      if (statuses.refreshInProgress) {
        return logger.warn("refresh in progress, skipping");
      }

      if (!options.datafileUrl) {
        return logger.error("cannot refresh since `datafileUrl` is not provided");
      }

      statuses.refreshInProgress = true;

      fetchDatafileContent(options.datafileUrl, options)
        .then((datafile) => {
          const currentRevision = sdk.getRevision();
          const newRevision = datafile.revision;
          const isNotSameRevision = currentRevision !== newRevision;

          sdk.setDatafile(datafile);
          logger.info("refreshed datafile");

          emitter.emit("refresh");

          if (isNotSameRevision) {
            emitter.emit("update");
          }

          statuses.refreshInProgress = false;
        })
        .catch((e) => {
          logger.error("failed to refresh datafile", { error: e });
          statuses.refreshInProgress = false;
        });
    },

    startRefreshing() {
      if (!options.datafileUrl) {
        return logger.error("cannot start refreshing since `datafileUrl` is not provided");
      }

      if (intervalId) {
        return logger.warn("refreshing has already started");
      }

      if (!options.refreshInterval) {
        return logger.warn("no `refreshInterval` option provided");
      }

      intervalId = setInterval(() => {
        instance.refresh();
      }, options.refreshInterval * 1000);
    },

    stopRefreshing() {
      if (!intervalId) {
        return logger.warn("refreshing has not started yet");
      }

      clearInterval(intervalId);
    },

    isReady() {
      return statuses.ready;
    },
  };

  if (options.datafileUrl && options.refreshInterval) {
    instance.startRefreshing();
  }

  return instance;
}

const emptyDatafile: DatafileContent = {
  schemaVersion: "1",
  revision: "unknown",
  attributes: [],
  segments: [],
  features: [],
};

export function createInstance(options: InstanceOptions) {
  if (!options.datafile && !options.datafileUrl) {
    throw new Error(
      "Featurevisor SDK instance cannot be created without both `datafile` and `datafileUrl` options",
    );
  }

  const logger = options.logger || createLogger();
  const emitter = new Emitter();
  const statuses: Statuses = {
    ready: false,
    refreshInProgress: false,
  };

  if (!options.datafileUrl && options.refreshInterval) {
    logger.warn("refreshing datafile requires `datafileUrl` option");
  }

  if (options.onReady) {
    emitter.addListener("ready", options.onReady);
  }

  if (options.onActivation) {
    emitter.addListener("activation", options.onActivation);
  }

  if (options.onRefresh) {
    emitter.addListener("refresh", options.onRefresh);
  }

  if (options.onUpdate) {
    emitter.addListener("update", options.onUpdate);
  }

  // datafile content is already provided
  if (options.datafile) {
    const sdk = new FeaturevisorSDK({
      datafile: options.datafile,
      onActivation: options.onActivation,
      configureBucketValue: options.configureBucketValue,
      logger,
      emitter,
      interceptAttributes: options.interceptAttributes,
      stickyFeatures: options.stickyFeatures,
      fromInstance: true,
    });

    statuses.ready = true;
    setTimeout(function () {
      emitter.emit("ready");
    }, 0);

    return getInstanceFromSdk(sdk, options, logger, emitter, statuses);
  }

  // datafile has to be fetched
  const sdk = new FeaturevisorSDK({
    datafile: emptyDatafile,
    onActivation: options.onActivation,
    configureBucketValue: options.configureBucketValue,
    logger,
    emitter,
    interceptAttributes: options.interceptAttributes,
    stickyFeatures: options.stickyFeatures,
    fromInstance: true,
  });

  if (options.datafileUrl) {
    fetchDatafileContent(options.datafileUrl, options)
      .then((datafile) => {
        sdk.setDatafile(datafile);

        statuses.ready = true;
        emitter.emit("ready");
      })
      .catch((e) => {
        logger.error("failed to fetch datafile:");
        console.error(e);
      });
  }

  return getInstanceFromSdk(sdk, options, logger, emitter, statuses);
}
