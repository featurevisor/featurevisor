import { getBucketedNumber, MAX_BUCKETED_NUMBER } from "./bucket";

describe("sdk: Bucket", function () {
  it("should be a function", function () {
    expect(typeof getBucketedNumber).toEqual("function");
  });

  it("should return a number between 0 and 100000", function () {
    const keys = ["foo", "bar", "baz", "123adshlk348-93asdlk"];

    keys.forEach((key) => {
      const n = getBucketedNumber(key);

      expect(n >= 0).toEqual(true);
      expect(n <= MAX_BUCKETED_NUMBER).toEqual(true);
    });
  });

  // these assertions will be copied to unit tests of SDKs ported to other languages,
  // so we can keep consitent bucketing across all SDKs
  it("should return expected number for known keys", function () {
    const expectedResults = {
      foo: 20602,
      bar: 89144,
      "123.foo": 3151,
      "123.bar": 9710,
      "123.456.foo": 14432,
      "123.456.bar": 1982,
    };

    Object.keys(expectedResults).forEach((key) => {
      const n = getBucketedNumber(key);

      expect(n).toEqual(expectedResults[key]);
    });
  });
});
