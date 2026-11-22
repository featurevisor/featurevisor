import type { FeatureKey, SegmentKey, VariableKey } from "@featurevisor/types";

/**
 * What the evaluations inside one `track` call read. An answer can change only
 * if something it read changes, so a value built on the SDK asks again only
 * when a change touches these.
 */
export interface EvaluationReads {
  /**
   * Context paths read by conditions and bucketing, as written, such as
   * `country` or `account.plan`. `"*"` means any attribute, recorded when a
   * module's `beforeEvaluation`, `bucketKey` or `bucketValue` ran, since what a
   * module reads from the context cannot be seen.
   */
  attributes: string[];
  segments: SegmentKey[];
  /** Features evaluated, the requested ones and their dependencies alike. */
  features: FeatureKey[];
  /** Global variables evaluated, the requested ones and their dependencies alike. */
  variables: VariableKey[];
}

export interface TrackResult<T> {
  result: T;
  reads: EvaluationReads;
}

/** The reads of the innermost active `track`. Null whenever nothing tracks, which is almost always. */
let current: EvaluationReads | null = null;

export const ANY_ATTRIBUTE = "*";

export function recordAttribute(path: string): void {
  if (current !== null) current.attributes.push(path);
}

export function recordSegment(segmentKey: SegmentKey): void {
  if (current !== null) current.segments.push(segmentKey);
}

export function recordFeature(featureKey: FeatureKey): void {
  if (current !== null) current.features.push(featureKey);
}

export function recordVariable(variableKey: VariableKey): void {
  if (current !== null) current.variables.push(variableKey);
}

/** Removes repeated values in place. Short lists, the usual case, need no set. */
function dedupe(values: string[]): void {
  const length = values.length;
  if (length < 2) return;

  if (length > 16) {
    const unique = Array.from(new Set(values));
    values.length = 0;
    for (const value of unique) values.push(value);
    return;
  }

  let kept = 0;
  outer: for (let index = 0; index < length; index++) {
    const value = values[index];
    for (let previous = 0; previous < kept; previous++) {
      if (values[previous] === value) continue outer;
    }
    values[kept++] = value;
  }
  values.length = kept;
}

function append(target: string[], source: string[]): void {
  for (let index = 0; index < source.length; index++) target.push(source[index]);
}

/**
 * Runs `callback` and returns its result with everything the evaluations inside
 * it read. Reads are appended as they happen and made unique once at the end. A
 * `track` inside another records into both, so an outer one never misses what an
 * inner one saw, even when the inner callback throws.
 */
export function track<T>(callback: () => T): TrackResult<T> {
  const reads: EvaluationReads = { attributes: [], segments: [], features: [], variables: [] };
  const parent = current;
  current = reads;

  let result: T;
  try {
    result = callback();
  } finally {
    current = parent;
    if (parent !== null) {
      append(parent.attributes, reads.attributes);
      append(parent.segments, reads.segments);
      append(parent.features, reads.features);
      append(parent.variables, reads.variables);
    }
  }

  dedupe(reads.attributes);
  dedupe(reads.segments);
  dedupe(reads.features);
  dedupe(reads.variables);

  return { result, reads };
}
