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

    test("buildScopedSegments is a function", function () {
      expect(buildScopedSegments).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(buildScopedSegments(datafileReaderWithSegments, "*", {})).toEqual("*");

      // Plain segment that matches
      expect(
        buildScopedSegments(datafileReaderWithSegments, "web", {
          platform: "web",
        }),
      ).toEqual("*");

      // Plain segment that doesn't match
      expect(
        buildScopedSegments(datafileReaderWithSegments, "web", {
          platform: "mobile",
        }),
      ).toEqual("web");

      // Array of segments - partial match (redundant "*" removed)
      expect(
        buildScopedSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "web",
        }),
      ).toEqual(["chrome"]);

      // Array of segments - full match (all "*" becomes "*")
      expect(
        buildScopedSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "web",
          browser: "chrome",
        }),
      ).toEqual("*");

      // Array of segments - no match
      expect(
        buildScopedSegments(datafileReaderWithSegments, ["web", "chrome"], {
          platform: "mobile",
          browser: "safari",
        }),
      ).toEqual(["web", "chrome"]);
    });

    test("AND group segments", function () {
      // AND with all matching segments (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");

      // AND with partial match (redundant "*" removed)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: ["web", "chrome"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        and: ["chrome"],
      });

      // AND with no matches
      expect(
        buildScopedSegments(
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

      // AND with "*" in it (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: ["*", "chrome"],
          },
          {
            browser: "chrome",
          },
        ),
      ).toEqual("*");
    });

    test("OR group segments", function () {
      // OR with all matching segments (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            or: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");

      // OR with partial match (redundant "*" removed, but OR structure remains)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            or: ["web", "chrome"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        or: ["chrome"],
      });

      // OR with no matches
      expect(
        buildScopedSegments(
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
      // NOT with matching segment (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            not: ["web"],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual("*");

      // NOT with non-matching segment
      expect(
        buildScopedSegments(
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
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            not: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");
    });

    test("nested AND group segments", function () {
      // Nested AND with all matching (all "*" becomes "*")
      expect(
        buildScopedSegments(
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
      ).toEqual("*");

      // Nested AND with partial match (redundant "*" removed)
      expect(
        buildScopedSegments(
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
          {
            and: ["us"],
          },
        ],
      });
    });

    test("nested OR group segments", function () {
      // Nested OR with outer match (redundant "*" removed, but inner OR remains)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            or: [
              "web",
              {
                or: ["mobile", "chrome"],
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        or: [
          {
            or: ["mobile", "chrome"],
          },
        ],
      });

      // Nested OR with inner match (redundant "*" removed, but outer OR remains)
      expect(
        buildScopedSegments(
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
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: [
          "web",
          {
            or: ["safari"],
          },
        ],
      });
    });

    test("nested NOT group segments", function () {
      // Nested NOT (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            not: [
              "web",
              {
                not: ["chrome"],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");
    });

    test("mixed nested group segments", function () {
      // AND with nested OR (redundant "*" removed, but OR structure remains if not all match)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: [
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
        and: [
          {
            or: ["safari"],
          },
        ],
      });

      // OR with nested AND (redundant "*" removed, but OR structure remains if not all match)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            or: [
              "web",
              {
                and: ["mobile", "chrome"],
              },
            ],
          },
          {
            platform: "mobile",
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: ["web"],
      });

      // AND with nested NOT (redundant "*" removed)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: [
              "web",
              {
                not: ["mobile"],
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        and: [
          {
            not: ["mobile"],
          },
        ],
      });

      // Complex nested structure (redundant "*" removed)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: [
              "web",
              {
                or: [
                  {
                    and: ["chrome", "us"],
                  },
                  "safari",
                ],
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
          {
            or: ["safari"],
          },
        ],
      });
    });

    test("arrays with nested group segments", function () {
      // Array with AND group segment (redundant "*" removed)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          [
            "web",
            {
              and: ["chrome", "us"],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
            country: "us",
          },
        ),
      ).toEqual("*");

      // Array with OR group segment (redundant "*" removed, but OR structure remains if not all match)
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          [
            "web",
            {
              or: ["chrome", "safari"],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual([
        {
          or: ["safari"],
        },
      ]);
    });

    test("segments with complex conditions", function () {
      // Segment with AND conditions in its definition
      expect(
        buildScopedSegments(datafileReaderWithSegments, "premium", {
          tier: "premium",
          status: "active",
        }),
      ).toEqual("*");

      // Segment with AND conditions that doesn't match
      expect(
        buildScopedSegments(datafileReaderWithSegments, "premium", {
          tier: "premium",
          status: "inactive",
        }),
      ).toEqual("premium");
    });

    test("edge cases", function () {
      // Empty context
      expect(buildScopedSegments(datafileReaderWithSegments, "web", {})).toEqual("web");

      // Empty array (all "*" becomes "*")
      expect(buildScopedSegments(datafileReaderWithSegments, [], {})).toEqual("*");

      // "*" in array with matching segment (all "*" becomes "*")
      expect(
        buildScopedSegments(datafileReaderWithSegments, ["*", "web"], {
          platform: "web",
        }),
      ).toEqual("*");

      // AND with empty array (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            and: [],
          },
          {},
        ),
      ).toEqual("*");

      // OR with empty array (all "*" becomes "*")
      expect(
        buildScopedSegments(
          datafileReaderWithSegments,
          {
            or: [],
          },
          {},
        ),
      ).toEqual("*");
    });
  });

  describe("removeRedundantGroupSegments", function () {
    test("removeRedundantGroupSegments is a function", function () {
      expect(removeRedundantGroupSegments).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // * is *
      expect(removeRedundantGroupSegments("*")).toEqual("*");

      // [*, *, *] is "*"
      expect(removeRedundantGroupSegments(["*", "*", "*"])).toEqual("*");

      // Array with mixed group segments
      expect(removeRedundantGroupSegments(["*", "web", "*", "chrome"])).toEqual(["web", "chrome"]);
    });

    test("AND group segments", function () {
      // All "*" in AND
      expect(removeRedundantGroupSegments({ and: ["*", "*", "*"] })).toEqual("*");

      // Mixed with "*" in AND
      expect(
        removeRedundantGroupSegments({
          and: ["*", "web", "*"],
        }),
      ).toEqual({
        and: ["web"],
      });

      // Multiple non-* group segments in AND
      expect(
        removeRedundantGroupSegments({
          and: ["*", "web", "*", "chrome", "*"],
        }),
      ).toEqual({
        and: ["web", "chrome"],
      });
    });

    test("OR group segments", function () {
      // All "*" in OR
      expect(removeRedundantGroupSegments({ or: ["*", "*", "*"] })).toEqual("*");

      // Mixed with "*" in OR
      expect(
        removeRedundantGroupSegments({
          or: ["*", "web", "*"],
        }),
      ).toEqual({
        or: ["web"],
      });

      // Multiple non-* group segments in OR
      expect(
        removeRedundantGroupSegments({
          or: ["*", "web", "*", "mobile", "*"],
        }),
      ).toEqual({
        or: ["web", "mobile"],
      });
    });

    test("NOT group segments", function () {
      // All "*" in NOT
      expect(removeRedundantGroupSegments({ not: ["*", "*", "*"] })).toEqual("*");

      // Mixed with "*" in NOT
      expect(
        removeRedundantGroupSegments({
          not: ["*", "web", "*"],
        }),
      ).toEqual({
        not: ["web"],
      });
    });

    test("nested AND group segments", function () {
      // Nested AND with all "*"
      expect(
        removeRedundantGroupSegments({
          and: ["*", { and: ["*", "*", "*"] }, "*"],
        }),
      ).toEqual("*");

      // Nested AND with mixed group segments
      expect(
        removeRedundantGroupSegments({
          and: [
            "*",
            "web",
            {
              and: ["*", "chrome", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          "web",
          {
            and: ["chrome"],
          },
        ],
      });

      // Deeply nested AND
      expect(
        removeRedundantGroupSegments({
          and: [
            "*",
            {
              and: [
                "*",
                {
                  and: ["*", "*", "*"],
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual("*");
    });

    test("nested OR group segments", function () {
      // Nested OR with all "*"
      expect(
        removeRedundantGroupSegments({
          or: ["*", { or: ["*", "*", "*"] }, "*"],
        }),
      ).toEqual("*");

      // Nested OR with mixed group segments
      expect(
        removeRedundantGroupSegments({
          or: [
            "*",
            "web",
            {
              or: ["*", "mobile", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          "web",
          {
            or: ["mobile"],
          },
        ],
      });
    });

    test("nested NOT group segments", function () {
      // Nested NOT with all "*"
      expect(
        removeRedundantGroupSegments({
          not: ["*", { not: ["*", "*", "*"] }, "*"],
        }),
      ).toEqual("*");

      // Nested NOT with mixed group segments
      expect(
        removeRedundantGroupSegments({
          not: [
            "*",
            "web",
            {
              not: ["*", "chrome", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        not: [
          "web",
          {
            not: ["chrome"],
          },
        ],
      });
    });

    test("mixed nested group segments", function () {
      // AND with nested OR
      expect(
        removeRedundantGroupSegments({
          and: [
            "*",
            "web",
            {
              or: ["*", "chrome", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          "web",
          {
            or: ["chrome"],
          },
        ],
      });

      // OR with nested AND
      expect(
        removeRedundantGroupSegments({
          or: [
            "*",
            "web",
            {
              and: ["*", "chrome", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          "web",
          {
            and: ["chrome"],
          },
        ],
      });

      // AND with nested NOT
      expect(
        removeRedundantGroupSegments({
          and: [
            "*",
            "web",
            {
              not: ["*", "mobile", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          "web",
          {
            not: ["mobile"],
          },
        ],
      });

      // Complex nested structure
      expect(
        removeRedundantGroupSegments({
          and: [
            "*",
            "web",
            {
              or: [
                "*",
                {
                  and: ["*", "chrome", "*"],
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          "web",
          {
            or: [
              {
                and: ["chrome"],
              },
            ],
          },
        ],
      });
    });

    test("arrays with nested group segments", function () {
      // Array with nested AND
      expect(
        removeRedundantGroupSegments([
          "*",
          {
            and: ["*", "web", "*"],
          },
          "*",
        ]),
      ).toEqual([
        {
          and: ["web"],
        },
      ]);

      // Array with multiple nested group segments
      expect(
        removeRedundantGroupSegments([
          "*",
          "web",
          {
            or: ["*", "chrome", "*"],
          },
          "*",
        ]),
      ).toEqual([
        "web",
        {
          or: ["chrome"],
        },
      ]);
    });

    test("edge cases", function () {
      // Single group segment after filtering
      expect(
        removeRedundantGroupSegments({
          and: ["*", "web", "*"],
        }),
      ).toEqual({
        and: ["web"],
      });

      // Plain string group segment (no change)
      expect(removeRedundantGroupSegments("web")).toEqual("web");

      // Array with single non-* group segment
      expect(removeRedundantGroupSegments(["*", "web", "*"])).toEqual(["web"]);
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
