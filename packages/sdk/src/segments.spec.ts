import { DatafileReader } from "./datafileReader";
import { allGroupSegmentsAreMatched } from "./segments";
import { DatafileContent, GroupSegment } from "@featurevisor/types";

interface Group {
  key: string;
  segments: GroupSegment | GroupSegment[] | "*";
}

describe("sdk: Segments", function () {
  it("should be a function", function () {
    expect(typeof allGroupSegmentsAreMatched).toEqual("function");
  });

  describe("datafile #1", function () {
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
    ];

    const datafileContent: DatafileContent = {
      schemaVersion: "1.0",
      revision: "1",
      features: [],
      attributes: [],

      segments: [
        // deviceType
        {
          key: "mobileUsers",
          conditions: [
            {
              attribute: "deviceType",
              operator: "equals",
              value: "mobile",
            },
          ],
        },
        {
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
        {
          key: "chromeBrowser",
          conditions: [
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
        {
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
        {
          key: "netherlands",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "nl",
            },
          ],
        },
        {
          key: "germany",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "de",
            },
          ],
        },
      ],
    };

    const datafileReader = new DatafileReader(datafileContent);

    it("should match everyone", function () {
      const group = groups.find((g) => g.key === "*") as Group;

      // match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(true);
      expect(allGroupSegmentsAreMatched(group.segments, { foo: "foo" }, datafileReader)).toEqual(
        true,
      );
      expect(allGroupSegmentsAreMatched(group.segments, { bar: "bar" }, datafileReader)).toEqual(
        true,
      );
    });

    it("should match dutchMobileUsers", function () {
      const group = groups.find((g) => g.key === "dutchMobileUsers") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(false);
    });

    it("should match dutchMobileUsers2", function () {
      const group = groups.find((g) => g.key === "dutchMobileUsers") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(false);
    });

    it("should match dutchMobileOrDesktopUsers", function () {
      const group = groups.find((g) => g.key === "dutchMobileOrDesktopUsers") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "desktop", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(false);
    });

    it("should match dutchMobileOrDesktopUsers2", function () {
      const group = groups.find((g) => g.key === "dutchMobileOrDesktopUsers2") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "desktop", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(false);
    });

    it("should match germanMobileUsers", function () {
      const group = groups.find((g) => g.key === "germanMobileUsers") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "mobile", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "mobile" },
          datafileReader,
        ),
      ).toEqual(false);
    });

    it("should match germanNonMobileUsers", function () {
      const group = groups.find((g) => g.key === "germanNonMobileUsers") as Group;

      // match
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(true);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "de", deviceType: "desktop", browser: "chrome" },
          datafileReader,
        ),
      ).toEqual(true);

      // not match
      expect(allGroupSegmentsAreMatched(group.segments, {}, datafileReader)).toEqual(false);
      expect(
        allGroupSegmentsAreMatched(
          group.segments,
          { country: "nl", deviceType: "desktop" },
          datafileReader,
        ),
      ).toEqual(false);
    });
  });
});
