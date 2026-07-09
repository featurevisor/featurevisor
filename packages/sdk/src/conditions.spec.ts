import type { Condition } from "@featurevisor/types";

import {
  allConditionsAreMatched,
  allSegmentsAreMatched,
  parseConditionsIfStringified,
  parseSegmentsIfStringified,
} from "./conditions";

describe("sdk: Conditions", function () {
  it("should be a function", function () {
    expect(typeof allConditionsAreMatched).toEqual("function");
  });

  it("should match all via *", function () {
    // match
    const conditions: Condition = "*";
    expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(true);

    // not match
    const conditions2: Condition = "blah";
    expect(allConditionsAreMatched(conditions2, { browser_type: "chrome" })).toEqual(false);
  });

  describe("operators", function () {
    it("should match with operator: equals", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(false);
    });

    it("should match with operator: equals with dot separated path", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser.type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser: { type: "chrome" } })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser: { type: "firefox" } })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { browser: { blah: "firefox" } })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { browser: "firefox" })).toEqual(false);
    });

    it("should match with operator: notEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "notEquals",
          value: "chrome",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(false);
    });

    it("should match with operator: equals", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(false);
    });

    it("should match with operator: exists", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "exists",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { not_browser_type: "chrome" })).toEqual(false);
    });

    it("should match with operator: exists (dot separated path)", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser.name",
          operator: "exists",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser: { name: "chrome" } })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser: "chrome" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { browser: { version: "1.2.3" } })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { version: "1.2.3" })).toEqual(false);
    });

    it("should match with operator: notExists", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "notExists",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { not_name: "Hello World" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { not_name: "Hello Universe" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(false);
    });

    it("should match with operator: notExists (with dot separated path)", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser.name",
          operator: "notExists",
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser: { not_name: "Hello World" },
        }),
      ).toEqual(true);
      expect(allConditionsAreMatched(conditions, { not_name: "Hello Universe" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser: { name: "Chrome" } })).toEqual(false);
    });

    it("should match with operator: endsWith", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "endsWith",
          value: "World",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hello World" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hi Universe" })).toEqual(false);
    });

    it("should match with operator: includes", function () {
      const conditions: Condition[] = [
        {
          attribute: "permissions",
          operator: "includes",
          value: "write",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { permissions: ["read", "write"] })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { permissions: ["read"] })).toEqual(false);
    });

    it("should match with operator: notIncludes", function () {
      const conditions: Condition[] = [
        {
          attribute: "permissions",
          operator: "notIncludes",
          value: "write",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { permissions: ["read", "admin"] })).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          permissions: ["read", "write", "admin"],
        }),
      ).toEqual(false);
    });

    it("should match with operator: contains", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "contains",
          value: "Hello",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hello World" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "Yo! Hello!" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(false);
    });

    it("should match with operator: notContains", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "notContains",
          value: "Hello",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hello World" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "Yo! Hello!" })).toEqual(false);
    });

    it("should match with operator: matches", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "matches",
          value: "^[a-zA-Z]{2,}$",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hello" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "Helloooooo" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hello World" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "Hell123" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "123" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: 123 })).toEqual(false);
    });

    it("should match with operator: matches with regexFlags", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "matches",
          value: "^[a-zA-Z]{2,}$",
          regexFlags: "i",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hello" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "Helloooooo" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hello World" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "Hell123" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "123" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: 123 })).toEqual(false);
    });

    it("should match with operator: notMatches", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "notMatches",
          value: "^[a-zA-Z]{2,}$",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "123" })).toEqual(true);

      // @NOTE: improve later
      // expect(allConditionsAreMatched(conditions, { name: 123 }, )).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hello" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "Hellooooooo" })).toEqual(false);
    });

    it("should match with operator: notMatches with regexFlags", function () {
      const conditions: Condition[] = [
        {
          attribute: "name",
          operator: "notMatches",
          value: "^[a-zA-Z]{2,}$",
          regexFlags: "i",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { name: "Hi World" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { name: "123" })).toEqual(true);

      // @NOTE: improve later
      // expect(allConditionsAreMatched(conditions, { name: 123 }, )).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { name: "Hello" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { name: "Hellooooooo" })).toEqual(false);
    });

    it("should match with operator: in", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "in",
          value: ["chrome", "firefox"],
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser_type: "edge" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { browser_type: "safari" })).toEqual(false);
    });

    it("should match with operator: notIn", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "notIn",
          value: ["chrome", "firefox"],
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { browser_type: "edge" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { browser_type: "safari" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { browser_type: "chrome" })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { browser_type: "firefox" })).toEqual(false);
    });

    it("should match with operator: greaterThan", function () {
      const conditions: Condition[] = [
        {
          attribute: "age",
          operator: "greaterThan",
          value: 18,
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { age: 19 })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { age: 17 })).toEqual(false);
    });

    it("should match with operator: greaterThanOrEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "age",
          operator: "greaterThanOrEquals",
          value: 18,
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { age: 18 })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { age: 19 })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { age: 17 })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { age: 16 })).toEqual(false);
    });

    it("should match with operator: lessThan", function () {
      const conditions: Condition[] = [
        {
          attribute: "age",
          operator: "lessThan",
          value: 18,
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { age: 17 })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { age: 19 })).toEqual(false);
    });

    it("should match with operator: lessThanOrEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "age",
          operator: "lessThanOrEquals",
          value: 18,
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { age: 17 })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { age: 18 })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { age: 19 })).toEqual(false);
      expect(allConditionsAreMatched(conditions, { age: 20 })).toEqual(false);
    });

    it("should match with operator: semverEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverEquals",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "1.0.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "2.0.0" })).toEqual(false);
    });

    it("should match with operator: semverNotEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverNotEquals",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "2.0.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "1.0.0" })).toEqual(false);
    });

    it("should match with operator: semverGreaterThan", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverGreaterThan",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "2.0.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "0.9.0" })).toEqual(false);
    });

    it("should match with operator: semverGreaterThanOrEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverGreaterThanOrEquals",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "1.0.0" })).toEqual(true);
      expect(allConditionsAreMatched(conditions, { version: "2.0.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "0.9.0" })).toEqual(false);
    });

    it("should match with operator: semverLessThan", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverLessThan",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "0.9.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "1.1.0" })).toEqual(false);
    });

    it("should match with operator: semverLessThanOrEquals", function () {
      const conditions: Condition[] = [
        {
          attribute: "version",
          operator: "semverLessThanOrEquals",
          value: "1.0.0",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { version: "1.0.0" })).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { version: "1.1.0" })).toEqual(false);
    });

    it("should match with operator: before", function () {
      const conditions: Condition[] = [
        {
          attribute: "date",
          operator: "before",
          value: "2023-05-13T16:23:59Z",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { date: "2023-05-12T00:00:00Z" })).toEqual(true);
      expect(
        allConditionsAreMatched(conditions, {
          date: new Date("2023-05-12T00:00:00Z"),
        }),
      ).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { date: "2023-05-14T00:00:00Z" })).toEqual(false);
      expect(
        allConditionsAreMatched(conditions, {
          date: new Date("2023-05-14T00:00:00Z"),
        }),
      ).toEqual(false);
    });

    it("should match with operator: after", function () {
      const conditions: Condition[] = [
        {
          attribute: "date",
          operator: "after",
          value: "2023-05-13T16:23:59Z",
        },
      ];

      // match
      expect(allConditionsAreMatched(conditions, { date: "2023-05-14T00:00:00Z" })).toEqual(true);
      expect(
        allConditionsAreMatched(conditions, {
          date: new Date("2023-05-14T00:00:00Z"),
        }),
      ).toEqual(true);

      // not match
      expect(allConditionsAreMatched(conditions, { date: "2023-05-12T00:00:00Z" })).toEqual(false);
      expect(
        allConditionsAreMatched(conditions, {
          date: new Date("2023-05-12T00:00:00Z"),
        }),
      ).toEqual(false);
    });
  });

  describe("simple condition", function () {
    it("should match with exact single condition", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions[0], {
          browser_type: "chrome",
        }),
      ).toEqual(true);
    });

    it("should match with exact condition", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(true);
    });

    it("should not match with empty conditions", function () {
      const conditions: Condition[] = [];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
        }),
      ).toEqual(true);
    });

    it("should match with extra conditions that are not needed", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "1.0",
        }),
      ).toEqual(true);
    });

    it("should match with multiple conditions", function () {
      const conditions: Condition[] = [
        {
          attribute: "browser_type",
          operator: "equals",
          value: "chrome",
        },
        {
          attribute: "browser_version",
          operator: "equals",
          value: "1.0",
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "1.0",
          foo: "bar",
        }),
      ).toEqual(true);
    });
  });

  describe("AND condition", function () {
    it("should match with one AND condition", function () {
      const conditions: Condition[] = [
        {
          and: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
        }),
      ).toEqual(false);
    });

    it("should match with multiple conditions inside AND", function () {
      const conditions: Condition[] = [
        {
          and: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              attribute: "browser_version",
              operator: "equals",
              value: "1.0",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "1.0",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(false);
    });
  });

  describe("OR condition", function () {
    it("should match with one OR condition", function () {
      const conditions: Condition[] = [
        {
          or: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(true);
    });

    it("should match with multiple conditions inside OR", function () {
      const conditions: Condition[] = [
        {
          or: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              attribute: "browser_version",
              operator: "equals",
              value: "1.0",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_version: "1.0",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
        }),
      ).toEqual(false);
    });
  });

  describe("NOT condition", function () {
    it("should match with one NOT condition", function () {
      const conditions: Condition[] = [
        {
          not: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(false);
    });

    it("should match with multiple conditions inside NOT", function () {
      const conditions: Condition[] = [
        {
          not: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              attribute: "browser_version",
              operator: "equals",
              value: "1.0",
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
          browser_version: "2.0",
        }),
      ).toEqual(true);
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(true);
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "2.0",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "1.0",
        }),
      ).toEqual(false);
    });

    it("should support NOT around OR for none-match checks", function () {
      const conditions: Condition[] = [
        {
          not: [
            {
              or: [
                {
                  attribute: "browser_type",
                  operator: "equals",
                  value: "chrome",
                },
                {
                  attribute: "browser_type",
                  operator: "equals",
                  value: "firefox",
                },
              ],
            },
          ],
        },
      ];

      // match because the OR group does not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "safari",
        }),
      ).toEqual(true);

      // not match because the OR group matches
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
        }),
      ).toEqual(false);
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
        }),
      ).toEqual(false);
    });

    it("should defensively reject empty NOT conditions", function () {
      expect(allConditionsAreMatched({ not: [] }, {})).toEqual(false);
    });
  });

  describe("nested conditions", function () {
    it("should match with OR inside AND", function () {
      const conditions: Condition[] = [
        {
          and: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              or: [
                {
                  attribute: "browser_version",
                  operator: "equals",
                  value: "1.0",
                },
                {
                  attribute: "browser_version",
                  operator: "equals",
                  value: "2.0",
                },
              ],
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "1.0",
        }),
      ).toEqual(true);

      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "2.0",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "3.0",
        }),
      ).toEqual(false);

      expect(
        allConditionsAreMatched(conditions, {
          browser_version: "2.0",
        }),
      ).toEqual(false);
    });

    it("should match with plain conditions, followed by OR inside AND", function () {
      const conditions: Condition[] = [
        {
          attribute: "country",
          operator: "equals",
          value: "nl",
        },
        {
          and: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              or: [
                {
                  attribute: "browser_version",
                  operator: "equals",
                  value: "1.0",
                },
                {
                  attribute: "browser_version",
                  operator: "equals",
                  value: "2.0",
                },
              ],
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          country: "nl",
          browser_type: "chrome",
          browser_version: "1.0",
        }),
      ).toEqual(true);

      expect(
        allConditionsAreMatched(conditions, {
          country: "nl",
          browser_type: "chrome",
          browser_version: "2.0",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "3.0",
        }),
      ).toEqual(false);

      expect(
        allConditionsAreMatched(conditions, {
          country: "us",
          browser_version: "2.0",
        }),
      ).toEqual(false);
    });

    it("should match with AND inside OR", function () {
      const conditions: Condition[] = [
        {
          or: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              and: [
                {
                  attribute: "device_type",
                  operator: "equals",
                  value: "mobile",
                },
                {
                  attribute: "orientation",
                  operator: "equals",
                  value: "portrait",
                },
              ],
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "chrome",
          browser_version: "2.0",
        }),
      ).toEqual(true);

      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
          device_type: "mobile",
          orientation: "portrait",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
          browser_version: "2.0",
        }),
      ).toEqual(false);

      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
          device_type: "desktop",
        }),
      ).toEqual(false);
    });

    it("should match with plain conditions, followed by AND inside OR", function () {
      const conditions: Condition[] = [
        {
          attribute: "country",
          operator: "equals",
          value: "nl",
        },
        {
          or: [
            {
              attribute: "browser_type",
              operator: "equals",
              value: "chrome",
            },
            {
              and: [
                {
                  attribute: "device_type",
                  operator: "equals",
                  value: "mobile",
                },
                {
                  attribute: "orientation",
                  operator: "equals",
                  value: "portrait",
                },
              ],
            },
          ],
        },
      ];

      // match
      expect(
        allConditionsAreMatched(conditions, {
          country: "nl",
          browser_type: "chrome",
          browser_version: "2.0",
        }),
      ).toEqual(true);

      expect(
        allConditionsAreMatched(conditions, {
          country: "nl",
          browser_type: "firefox",
          device_type: "mobile",
          orientation: "portrait",
        }),
      ).toEqual(true);

      // not match
      expect(
        allConditionsAreMatched(conditions, {
          browser_type: "firefox",
          browser_version: "2.0",
        }),
      ).toEqual(false);

      expect(
        allConditionsAreMatched(conditions, {
          country: "de",
          browser_type: "firefox",
          device_type: "desktop",
        }),
      ).toEqual(false);
    });
  });

  describe("helpers", function () {
    it("should parse stringified conditions", function () {
      const conditions = '[{"attribute":"country","operator":"equals","value":"nl"}]' as Condition;

      expect(parseConditionsIfStringified(conditions)).toEqual([
        {
          attribute: "country",
          operator: "equals",
          value: "nl",
        },
      ]);
      expect(parseConditionsIfStringified("*")).toEqual("*");
      expect(
        parseConditionsIfStringified([{ attribute: "country", operator: "equals", value: "nl" }]),
      ).toEqual([{ attribute: "country", operator: "equals", value: "nl" }]);
    });

    it("should report invalid stringified conditions", function () {
      const reportDiagnostic = jest.fn();

      expect(parseConditionsIfStringified("{", reportDiagnostic)).toEqual("{");
      expect(reportDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          code: "conditions_parse_error",
          message: "Error parsing conditions",
          details: { conditions: "{" },
        }),
      );
    });

    it("should parse stringified segments", function () {
      expect(parseSegmentsIfStringified('{"and":["netherlands"]}')).toEqual({
        and: ["netherlands"],
      });
      expect(parseSegmentsIfStringified('["netherlands"]')).toEqual(["netherlands"]);
      expect(parseSegmentsIfStringified("netherlands")).toEqual("netherlands");
    });

    it("should report condition match errors", function () {
      const reportDiagnostic = jest.fn();

      expect(
        allConditionsAreMatched(
          {
            attribute: "name",
            operator: "matches",
            value: "[",
          },
          { name: "Featurevisor" },
          undefined,
          reportDiagnostic,
        ),
      ).toEqual(false);
      expect(reportDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          code: "condition_match_error",
        }),
      );
    });

    it("should match segments with supplied segment getter", function () {
      const getSegment = jest.fn((segmentKey: string) => {
        if (segmentKey === "netherlands") {
          return {
            key: "netherlands",
            conditions: '[{"attribute":"country","operator":"equals","value":"nl"}]',
          };
        }

        return undefined;
      });

      expect(allSegmentsAreMatched("netherlands", { country: "nl" }, getSegment)).toEqual(true);
      expect(allSegmentsAreMatched("netherlands", { country: "de" }, getSegment)).toEqual(false);
      expect(allSegmentsAreMatched("unknown", { country: "nl" }, getSegment)).toEqual(false);
      expect(allSegmentsAreMatched({ not: [] }, {}, getSegment)).toEqual(false);
      expect(allSegmentsAreMatched(["netherlands"], { country: "nl" }, getSegment)).toEqual(true);
    });
  });
});
