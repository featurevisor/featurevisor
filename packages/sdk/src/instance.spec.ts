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
            defaultVariation: false,
            bucketBy: "userId",
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, attributes, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    const variation = sdk.getVariation("test", {
      userId: "123",
    });

    expect(variation).toEqual(true);
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
            defaultVariation: false,
            bucketBy: ["userId", "organizationId"],
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, attributes, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    const variation = sdk.getVariation("test", {
      userId: "123",
      organizationId: "456",
    });

    expect(variation).toEqual(true);
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
            defaultVariation: false,
            bucketBy: { or: ["userId", "deviceId"] },
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      configureBucketKey: function (feature, attributes, bucketKey) {
        capturedBucketKey = bucketKey;

        return bucketKey;
      },
    });

    expect(
      sdk.getVariation("test", {
        userId: "123",
        deviceId: "456",
      }),
    ).toEqual(true);
    expect(capturedBucketKey).toEqual("123.test");

    expect(
      sdk.getVariation("test", {
        deviceId: "456",
      }),
    ).toEqual(true);
    expect(capturedBucketKey).toEqual("456.test");
  });

  it("should intercept attributes", function () {
    let intercepted = false;

    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            defaultVariation: false,
            bucketBy: "userId",
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
      interceptAttributes: function (attributes) {
        intercepted = true;

        return {
          ...attributes,
        };
      },
    });

    const variation = sdk.getVariation("test", {
      userId: "123",
    });

    expect(variation).toEqual(true);
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
            defaultVariation: false,
            bucketBy: "userId",
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
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
    expect(variation).toEqual(true);

    const activatedVariation = sdk.activate("test", {
      userId: "123",
    });

    expect(activated).toEqual(true);
    expect(activatedVariation).toEqual(true);
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
            defaultVariation: false,
            bucketBy: "userId",
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
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
          variation: false,
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
              defaultVariation: false,
              bucketBy: "userId",
              variations: [{ value: true }, { value: false }],
              traffic: [
                {
                  key: "1",
                  segments: "*",
                  percentage: 100000,
                  allocation: [
                    { variation: true, range: [0, 100000] },
                    { variation: false, range: [0, 0] },
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

    // initially false
    expect(
      sdk.getVariation("test", {
        userId: "123",
      }),
    ).toEqual(false);

    setTimeout(function () {
      // still false after fetching datafile
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual(false);

      // unsetting sticky features will make it true
      sdk.setStickyFeatures({});
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual(true);

      done();
    }, 75);
  });

  it("should initialize with initial features", function (done) {
    const sdk = createInstance({
      initialFeatures: {
        test: {
          variation: false,
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
              defaultVariation: false,
              bucketBy: "userId",
              variations: [{ value: true }, { value: false }],
              traffic: [
                {
                  key: "1",
                  segments: "*",
                  percentage: 100000,
                  allocation: [
                    { variation: true, range: [0, 100000] },
                    { variation: false, range: [0, 0] },
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

    // initially false
    expect(
      sdk.getVariation("test", {
        userId: "123",
      }),
    ).toEqual(false);

    setTimeout(function () {
      // true after fetching datafile
      expect(
        sdk.getVariation("test", {
          userId: "123",
        }),
      ).toEqual(true);

      done();
    }, 75);
  });
});
