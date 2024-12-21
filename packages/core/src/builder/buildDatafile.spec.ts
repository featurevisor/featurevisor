import { DatafileContent } from "@featurevisor/types";
import { buildScopedDatafile } from "./buildDatafile";

describe("core: buildDatafile", function () {
  test("buildScopedDatafile is a function", function () {
    expect(buildScopedDatafile).toBeInstanceOf(Function);
  });

  test("buildScopedDatafile: simple context", function () {
    // taken from examples/example-yml-scope/dist/datafile-tag-web.json
    const originalDatafileContent: DatafileContent = {
      schemaVersion: "1",
      revision: "5",
      attributes: [
        {
          key: "deviceId",
          type: "string",
          capture: true,
        },
        {
          key: "platform",
          type: "string",
        },
        {
          key: "userId",
          type: "string",
          capture: true,
        },
      ],
      segments: [
        {
          key: "android",
          conditions: '[{"attribute":"platform","operator":"equals","value":"android"}]',
        },
        {
          key: "ios",
          conditions: '[{"attribute":"platform","operator":"equals","value":"ios"}]',
        },
        {
          key: "web",
          conditions: '[{"attribute":"platform","operator":"equals","value":"web"}]',
        },
      ],
      features: [
        {
          key: "showBanner",
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "web",
              percentage: 100000,
              allocation: [],
            },
            {
              key: "ios",
              segments: "ios",
              percentage: 50000,
              allocation: [],
            },
            {
              key: "android",
              segments: "android",
              percentage: 25000,
              allocation: [],
            },
          ],
        },
      ],
    };

    const scopedDatafileContent = buildScopedDatafile(originalDatafileContent, { platform: "web" });

    expect(scopedDatafileContent).toEqual({
      schemaVersion: "1",
      revision: "5",
      attributes: [
        {
          key: "deviceId",
          type: "string",
          capture: true,
        },
        {
          key: "userId",
          type: "string",
          capture: true,
        },
      ],
      segments: [],
      features: [
        {
          key: "showBanner",
          bucketBy: "userId",
          traffic: [
            {
              key: "web",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
        },
      ],
    });
  });
});
