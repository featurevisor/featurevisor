import type { DatafileContent, GroupSegment } from "@featurevisor/types";

import { DatafileReader } from "./datafileReader";
import { createLogger } from "./logger";

interface Group {
  key: string;
  segments: GroupSegment | GroupSegment[] | "*";
}

describe("sdk: DatafileReader", function () {
  const logger = createLogger();

  it("should be a function", function () {
    expect(typeof DatafileReader).toEqual("function");
  });

  it("v2 datafile schema: should return requested entities", function () {
    const datafileJson: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      segments: {
        netherlands: {
          key: "netherlands",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "nl",
            },
          ],
        },
        germany: {
          key: "germany",
          conditions: JSON.stringify([
            {
              attribute: "country",
              operator: "equals",
              value: "de",
            },
          ]),
        },
      },
      features: {
        test: {
          key: "test",
          bucketBy: "userId",
          variations: [
            { value: "control" },
            {
              value: "treatment",
              variables: {
                showSidebar: true,
              },
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
      },
    };

    const reader = new DatafileReader({
      datafile: datafileJson,
      logger,
    });

    expect(reader.getRevision()).toEqual("1");
    expect(reader.getSchemaVersion()).toEqual("2");
    expect(reader.getSegment("netherlands")).toEqual(datafileJson.segments.netherlands);
    expect((reader.getSegment("germany") as any).conditions[0].value).toEqual("de");
    expect(reader.getSegment("belgium")).toEqual(undefined);
    expect(reader.getFeature("test")).toEqual(datafileJson.features.test);
    expect(reader.getVariableKeys("test")).toEqual([]);
    expect(reader.getFeature("test2")).toEqual(undefined);
    expect(reader.getVariableKeys("test2")).toEqual([]);
  });

  describe("segments", function () {
    const groups = [
      // everyone
      {
        key: "*",
        segments: "*",
      },

      // dutch
      {
        key: "dutchMobileUsers",
        segments: ["mobileUsers", "netherlands"],
      },
      {
        key: "dutchMobileUsers2",
        segments: {
          and: ["mobileUsers", "netherlands"],
        },
      },
      {
        key: "dutchMobileOrDesktopUsers",
        segments: ["netherlands", { or: ["mobileUsers", "desktopUsers"] }],
      },
      {
        key: "dutchMobileOrDesktopUsers2",
        segments: {
          and: ["netherlands", { or: ["mobileUsers", "desktopUsers"] }],
        },
      },

      // german
      {
        key: "germanMobileUsers",
        segments: [
          {
            and: ["mobileUsers", "germany"],
          },
        ],
      },
      {
        key: "germanNonMobileUsers",
        segments: [
          {
            and: [
              "germany",
              {
                not: ["mobileUsers"],
              },
            ],
          },
        ],
      },

      // version
      {
        key: "notVersion5.5",
        segments: [
          {
            not: ["version_5.5"],
          },
        ],
      },
    ];

    const datafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1",
      features: {},

      segments: {
        // deviceType
        mobileUsers: {
          key: "mobileUsers",
          conditions: [
            {
              attribute: "deviceType",
              operator: "equals",
              value: "mobile",
            },
          ],
        },
        desktopUsers: {
          key: "desktopUsers",
          conditions: [
            {
              attribute: "deviceType",
              operator: "equals",
              value: "desktop",
            },
          ],
        },

        // browser
        chromeBrowser: {
          key: "chromeBrowser",
          conditions: [
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
        firefoxBrowser: {
          key: "firefoxBrowser",
          conditions: [
            {
              attribute: "browser",
              operator: "equals",
              value: "firefox",
            },
          ],
        },

        // country
        netherlands: {
          key: "netherlands",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "nl",
            },
          ],
        },
        germany: {
          key: "germany",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "de",
            },
          ],
        },

        // version
        "version_5.5": {
          key: "version_5.5",
          conditions: [
            {
              or: [
                {
                  attribute: "version",
                  operator: "equals",
                  value: "5.5",
                },
                {
                  attribute: "version",
                  operator: "equals",
                  value: 5.5,
                },
              ],
            },
          ],
        },
      },
    };

    const datafileReader = new DatafileReader({
      datafile: datafileContent,
      logger,
    });

    it("should match everyone", function () {
      const group = groups.find((g) => g.key === "*") as Group;

      // match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(true);
      expect(datafileReader.allSegmentsAreMatched(group.segments, { foo: "foo" })).toEqual(true);
      expect(datafileReader.allSegmentsAreMatched(group.segments, { bar: "bar" })).toEqual(true);
    });

    it("should match dutchMobileUsers", function () {
      const group = groups.find((g) => g.key === "dutchMobileUsers") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
        }),
      ).toEqual(false);
    });

    it("should match dutchMobileUsers2", function () {
      const group = groups.find((g) => g.key === "dutchMobileUsers") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
        }),
      ).toEqual(false);
    });

    it("should match dutchMobileOrDesktopUsers", function () {
      const group = groups.find((g) => g.key === "dutchMobileOrDesktopUsers") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
          browser: "chrome",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "desktop",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "desktop",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
        }),
      ).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "desktop",
        }),
      ).toEqual(false);
    });

    it("should match dutchMobileOrDesktopUsers2", function () {
      const group = groups.find((g) => g.key === "dutchMobileOrDesktopUsers2") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
          browser: "chrome",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "desktop",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "desktop",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
        }),
      ).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "desktop",
        }),
      ).toEqual(false);
    });

    it("should match germanMobileUsers", function () {
      const group = groups.find((g) => g.key === "germanMobileUsers") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "mobile",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "mobile",
        }),
      ).toEqual(false);
    });

    it("should match germanNonMobileUsers", function () {
      const group = groups.find((g) => g.key === "germanNonMobileUsers") as Group;

      // match
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "desktop",
        }),
      ).toEqual(true);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "de",
          deviceType: "desktop",
          browser: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(false);
      expect(
        datafileReader.allSegmentsAreMatched(group.segments, {
          country: "nl",
          deviceType: "desktop",
        }),
      ).toEqual(false);
    });

    it("should match notVersion5.5", function () {
      const group = groups.find((g) => g.key === "notVersion5.5") as Group;

      // match
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(true);
      expect(datafileReader.allSegmentsAreMatched(group.segments, {})).toEqual(true);
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: "5.6" })).toEqual(
        true,
      );
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: 5.6 })).toEqual(true);
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: "5.7" })).toEqual(
        true,
      );
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: 5.7 })).toEqual(true);

      // not match
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: "5.5" })).toEqual(
        false,
      );
      expect(datafileReader.allSegmentsAreMatched(group.segments, { version: 5.5 })).toEqual(false);
    });
  });
});
