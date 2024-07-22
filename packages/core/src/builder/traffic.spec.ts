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
            range: [0, 80000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for 0-100 weight on two variations", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "control",
          weight: 0,
        },
        {
          value: "treatment",
          weight: 100,
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
          // should be filtered out automatically
          // {
          //   variation: "control",
          //   range: [0, 0],
          // },

          {
            variation: "treatment",
            range: [0, 80000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for 0-100 weight on two variations, with rule percentage going from 80% to 100%", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "control",
          weight: 0,
        },
        {
          value: "treatment",
          weight: 100,
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
            value: "control",
            weight: 0,
          },
          {
            value: "treatment",
            weight: 80,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "treatment",
                range: [0, 80000],
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
          // should be filtered out automatically
          // {
          //   variation: "control",
          //   range: [0, 0],
          // },

          {
            variation: "treatment",
            range: [0, 100000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for 0-100 weight on two variations, with rule percentage going from 100% to 80%", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "control",
          weight: 0,
        },
        {
          value: "treatment",
          weight: 100,
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
            value: "control",
            weight: 0,
          },
          {
            value: "treatment",
            weight: 80,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 100000,
            allocation: [
              {
                variation: "treatment",
                range: [0, 100000],
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
          // should be filtered out automatically
          // {
          //   variation: "control",
          //   range: [0, 0],
          // },

          {
            variation: "treatment",
            range: [0, 80000],
          },
        ],
      },
    ]);
  });

  it("should allocate traffic for existing variations state of 0-100 weights", function () {
    const result = getTraffic(
      // parsed variations from YAML
      [
        {
          value: "control",
          weight: 50,
        },
        {
          value: "treatment",
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
            value: "control",
            weight: 0,
          },
          {
            value: "treatment",
            weight: 80,
          },
        ],
        traffic: [
          {
            key: "1",
            percentage: 80000,
            allocation: [
              {
                variation: "treatment",
                range: [0, 80000],
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
            variation: "control",
            range: [0, 40000],
          },
          {
            variation: "treatment",
            range: [40000, 80000],
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
            range: [0, 40000],
          },
          {
            variation: "off",
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
            range: [0, 33330],
          },
          {
            variation: "no",
            range: [33330, 66660],
          },
          {
            variation: "maybe",
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
                range: [0, 40000],
              },
              {
                variation: "off",
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
            range: [0, 40000],
          },
          {
            variation: "off",
            range: [40000, 80000],
          },

          // new
          {
            variation: "on",
            range: [80000, 85000],
          },
          {
            variation: "off",
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
                range: [0, 40000],
              },
              {
                variation: "off",
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
            range: [0, 35000],
          },
          {
            variation: "off",
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
                range: [0, 40000],
              },
              {
                variation: "b",
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
            range: [0, 29997],
          },
          {
            variation: "b",
            range: [29997, 59994],
          },
          {
            variation: "c",
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
                range: [0, 40000],
              },
              {
                variation: "b",
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
            range: [0, 25000],
          },
          {
            variation: "b",
            range: [25000, 50000],
          },
          {
            variation: "c",
            range: [50000, 75000],
          },
          {
            variation: "d",
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
                range: [0, 25000],
              },
              {
                variation: "b",
                range: [25000, 50000],
              },
              {
                variation: "c",
                range: [50000, 75000],
              },
              {
                variation: "d",
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
            range: [0, 50000],
          },
          {
            variation: "b",
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
                range: [0, 25000],
              },
              {
                variation: "b",
                range: [25000, 50000],
              },
              {
                variation: "c",
                range: [50000, 75000],
              },
              {
                variation: "d",
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
            range: [0, 40000],
          },
          {
            variation: "b",
            range: [40000, 80000],
          },
        ],
      },
    ]);
  });
});
