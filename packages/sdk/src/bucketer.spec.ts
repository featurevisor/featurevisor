import { getBucketedNumber, MAX_BUCKETED_NUMBER, getBucketKey } from "./bucketer";
import { createLogger } from "./logger";

describe("sdk: Bucket", function () {
  describe("getBucketedNumber", function () {
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

  describe("getBucketKey", function () {
    const logger = createLogger({
      levels: ["error", "warn"],
    });

    it("should be a function", function () {
      expect(typeof getBucketKey).toEqual("function");
    });

    it("plain: should return a bucket key for a plain bucketBy", function () {
      const featureKey = "test-feature";
      const bucketBy = "userId";
      const context = { userId: "123", browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("123.test-feature");
    });

    it("plain: should return a bucket key with feature key only if value is missing in context", function () {
      const featureKey = "test-feature";
      const bucketBy = "userId";
      const context = { browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("test-feature");
    });

    it("and: should combine multiple field values together if present", function () {
      const featureKey = "test-feature";
      const bucketBy = ["organizationId", "userId"];
      const context = { organizationId: "123", userId: "234", browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("123.234.test-feature");
    });

    it("and: should combine only available field values together if present", function () {
      const featureKey = "test-feature";
      const bucketBy = ["organizationId", "userId"];
      const context = { organizationId: "123", browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("123.test-feature");
    });

    it("and: should combine all available fields, with dot separated paths", function () {
      const featureKey = "test-feature";
      const bucketBy = ["organizationId", "user.id"];
      const context = {
        organizationId: "123",
        user: {
          id: "234",
        },
        browser: "chrome",
      };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("123.234.test-feature");
    });

    it("or: should take first available field value", function () {
      const featureKey = "test-feature";
      const bucketBy = {
        or: ["userId", "deviceId"],
      };
      const context = { deviceId: "deviceIdHere", userId: "234", browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("234.test-feature");
    });

    it("or: should take first available field value", function () {
      const featureKey = "test-feature";
      const bucketBy = {
        or: ["userId", "deviceId"],
      };
      const context = { deviceId: "deviceIdHere", browser: "chrome" };

      const bucketKey = getBucketKey({
        featureKey,
        bucketBy,
        context,
        logger,
      });

      expect(bucketKey).toEqual("deviceIdHere.test-feature");
    });
  });
});
