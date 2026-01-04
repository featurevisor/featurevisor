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

    test("remove redundant conditions", function () {
      /**
       * Simple
       */
      // * is *
      expect(removeRedundantConditions("*")).toEqual("*");

      // [*, *, *], is "*"
      expect(removeRedundantConditions(["*", "*", "*"])).toEqual("*");

      /**
       * AND
       */
      expect(removeRedundantConditions({ and: ["*", "*", "*"] })).toEqual("*");

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

      /**
       * OR
       */
      expect(removeRedundantConditions({ or: ["*", "*", "*"] })).toEqual("*");

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

      /**
       * NOT
       */
      expect(removeRedundantConditions({ not: ["*", "*", "*"] })).toEqual("*");

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
  });
});
