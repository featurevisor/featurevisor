import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./index";

describe("sdk: private evaluation plumbing", function () {
  const datafile: DatafileContent = {
    schemaVersion: "2",
    revision: "regex-test",
    segments: {
      nameStartsWithF: {
        key: "nameStartsWithF",
        conditions: [
          {
            attribute: "name",
            operator: "matches",
            value: "^F",
          },
        ],
      },
    },
    features: {
      forcedByRegex: {
        key: "forcedByRegex",
        bucketBy: "userId",
        force: [
          {
            conditions: [
              {
                attribute: "name",
                operator: "matches",
                value: "^F",
              },
            ],
            enabled: true,
          },
        ],
        traffic: [],
      },
      segmentedByRegex: {
        key: "segmentedByRegex",
        bucketBy: "userId",
        traffic: [
          {
            key: "1",
            segments: ["nameStartsWithF"],
            percentage: 100000,
          },
        ],
      },
    },
  };

  it("should evaluate regex conditions through private condition and segment wrappers", function () {
    const sdk = createFeaturevisor({ datafile, logLevel: "fatal" });
    const context = { userId: "user-1", name: "Featurevisor" };

    expect(sdk.isEnabled("forcedByRegex", context)).toEqual(true);
    expect(sdk.isEnabled("forcedByRegex", context)).toEqual(true);
    expect(sdk.isEnabled("segmentedByRegex", context)).toEqual(true);
    expect(sdk.isEnabled("segmentedByRegex", context)).toEqual(true);
  });
});
