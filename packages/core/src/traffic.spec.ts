import { getTraffic } from "./traffic";

describe("core: Traffic", function () {
  it("should be a function", function () {
    expect(typeof getTraffic).toEqual("function");
  });

  it("should allocate traffic for 100-0 weight on two variations", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "on",
          weight: 100,
        },
        {
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
            range: [0, 80000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for 50-50 weight on two variations", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "on",
          weight: 50,
        },
        {
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
            range: [0, 40000],
          },
          {
            variation: "off",
            percentage: 40000,
            range: [40000, 80000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for weight with two decimal places among three variations", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "yes",
          weight: 33.33,
        },
        {
          value: "no",
          weight: 33.33,
        },
        {
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
            range: [0, 33330],
          },
          {
            variation: "no",
            percentage: 33330,
            range: [33330, 66660],
          },
          {
            variation: "maybe",
            percentage: 33340,
            range: [66660, 100000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 90%, with same variations and weight", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "on",
          weight: 50,
        },
        {
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
        revision: "1",
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
                range: [0, 40000],
              },
              {
                variation: "off",
                percentage: 40000,
                range: [40000, 80000],
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
            range: [0, 40000],
          },
          {
            variation: "off",
            percentage: 40000,
            range: [40000, 80000],
          },

          // new
          {
            variation: "on",
            percentage: 5000,
            range: [80000, 85000],
          },
          {
            variation: "off",
            percentage: 5000,
            range: [85000, 90000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, decreasing from 80% to 70%, with same variations and weight", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "on",
          weight: 50,
        },
        {
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
        revision: "1",
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
                range: [0, 40000],
              },
              {
                variation: "off",
                percentage: 40000,
                range: [40000, 80000],
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
            range: [0, 35000],
          },
          {
            variation: "off",
            percentage: 35000,
            range: [35000, 70000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 90%, with new added variation", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "a",
          weight: 33.33,
        },
        {
          value: "b",
          weight: 33.33,
        },
        {
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
        revision: "1",
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
                range: [0, 40000],
              },
              {
                variation: "b",
                percentage: 40000,
                range: [40000, 80000],
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
            range: [0, 29997],
          },
          {
            variation: "b",
            percentage: 29997,
            range: [29997, 59994],
          },
          {
            variation: "c",
            percentage: 30006,
            range: [59994, 90000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, increasing from 80% to 100%, with new added variation, totalling 4 variations", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
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
        revision: "1",
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
                range: [0, 40000],
              },
              {
                variation: "b",
                percentage: 40000,
                range: [40000, 80000],
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
            range: [0, 25000],
          },
          {
            variation: "b",
            percentage: 25000,
            range: [25000, 50000],
          },
          {
            variation: "c",
            percentage: 25000,
            range: [50000, 75000],
          },
          {
            variation: "d",
            percentage: 25000,
            range: [75000, 100000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, staying at same 100%, removing variations from 4 to 2", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "a",
          weight: 50,
        },
        {
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
        revision: "1",
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
                range: [0, 25000],
              },
              {
                variation: "b",
                percentage: 25000,
                range: [25000, 50000],
              },
              {
                variation: "c",
                percentage: 25000,
                range: [50000, 75000],
              },
              {
                variation: "d",
                percentage: 25000,
                range: [75000, 100000],
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
            range: [0, 50000],
          },
          {
            variation: "b",
            percentage: 50000,
            range: [50000, 100000],
          },
        ],
      },
    ]);
  });

  it("should allocate against previous known allocation, decreasing from 100% to 80%, removing variations from 4 to 2", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "a",
          weight: 50,
        },
        {
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
        revision: "1",
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
                range: [0, 25000],
              },
              {
                variation: "b",
                percentage: 25000,
                range: [25000, 50000],
              },
              {
                variation: "c",
                percentage: 25000,
                range: [50000, 75000],
              },
              {
                variation: "d",
                percentage: 25000,
                range: [75000, 100000],
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
            range: [0, 40000],
          },
          {
            variation: "b",
            percentage: 40000,
            range: [40000, 80000],
          },
        ],
      },
    ]);
  });
});
