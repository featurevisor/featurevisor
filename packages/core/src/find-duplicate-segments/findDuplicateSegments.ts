import * as crypto from "crypto";

import { SegmentKey } from "@featurevisor/types";

import { Datasource } from "../datasource";

export function findDuplicateSegments(datasource: Datasource): SegmentKey[][] {
  const segmentsWithHash = datasource.listSegments().map((segmentKey) => {
    const segment = datasource.readSegment(segmentKey);
    const conditions = JSON.stringify(segment.conditions);
    const hash = crypto.createHash("sha256").update(conditions).digest("hex");

    return {
      segmentKey,
      hash,
    };
  });

  const groupedSegments: { [hash: string]: SegmentKey[] } = segmentsWithHash.reduce(
    (acc, { segmentKey, hash }) => {
      if (!acc[hash]) {
        acc[hash] = [];
      }
      acc[hash].push(segmentKey);
      return acc;
    },
    {},
  );

  const result = Object.values(groupedSegments).filter((segmentKeys) => segmentKeys.length > 1);

  return result;
}
