import type { GroupSegment, DatafileContent } from "@featurevisor/types";

import {
  buildScopedSegments,
  removeRedundantGroupSegments,
  buildScopedGroupSegments,
} from "./buildScopedSegments";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

describe("core: buildScopedSegments", function () {
  const emptyDatafile: DatafileContent = {
    schemaVersion: "2",
    revision: "unknown",
    segments: {},
    features: {},
  };

  const datafileReader = new DatafileReader({
    datafile: emptyDatafile,
    logger: createLogger({ level: "fatal" }),
  });

  describe("buildScopedSegments", function () {
    test("buildScopedSegments is a function", function () {
      expect(buildScopedSegments).toBeInstanceOf(Function);
    });
  });

  describe("removeRedundantGroupSegments", function () {
    test("removeRedundantGroupSegments is a function", function () {
      expect(removeRedundantGroupSegments).toBeInstanceOf(Function);
    });
  });

  describe("buildScopedGroupSegments", function () {
    const datafileWithSegments: DatafileContent = {
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
        safari: {
          conditions: [{ attribute: "browser", operator: "equals", value: "safari" }],
        },
        premium: {
          conditions: [
            {
              and: [
                { attribute: "tier", operator: "equals", value: "premium" },
                { attribute: "status", operator: "equals", value: "active" },
              ],
            },
          ],
        },
        us: {
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        },
        eu: {
          conditions: [{ attribute: "country", operator: "equals", value: "eu" }],
        },
      },
      features: {},
    };

    const datafileReaderWithSegments = new DatafileReader({
      datafile: datafileWithSegments,
      logger: createLogger({ level: "fatal" }),
    });

    test("buildScopedGroupSegments is a function", function () {
      expect(buildScopedGroupSegments).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(buildScopedGroupSegments(datafileReaderWithSegments, "*", {})).toEqual("*");

      // Plain segment that matches
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, "web", {
          platform: "web",
        }),
      ).toEqual("*");

      // Plain segment that doesn't match
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, "web", {
          platform: "mobile",
        }),
      ).toEqual("web");

      // Array of segments - partial match
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "web",
        }),
      ).toEqual(["*", "chrome"]);

      // Array of segments - full match (all "*" - will be cleaned by removeRedundantGroupSegments later)
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "web",
          browser: "chrome",
        }),
      ).toEqual(["*", "*"]);

      // Array of segments - no match
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "mobile",
          browser: "safari",
        }),
      ).toEqual(["web", "chrome"]);
    });

    test("AND group segments", function () {
      // AND with all matching segments (all "*" becomes "*")
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        and: ["*", "*"],
      });

      // AND with partial match
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: ["web", "chrome"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        and: ["*", "chrome"],
      });

      // AND with no matches
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: ["web", "chrome"],
          },
          {
            platform: "mobile",
            browser: "safari",
          },
        ),
      ).toEqual({
        and: ["web", "chrome"],
      });

      // AND with "*" in it
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: ["*", "chrome"],
          },
          {
            browser: "chrome",
          },
        ),
      ).toEqual({
        and: ["*", "*"],
      });
    });

    test("OR group segments", function () {
      // OR with all matching segments (all "*" becomes "*")
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            or: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: ["*", "*"],
      });

      // OR with partial match
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            or: ["web", "chrome"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        or: ["*", "chrome"],
      });

      // OR with no matches
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            or: ["web", "mobile"],
          },
          {
            platform: "desktop",
          },
        ),
      ).toEqual({
        or: ["web", "mobile"],
      });
    });

    test("NOT group segments", function () {
      // NOT with matching segment
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            not: ["web"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        not: ["*"],
      });

      // NOT with non-matching segment
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            not: ["web"],
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        not: ["web"],
      });

      // NOT with multiple segments (all "*" becomes "*")
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            not: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        not: ["*", "*"],
      });
    });

    test("nested AND group segments", function () {
      // Nested AND with all matching (all "*" becomes "*")
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: [
              "web",
              {
                and: ["chrome", "us"],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
            country: "us",
          },
        ),
      ).toEqual({
        and: [
          "*",
          {
            and: ["*", "*"],
          },
        ],
      });

      // Nested AND with partial match
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: [
              "web",
              {
                and: ["chrome", "us"],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        and: [
          "*",
          {
            and: ["*", "us"],
          },
        ],
      });
    });

    test("nested OR group segments", function () {
      // Nested OR with all matching
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            or: [
              "web",
              {
                or: ["chrome", "safari"],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: [
          "*",
          {
            or: ["*", "safari"],
          },
        ],
      });

      // Nested OR with partial match
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            or: [
              "web",
              {
                or: ["chrome", "safari"],
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        or: [
          "*",
          {
            or: ["chrome", "safari"],
          },
        ],
      });
    });

    test("complex nested structures", function () {
      // Complex nested with AND, OR, NOT
      expect(
        buildScopedGroupSegments(
          datafileReaderWithSegments,
          {
            and: [
              "web",
              {
                or: ["chrome", "safari"],
              },
              {
                not: ["mobile"],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        and: [
          "*",
          {
            or: ["*", "safari"],
          },
          {
            not: ["mobile"],
          },
        ],
      });
    });

    test("segments with complex conditions", function () {
      // Segment with AND conditions in its definition
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, "premium", {
          tier: "premium",
          status: "active",
        }),
      ).toEqual("*");

      // Segment with AND conditions that doesn't match
      expect(
        buildScopedGroupSegments(datafileReaderWithSegments, "premium", {
          tier: "premium",
          status: "inactive",
        }),
      ).toEqual("premium");
    });
  });
});
