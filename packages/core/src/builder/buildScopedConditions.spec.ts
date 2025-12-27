import type { Condition } from "@featurevisor/types";

import { buildScopedConditions } from "./buildScopedConditions";

describe("core: buildScopedConditions", function () {
  test("buildScopedConditions is a function", function () {
    expect(buildScopedConditions).toBeInstanceOf(Function);
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
      buildScopedConditions(originalConditions, {
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

    // context: { platform: "web" }
    expect(
      buildScopedConditions(originalConditions, {
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

    // context: { platform: "web", browser: "chrome" }
    expect(
      buildScopedConditions(originalConditions, {
        platform: "web",
        browser: "chrome",
      }),
    ).toEqual(["*", "*"]);
  });
});
