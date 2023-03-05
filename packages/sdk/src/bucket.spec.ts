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
});
