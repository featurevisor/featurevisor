import type { Condition } from "./condition";

export type SegmentKey = string;

export interface Segment {
  archived?: boolean; // only available in YAML files
  key?: SegmentKey; // needed for supporting v1 datafile generation
  conditions: Condition | Condition[]; // string only when stringified for datafile
  description?: string; // only available in YAML files
}

export type PlainGroupSegment = SegmentKey;

export interface AndGroupSegment {
  and: GroupSegment[];
}

export interface OrGroupSegment {
  or: GroupSegment[];
}

export interface NotGroupSegment {
  not: GroupSegment[];
}

export type AndOrNotGroupSegment = AndGroupSegment | OrGroupSegment | NotGroupSegment;

// group of segment keys with and/or conditions, or just string
export type GroupSegment = PlainGroupSegment | AndOrNotGroupSegment;
