import { DatafileContent } from "@featurevisor/types";

import { createInstance } from "./instance";

describe("sdk: instance", function () {
  it("should be a function", function () {
    expect(typeof createInstance).toEqual("function");
  });

  it("should create instance with datafile content", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [],
        attributes: [],
        segments: [],
      },
    });

    expect(typeof sdk.getVariation).toEqual("function");
  });

  it("should trigger onReady event once", function (done) {
    let readyCount = 0;

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [],
        attributes: [],
        segments: [],
      },
      onReady: () => {
        readyCount += 1;
      },
    });

    setTimeout(() => {
      expect(readyCount).toEqual(1);
      expect(sdk.isReady()).toEqual(true);
      done();
    }, 0);
  });

  it("should configure plain bucketBy", function () {
    let capturedBucketKey = "";

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, context, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    const featureKey = "test";
    const context = {
      userId: "123",
    };

    expect(sdk.isEnabled(featureKey, context)).toEqual(true);
    expect(sdk.getVariation(featureKey, context)).toEqual("control");
    expect(capturedBucketKey).toEqual("123.test");
  });

  it("should configure and bucketBy", function () {
    let capturedBucketKey = "";

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: ["userId", "organizationId"],
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, context, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    const featureKey = "test";
    const context = {
      userId: "123",
      organizationId: "456",
    };

    expect(sdk.getVariation(featureKey, context)).toEqual("control");
    expect(capturedBucketKey).toEqual("123.456.test");
  });

  it("should configure or bucketBy", function () {
    let capturedBucketKey = "";

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: { or: ["userId", "deviceId"] },
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, context, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    expect(
      sdk.isEnabled("test", {
        userId: "123",
        deviceId: "456",
      }),
    ).toEqual(true);
    expect(
      sdk.getVariation("test", {
        userId: "123",
        deviceId: "456",
      }),
    ).toEqual("control");
    expect(capturedBucketKey).toEqual("123.test");

    expect(
      sdk.getVariation("test", {
        deviceId: "456",
      }),
    ).toEqual("control");
    expect(capturedBucketKey).toEqual("456.test");
  });

  it("should intercept context", function () {
    let intercepted = false;

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      interceptContext: function (context) {
        intercepted = true;

        return {
          ...context,
        };
      },
    });

    const variation = sdk.getVariation("test", {
      userId: "123",
    });

    expect(variation).toEqual("control");
    expect(intercepted).toEqual(true);
  });

  it("should activate feature", function () {
    let activated = false;

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      onActivation: function (featureKey) {
        activated = true;
      },
    });

    const variation = sdk.getVariation("test", {
      userId: "123",
    });

    expect(activated).toEqual(false);
    expect(variation).toEqual("control");

    const activatedVariation = sdk.activate("test", {
      userId: "123",
    });

    expect(activated).toEqual(true);
    expect(activatedVariation).toEqual("control");
  });

  it("should refresh datafile", function (done) {
    let revision = 1;
    let refreshed = false;
    let updated = false;

    function getDatafileContent(): DatafileContent {
      const content: DatafileContent = {
        schemaVersion: "1",
        revision: revision.toString(),
        features: [
          {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] },
                  { variation: "treatment", range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      };

      revision += 1;

      return content;
    }

    const sdk = createInstance({
      datafileUrl: "http://localhost:3000/datafile.json",
      handleDatafileFetch: function (datafileUrl) {
        return new Promise(function (resolve, reject) {
          resolve(getDatafileContent());
        });
      },
      refreshInterval: 0.1,
      onRefresh() {
        refreshed = true;
      },
      onUpdate() {
        updated = true;
      },
    });

    expect(sdk.isReady()).toEqual(false);

    setTimeout(function () {
      expect(refreshed).toEqual(true);
      expect(updated).toEqual(true);

      expect(sdk.isReady()).toEqual(true);

      sdk.stopRefreshing();

      done();
    }, 200);
  });

  it("should initialize with sticky features", function (done) {
    const sdk = createInstance({
      stickyFeatures: {
        test: {
          enabled: true,
          variation: "control",
        },
      },
      datafileUrl: "http://localhost:3000/datafile.json",
      handleDatafileFetch: function (datafileUrl) {
        const content: DatafileContent = {
          schemaVersion: "1",
          revision: "1.0",
          features: [
            {
              key: "test",
              bucketBy: "userId",
              variations: [{ value: "control" }, { value: "treatment" }],
              traffic: [
                {
                  key: "1",
                  segments: "*",
                  percentage: 100000,
                  allocation: [
                    { variation: "control", range: [0, 0] },
                    { variation: "treatment", range: [0, 100000] },
                  ],
                },
              ],
            },
          ],
          attributes: [],
          segments: [],
        };

        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            resolve(content);
          }, 50);
        });
      },
    });

    // initially control
    expect(
      sdk.getVariation("test", {
        userId: "123",
      }),
    ).toEqual("control");

    setTimeout(function () {
      // still control after fetching datafile
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual("control");

      // unsetting sticky features will make it treatment
      sdk.setStickyFeatures({});
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual("treatment");

      done();
    }, 75);
  });

  it("should initialize with initial features", function (done) {
    const sdk = createInstance({
      initialFeatures: {
        test: {
          enabled: true,
          variation: "control",
        },
      },
      datafileUrl: "http://localhost:3000/datafile.json",
      handleDatafileFetch: function (datafileUrl) {
        const content: DatafileContent = {
          schemaVersion: "1",
          revision: "1.0",
          features: [
            {
              key: "test",
              bucketBy: "userId",
              variations: [{ value: "control" }, { value: "treatment" }],
              traffic: [
                {
                  key: "1",
                  segments: "*",
                  percentage: 100000,
                  allocation: [
                    { variation: "control", range: [0, 0] },
                    { variation: "treatment", range: [0, 100000] },
                  ],
                },
              ],
            },
          ],
          attributes: [],
          segments: [],
        };

        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            resolve(content);
          }, 50);
        });
      },
    });

    // initially control
    expect(
      sdk.getVariation("test", {
        userId: "123",
      }),
    ).toEqual("control");

    setTimeout(function () {
      // treatment after fetching datafile
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual("treatment");

      done();
    }, 75);
  });

  it("should honour parents", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "parentKey",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 0, // parent is disabled
                allocation: [],
              },
            ],
          },

          {
            key: "childKey",
            bucketBy: "userId",
            parents: ["parentKey"],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
    });

    // child should be disabled because parent is disabled
    expect(sdk.isEnabled("childKey")).toEqual(false);

    // enabling parent should enable the child too
    const sdk2 = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "parentKey",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000, // parent is enabled
                allocation: [],
              },
            ],
          },

          {
            key: "childKey",
            bucketBy: "userId",
            parents: ["parentKey"],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
    });
    expect(sdk.isEnabled("childKey")).toEqual(true);
  });
});
