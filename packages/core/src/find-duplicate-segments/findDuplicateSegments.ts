import * as crypto from "crypto";

import type { HistoryEntry, SegmentKey } from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import { compileConditions } from "../datasource/conditions";

function normalizeConditions(value: unknown): unknown {
  if (Array.isArray(value)) {
    const children = value.map(normalizeConditions);
    return children.length === 1 ? children[0] : { and: children };
  }
  if (!value || typeof value !== "object") return value;
  if ("and" in value) return normalizeConditions(value.and);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        (key === "or" || key === "not") && Array.isArray(entry)
          ? entry.map(normalizeConditions)
          : entry,
      ]),
  );
}

export interface DuplicateSegmentsOptions {
  authors?: boolean;
}

export interface DuplicateSegmentsResult {
  segments: SegmentKey[];
  authors?: string[];
}

export async function findDuplicateSegments(
  deps: Dependencies,
  options: DuplicateSegmentsOptions = {},
): Promise<DuplicateSegmentsResult[]> {
  const { datasource } = deps;

  const segments = await datasource.listSegments();

  const segmentsWithHash: { segmentKey: SegmentKey; hash: string }[] = [];
  for (const segmentKey of segments) {
    const segment = await datasource.readSegment(segmentKey);
    const conditions = JSON.stringify(normalizeConditions(compileConditions(segment.conditions)));
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

  const duplicateSegments = Object.values(groupedSegments).filter(
    (segmentKeys) => segmentKeys.length > 1,
  );
  const result: DuplicateSegmentsResult[] = [];

  for (const segmentKeys of duplicateSegments) {
    const entry: DuplicateSegmentsResult = {
      segments: segmentKeys,
    };

    if (options.authors) {
      const historyEntries: HistoryEntry[] = [];

      for (const segmentKey of segmentKeys) {
        const entries = await datasource.listHistoryEntries("segment", segmentKey);

        entries.forEach((entry) => {
          historyEntries.push(entry);
        });
      }

      const authors = Array.from(new Set(historyEntries.map((entry) => entry.author)));
      entry.authors = authors;
    }

    result.push(entry);
  }

  return result;
}
