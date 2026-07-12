import * as sdk from "./index";

describe("sdk: public runtime exports", function () {
  it("should keep the root runtime surface intentionally small", function () {
    expect(Object.keys(sdk).sort()).toEqual([
      "MAX_BUCKETED_NUMBER",
      "allConditionsAreMatched",
      "allSegmentsAreMatched",
      "createFeaturevisor",
    ]);
  });

  it("should not expose internal runtime helpers from the root", function () {
    expect("DatafileReader" in sdk).toEqual(false);
    expect("parseConditionsIfStringified" in sdk).toEqual(false);
    expect("parseSegmentsIfStringified" in sdk).toEqual(false);
  });
});
