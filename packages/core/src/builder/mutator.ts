import type { VariableSchema, VariableValue } from "@featurevisor/types";

export type PathPart =
  | { key: string }
  | { key: string; index: number }
  | { key: string; selector: { prop: string; value: string } };

export type MutationOperation = "set" | "append" | "prepend" | "after" | "before" | "remove";

export interface ParsedNotation {
  segments: PathPart[];
  operation: MutationOperation;
}

export function parseNotation(notation: string): ParsedNotation {
  let rest = notation.trim();
  const operationMatch = rest.match(/:((?:append|prepend|after|before|remove))$/);
  const operation: MutationOperation = operationMatch
    ? (operationMatch[1] as MutationOperation)
    : "set";
  if (operationMatch) {
    rest = rest.slice(0, -operationMatch[0].length);
  }

  const segments: PathPart[] = [];
  let i = 0;
  while (i < rest.length) {
    let key = "";
    while (i < rest.length && rest[i] !== "." && rest[i] !== "[") {
      key += rest[i];
      i++;
    }
    key = key.trim();
    if (key) {
      if (rest[i] === "[") {
        i++;
        const bracketStart = i;
        while (i < rest.length && rest[i] !== "]") i++;
        const bracketContent = rest.slice(bracketStart, i);
        i++;
        const eq = bracketContent.indexOf("=");
        if (eq >= 0) {
          const prop = bracketContent.slice(0, eq).trim();
          let val = bracketContent.slice(eq + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          segments.push({ key, selector: { prop, value: val } });
        } else {
          const index = parseInt(bracketContent.trim(), 10);
          segments.push({ key, index });
        }
      } else {
        segments.push({ key });
      }
    } else if (rest[i] === "[") {
      i++;
      const bracketStart = i;
      while (i < rest.length && rest[i] !== "]") i++;
      const bracketContent = rest.slice(bracketStart, i);
      i++;
      const eq = bracketContent.indexOf("=");
      if (eq >= 0) {
        const prop = bracketContent.slice(0, eq).trim();
        let val = bracketContent.slice(eq + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        segments.push({ key: "", selector: { prop, value: val } });
      } else {
        const index = parseInt(bracketContent.trim(), 10);
        segments.push({ key: "", index });
      }
    }
    if (rest[i] === ".") i++;
  }

  return { segments, operation };
}

function getAtSegment(obj: VariableValue, seg: PathPart): VariableValue {
  if (obj === null || obj === undefined) return undefined;
  const o = obj as Record<string, unknown>;
  if ("index" in seg) {
    const arr =
      seg.key === ""
        ? Array.isArray(obj)
          ? obj
          : undefined
        : Array.isArray(obj)
          ? obj
          : (o[seg.key] as unknown[]);
    if (!Array.isArray(arr)) return undefined;
    return arr[seg.index] as VariableValue;
  }
  if ("selector" in seg) {
    const arr =
      seg.key === ""
        ? Array.isArray(obj)
          ? obj
          : undefined
        : Array.isArray(obj)
          ? obj
          : (o[seg.key] as unknown[]);
    if (!Array.isArray(arr)) return undefined;
    const { prop, value } = seg.selector;
    const found = arr.find((item) => {
      if (item === null || typeof item !== "object") return false;
      const v = (item as Record<string, unknown>)[prop];
      return String(v) === value;
    });
    return found as VariableValue;
  }
  return o[seg.key] as VariableValue;
}

function setAtSegment(
  obj: Record<string, unknown> | unknown[],
  seg: PathPart,
  _value: VariableValue,
  op: MutationOperation,
  setValue: VariableValue | undefined,
): void {
  if ("index" in seg) {
    const i = seg.index;
    const arr =
      seg.key === ""
        ? Array.isArray(obj)
          ? obj
          : undefined
        : Array.isArray(obj)
          ? obj
          : ((obj as Record<string, unknown>)[seg.key] as unknown[]);
    if (!Array.isArray(arr)) return;
    if (op === "remove") {
      arr.splice(i, 1);
      return;
    }
    if (op === "set") {
      arr[i] = setValue;
      return;
    }
    return;
  }
  if ("selector" in seg) {
    const arr =
      seg.key === ""
        ? Array.isArray(obj)
          ? obj
          : undefined
        : Array.isArray(obj)
          ? obj
          : ((obj as Record<string, unknown>)[seg.key] as unknown[]);
    if (!Array.isArray(arr)) return;
    const { prop, value: selVal } = seg.selector;
    const numVal = /^\d+$/.test(selVal) ? parseInt(selVal, 10) : null;
    const idx = arr.findIndex((item) => {
      if (item === null || typeof item !== "object") return false;
      const v = (item as Record<string, unknown>)[prop];
      return String(v) === selVal || (numVal !== null && v === numVal);
    });
    if (idx < 0) return;
    if (op === "remove") {
      arr.splice(idx, 1);
      return;
    }
    if (op === "after" && setValue !== undefined) {
      arr.splice(idx + 1, 0, setValue);
      return;
    }
    if (op === "before" && setValue !== undefined) {
      arr.splice(idx, 0, setValue);
      return;
    }
    return;
  }
  const key = seg.key;
  const o = obj as Record<string, unknown>;
  if (op === "remove") {
    delete o[key];
    return;
  }
  if (op === "append" && setValue !== undefined) {
    const arr = (o[key] ?? []) as unknown[];
    arr.push(setValue);
    o[key] = arr;
    return;
  }
  if (op === "prepend" && setValue !== undefined) {
    const arr = (o[key] ?? []) as unknown[];
    arr.unshift(setValue);
    o[key] = arr;
    return;
  }
  if (op === "set") {
    o[key] = setValue as unknown;
  }
}

export function mutate(
  _schema: VariableSchema,
  value: VariableValue,
  notation: string,
  setValue: VariableValue | undefined,
): VariableValue {
  if (value === null || value === undefined) return value;
  const result = JSON.parse(JSON.stringify(value)) as VariableValue;

  const { segments, operation } = parseNotation(notation);
  if (segments.length === 0) return result;

  const last = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  let container: Record<string, unknown> | unknown[] = result as
    | Record<string, unknown>
    | unknown[];
  for (const seg of parentSegments) {
    const next = getAtSegment(container as VariableValue, seg);
    if (next === undefined) return result;
    container = next as Record<string, unknown> | unknown[];
  }

  setAtSegment(container, last, undefined, operation, setValue);
  return result;
}
