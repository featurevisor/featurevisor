import type { GroupSegment, DatafileContent } from "@featurevisor/types";

import {
  buildScopedSegments,
  removeRedundantGroupSegments,
  buildScopedGroupSegments,
} from "./buildScopedSegments";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

describe("core: buildScopedSegments", function () {
  const emptyDatafile: DatafileContent = {
    schemaVersion: "2",
    revision: "unknown",
    segments: {},
    features: {},
  };

  const datafileReader = new DatafileReader({
    datafile: emptyDatafile,
    logger: createLogger({ level: "fatal" }),
  });

  describe("buildScopedSegments", function () {
    test("buildScopedSegments is a function", function () {
      expect(buildScopedSegments).toBeInstanceOf(Function);
    });
  });

  describe("removeRedundantGroupSegments", function () {
    test("removeRedundantGroupSegments is a function", function () {
      expect(removeRedundantGroupSegments).toBeInstanceOf(Function);
    });
  });

  describe("buildScopedGroupSegments", function () {
    test("buildScopedGroupSegments is a function", function () {
      expect(buildScopedGroupSegments).toBeInstanceOf(Function);
    });
  });
});
