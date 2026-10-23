import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { onFeaturesChange } from "./onFeaturesChange";

function feature(hash: string) {
  return {
    hash,
    bucketBy: "userId" as const,
    traffic: [{ key: "all", conditions: "*" as const, percentage: 100000 }],
  };
}

function datafile(hashes: Record<string, string>): DatafileContent {
  return {
    schemaVersion: "4",
    revision: Object.values(hashes).join("-"),
    segments: {},
    features: Object.fromEntries(Object.entries(hashes).map(([key, hash]) => [key, feature(hash)])),
  };
}

const initial = { checkout: "c1", liveChat: "l1", wishlist: "w1" };

describe("react: onFeaturesChange", function () {
  test("follows the keys it was given, even if the caller's array changes later", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    const keys = ["checkout"];
    onFeaturesChange(sdk, keys, fn);
    keys.splice(0, 1, "wishlist");

    sdk.setDatafile(datafile({ ...initial, wishlist: "w2" }));
    expect(fn).not.toHaveBeenCalled();

    sdk.setDatafile(datafile({ ...initial, wishlist: "w2", checkout: "c2" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("calls back once when any listed feature changes in a datafile", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    onFeaturesChange(sdk, ["checkout", "liveChat"], fn);

    sdk.setDatafile(datafile({ ...initial, liveChat: "l2" }));
    expect(fn).toHaveBeenCalledTimes(1);

    sdk.setDatafile(datafile({ ...initial, checkout: "c2", liveChat: "l3" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("ignores a datafile that changes only unlisted features", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    onFeaturesChange(sdk, ["checkout", "liveChat"], fn);

    sdk.setDatafile(datafile({ ...initial, wishlist: "w2" }));
    expect(fn).not.toHaveBeenCalled();
  });

  test("calls back for context and for nonempty sticky values", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    onFeaturesChange(sdk, ["checkout"], fn);

    sdk.setContext({ country: "nl" });
    expect(fn).toHaveBeenCalledTimes(1);

    sdk.setStickyFeatures({ checkout: { enabled: false } });
    expect(fn).toHaveBeenCalledTimes(2);

    sdk.setStickyVariables({ gate: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("treats a key listed twice like a key listed once", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    onFeaturesChange(sdk, ["checkout", "checkout"], fn);

    sdk.setDatafile(datafile({ ...initial, checkout: "c2" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("stops calling back after unsubscribing", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile(initial) });
    const fn = jest.fn();
    const unsubscribe = onFeaturesChange(sdk, ["checkout", "liveChat"], fn);

    unsubscribe();
    sdk.setContext({ country: "nl" });
    sdk.setDatafile(datafile({ ...initial, checkout: "c2" }));
    sdk.setStickyFeatures({ checkout: { enabled: false } });
    expect(fn).not.toHaveBeenCalled();
  });
});
