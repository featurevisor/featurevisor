import { DatafileContent } from "@featurevisor/types";

import { createInstance } from "./instance";
import { createLogger } from "./logger";

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

  it("should resolve onReady method as Promise", function (done) {
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
      sdk.onReady().then((f) => {
        expect(f.isReady()).toEqual(true);
        expect(readyCount).toEqual(1);

        done();
      });
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
    let updatedViaOption = false;
    let updatedViaEventListener = false;

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
        updatedViaOption = true;
      },
    });

    const onUpdateCallback = function () {
      updatedViaEventListener = true;
    };

    sdk.on("update", onUpdateCallback);

    expect(sdk.isReady()).toEqual(false);

    setTimeout(function () {
      expect(refreshed).toEqual(true);
      expect(updatedViaOption).toEqual(true);
      expect(updatedViaEventListener).toEqual(true);

      sdk.off("update", onUpdateCallback);

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

  it("should honour simple required features", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "requiredKey",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 0, // disabled
                allocation: [],
              },
            ],
          },

          {
            key: "myKey",
            bucketBy: "userId",
            required: ["requiredKey"],
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

    // should be disabled because required is disabled
    expect(sdk.isEnabled("myKey")).toEqual(false);

    // enabling required should enable the feature too
    const sdk2 = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "requiredKey",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000, // enabled
                allocation: [],
              },
            ],
          },

          {
            key: "myKey",
            bucketBy: "userId",
            required: ["requiredKey"],
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
    expect(sdk2.isEnabled("myKey")).toEqual(true);
  });

  it("should honour required features with variation", function () {
    // should be disabled because required has different variation
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "requiredKey",
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

          {
            key: "myKey",
            bucketBy: "userId",
            required: [
              {
                key: "requiredKey",
                variation: "control", // different variation
              },
            ],
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

    expect(sdk.isEnabled("myKey")).toEqual(false);

    // child should be enabled because required has desired variation
    const sdk2 = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "requiredKey",
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

          {
            key: "myKey",
            bucketBy: "userId",
            required: [
              {
                key: "requiredKey",
                variation: "treatment", // desired variation
              },
            ],
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
    expect(sdk2.isEnabled("myKey")).toEqual(true);
  });

  it("should emit warnings for deprecated feature", function () {
    let deprecatedCount = 0;

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
          {
            key: "deprecatedTest",
            deprecated: true,
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
      logger: createLogger({
        handler: function (level, message) {
          if (level === "warn" && message.indexOf("is deprecated")) {
            deprecatedCount += 1;
          }
        },
      }),
    });

    const testVariation = sdk.getVariation("test", {
      userId: "123",
    });
    const deprecatedTestVariation = sdk.getVariation("deprecatedTest", {
      userId: "123",
    });

    expect(testVariation).toEqual("control");
    expect(deprecatedTestVariation).toEqual("control");
    expect(deprecatedCount).toEqual(1);
  });

  it("should get variable", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            bucketBy: "userId",
            variablesSchema: [
              {
                key: "color",
                type: "string",
                defaultValue: "red",
              },
              {
                key: "showSidebar",
                type: "boolean",
                defaultValue: false,
              },
              {
                key: "count",
                type: "integer",
                defaultValue: 0,
              },
              {
                key: "paymentMethods",
                type: "array",
                defaultValue: ["paypal", "creditcard"],
              },
              {
                key: "flatConfig",
                type: "object",
                defaultValue: {
                  key: "value",
                },
              },
              {
                key: "nestedConfig",
                type: "json",
                defaultValue: JSON.stringify({
                  key: {
                    nested: "value",
                  },
                }),
              },
            ],
            variations: [
              { value: "control" },
              {
                value: "treatment",
                variables: [
                  {
                    key: "showSidebar",
                    value: true,
                  },
                ],
              },
            ],
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
      },
    });

    const context = {
      userId: "123",
    };

    expect(sdk.getVariation("test", context)).toEqual("treatment");

    expect(sdk.getVariable("test", "color", context)).toEqual("red");
    expect(sdk.getVariableString("test", "color", context)).toEqual("red");

    expect(sdk.getVariable("test", "showSidebar", context)).toEqual(true);
    expect(sdk.getVariableBoolean("test", "showSidebar", context)).toEqual(true);

    expect(sdk.getVariable("test", "count", context)).toEqual(0);
    expect(sdk.getVariableInteger("test", "count", context)).toEqual(0);

    expect(sdk.getVariable("test", "paymentMethods", context)).toEqual(["paypal", "creditcard"]);
    expect(sdk.getVariableArray("test", "paymentMethods", context)).toEqual([
      "paypal",
      "creditcard",
    ]);

    expect(sdk.getVariable("test", "flatConfig", context)).toEqual({
      key: "value",
    });
    expect(sdk.getVariableObject("test", "flatConfig", context)).toEqual({
      key: "value",
    });

    expect(sdk.getVariable("test", "nestedConfig", context)).toEqual({
      key: {
        nested: "value",
      },
    });
    expect(sdk.getVariableJSON("test", "nestedConfig", context)).toEqual({
      key: {
        nested: "value",
      },
    });
  });
});
