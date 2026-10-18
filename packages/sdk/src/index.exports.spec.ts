import * as sdk from "./index";

describe("sdk: public runtime exports", function () {
  it("should keep the root runtime surface intentionally small", function () {
    expect(Object.keys(sdk).sort()).toEqual([
      "MAX_BUCKETED_NUMBER",
      "allConditionsAreMatched",
      "applyVariableOperations",
      "createFeaturevisor",
      "getPortableTimestamp",
      "getRequiredVariableValueAtPath",
      "isValidVersion",
    ]);
  });

  it("should not expose internal runtime helpers from the root", function () {
    expect("DatafileReader" in sdk).toEqual(false);
    expect("parseConditionsIfStringified" in sdk).toEqual(false);
    expect("parseSegmentsIfStringified" in sdk).toEqual(false);
  });

  it("validates versions with the same grammar the version operators use", function () {
    expect(["5.5.0", "5.5", "v5.5.0", "1.x", "1.2.3-beta.1+build"].map(sdk.isValidVersion)).toEqual(
      [true, true, true, true, true],
    );
    expect(["5.5,0", "abc", "", " 1.0.0", 5.5].map(sdk.isValidVersion)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
