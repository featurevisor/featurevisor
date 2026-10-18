import type { Conditions } from "./condition";

export type SegmentKey = string;

export interface Segment {
  archived?: boolean; // only available in YAML files
  promotable?: boolean; // only available in YAML files
  key?: SegmentKey;
  conditions: Conditions;
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
