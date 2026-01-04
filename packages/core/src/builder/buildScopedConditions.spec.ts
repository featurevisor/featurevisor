import type { Condition, DatafileContent } from "@featurevisor/types";

import { buildScopedCondition } from "./buildScopedConditions";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

describe("core: buildScopedCondition (singular)", function () {
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
