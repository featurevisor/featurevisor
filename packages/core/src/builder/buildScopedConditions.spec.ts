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

    test("and conditions", function () {
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

      //  context: {}
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

      // context: { platform: "web" }
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

      // context: { platform: "web", browser: "chrome" }
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
