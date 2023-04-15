import { createInstance } from "./createInstance";

describe("sdk: createInstance", function () {
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
            variations: [
              { type: "boolean", value: true },
              { type: "boolean", value: false },
            ],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, percentage: 100000 },
                  { variation: false, percentage: 0 },
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
});
