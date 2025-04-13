import { DatafileContent, DatafileContentV2 } from "@featurevisor/types";

import { createInstance } from "./instance";
import { createLogger } from "./logger";

describe("sdk: instance", function () {
  it("should be a function", function () {
    expect(typeof createInstance).toEqual("function");
  });

  it("should create instance with datafile content", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {},
        attributes: {},
        segments: {},
      },
    });

    expect(typeof sdk.getVariation).toEqual("function");
  });

  it("should configure plain bucketBy", function () {
    let capturedBucketKey = "";

    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
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
        },
        attributes: {},
        segments: {},
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
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
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
        },
        attributes: {},
        segments: {},
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
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
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
        },
        attributes: {},
        segments: {},
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
    let interceptedFeatureKey = "";
    let interceptedVariableKey: string | undefined = "";

    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
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
        },
        attributes: {},
        segments: {},
      },
      interceptContext: function (context, featureKey, variableKey) {
        intercepted = true;
        interceptedFeatureKey = featureKey;
        interceptedVariableKey = variableKey;

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
    expect(interceptedFeatureKey).toEqual("test");
    expect(interceptedVariableKey).toEqual(undefined);
  });

  it("should initialize with sticky features", function (done) {
    const datafileContent: DatafileContentV2 = {
      schemaVersion: "2",
      revision: "1.0",
      features: {
        test: {
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
      },
      attributes: {},
      segments: {},
    };

    const sdk = createInstance({
      stickyFeatures: {
        test: {
          enabled: true,
          variation: "control",
          variables: {
            color: "red",
          },
        },
      },
      datafile: datafileContent,
    });

    // initially control
    expect(
      sdk.getVariation("test", {
        userId: "123",
      }),
    ).toEqual("control");
    expect(
      sdk.getVariable("test", "color", {
        userId: "123",
      }),
    ).toEqual("red");

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

  it("should honour simple required features", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          requiredKey: {
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

          myKey: {
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
        },
        attributes: {},
        segments: {},
      },
    });

    // should be disabled because required is disabled
    expect(sdk.isEnabled("myKey")).toEqual(false);

    // enabling required should enable the feature too
    const sdk2 = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          requiredKey: {
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

          myKey: {
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
        },
        attributes: {},
        segments: {},
      },
    });
    expect(sdk2.isEnabled("myKey")).toEqual(true);
  });

  it("should honour required features with variation", function () {
    // should be disabled because required has different variation
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          requiredKey: {
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

          myKey: {
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
        },
        attributes: {},
        segments: {},
      },
    });

    expect(sdk.isEnabled("myKey")).toEqual(false);

    // child should be enabled because required has desired variation
    const sdk2 = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          requiredKey: {
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

          myKey: {
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
        },
        attributes: {},
        segments: {},
      },
    });
    expect(sdk2.isEnabled("myKey")).toEqual(true);
  });

  it("should emit warnings for deprecated feature", function () {
    let deprecatedCount = 0;

    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
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
          deprecatedTest: {
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
        },
        attributes: {},
        segments: {},
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

  it("should check if enabled for overridden flags from rules", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            traffic: [
              {
                key: "2",
                segments: ["netherlands"],
                percentage: 100000,
                enabled: false,
                allocation: [],
              },
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        },
        attributes: {},
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
        },
      },
    });

    expect(sdk.isEnabled("test", { userId: "user-123", country: "de" })).toEqual(true);
    expect(sdk.isEnabled("test", { userId: "user-123", country: "nl" })).toEqual(false);
  });

  it("should check if enabled for mutually exclusive features", function () {
    let bucketValue = 10000;

    const sdk = createInstance({
      configureBucketValue: function () {
        return bucketValue;
      },

      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          mutex: {
            key: "mutex",
            bucketBy: "userId",
            ranges: [[0, 50000]],
            traffic: [{ key: "1", segments: "*", percentage: 50000, allocation: [] }],
          },
        },
        attributes: {},
        segments: {},
      },
    });

    expect(sdk.isEnabled("test")).toEqual(false);
    expect(sdk.isEnabled("test", { userId: "123" })).toEqual(false);

    bucketValue = 40000;
    expect(sdk.isEnabled("mutex", { userId: "123" })).toEqual(true);

    bucketValue = 60000;
    expect(sdk.isEnabled("mutex", { userId: "123" })).toEqual(false);
  });

  it("should get variation", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            force: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "user-gb" }],
                enabled: false,
              },
              {
                segments: ["netherlands"],
                enabled: false,
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
          testWithNoVariation: {
            key: "testWithNoVariation",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        },
        attributes: {},
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
        },
      },
    });

    const context = {
      userId: "123",
    };

    expect(sdk.getVariation("test", context)).toEqual("treatment");
    expect(sdk.getVariation("test", { userId: "user-ch" })).toEqual("treatment");

    // non existing
    expect(sdk.getVariation("nonExistingFeature", context)).toEqual(null);

    // disabled
    expect(sdk.getVariation("test", { userId: "user-gb" })).toEqual(null);
    expect(sdk.getVariation("test", { userId: "user-gb" })).toEqual(null);
    expect(sdk.getVariation("test", { userId: "123", country: "nl" })).toEqual(null);

    // no variation
    expect(sdk.getVariation("testWithNoVariation", context)).toEqual(null);
  });

  it("should get variable", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variablesSchema: {
              color: {
                key: "color",
                type: "string",
                defaultValue: "red",
              },
              showSidebar: {
                key: "showSidebar",
                type: "boolean",
                defaultValue: false,
              },
              sidebarTitle: {
                key: "sidebarTitle",
                type: "string",
                defaultValue: "sidebar title",
              },
              count: {
                key: "count",
                type: "integer",
                defaultValue: 0,
              },
              price: {
                key: "price",
                type: "double",
                defaultValue: 9.99,
              },
              paymentMethods: {
                key: "paymentMethods",
                type: "array",
                defaultValue: ["paypal", "creditcard"],
              },
              flatConfig: {
                key: "flatConfig",
                type: "object",
                defaultValue: {
                  key: "value",
                },
              },
              nestedConfig: {
                key: "nestedConfig",
                type: "json",
                defaultValue: JSON.stringify({
                  key: {
                    nested: "value",
                  },
                }),
              },
            },
            variations: [
              { value: "control" },
              {
                value: "treatment",
                variables: [
                  {
                    key: "showSidebar",
                    value: true,
                    overrides: [
                      {
                        segments: ["netherlands"],
                        value: false,
                      },
                      {
                        conditions: [
                          {
                            attribute: "country",
                            operator: "equals",
                            value: "de",
                          },
                        ],
                        value: false,
                      },
                    ],
                  },
                  {
                    key: "sidebarTitle",
                    value: "sidebar title from variation",
                    overrides: [
                      {
                        segments: ["netherlands"],
                        value: "Dutch title",
                      },
                      {
                        conditions: [
                          {
                            attribute: "country",
                            operator: "equals",
                            value: "de",
                          },
                        ],
                        value: "German title",
                      },
                    ],
                  },
                ],
              },
            ],
            force: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "user-ch" }],
                enabled: true,
                variation: "control",
                variables: {
                  color: "red and white",
                },
              },
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "user-gb" }],
                enabled: false,
              },
              {
                conditions: [
                  { attribute: "userId", operator: "equals", value: "user-forced-variation" },
                ],
                enabled: true,
                variation: "treatment",
              },
            ],
            traffic: [
              // belgium
              {
                key: "2",
                segments: ["belgium"],
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 0] },
                  {
                    variation: "treatment",
                    range: [0, 100000],
                  },
                ],
                variation: "control",
                variables: {
                  color: "black",
                },
              },

              // everyone
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 0] },
                  {
                    variation: "treatment",
                    range: [0, 100000],
                  },
                ],
              },
            ],
          },
        },
        attributes: {
          userId: { key: "userId", type: "string" },
          country: { key: "country", type: "string" },
        },
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
          belgium: {
            key: "belgium",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "be",
              },
            ]),
          },
        },
      },
    });

    const context = {
      userId: "123",
    };

    expect(sdk.getVariation("test", context)).toEqual("treatment");
    expect(
      sdk.getVariation("test", {
        ...context,
        country: "be",
      }),
    ).toEqual("control");
    expect(sdk.getVariation("test", { userId: "user-ch" })).toEqual("control");

    expect(sdk.getVariable("test", "color", context)).toEqual("red");
    expect(sdk.getVariableString("test", "color", context)).toEqual("red");
    expect(sdk.getVariable("test", "color", { ...context, country: "be" })).toEqual("black");
    expect(sdk.getVariable("test", "color", { userId: "user-ch" })).toEqual("red and white");

    expect(sdk.getVariable("test", "showSidebar", context)).toEqual(true);
    expect(sdk.getVariableBoolean("test", "showSidebar", context)).toEqual(true);
    expect(
      sdk.getVariableBoolean("test", "showSidebar", {
        ...context,
        country: "nl",
      }),
    ).toEqual(false);
    expect(
      sdk.getVariableBoolean("test", "showSidebar", {
        ...context,
        country: "de",
      }),
    ).toEqual(false);

    expect(
      sdk.getVariableString("test", "sidebarTitle", {
        userId: "user-forced-variation",
        country: "de",
      }),
    ).toEqual("German title");
    expect(
      sdk.getVariableString("test", "sidebarTitle", {
        userId: "user-forced-variation",
        country: "nl",
      }),
    ).toEqual("Dutch title");
    expect(
      sdk.getVariableString("test", "sidebarTitle", {
        userId: "user-forced-variation",
        country: "be",
      }),
    ).toEqual("sidebar title from variation");

    expect(sdk.getVariable("test", "count", context)).toEqual(0);
    expect(sdk.getVariableInteger("test", "count", context)).toEqual(0);

    expect(sdk.getVariable("test", "price", context)).toEqual(9.99);
    expect(sdk.getVariableDouble("test", "price", context)).toEqual(9.99);

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

    // non existing
    expect(sdk.getVariable("test", "nonExisting", context)).toEqual(null);
    expect(sdk.getVariable("nonExistingFeature", "nonExisting", context)).toEqual(null);

    // disabled
    expect(sdk.getVariable("test", "color", { userId: "user-gb" })).toEqual(null);
  });

  it("should get variables without any variations", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        attributes: {
          userId: { key: "userId", type: "string" },
          country: { key: "country", type: "string" },
        },
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
        },
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variablesSchema: {
              color: {
                key: "color",
                type: "string",
                defaultValue: "red",
              },
            },
            traffic: [
              {
                key: "1",
                segments: "netherlands",
                percentage: 100000,
                variables: {
                  color: "orange",
                },
                allocation: [],
              },
              {
                key: "2",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        },
      },
    });

    const defaultContext = {
      userId: "123",
    };

    // test default value
    expect(
      sdk.getVariable("test", "color", {
        ...defaultContext,
      }),
    ).toEqual("red");

    // test override
    expect(
      sdk.getVariable("test", "color", {
        ...defaultContext,
        country: "nl",
      }),
    ).toEqual("orange");
  });

  it("should check if enabled for individually named segments", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            traffic: [
              { key: "1", segments: "netherlands", percentage: 100000, allocation: [] },
              {
                key: "2",
                segments: JSON.stringify(["iphone", "unitedStates"]),
                percentage: 100000,
                allocation: [],
              },
            ],
          },
        },
        attributes: {},
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "nl",
              },
            ]),
          },
          iphone: {
            key: "iphone",
            conditions: JSON.stringify([
              {
                attribute: "device",
                operator: "equals",
                value: "iphone",
              },
            ]),
          },
          unitedStates: {
            key: "unitedStates",
            conditions: JSON.stringify([
              {
                attribute: "country",
                operator: "equals",
                value: "us",
              },
            ]),
          },
        },
      },
    });

    expect(sdk.isEnabled("test")).toEqual(false);
    expect(sdk.isEnabled("test", { userId: "123" })).toEqual(false);
    expect(sdk.isEnabled("test", { userId: "123", country: "de" })).toEqual(false);
    expect(sdk.isEnabled("test", { userId: "123", country: "us" })).toEqual(false);

    expect(sdk.isEnabled("test", { userId: "123", country: "nl" })).toEqual(true);
    expect(sdk.isEnabled("test", { userId: "123", country: "us", device: "iphone" })).toEqual(true);
  });
});
