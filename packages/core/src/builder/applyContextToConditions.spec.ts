import type { Condition, DatafileContent } from "@featurevisor/types";

import {
  applyContextToCondition,
  removeRedundantConditions,
  applyContextToConditions,
} from "./applyContextToConditions";
import { createFeaturevisor } from "@featurevisor/sdk";

describe("core: applyContextToConditions", function () {
  const emptyDatafile: DatafileContent = {
    schemaVersion: "2",
    revision: "unknown",
    segments: {},
    features: {},
  };

  const datafileReader = createFeaturevisor({
    datafile: emptyDatafile,
    logLevel: "fatal",
  });

  describe("applyContextToConditions (plural)", function () {
    test("applyContextToConditions is a function", function () {
      expect(applyContextToConditions).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(applyContextToConditions(datafileReader, "*", {})).toEqual("*");

      // Plain condition that matches
      expect(
        applyContextToConditions(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "web",
          },
        ),
      ).toEqual("*");

      // Plain condition that doesn't match
      expect(
        applyContextToConditions(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Array of conditions - partial match (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
          {
            platform: "web",
          },
        ),
      ).toEqual([
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ]);

      // Array of conditions - full match (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");

      // Array of conditions - no match
      expect(
        applyContextToConditions(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
          {
            platform: "mobile",
            browser: "safari",
          },
        ),
      ).toEqual([
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ]);
    });

    test("AND conditions", function () {
      // AND with all matching conditions (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");

      // AND with partial match (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
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
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // AND with no matches
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
          {
            platform: "mobile",
            browser: "safari",
          },
        ),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // AND with "*" in it (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              "*",
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual("*");
    });

    test("OR conditions", function () {
      // OR with all matching conditions (all "*" becomes "*")
      // Note: This would require both conditions to match, which isn't possible with same attribute
      // So testing with different attributes that both match
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual("*");

      // OR with partial match (redundant "*" removed, but OR structure remains)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
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
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // OR with no matches
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
            ],
          },
          {
            platform: "desktop",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "platform",
            operator: "equals",
            value: "mobile",
          },
        ],
      });
    });

    test("NOT conditions", function () {
      // NOT with matching condition remains an always-false expression
      expect(
        applyContextToConditions(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        not: ["*"],
      });

      // NOT with non-matching condition
      expect(
        applyContextToConditions(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        not: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // NOT with multiple matching conditions remains an always-false expression
      expect(
        applyContextToConditions(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
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

    test("nested AND conditions", function () {
      // Nested AND with all matching (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "version",
                    operator: "equals",
                    value: "1.0",
                  },
                ],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
          },
        ),
      ).toEqual("*");

      // Nested AND with partial match (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "version",
                    operator: "equals",
                    value: "1.0",
                  },
                ],
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
            and: [
              {
                attribute: "version",
                operator: "equals",
                value: "1.0",
              },
            ],
          },
        ],
      });
    });

    test("nested OR conditions", function () {
      // Nested OR with outer match (redundant "*" removed, but inner OR remains)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "desktop",
                  },
                ],
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
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
              {
                attribute: "platform",
                operator: "equals",
                value: "desktop",
              },
            ],
          },
        ],
      });

      // Nested OR with inner match (redundant "*" removed, but outer OR remains)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "desktop",
                  },
                ],
              },
            ],
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "desktop",
              },
            ],
          },
        ],
      });
    });

    test("nested NOT conditions", function () {
      // Nested NOT preserves non-broadening false expressions
      expect(
        applyContextToConditions(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                not: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                ],
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

    test("mixed nested conditions", function () {
      // AND with nested OR (redundant "*" removed, but OR structure remains if not all match)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "firefox",
                  },
                ],
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
            or: [
              {
                attribute: "browser",
                operator: "equals",
                value: "firefox",
              },
            ],
          },
        ],
      });

      // OR with nested AND (redundant "*" removed, but OR structure remains if not all match)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                ],
              },
            ],
          },
          {
            platform: "mobile",
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // AND with nested NOT (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                not: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "safari",
                  },
                ],
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
            not: [
              {
                attribute: "browser",
                operator: "equals",
                value: "safari",
              },
            ],
          },
        ],
      });

      // Complex nested structure (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    and: [
                      {
                        attribute: "browser",
                        operator: "equals",
                        value: "chrome",
                      },
                      {
                        attribute: "version",
                        operator: "equals",
                        value: "1.0",
                      },
                    ],
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "firefox",
                  },
                ],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
          },
        ),
      ).toEqual({
        and: [
          {
            or: [
              {
                attribute: "browser",
                operator: "equals",
                value: "firefox",
              },
            ],
          },
        ],
      });
    });

    test("arrays with nested conditions", function () {
      // Array with AND condition (redundant "*" removed)
      expect(
        applyContextToConditions(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              and: [
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                {
                  attribute: "version",
                  operator: "equals",
                  value: "1.0",
                },
              ],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
          },
        ),
      ).toEqual("*");

      // Array with OR condition (redundant "*" removed, but OR structure remains if not all match)
      expect(
        applyContextToConditions(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              or: [
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "firefox",
                },
              ],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual([
        {
          or: [
            {
              attribute: "browser",
              operator: "equals",
              value: "firefox",
            },
          ],
        },
      ]);
    });

    test("edge cases", function () {
      // Empty context
      expect(
        applyContextToConditions(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {},
        ),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Empty array (all "*" becomes "*")
      expect(applyContextToConditions(datafileReader, [], {})).toEqual("*");

      // "*" in array with matching condition (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
          ],
          {
            platform: "web",
          },
        ),
      ).toEqual("*");

      // AND with empty array (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          {
            and: [],
          },
          {},
        ),
      ).toEqual("*");

      // OR with empty array (all "*" becomes "*")
      expect(
        applyContextToConditions(
          datafileReader,
          {
            or: [],
          },
          {},
        ),
      ).toEqual("*");
    });
  });

  describe("applyContextToCondition (singular)", function () {
    test("applyContextToCondition is a function", function () {
      expect(applyContextToCondition).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(applyContextToCondition(datafileReader, "*", {})).toEqual("*");

      // Plain condition that matches
      expect(
        applyContextToCondition(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "web",
          },
        ),
      ).toEqual("*");

      // Plain condition that doesn't match
      expect(
        applyContextToCondition(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Array of conditions
      const originalConditions: Condition[] = [
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ];

      // Partial match
      expect(
        applyContextToCondition(datafileReader, originalConditions, {
          platform: "web",
        }),
      ).toEqual([
        "*",
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ]);

      // Full match
      expect(
        applyContextToCondition(datafileReader, originalConditions, {
          platform: "web",
          browser: "chrome",
        }),
      ).toEqual(["*", "*"]);

      // No match
      expect(
        applyContextToCondition(datafileReader, originalConditions, {
          platform: "mobile",
          browser: "safari",
        }),
      ).toEqual([
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ]);
    });

    test("AND conditions", function () {
      // AND with all matching conditions
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
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
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        and: [
          "*",
          {
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // AND with no matches
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
          {
            platform: "mobile",
            browser: "safari",
          },
        ),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // AND with "*" in it
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              "*",
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        and: ["*", "*"],
      });
    });

    test("OR conditions", function () {
      // OR with all matching conditions
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        or: ["*", { attribute: "platform", operator: "equals", value: "mobile" }],
      });

      // OR with partial match (first matches)
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
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
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });

      // OR with no matches
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
            ],
          },
          {
            platform: "desktop",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "platform",
            operator: "equals",
            value: "mobile",
          },
        ],
      });
    });

    test("NOT conditions", function () {
      // NOT with matching condition (should not match)
      expect(
        applyContextToCondition(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "web",
          },
        ),
      ).toEqual({
        not: ["*"],
      });

      // NOT with non-matching condition
      expect(
        applyContextToCondition(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
            ],
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        not: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // NOT with multiple conditions
      expect(
        applyContextToCondition(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
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

    test("nested AND conditions", function () {
      // Nested AND with all matching
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "version",
                    operator: "equals",
                    value: "1.0",
                  },
                ],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
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
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "version",
                    operator: "equals",
                    value: "1.0",
                  },
                ],
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
            and: [
              "*",
              {
                attribute: "version",
                operator: "equals",
                value: "1.0",
              },
            ],
          },
        ],
      });
    });

    test("nested OR conditions", function () {
      // Nested OR with matching
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "desktop",
                  },
                ],
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
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
              {
                attribute: "platform",
                operator: "equals",
                value: "desktop",
              },
            ],
          },
        ],
      });

      // Nested OR with inner match
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "desktop",
                  },
                ],
              },
            ],
          },
          {
            platform: "mobile",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              "*",
              {
                attribute: "platform",
                operator: "equals",
                value: "desktop",
              },
            ],
          },
        ],
      });
    });

    test("nested NOT conditions", function () {
      // Nested NOT
      expect(
        applyContextToCondition(
          datafileReader,
          {
            not: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                not: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                ],
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
          "*",
          {
            not: ["*"],
          },
        ],
      });
    });

    test("mixed nested conditions", function () {
      // AND with nested OR
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "firefox",
                  },
                ],
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
            or: [
              "*",
              {
                attribute: "browser",
                operator: "equals",
                value: "firefox",
              },
            ],
          },
        ],
      });

      // OR with nested AND
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                and: [
                  {
                    attribute: "platform",
                    operator: "equals",
                    value: "mobile",
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                ],
              },
            ],
          },
          {
            platform: "mobile",
            browser: "chrome",
          },
        ),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            and: ["*", "*"],
          },
        ],
      });

      // AND with nested NOT
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                not: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "safari",
                  },
                ],
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
            not: [
              {
                attribute: "browser",
                operator: "equals",
                value: "safari",
              },
            ],
          },
        ],
      });

      // Complex nested structure
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              {
                or: [
                  {
                    and: [
                      {
                        attribute: "browser",
                        operator: "equals",
                        value: "chrome",
                      },
                      {
                        attribute: "version",
                        operator: "equals",
                        value: "1.0",
                      },
                    ],
                  },
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "firefox",
                  },
                ],
              },
            ],
          },
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
          },
        ),
      ).toEqual({
        and: [
          "*",
          {
            or: [
              {
                and: ["*", "*"],
              },
              {
                attribute: "browser",
                operator: "equals",
                value: "firefox",
              },
            ],
          },
        ],
      });
    });

    test("arrays with nested conditions", function () {
      // Array with AND condition
      expect(
        applyContextToCondition(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              and: [
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                {
                  attribute: "version",
                  operator: "equals",
                  value: "1.0",
                },
              ],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
            version: "1.0",
          },
        ),
      ).toEqual([
        "*",
        {
          and: ["*", "*"],
        },
      ]);

      // Array with OR condition
      expect(
        applyContextToCondition(
          datafileReader,
          [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              or: [
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "firefox",
                },
              ],
            },
          ],
          {
            platform: "web",
            browser: "chrome",
          },
        ),
      ).toEqual([
        "*",
        {
          or: [
            "*",
            {
              attribute: "browser",
              operator: "equals",
              value: "firefox",
            },
          ],
        },
      ]);
    });

    test("edge cases", function () {
      // Empty context
      expect(
        applyContextToCondition(
          datafileReader,
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {},
        ),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Empty array
      expect(applyContextToCondition(datafileReader, [], {})).toEqual([]);

      // "*" in array
      expect(
        applyContextToCondition(
          datafileReader,
          [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
          ],
          {
            platform: "web",
          },
        ),
      ).toEqual(["*", "*"]);

      // AND with empty array
      expect(
        applyContextToCondition(
          datafileReader,
          {
            and: [],
          },
          {},
        ),
      ).toEqual({
        and: [],
      });

      // OR with empty array
      expect(
        applyContextToCondition(
          datafileReader,
          {
            or: [],
          },
          {},
        ),
      ).toEqual({
        or: [],
      });
    });
  });

  describe("removeRedundantConditions", function () {
    test("removeRedundantConditions is a function", function () {
      expect(removeRedundantConditions).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // * is *
      expect(removeRedundantConditions("*")).toEqual("*");

      // [*, *, *] is "*"
      expect(removeRedundantConditions(["*", "*", "*"])).toEqual("*");

      // Array with mixed conditions
      expect(
        removeRedundantConditions([
          "*",
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          "*",
          {
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ]),
      ).toEqual([
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
        {
          attribute: "browser",
          operator: "equals",
          value: "chrome",
        },
      ]);
    });

    test("AND conditions", function () {
      // All "*" in AND
      expect(removeRedundantConditions({ and: ["*", "*", "*"] })).toEqual("*");

      // Mixed with "*" in AND
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // Multiple non-* conditions in AND
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "browser",
            operator: "equals",
            value: "chrome",
          },
        ],
      });
    });

    test("OR conditions", function () {
      // All "*" in OR
      expect(removeRedundantConditions({ or: ["*", "*", "*"] })).toEqual("*");

      // Mixed with "*" in OR
      expect(
        removeRedundantConditions({
          or: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // Multiple non-* conditions in OR
      expect(
        removeRedundantConditions({
          or: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "mobile",
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            attribute: "platform",
            operator: "equals",
            value: "mobile",
          },
        ],
      });
    });

    test("NOT conditions", function () {
      // All "*" in NOT
      expect(removeRedundantConditions({ not: ["*", "*", "*"] })).toEqual({
        not: ["*"],
      });

      // Mixed with "*" in NOT
      expect(
        removeRedundantConditions({
          not: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
          ],
        }),
      ).toEqual({
        not: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });
    });

    test("nested AND conditions", function () {
      // Nested AND with all "*"
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              and: ["*", "*", "*"],
            },
            "*",
          ],
        }),
      ).toEqual("*");

      // Nested AND with mixed conditions
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              and: [
                "*",
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            and: [
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
        ],
      });

      // Deeply nested AND
      expect(
        removeRedundantConditions({
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

    test("nested OR conditions", function () {
      // Nested OR with all "*"
      expect(
        removeRedundantConditions({
          or: [
            "*",
            {
              or: ["*", "*", "*"],
            },
            "*",
          ],
        }),
      ).toEqual("*");

      // Nested OR with mixed conditions
      expect(
        removeRedundantConditions({
          or: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              or: [
                "*",
                {
                  attribute: "platform",
                  operator: "equals",
                  value: "mobile",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              {
                attribute: "platform",
                operator: "equals",
                value: "mobile",
              },
            ],
          },
        ],
      });
    });

    test("nested NOT conditions", function () {
      // Nested NOT with all "*"
      expect(
        removeRedundantConditions({
          not: [
            "*",
            {
              not: ["*", "*", "*"],
            },
            "*",
          ],
        }),
      ).toEqual({
        not: [
          {
            not: ["*"],
          },
        ],
      });

      // Nested NOT with mixed conditions
      expect(
        removeRedundantConditions({
          not: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              not: [
                "*",
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        not: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            not: [
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
        ],
      });
    });

    test("mixed nested conditions", function () {
      // AND with nested OR
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              or: [
                "*",
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
        ],
      });

      // OR with nested AND
      expect(
        removeRedundantConditions({
          or: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              and: [
                "*",
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "chrome",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        or: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            and: [
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
            ],
          },
        ],
      });

      // AND with nested NOT
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              not: [
                "*",
                {
                  attribute: "browser",
                  operator: "equals",
                  value: "safari",
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            not: [
              {
                attribute: "browser",
                operator: "equals",
                value: "safari",
              },
            ],
          },
        ],
      });

      // Complex nested structure
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            {
              or: [
                "*",
                {
                  and: [
                    "*",
                    {
                      attribute: "browser",
                      operator: "equals",
                      value: "chrome",
                    },
                    "*",
                  ],
                },
                "*",
              ],
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              {
                and: [
                  {
                    attribute: "browser",
                    operator: "equals",
                    value: "chrome",
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    test("arrays with nested conditions", function () {
      // Array with nested AND
      expect(
        removeRedundantConditions([
          "*",
          {
            and: [
              "*",
              {
                attribute: "platform",
                operator: "equals",
                value: "web",
              },
              "*",
            ],
          },
          "*",
        ]),
      ).toEqual([
        {
          and: [
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
          ],
        },
      ]);

      // Array with multiple nested conditions
      expect(
        removeRedundantConditions([
          "*",
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            or: [
              "*",
              {
                attribute: "browser",
                operator: "equals",
                value: "chrome",
              },
              "*",
            ],
          },
          "*",
        ]),
      ).toEqual([
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
        {
          or: [
            {
              attribute: "browser",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
      ]);
    });

    test("edge cases", function () {
      // Single condition after filtering
      expect(
        removeRedundantConditions({
          and: [
            "*",
            {
              attribute: "platform",
              operator: "equals",
              value: "web",
            },
            "*",
          ],
        }),
      ).toEqual({
        and: [
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
        ],
      });

      // Plain condition object (no change)
      expect(
        removeRedundantConditions({
          attribute: "platform",
          operator: "equals",
          value: "web",
        }),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Array with single non-* condition
      expect(
        removeRedundantConditions([
          "*",
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          "*",
        ]),
      ).toEqual([
        {
          attribute: "platform",
          operator: "equals",
          value: "web",
        },
      ]);
    });
  });
});
