import type { Condition, DatafileContent } from "@featurevisor/types";

import { buildScopedCondition, removeRedundantConditions } from "./buildScopedConditions";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

describe("core: buildScopedConditions", function () {
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

  describe("buildScopedCondition (singular)", function () {
    test("buildScopedCondition is a function", function () {
      expect(buildScopedCondition).toBeInstanceOf(Function);
    });

    test("simple cases", function () {
      // "*" remains "*"
      expect(buildScopedCondition("*", {}, datafileReader)).toEqual("*");

      // Plain condition that matches
      expect(
        buildScopedCondition(
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "web",
          },
          datafileReader,
        ),
      ).toEqual("*");

      // Plain condition that doesn't match
      expect(
        buildScopedCondition(
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {
            platform: "mobile",
          },
          datafileReader,
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
        buildScopedCondition(
          originalConditions,
          {
            platform: "web",
          },
          datafileReader,
        ),
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
        buildScopedCondition(
          originalConditions,
          {
            platform: "web",
            browser: "chrome",
          },
          datafileReader,
        ),
      ).toEqual(["*", "*"]);

      // No match
      expect(
        buildScopedCondition(
          originalConditions,
          {
            platform: "mobile",
            browser: "safari",
          },
          datafileReader,
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
      // AND with all matching conditions
      expect(
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual({
        and: ["*", "*"],
      });

      // AND with partial match
      expect(
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual({
        and: ["*", "*"],
      });
    });

    test("OR conditions", function () {
      // OR with all matching conditions
      expect(
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual({
        or: ["*", { attribute: "platform", operator: "equals", value: "mobile" }],
      });

      // OR with partial match (first matches)
      expect(
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual({
        not: ["*"],
      });

      // NOT with non-matching condition
      expect(
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual({
        not: ["*", "*"],
      });
    });

    test("nested AND conditions", function () {
      // Nested AND with all matching
      expect(
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual([
        "*",
        {
          and: ["*", "*"],
        },
      ]);

      // Array with OR condition
      expect(
        buildScopedCondition(
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
          datafileReader,
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
        buildScopedCondition(
          {
            attribute: "platform",
            operator: "equals",
            value: "web",
          },
          {},
          datafileReader,
        ),
      ).toEqual({
        attribute: "platform",
        operator: "equals",
        value: "web",
      });

      // Empty array
      expect(buildScopedCondition([], {}, datafileReader)).toEqual([]);

      // "*" in array
      expect(
        buildScopedCondition(
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
          datafileReader,
        ),
      ).toEqual(["*", "*"]);

      // AND with empty array
      expect(
        buildScopedCondition(
          {
            and: [],
          },
          {},
          datafileReader,
        ),
      ).toEqual({
        and: [],
      });

      // OR with empty array
      expect(
        buildScopedCondition(
          {
            or: [],
          },
          {},
          datafileReader,
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
      expect(removeRedundantConditions({ not: ["*", "*", "*"] })).toEqual("*");

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
      ).toEqual("*");

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
