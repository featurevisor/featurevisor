import { DatafileContent } from "@featurevisor/types";
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
   *
   * @TODO
   */
  // start: () => void;
  // stop: () => void;
  // refresh: () => void;
}

function getInstanceFromSdk(sdk: FeaturevisorSDK, options: InstanceOptions): FeaturevisorInstance {
  return {
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
    // @TODO
    // start: () => {},
    // stop: () => {},
    // refresh: () => {},
  };
}

const emptyDatafile: DatafileContent = {
  schemaVersion: "1",
  revision: "unknown",
  attributes: [],
  segments: [],
  features: [],
};

function fetchDatafileContent(datafileUrl, options: InstanceOptions): Promise<DatafileContent> {
  if (options.handleDatafileFetch) {
    return options.handleDatafileFetch(datafileUrl);
  }

  return fetch(datafileUrl).then((res) => res.json());
}

export function createInstance(options: InstanceOptions) {
  if (!options.datafile && !options.datafileUrl) {
    throw new Error(
      "Featurevisor SDK instance cannot be created without both `datafile` and `datafileUrl` options",
    );
  }

  const logger = options.logger || createLogger();

  // datafile content is already provided
  if (options.datafile) {
    const sdk = new FeaturevisorSDK({
      datafile: options.datafile,
      onActivation: options.onActivation,
      configureBucketValue: options.configureBucketValue,
      logger,
    });

    if (typeof options.onReady === "function") {
      const onReady = options.onReady;

      setTimeout(function () {
        onReady();
      }, 0);
    }

    return getInstanceFromSdk(sdk, options);
  }

  // datafile has to be fetched
  const sdk = new FeaturevisorSDK({
    datafile: emptyDatafile,
    onActivation: options.onActivation,
    configureBucketValue: options.configureBucketValue,
    logger,
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
        console.error("Featurevisor failed to fetch datafile:");
        console.error(e);
      });
  }

  return getInstanceFromSdk(sdk, options);
}
