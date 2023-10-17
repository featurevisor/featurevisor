import * as crypto from "crypto";

import { SegmentKey } from "@featurevisor/types";

import { Datasource } from "../datasource";

export async function findDuplicateSegments(datasource: Datasource): Promise<SegmentKey[][]> {
  const segments = await datasource.listSegments();

  const segmentsWithHash: { segmentKey: SegmentKey; hash: string }[] = [];
  for (const segmentKey of segments) {
    const segment = await datasource.readSegment(segmentKey);
    const conditions = JSON.stringify(segment.conditions);
    const hash = crypto.createHash("sha256").update(conditions).digest("hex");

    segmentsWithHash.push({
      segmentKey,
      hash,
    });
  }

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
