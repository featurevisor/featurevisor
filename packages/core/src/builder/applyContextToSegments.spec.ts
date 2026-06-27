import type { DatafileContent } from "@featurevisor/types";

import {
  applyContextToSegments,
  removeRedundantGroupSegments,
  applyContextToGroupSegments,
} from "./applyContextToSegments";
import { createFeaturevisor } from "@featurevisor/sdk";

describe("core: applyContextToSegments", function () {
  describe("applyContextToSegments", function () {
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

    const featurevisorWithSegments = createFeaturevisor({
      datafile: datafileWithSegments,
      logLevel: "fatal",
    });

    test("applyContextToSegments is a function", function () {
      expect(applyContextToSegments).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(applyContextToSegments(featurevisorWithSegments, "*", {})).toEqual("*");

      // Plain segment that matches
      expect(
        applyContextToSegments(featurevisorWithSegments, "web", {
          platform: "web",
        }),
      ).toEqual("*");

      // Plain segment that doesn't match
      expect(
        applyContextToSegments(featurevisorWithSegments, "web", {
          platform: "mobile",
        }),
      ).toEqual("web");

      // Array of segments - partial match (redundant "*" removed)
      expect(
        applyContextToSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "web",
        }),
      ).toEqual(["chrome"]);

      // Array of segments - full match (all "*" becomes "*")
      expect(
        applyContextToSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "web",
          browser: "chrome",
        }),
      ).toEqual("*");

      // Array of segments - no match
      expect(
        applyContextToSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "mobile",
          browser: "safari",
        }),
      ).toEqual(["web", "chrome"]);
    });

    test("AND group segments", function () {
      // AND with all matching segments (all "*" becomes "*")
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
      // NOT with matching segment remains an always-false expression
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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

      // NOT with multiple matching segments remains an always-false expression
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
          {
            not: ["web", "chrome"],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual({
        not: ["*"],
      });
    });

    test("nested AND group segments", function () {
      // Nested AND with all matching (all "*" becomes "*")
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
      // Nested NOT preserves non-broadening false expressions
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
      ).toEqual({
        not: [
          {
            not: ["*"],
          },
        ],
      });
    });

    test("mixed nested group segments", function () {
      // AND with nested OR (redundant "*" removed, but OR structure remains if not all match)
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(
          featurevisorWithSegments,
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
        applyContextToSegments(featurevisorWithSegments, "premium", {
          tier: "premium",
          status: "active",
        }),
      ).toEqual("*");

      // Segment with AND conditions that doesn't match
      expect(
        applyContextToSegments(featurevisorWithSegments, "premium", {
          tier: "premium",
          status: "inactive",
        }),
      ).toEqual("premium");
    });

    test("edge cases", function () {
      // Empty context
      expect(applyContextToSegments(featurevisorWithSegments, "web", {})).toEqual("web");

      // Empty array (all "*" becomes "*")
      expect(applyContextToSegments(featurevisorWithSegments, [], {})).toEqual("*");

      // "*" in array with matching segment (all "*" becomes "*")
      expect(
        applyContextToSegments(featurevisorWithSegments, ["*", "web"], {
          platform: "web",
        }),
      ).toEqual("*");

      // AND with empty array (all "*" becomes "*")
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
          {
            and: [],
          },
          {},
        ),
      ).toEqual("*");

      // OR with empty array (all "*" becomes "*")
      expect(
        applyContextToSegments(
          featurevisorWithSegments,
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
      expect(removeRedundantGroupSegments({ not: ["*", "*", "*"] })).toEqual({
        not: ["*"],
      });

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
      ).toEqual({
        not: [
          {
            not: ["*"],
          },
        ],
      });

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

  describe("applyContextToGroupSegments", function () {
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

    const featurevisorWithSegments = createFeaturevisor({
      datafile: datafileWithSegments,
      logLevel: "fatal",
    });

    test("applyContextToGroupSegments is a function", function () {
      expect(applyContextToGroupSegments).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(applyContextToGroupSegments(featurevisorWithSegments, "*", {})).toEqual("*");

      // Plain segment that matches
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, "web", {
          platform: "web",
        }),
      ).toEqual("*");

      // Plain segment that doesn't match
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, "web", {
          platform: "mobile",
        }),
      ).toEqual("web");

      // Array of segments - partial match
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "web",
        }),
      ).toEqual(["*", "chrome"]);

      // Array of segments - full match (all "*" - will be cleaned by removeRedundantGroupSegments later)
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "web",
          browser: "chrome",
        }),
      ).toEqual(["*", "*"]);

      // Array of segments - no match
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "chrome"], {
          platform: "mobile",
          browser: "safari",
        }),
      ).toEqual(["web", "chrome"]);
    });

    test("AND group segments", function () {
      // AND with all matching segments (all "*" becomes "*")
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
        applyContextToGroupSegments(featurevisorWithSegments, "premium", {
          tier: "premium",
          status: "active",
        }),
      ).toEqual("*");

      // Segment with AND conditions that doesn't match
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, "premium", {
          tier: "premium",
          status: "inactive",
        }),
      ).toEqual("premium");
    });

    test("removeSegments parameter", function () {
      // Simple segment in removeSegments
      expect(applyContextToGroupSegments(featurevisorWithSegments, "web", {}, ["web"])).toEqual(
        "*",
      );

      // Segment not in removeSegments
      expect(applyContextToGroupSegments(featurevisorWithSegments, "web", {}, ["mobile"])).toEqual(
        "web",
      );

      // Array with one segment in removeSegments
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "chrome"], {}, ["web"]),
      ).toEqual(["*", "chrome"]);

      // Array with all segments in removeSegments
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "chrome"], {}, [
          "web",
          "chrome",
        ]),
      ).toEqual(["*", "*"]);

      // Array with multiple segments, some in removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          ["web", "chrome", "mobile", "safari"],
          {},
          ["web", "mobile"],
        ),
      ).toEqual(["*", "chrome", "*", "safari"]);

      // AND group segment with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            and: ["web", "chrome"],
          },
          {},
          ["web"],
        ),
      ).toEqual({
        and: ["*", "chrome"],
      });

      // AND group segment with all segments in removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            and: ["web", "chrome"],
          },
          {},
          ["web", "chrome"],
        ),
      ).toEqual({
        and: ["*", "*"],
      });

      // OR group segment with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            or: ["web", "chrome"],
          },
          {},
          ["web"],
        ),
      ).toEqual({
        or: ["*", "chrome"],
      });

      // OR group segment with all segments in removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            or: ["web", "chrome"],
          },
          {},
          ["web", "chrome"],
        ),
      ).toEqual({
        or: ["*", "*"],
      });

      // NOT group segment with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            not: ["web", "chrome"],
          },
          {},
          ["web"],
        ),
      ).toEqual({
        not: ["*", "chrome"],
      });

      // NOT group segment with all segments in removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            not: ["web", "chrome"],
          },
          {},
          ["web", "chrome"],
        ),
      ).toEqual({
        not: ["*", "*"],
      });

      // Nested AND with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            and: [
              "web",
              {
                and: ["chrome", "us"],
              },
            ],
          },
          {},
          ["web"],
        ),
      ).toEqual({
        and: [
          "*",
          {
            and: ["chrome", "us"],
          },
        ],
      });

      // Nested OR with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            or: [
              "web",
              {
                or: ["chrome", "safari"],
              },
            ],
          },
          {},
          ["chrome"],
        ),
      ).toEqual({
        or: [
          "web",
          {
            or: ["*", "safari"],
          },
        ],
      });

      // Mixed nested structure with removeSegments
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
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
          {},
          ["web", "safari"],
        ),
      ).toEqual({
        and: [
          "*",
          {
            or: ["chrome", "*"],
          },
          {
            not: ["mobile"],
          },
        ],
      });

      // removeSegments combined with matching context
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          ["web", "chrome"],
          {
            platform: "web",
          },
          ["chrome"],
        ),
      ).toEqual(["*", "*"]);

      // removeSegments with segment that would match context
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          ["web", "chrome"],
          {
            platform: "web",
            browser: "chrome",
          },
          ["web"],
        ),
      ).toEqual(["*", "*"]);

      // Complex: removeSegments, context matching, and nested structures
      expect(
        applyContextToGroupSegments(
          featurevisorWithSegments,
          {
            and: [
              "web",
              {
                or: ["chrome", "safari", "mobile"],
              },
              "us",
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
          ["us"],
        ),
      ).toEqual({
        and: [
          "*",
          {
            or: ["*", "safari", "mobile"],
          },
          "*",
        ],
      });

      // Empty removeSegments array (should behave like no removeSegments)
      expect(applyContextToGroupSegments(featurevisorWithSegments, "web", {}, [])).toEqual("web");

      // removeSegments with segment that doesn't exist in datafile
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["web", "nonexistent"], {}, [
          "nonexistent",
        ]),
      ).toEqual(["web", "*"]);

      // removeSegments with "*" in array (should still work)
      expect(
        applyContextToGroupSegments(featurevisorWithSegments, ["*", "web", "chrome"], {}, ["web"]),
      ).toEqual(["*", "*", "chrome"]);
    });
  });
});
