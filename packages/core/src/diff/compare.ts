import { isDeepStrictEqual } from "node:util";

export interface ValueChange {
  /** JSON Pointer; an empty string identifies the entire entity. */
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

/** Object ordering is irrelevant. Array ordering is significant, including rules and overrides. */
export function compareValues(before: unknown, after: unknown, pointer = ""): ValueChange[] {
  if (isDeepStrictEqual(before, after)) return [];
  const beforeObject = before !== null && typeof before === "object";
  const afterObject = after !== null && typeof after === "object";
  if (
    beforeObject &&
    afterObject &&
    Array.isArray(before) === Array.isArray(after) &&
    !(before instanceof Date) &&
    !(after instanceof Date)
  ) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    keys.sort(Array.isArray(before) ? (a, b) => Number(a) - Number(b) : undefined);
    return keys.flatMap((key) => {
      const next = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (!hasBefore) return [{ path: next, kind: "added" as const, after: after[key] }];
      if (!hasAfter) return [{ path: next, kind: "removed" as const, before: before[key] }];
      return compareValues(before[key], after[key], next);
    });
  }
  return [{ path: pointer, kind: "changed", before, after }];
}
