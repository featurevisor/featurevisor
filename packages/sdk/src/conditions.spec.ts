import { allConditionsAreMatched } from "./conditions";
import { Condition } from "@featurevisor/types";

describe("sdk: Conditions", function () {
  it("should be a function", function () {
    expect(typeof allConditionsAreMatched).toEqual("function");
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
});
