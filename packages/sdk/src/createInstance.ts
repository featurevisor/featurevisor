import { DatafileContent } from "@featurevisor/types";
import { FeaturevisorSDK, ConfigureBucketValue, ActivationCallback } from "./client";

export type ReadyCallback = () => void;

export interface InstanceOptions {
  // from SdkOptions
  datafile?: DatafileContent | string; // optional here, but not in SdkOptions
  onActivation?: ActivationCallback;
  configureBucketValue?: ConfigureBucketValue;

  // additions
  datafileUrl?: string;
  onReady?: ReadyCallback;
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
    getVariation: sdk.getVariation,
    getVariationBoolean: sdk.getVariationBoolean,
    getVariationInteger: sdk.getVariationInteger,
    getVariationDouble: sdk.getVariationDouble,
    getVariationString: sdk.getVariationString,

    // activate
    activate: sdk.activate,
    activateBoolean: sdk.activateBoolean,
    activateInteger: sdk.activateInteger,
    activateDouble: sdk.activateDouble,
    activateString: sdk.activateString,

    // variable
    getVariable: sdk.getVariable,
    getVariableBoolean: sdk.getVariableBoolean,
    getVariableInteger: sdk.getVariableInteger,
    getVariableDouble: sdk.getVariableDouble,
    getVariableString: sdk.getVariableString,
    getVariableArray: sdk.getVariableArray,
    getVariableObject: sdk.getVariableObject,

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

export function createInstance(options: InstanceOptions) {
  if (!options.datafile && !options.datafileUrl) {
    throw new Error(
      "Featurevisor SDK instance cannot be created without `datafile` or `datafileUrl`",
    );
  }

  // datafile content is already provided
  if (options.datafile) {
    const sdk = new FeaturevisorSDK({
      datafile: options.datafile,
      onActivation: options.onActivation,
      configureBucketValue: options.configureBucketValue,
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
  });

  if (options.datafileUrl) {
    fetch(options.datafileUrl)
      .then((res) => res.json())
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
