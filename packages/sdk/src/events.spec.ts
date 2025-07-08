import { DatafileReader } from "./datafileReader";
import { createLogger } from "./logger";

import { getParamsForDatafileSetEvent, getParamsForStickySetEvent } from "./events";

describe("sdk: events", function () {
  describe("getParamsForStickySetEvent", function () {
    it("should get params for sticky set event: empty to new", function () {
      const previousStickyFeatures = {};
      const newStickyFeatures = {
        feature2: { enabled: true },
        feature3: { enabled: true },
      };
      const replace = true;

      const result = getParamsForStickySetEvent(previousStickyFeatures, newStickyFeatures, replace);

      expect(result).toEqual({
        features: ["feature2", "feature3"],
        replaced: replace,
      });
    });

    it("should get params for sticky set event: add, change, remove", function () {
      const previousStickyFeatures = {
        feature1: { enabled: true },
        feature2: { enabled: true },
      };
      const newStickyFeatures = {
        feature2: { enabled: true },
        feature3: { enabled: true },
      };
      const replace = true;

      const result = getParamsForStickySetEvent(previousStickyFeatures, newStickyFeatures, replace);

      expect(result).toEqual({
        features: ["feature1", "feature2", "feature3"],
        replaced: replace,
      });
    });
  });

  describe("getParamsForDatafileSetEvent", function () {
    const logger = createLogger({
      levels: [],
    });

    it("should get params for datafile set event: empty to new", function () {
      const previousDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "1",
          features: {},
          segments: {},
        },
        logger,
      });
      const newDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "2",
          features: {
            feature1: { bucketBy: "userId", hash: "hash1", traffic: [] },
            feature2: { bucketBy: "userId", hash: "hash2", traffic: [] },
          },
          segments: {},
        },
        logger,
      });

      const result = getParamsForDatafileSetEvent(previousDatafileReader, newDatafileReader);

      expect(result).toEqual({
        revision: "2",
        previousRevision: "1",
        revisionChanged: true,
        features: ["feature1", "feature2"],
      });
    });

    it("should get params for datafile set event: change hash, addition", function () {
      const previousDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "1",
          features: {
            feature1: { bucketBy: "userId", hash: "hash-same", traffic: [] },
            feature2: { bucketBy: "userId", hash: "hash1-2", traffic: [] },
          },
          segments: {},
        },
        logger,
      });
      const newDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "2",
          features: {
            feature1: { bucketBy: "userId", hash: "hash-same", traffic: [] },
            feature2: { bucketBy: "userId", hash: "hash2-2", traffic: [] },
            feature3: { bucketBy: "userId", hash: "hash2-3", traffic: [] },
          },
          segments: {},
        },
        logger,
      });

      const result = getParamsForDatafileSetEvent(previousDatafileReader, newDatafileReader);

      expect(result).toEqual({
        revision: "2",
        previousRevision: "1",
        revisionChanged: true,
        features: ["feature2", "feature3"],
      });
    });

    it("should get params for datafile set event: change hash, removal", function () {
      const previousDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "1",
          features: {
            feature1: { bucketBy: "userId", hash: "hash-same", traffic: [] },
            feature2: { bucketBy: "userId", hash: "hash1-2", traffic: [] },
          },
          segments: {},
        },
        logger,
      });
      const newDatafileReader = new DatafileReader({
        datafile: {
          schemaVersion: "1.0.0",
          revision: "2",
          features: {
            feature2: { bucketBy: "userId", hash: "hash2-2", traffic: [] },
          },
          segments: {},
        },
        logger,
      });

      const result = getParamsForDatafileSetEvent(previousDatafileReader, newDatafileReader);

      expect(result).toEqual({
        revision: "2",
        previousRevision: "1",
        revisionChanged: true,
        features: ["feature1", "feature2"],
      });
    });
  });
});
