import { DatafileContent, GroupSegment, ParsedFeature } from "@featurevisor/types";
import { getNewTraffic } from "./traffic";

describe("core: Traffic", function () {
  it("should be a function", function () {
    expect(typeof getNewTraffic).toEqual("function");
  });

  it("should allocate traffic for 100-0 weight on two variations", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "on",
          weight: 100,
        },
        {
          type: "string",
          value: "off",
          weight: 0,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 80,
        },
      ],

      // existing feature from previous release
      undefined,
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 80000,
        allocation: [
          {
            variation: "on",
            percentage: 80000,
          },
          {
            variation: "off",
            percentage: 0,
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for 50-50 weight on two variations", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "on",
          weight: 50,
        },
        {
          type: "string",
          value: "off",
          weight: 50,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 80,
        },
      ],

      // existing feature from previous release
      undefined,
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 80000,
        allocation: [
          {
            variation: "on",
            percentage: 40000,
          },
          {
            variation: "off",
            percentage: 40000,
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for weight with two decimal places among three variations", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "yes",
          weight: 33.33,
        },
        {
          type: "string",
          value: "no",
          weight: 33.33,
        },
        {
          type: "string",
          value: "maybe",
          weight: 33.34,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 100,
        },
      ],

      // existing feature from previous release
      undefined,
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 100000,
        allocation: [
          {
            variation: "yes",
            percentage: 33330,
          },
          {
            variation: "no",
            percentage: 33330,
          },
          {
            variation: "maybe",
            percentage: 33340,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 90%, with same variations and weight", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "on",
          weight: 50,
        },
        {
          type: "string",
          value: "off",
          weight: 50,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 90,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "on",
            weight: 50,
          },
          {
            value: "off",
            weight: 50,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "on",
                percentage: 40000,
              },
              {
                variation: "off",
                percentage: 40000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 90000,
        allocation: [
          // existing
          {
            variation: "on",
            percentage: 40000,
          },
          {
            variation: "off",
            percentage: 40000,
          },

          // new
          {
            variation: "on",
            percentage: 5000,
          },
          {
            variation: "off",
            percentage: 5000,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, decreasing from 80% to 70%, with same variations and weight", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "on",
          weight: 50,
        },
        {
          type: "string",
          value: "off",
          weight: 50,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 70,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "on",
            weight: 50,
          },
          {
            value: "off",
            weight: 50,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "on",
                percentage: 40000,
              },
              {
                variation: "off",
                percentage: 40000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 70000,
        allocation: [
          {
            variation: "on",
            percentage: 35000,
          },
          {
            variation: "off",
            percentage: 35000,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 90%, with new added variation", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "a",
          weight: 33.33,
        },
        {
          type: "string",
          value: "b",
          weight: 33.33,
        },
        {
          type: "string",
          value: "c",
          weight: 33.34,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 90,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "a",
            weight: 50,
          },
          {
            value: "b",
            weight: 50,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "a",
                percentage: 40000,
              },
              {
                variation: "b",
                percentage: 40000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 90000,
        allocation: [
          {
            variation: "a",
            percentage: 29997,
          },
          {
            variation: "b",
            percentage: 29997,
          },
          {
            variation: "c",
            percentage: 30006,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 100%, with new added variation, totalling 4 variations", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "a",
          weight: 25,
        },
        {
          type: "string",
          value: "b",
          weight: 25,
        },
        {
          type: "string",
          value: "c",
          weight: 25,
        },
        {
          type: "string",
          value: "d",
          weight: 25,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 100,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "a",
            weight: 50,
          },
          {
            value: "b",
            weight: 50,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "a",
                percentage: 40000,
              },
              {
                variation: "b",
                percentage: 40000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 100000,
        allocation: [
          {
            variation: "a",
            percentage: 25000,
          },
          {
            variation: "b",
            percentage: 25000,
          },
          {
            variation: "c",
            percentage: 25000,
          },
          {
            variation: "d",
            percentage: 25000,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, staying at same 100%, removing variations from 4 to 2", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "a",
          weight: 50,
        },
        {
          type: "string",
          value: "b",
          weight: 50,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 100,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "a",
            weight: 25,
          },
          {
            value: "b",
            weight: 25,
          },
          {
            value: "c",
            weight: 25,
          },
          {
            value: "d",
            weight: 25,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 100000,
            allocation: [
              {
                variation: "a",
                percentage: 25000,
              },
              {
                variation: "b",
                percentage: 25000,
              },
              {
                variation: "c",
                percentage: 25000,
              },
              {
                variation: "d",
                percentage: 25000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 100000,
        allocation: [
          {
            variation: "a",
            percentage: 50000,
          },
          {
            variation: "b",
            percentage: 50000,
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, decreasing from 100% to 80%, removing variations from 4 to 2", function () {
    const result = getNewTraffic(
      // parsed variations from YAML
      [
        {
          type: "string",
          value: "a",
          weight: 50,
        },
        {
          type: "string",
          value: "b",
          weight: 50,
        },
      ],

      // parsed rollouts from YAML
      [
        {
          key: "1",
          segments: "*",
          percentage: 80,
        },
      ],

      // existing feature from previous release
      {
        variations: [
          {
            value: "a",
            weight: 25,
          },
          {
            value: "b",
            weight: 25,
          },
          {
            value: "c",
            weight: 25,
          },
          {
            value: "d",
            weight: 25,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 100000,
            allocation: [
              {
                variation: "a",
                percentage: 25000,
              },
              {
                variation: "b",
                percentage: 25000,
              },
              {
                variation: "c",
                percentage: 25000,
              },
              {
                variation: "d",
                percentage: 25000,
              },
            ],
          },
        ],
      },
    );

    expect(result).toEqual([
      {
        key: "1",
        segments: "*",
        percentage: 80000,
        allocation: [
          {
            variation: "a",
            percentage: 40000,
          },
          {
            variation: "b",
            percentage: 40000,
          },
        ],
      },
    ]);
  });
});
