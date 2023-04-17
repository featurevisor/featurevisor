import { DatafileContent, Attributes } from "@featurevisor/types";
import { FeaturevisorSDK, ConfigureBucketValue, ActivationCallback } from "./client";
import { createLogger, Logger } from "./logger";

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
}

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
  refresh: () => void;
  startRefreshing: () => void;
  stopRefreshing: () => void;
}

function fetchDatafileContent(datafileUrl, options: InstanceOptions): Promise<DatafileContent> {
  if (options.handleDatafileFetch) {
    return options.handleDatafileFetch(datafileUrl);
  }

  return fetch(datafileUrl).then((res) => res.json());
}

function getInstanceFromSdk(
  sdk: FeaturevisorSDK,
  options: InstanceOptions,
  logger: Logger,
): FeaturevisorInstance {
  let intervalId;
  let refreshInProgress = false;

  const instance: FeaturevisorInstance = {
    // variation
    getVariation: sdk.getVariation.bind(sdk),
    getVariationBoolean: sdk.getVariationBoolean.bind(sdk),
    getVariationInteger: sdk.getVariationInteger.bind(sdk),
    getVariationDouble: sdk.getVariationDouble.bind(sdk),
    getVariationString: sdk.getVariationString.bind(sdk),

    // activate
    activate: sdk.activate,
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

    refresh() {
      logger.debug("refreshing datafile");

      if (refreshInProgress) {
        return logger.warn("refresh in progress, skipping");
      }

      if (!options.datafileUrl) {
        return logger.error("cannot refresh since `datafileUrl` is not provided");
      }

      refreshInProgress = true;

      fetchDatafileContent(options.datafileUrl, options)
        .then((datafile) => {
          const currentRevision = sdk.getRevision();
          const newRevision = datafile.revision;
          const isNotSameRevision = currentRevision !== newRevision;

          sdk.setDatafile(datafile);
          logger.info("refreshed datafile");

          if (typeof options.onRefresh === "function") {
            options.onRefresh();
          }

          if (isNotSameRevision && typeof options.onUpdate === "function") {
            options.onUpdate();
          }

          refreshInProgress = false;
        })
        .catch((e) => {
          logger.error("failed to refresh datafile", { error: e });
          refreshInProgress = false;
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

  if (!options.datafileUrl && options.refreshInterval) {
    logger.warn("refreshing datafile requires `datafileUrl` option");
  }

  // datafile content is already provided
  if (options.datafile) {
    const sdk = new FeaturevisorSDK({
      datafile: options.datafile,
      onActivation: options.onActivation,
      configureBucketValue: options.configureBucketValue,
      logger,
      interceptAttributes: options.interceptAttributes,
    });

    if (typeof options.onReady === "function") {
      const onReady = options.onReady;

      setTimeout(function () {
        onReady();
      }, 0);
    }

    return getInstanceFromSdk(sdk, options, logger);
  }

  // datafile has to be fetched
  const sdk = new FeaturevisorSDK({
    datafile: emptyDatafile,
    onActivation: options.onActivation,
    configureBucketValue: options.configureBucketValue,
    logger,
    interceptAttributes: options.interceptAttributes,
  });

  if (options.datafileUrl) {
    fetchDatafileContent(options.datafileUrl, options)
      .then((datafile) => {
        sdk.setDatafile(datafile);

        if (typeof options.onReady === "function") {
          options.onReady();
        }
      })
      .catch((e) => {
        logger.error("failed to fetch datafile:");
        console.error(e);
      });
  }

  return getInstanceFromSdk(sdk, options, logger);
}
