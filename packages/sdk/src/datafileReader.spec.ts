import { DatafileContent } from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";

describe("sdk: DatafileReader", function () {
  it("should be a function", function () {
    expect(typeof DatafileReader).toEqual("function");
  });

  it("should return requested entities", function () {
    const datafileJson: DatafileContent = {
      schemaVersion: "1",
      revision: "1",
      attributes: [
        {
          key: "userId",
          type: "string",
          capture: true,
        },
        {
          key: "country",
          type: "string",
        },
      ],
      segments: [
        {
          key: "netherlands",
          conditions: [
            {
              attribute: "country",
              operator: "equals",
              value: "nl",
            },
          ],
        },
        {
          key: "germany",
          conditions: JSON.stringify([
            {
              attribute: "country",
              operator: "equals",
              value: "de",
            },
          ]),
        },
      ],
      features: [
        {
          key: "test",
          bucketBy: "userId",
          variations: [
            { value: "control" },
            {
              value: "treatment",
              variables: [
                {
                  key: "showSidebar",
                  value: true,
                },
              ],
            },
          ],
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [
                { variation: "control", range: [0, 0] },
                { variation: "treatment", range: [0, 100000] },
              ],
            },
          ],
        },
      ],
    };

    const reader = new DatafileReader(datafileJson);

    expect(reader.getRevision()).toEqual("1");
    expect(reader.getSchemaVersion()).toEqual("1");
    expect(reader.getAllAttributes()).toEqual(datafileJson.attributes);
    expect(reader.getAttribute("userId")).toEqual(datafileJson.attributes[0]);
    expect(reader.getSegment("netherlands")).toEqual(datafileJson.segments[0]);
    expect((reader.getSegment("germany") as any).conditions[0].value).toEqual("de");
    expect(reader.getSegment("belgium")).toEqual(undefined);
    expect(reader.getFeature("test")).toEqual(datafileJson.features[0]);
    expect(reader.getFeature("test2")).toEqual(undefined);
  });
});
