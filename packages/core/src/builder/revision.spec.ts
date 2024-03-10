import { getNextRevision } from "./revision";

describe("core: Revision", function () {
  it("should be a function", function () {
    expect(typeof getNextRevision).toEqual("function");
  });

  it("should return next version number", function () {
    // string-string
    expect(getNextRevision("")).toEqual("1");
    expect(getNextRevision("random text")).toEqual("1");

    // string-numeric
    expect(getNextRevision("1")).toEqual("2");
    expect(getNextRevision("2024")).toEqual("2025");

    // string-semver
    expect(getNextRevision("1.0.0")).toEqual("1");
    expect(getNextRevision("0.0.0")).toEqual("1");
    expect(getNextRevision("0.0.1523")).toEqual("1524");
  });
});
