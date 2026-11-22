import type { PathKey } from "./types.js";

/**
 * One step of a field path: an object key, an array index, every item of an
 * array (`[]`), or every value of an object that allows any key (`*`).
 */
export type PathStep =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "items" }
  | { kind: "values" };

const INDEX = /^(0|[1-9][0-9]*)$/;

/**
 * Reads a field path as form libraries write it: `address.city`, `items.0.name`,
 * `items[0].name`, `items[].name` or `labels.*`. A number after a dot or in
 * brackets is an index, so `items.0` and `items[0]` are the same.
 */
export function parsePath(path: string): PathStep[] {
  const steps: PathStep[] = [];
  if (path === "") return steps;
  let index = 0;
  let key = "";
  const flushKey = () => {
    if (key === "") return;
    if (key === "*") steps.push({ kind: "values" });
    else if (INDEX.test(key)) steps.push({ kind: "index", index: Number(key) });
    else steps.push({ kind: "key", key });
    key = "";
  };
  while (index < path.length) {
    const char = path[index];
    if (char === ".") {
      flushKey();
      index++;
    } else if (char === "[") {
      flushKey();
      const end = path.indexOf("]", index);
      const inside = end === -1 ? path.slice(index + 1) : path.slice(index + 1, end);
      if (inside === "") steps.push({ kind: "items" });
      else if (inside === "*") steps.push({ kind: "values" });
      else if (INDEX.test(inside)) steps.push({ kind: "index", index: Number(inside) });
      else steps.push({ kind: "key", key: inside.replace(/^["']|["']$/g, "") });
      index = end === -1 ? path.length : end + 1;
    } else {
      key += char;
      index++;
    }
  }
  flushKey();
  return steps;
}

/** A path as a field name with dots, such as `items.0.name`, the names forms give their inputs. */
export function formatPath(path: ReadonlyArray<PathKey>): string {
  return path.map(String).join(".");
}

/** Whether `inner` is `outer` or a path inside it. */
export function isAtOrInside(
  inner: ReadonlyArray<PathKey>,
  outer: ReadonlyArray<PathKey>,
): boolean {
  if (inner.length < outer.length) return false;
  for (let index = 0; index < outer.length; index++) {
    if (String(inner[index]) !== String(outer[index])) return false;
  }
  return true;
}

/** Whether a concrete path matches a path with `[]` and `*` steps, at or inside it. */
export function matchesSteps(path: ReadonlyArray<PathKey>, steps: PathStep[]): boolean {
  if (path.length < steps.length) return false;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const part = path[index];
    if (step.kind === "items" || step.kind === "values") continue;
    if (step.kind === "index" && String(part) !== String(step.index)) return false;
    if (step.kind === "key" && String(part) !== step.key) return false;
  }
  return true;
}
