import type { DatafileContent } from "@featurevisor/types";
import { buildScopedDatafile } from "./buildScopedDatafile";

describe("core: buildScopedDatafile", function () {
  test("buildScopedDatafile is a function", function () {
    expect(buildScopedDatafile).toBeInstanceOf(Function);
  });

  describe("basic functionality", function () {
    test("empty datafile", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {},
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result).toEqual(datafile);
    });

    test("datafile with no segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.segments).toEqual({});
      expect(result.features.feature1).toBeDefined();
    });

    test("datafile with no features", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments).toEqual({});
      expect(result.features).toEqual({});
    });
  });

  describe("segments processing", function () {
    test("segment with matching condition becomes * and is removed", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments).toEqual({});
    });

    test("segment with non-matching condition remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(result.segments.web).toBeDefined();
      expect(result.segments.web.conditions).toEqual([
        { attribute: "platform", operator: "equals", value: "web" },
      ]);
    });

    test("segment with * condition is removed", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          all: {
            conditions: "*",
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.segments).toEqual({});
    });

    test("multiple segments - some match, some don't", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.segments.web).toBeUndefined();
      expect(result.segments.mobile).toBeDefined();
      expect(result.segments.chrome).toBeUndefined();
    });

    test("segment with AND conditions - all match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          premium: {
            conditions: {
              and: [
                { attribute: "tier", operator: "equals", value: "premium" },
                { attribute: "status", operator: "equals", value: "active" },
              ],
            },
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { tier: "premium", status: "active" });

      expect(result.segments).toEqual({});
    });

    test("segment with AND conditions - partial match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          premium: {
            conditions: {
              and: [
                { attribute: "tier", operator: "equals", value: "premium" },
                { attribute: "status", operator: "equals", value: "active" },
              ],
            },
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { tier: "premium" });

      expect(result.segments.premium).toBeDefined();
      expect(result.segments.premium.conditions).toEqual({
        and: [{ attribute: "status", operator: "equals", value: "active" }],
      });
    });

    test("segment with OR conditions - one matches", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          browser: {
            conditions: {
              or: [
                { attribute: "browser", operator: "equals", value: "chrome" },
                { attribute: "browser", operator: "equals", value: "firefox" },
              ],
            },
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { browser: "chrome" });

      expect(result.segments).toEqual({
        browser: {
          conditions: {
            // @TODO: this OR (with only one child) can become a single (AND) condition
            or: [
              {
                attribute: "browser",
                operator: "equals",
                value: "firefox",
              },
            ],
          },
        },
      });
    });

    test("segment with array of conditions - all match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          combined: {
            conditions: [
              { attribute: "platform", operator: "equals", value: "web" },
              { attribute: "browser", operator: "equals", value: "chrome" },
            ],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.segments).toEqual({});
    });

    test("segment with array of conditions - partial match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          combined: {
            conditions: [
              { attribute: "platform", operator: "equals", value: "web" },
              { attribute: "browser", operator: "equals", value: "chrome" },
            ],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments.combined).toBeDefined();
      expect(result.segments.combined.conditions).toEqual([
        { attribute: "browser", operator: "equals", value: "chrome" },
      ]);
    });
  });

  describe("features with force entries", function () {
    test("force with matching segments becomes *", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: "web",
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].segments).toEqual("*");
    });

    test("force with non-matching segments remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: "web",
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(result.features.feature1.force?.[0].segments).toEqual("web");
    });

    test("force with matching conditions becomes *", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].conditions).toEqual("*");
    });

    test("force with non-matching conditions remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(result.features.feature1.force?.[0].conditions).toEqual([
        { attribute: "platform", operator: "equals", value: "web" },
      ]);
    });

    test("force with array of segments - all match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: ["web", "chrome"],
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.force?.[0].segments).toEqual("*");
    });

    test("force with array of segments - partial match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: ["web", "chrome"],
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].segments).toEqual(["chrome"]);
    });

    test("force with AND group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: { and: ["web", "chrome"] },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.force?.[0].segments).toEqual("*");
    });

    test("force with OR group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: { or: ["web", "mobile"] },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].segments).toEqual({ or: ["mobile"] });
    });

    test("force with AND conditions", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                conditions: {
                  and: [
                    { attribute: "platform", operator: "equals", value: "web" },
                    { attribute: "browser", operator: "equals", value: "chrome" },
                  ],
                },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.force?.[0].conditions).toEqual("*");
    });

    test("force with OR conditions", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                conditions: {
                  or: [
                    { attribute: "platform", operator: "equals", value: "web" },
                    { attribute: "platform", operator: "equals", value: "mobile" },
                  ],
                },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].conditions).toEqual({
        or: [{ attribute: "platform", operator: "equals", value: "mobile" }],
      });
    });

    test("multiple force entries", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: "web",
                variation: "treatment",
              },
              {
                segments: "mobile",
                variation: "control",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[1].segments).toEqual("mobile");
    });
  });

  describe("features with traffic entries", function () {
    test("traffic with matching segments becomes *", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
    });

    test("traffic with non-matching segments remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(result.features.feature1.traffic[0].segments).toEqual("web");
    });

    test("traffic with array of segments - all match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: ["web", "chrome"],
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
    });

    test("traffic with array of segments - partial match", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: ["web", "chrome"],
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic[0].segments).toEqual(["chrome"]);
    });

    test("traffic with AND group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: { and: ["web", "chrome"] },
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
    });

    test("traffic with OR group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: { or: ["web", "mobile"] },
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic[0].segments).toEqual({ or: ["mobile"] });
    });

    test("multiple traffic entries", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 50000,
              },
              {
                key: "rule2",
                segments: "mobile",
                percentage: 50000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.traffic[1].segments).toEqual("mobile");
    });

    test("consecutive traffic entries with * segments - second is removed", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 50000,
              },
              {
                key: "rule2",
                segments: "*",
                percentage: 50000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.traffic).toHaveLength(1);
      expect(result.features.feature1.traffic[0].key).toEqual("rule1");
    });

    test("consecutive traffic entries with * segments - multiple consecutive removed", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 25000,
              },
              {
                key: "rule2",
                segments: "*",
                percentage: 25000,
              },
              {
                key: "rule3",
                segments: "*",
                percentage: 25000,
              },
              {
                key: "rule4",
                segments: "web",
                percentage: 25000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic).toHaveLength(2);
      expect(result.features.feature1.traffic[0].key).toEqual("rule1");
      expect(result.features.feature1.traffic[1].key).toEqual("rule4");
      expect(result.features.feature1.traffic[1].segments).toEqual("*");
    });

    test("non-consecutive traffic entries with * segments - both remain", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 33333,
              },
              {
                key: "rule2",
                segments: "mobile",
                percentage: 33333,
              },
              {
                key: "rule3",
                segments: "*",
                percentage: 33334,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.traffic).toHaveLength(3);
    });

    test("traffic entry that becomes * after scoping - consecutive removal works", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 50000,
              },
              {
                key: "rule2",
                segments: "web",
                percentage: 50000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic).toHaveLength(1);
      expect(result.features.feature1.traffic[0].key).toEqual("rule1");
    });
  });

  describe("features with variations and variableOverrides", function () {
    test("variableOverride with matching segments becomes *", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("variableOverride with non-matching segments remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "web",
      );
    });

    test("variableOverride with matching conditions becomes *", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(
        result.features.feature1.variations?.[0].variableOverrides?.color[0].conditions,
      ).toEqual("*");
    });

    test("variableOverride with non-matching conditions remains", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile" });

      expect(
        result.features.feature1.variations?.[0].variableOverrides?.color[0].conditions,
      ).toEqual([{ attribute: "platform", operator: "equals", value: "web" }]);
    });

    test("variableOverride with array of segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: ["web", "chrome"],
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("variableOverride with AND group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: { and: ["web", "chrome"] },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("variableOverride with OR group segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: { or: ["web", "mobile"] },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        { or: ["mobile"] },
      );
    });

    test("variableOverride with AND conditions", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      conditions: {
                        and: [
                          { attribute: "platform", operator: "equals", value: "web" },
                          { attribute: "browser", operator: "equals", value: "chrome" },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(
        result.features.feature1.variations?.[0].variableOverrides?.color[0].conditions,
      ).toEqual("*");
    });

    test("variableOverride with OR conditions", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      conditions: {
                        or: [
                          { attribute: "platform", operator: "equals", value: "web" },
                          { attribute: "platform", operator: "equals", value: "mobile" },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(
        result.features.feature1.variations?.[0].variableOverrides?.color[0].conditions,
      ).toEqual({
        or: [{ attribute: "platform", operator: "equals", value: "mobile" }],
      });
    });

    test("multiple variableOverrides for same variable", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                    {
                      value: "blue",
                      segments: "mobile",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
      expect(result.features.feature1.variations?.[0].variableOverrides?.color[1].segments).toEqual(
        "mobile",
      );
    });

    test("multiple variables with variableOverrides", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                  size: [
                    {
                      value: "large",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
      expect(result.features.feature1.variations?.[0].variableOverrides?.size[0].segments).toEqual(
        "*",
      );
    });

    test("multiple variations with variableOverrides", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
              {
                value: "treatment",
                variableOverrides: {
                  color: [
                    {
                      value: "blue",
                      segments: "mobile",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
      expect(result.features.feature1.variations?.[1].variableOverrides?.color[0].segments).toEqual(
        "mobile",
      );
    });
  });

  describe("complex nested scenarios", function () {
    test("feature with force, traffic, and variations", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
            force: [
              {
                segments: "chrome",
                variation: "treatment",
              },
            ],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].segments).toEqual("*");
      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("multiple features with different scoping results", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
          },
          feature2: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "mobile",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature2.traffic[0].segments).toEqual("mobile");
    });

    test("segment used in multiple places - all scoped correctly", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
            force: [
              {
                segments: "web",
                variation: "treatment",
              },
            ],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments).toEqual({});
      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].segments).toEqual("*");
      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("nested AND/OR segments in force and traffic", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: {
                  and: ["web", "chrome"],
                },
                percentage: 100000,
              },
            ],
            force: [
              {
                segments: {
                  or: ["web", "mobile"],
                },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].segments).toEqual({ or: ["mobile"] });
    });

    test("nested AND/OR conditions in force and variableOverrides", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                conditions: {
                  and: [
                    { attribute: "platform", operator: "equals", value: "web" },
                    { attribute: "browser", operator: "equals", value: "chrome" },
                  ],
                },
                variation: "treatment",
              },
            ],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      conditions: {
                        or: [
                          { attribute: "platform", operator: "equals", value: "web" },
                          { attribute: "platform", operator: "equals", value: "mobile" },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.force?.[0].conditions).toEqual("*");
      expect(
        result.features.feature1.variations?.[0].variableOverrides?.color[0].conditions,
      ).toEqual({
        or: [{ attribute: "platform", operator: "equals", value: "mobile" }],
      });
    });
  });

  describe("edge cases", function () {
    test("feature without force, traffic, or variations", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1).toBeDefined();
      expect(result.features.feature1.traffic).toEqual([]);
    });

    test("feature with empty force array", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.force).toEqual([]);
    });

    test("feature with empty variations array", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.variations).toEqual([]);
    });

    test("variation without variableOverrides", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.variations?.[0].variableOverrides).toBeUndefined();
    });

    test("variation with empty variableOverrides object", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {},
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.variations?.[0].variableOverrides).toEqual({});
    });

    test("variableOverride with empty segments array", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: [],
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });

    test("force with both segments and conditions - segments take precedence", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            force: [
              {
                segments: "web",
                conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.force?.[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].conditions).toBeDefined();
    });

    test("traffic with * segments initially - consecutive removal still works", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {},
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "*",
                percentage: 50000,
              },
              {
                key: "rule2",
                segments: "*",
                percentage: 50000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, {});

      expect(result.features.feature1.traffic).toHaveLength(1);
    });

    test("segment that becomes * is removed even if referenced elsewhere", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments).toEqual({});
      expect(result.features.feature1.traffic[0].segments).toEqual("*");
    });

    test("context with extra attributes not in segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, {
        platform: "web",
        extraAttribute: "extraValue",
      });

      expect(result.segments).toEqual({});
    });

    test("datafile with all segments matching context", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.segments).toEqual({});
    });

    test("datafile with no segments matching context", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {},
      };

      const result = buildScopedDatafile(datafile, { platform: "mobile", browser: "safari" });

      expect(result.segments.web).toBeDefined();
      expect(result.segments.chrome).toBeDefined();
    });

    test("feature with multiple traffic entries becoming * consecutively", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 25000,
              },
              {
                key: "rule2",
                segments: "web",
                percentage: 25000,
              },
              {
                key: "rule3",
                segments: "web",
                percentage: 25000,
              },
              {
                key: "rule4",
                segments: "web",
                percentage: 25000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.features.feature1.traffic).toHaveLength(1);
      expect(result.features.feature1.traffic[0].key).toEqual("rule1");
    });

    test("variableOverride with segments that become * after segment removal", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web" });

      expect(result.segments).toEqual({});
      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );
    });
  });

  describe("integration scenarios", function () {
    test("complete datafile with all feature types", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
          mobile: {
            conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
            force: [
              {
                segments: "chrome",
                variation: "treatment",
              },
            ],
            variations: [
              {
                value: "control",
                variableOverrides: {
                  color: [
                    {
                      value: "red",
                      segments: "web",
                    },
                  ],
                },
              },
            ],
          },
          feature2: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "mobile",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.segments.web).toBeUndefined();
      expect(result.segments.chrome).toBeUndefined();
      expect(result.segments.mobile).toBeDefined();

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].segments).toEqual("*");
      expect(result.features.feature1.variations?.[0].variableOverrides?.color[0].segments).toEqual(
        "*",
      );

      expect(result.features.feature2.traffic[0].segments).toEqual("mobile");
    });

    test("datafile with deeply nested conditions and segments", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
          chrome: {
            conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: {
                  and: [
                    "web",
                    {
                      or: ["chrome", "web"],
                    },
                  ],
                },
                percentage: 100000,
              },
            ],
            force: [
              {
                conditions: {
                  and: [
                    { attribute: "platform", operator: "equals", value: "web" },
                    {
                      or: [
                        { attribute: "browser", operator: "equals", value: "chrome" },
                        { attribute: "browser", operator: "equals", value: "firefox" },
                      ],
                    },
                  ],
                },
                variation: "treatment",
              },
            ],
          },
        },
      };

      const result = buildScopedDatafile(datafile, { platform: "web", browser: "chrome" });

      expect(result.features.feature1.traffic[0].segments).toEqual("*");
      expect(result.features.feature1.force?.[0].conditions).toEqual("*");
    });

    test("datafile immutability - original not modified", function () {
      const datafile: DatafileContent = {
        schemaVersion: "2",
        revision: "unknown",
        segments: {
          web: {
            conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
          },
        },
        features: {
          feature1: {
            bucketBy: ["userId"],
            traffic: [
              {
                key: "rule1",
                segments: "web",
                percentage: 100000,
              },
            ],
          },
        },
      };

      const originalSegments = JSON.stringify(datafile.segments);
      const originalTraffic = JSON.stringify(datafile.features.feature1.traffic);

      buildScopedDatafile(datafile, { platform: "web" });

      expect(JSON.stringify(datafile.segments)).toEqual(originalSegments);
      expect(JSON.stringify(datafile.features.feature1.traffic)).toEqual(originalTraffic);
    });
  });
});
