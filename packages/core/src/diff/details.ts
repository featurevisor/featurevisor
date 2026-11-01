import { isDeepStrictEqual } from "node:util";

import { describeConditions, sameConditions, type ConditionsView } from "./conditions";

/** Authored identities for readable reports, separate from positional JSON field changes. */
export interface DiffDetail {
  label: string;
  kind: "added" | "removed" | "changed" | "reordered";
  before?: unknown;
  after?: unknown;
  position?: number;
  children?: DiffDetail[];
  /** Conditions on one line each, as the report shows them */
  text?: { before?: string; after?: string };
}

type Context = "feature" | "variable" | "segment" | "rule" | "override" | "variation" | "plain";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const quote = (value: unknown) => JSON.stringify(value);
const title = (key: string) => {
  if (key === "percentage") return "Rollout percentage";
  if (key === "mutate") return "Mutations";
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

function changed(label: string, before: unknown, after: unknown): DiffDetail[] {
  if (isDeepStrictEqual(before, after)) return [];
  return [
    {
      label,
      kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    },
  ];
}

function group(label: string, children: DiffDetail[]): DiffDetail[] {
  return children.length ? [{ label, kind: "changed", children }] : [];
}

function collection(
  label: string,
  before: unknown,
  after: unknown,
  context: "rule" | "override" | "variation",
  view: ConditionsView,
): DiffDetail[] {
  if (isDeepStrictEqual(before, after)) return [];
  if (
    (before !== undefined && !Array.isArray(before)) ||
    (after !== undefined && !Array.isArray(after))
  ) {
    return changed(label, before, after);
  }
  const previous = (before ?? []) as unknown[];
  const next = (after ?? []) as unknown[];
  const identity = context === "variation" ? "value" : "key";
  const unique = (items: unknown[]) =>
    items.every(
      (item) => record(item) && typeof item[identity] === "string" && item[identity] !== "",
    ) && new Set(items.map((item: RecordValue) => item[identity])).size === items.length;
  const noun = title(context);
  const children: DiffDetail[] = [];
  if (unique(previous) && unique(next)) {
    const oldItems = new Map(
      (previous as RecordValue[]).map((item) => [item[identity] as string, item]),
    );
    const newItems = new Map(
      (next as RecordValue[]).map((item) => [item[identity] as string, item]),
    );
    const oldKeys = Array.from(oldItems.keys());
    const newKeys = Array.from(newItems.keys());
    for (const key of oldKeys.filter((key) => !newItems.has(key))) {
      children.push({ label: `${noun} ${quote(key)}`, kind: "removed", before: oldItems.get(key) });
    }
    for (const [index, key] of newKeys.entries()) {
      const itemLabel = `${noun} ${quote(key)}`;
      if (!oldItems.has(key)) {
        children.push({
          label: itemLabel,
          kind: "added",
          after: newItems.get(key),
          position: index + 1,
        });
      } else {
        children.push(
          ...group(itemLabel, fields(oldItems.get(key), newItems.get(key), context, view)),
        );
      }
    }
    // An insertion shifts positions, but only a change in relative order reorders existing items.
    if (
      !isDeepStrictEqual(
        oldKeys.filter((key) => newItems.has(key)),
        newKeys.filter((key) => oldItems.has(key)),
      )
    ) {
      children.push({ label: `${noun} order`, kind: "reordered", before: oldKeys, after: newKeys });
    }
  } else {
    label += " (compared by position: missing or duplicate identities)";
    for (let index = 0; index < Math.max(previous.length, next.length); index++) {
      const itemLabel = `${noun} at position ${index + 1}`;
      if (index >= previous.length || index >= next.length) {
        children.push(...changed(itemLabel, previous[index], next[index]));
      } else {
        children.push(...group(itemLabel, fields(previous[index], next[index], context, view)));
      }
    }
  }
  // Adding or removing an explicitly empty list is still an authored change.
  return children.length ? group(label, children) : changed(label, before, after);
}

function environments(
  label: string,
  before: unknown,
  after: unknown,
  context: "rule" | "override",
  view: ConditionsView,
): DiffDetail[] {
  if (Array.isArray(before) || Array.isArray(after))
    return collection(label, before, after, context, view);
  if ((before !== undefined && !record(before)) || (after !== undefined && !record(after))) {
    return changed(label, before, after);
  }
  const oldMap = (before ?? {}) as RecordValue;
  const newMap = (after ?? {}) as RecordValue;
  const children = keys(oldMap, newMap).flatMap((key) =>
    collection(
      `${label} (${quote(key)})`,
      own(oldMap, key) ? oldMap[key] : undefined,
      own(newMap, key) ? newMap[key] : undefined,
      context,
      view,
    ),
  );
  return children.length ? children : changed(label, before, after);
}

const keys = (before: RecordValue, after: RecordValue) =>
  Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();

function variables(
  before: unknown,
  after: unknown,
  overrides: boolean,
  view: ConditionsView,
): DiffDetail[] {
  if ((before !== undefined && !record(before)) || (after !== undefined && !record(after))) {
    return changed(overrides ? "Variable overrides" : "Variables", before, after);
  }
  const oldMap = (before ?? {}) as RecordValue;
  const newMap = (after ?? {}) as RecordValue;
  const children = keys(oldMap, newMap).flatMap((key) => {
    const oldValue = own(oldMap, key) ? oldMap[key] : undefined;
    const newValue = own(newMap, key) ? newMap[key] : undefined;
    const label = `Variable ${quote(key)}`;
    if (overrides)
      return group(label, collection("Overrides", oldValue, newValue, "override", view));
    if (oldValue === undefined || newValue === undefined) return changed(label, oldValue, newValue);
    return group(label, fields(oldValue, newValue, "plain", view));
  });
  return children.length
    ? children
    : changed(overrides ? "Variable overrides" : "Variables", before, after);
}

function mutations(before: unknown, after: unknown, view: ConditionsView): DiffDetail[] {
  if (
    before !== undefined &&
    after !== undefined &&
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return group("Mutations", [
      ...changed(
        "Form",
        Array.isArray(before) ? "list" : "map",
        Array.isArray(after) ? "list" : "map",
      ),
      ...changed("Entries", before, after),
    ]);
  }
  if (!Array.isArray(before) || !Array.isArray(after)) {
    return record(before) && record(after)
      ? group("Mutations", fields(before, after, "plain", view))
      : changed("Mutations", before, after);
  }
  // Match whole items, not paths, because a path can occur several times.
  const remaining = [...before];
  const reordered =
    before.length === after.length &&
    after.every((item) => {
      const index = remaining.findIndex((previous) => isDeepStrictEqual(previous, item));
      if (index === -1) return false;
      remaining.splice(index, 1);
      return true;
    });
  if (reordered) {
    return group("Mutations", [{ label: "Item order", kind: "reordered", before, after }]);
  }
  return group(
    "Mutations",
    Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
      changed(`Mutation at position ${index + 1}`, before[index], after[index]),
    ).flat(),
  );
}

/**
 * A change of conditions, on one line each side. Conditions that build the same tree are the
 * same, whether written as a tree or as an expression.
 */
function conditions(before: unknown, after: unknown, view: ConditionsView): DiffDetail[] {
  if (before !== undefined && after !== undefined && sameConditions(before, after, view)) return [];
  return changed("Conditions", before, after).map((detail) => ({
    ...detail,
    text: {
      ...(before !== undefined ? { before: describeConditions(before, view) } : {}),
      ...(after !== undefined ? { after: describeConditions(after, view) } : {}),
    },
  }));
}

function fields(
  before: unknown,
  after: unknown,
  context: Context,
  view: ConditionsView,
): DiffDetail[] {
  if (isDeepStrictEqual(before, after)) return [];
  if (!record(before) || !record(after)) return changed("Value", before, after);
  // keys of arbitrary values, and of segments, read as written
  const label = (key: string) =>
    context === "plain" || context === "segment" ? quote(key) : title(key);
  return keys(before, after).flatMap((key) => {
    const oldValue = own(before, key) ? before[key] : undefined;
    const newValue = own(after, key) ? after[key] : undefined;
    if (isDeepStrictEqual(oldValue, newValue)) return [];
    if (key === "conditions" && context !== "plain") return conditions(oldValue, newValue, view);
    if (context === "feature" && key === "rules")
      return environments("Rules", oldValue, newValue, "rule", view);
    if (context === "variable" && key === "overrides")
      return environments("Overrides", oldValue, newValue, "override", view);
    if (context === "override" && key === "overrides")
      return collection("Overrides", oldValue, newValue, "override", view);
    if (context === "feature" && key === "variations")
      return collection("Variations", oldValue, newValue, "variation", view);
    if (context === "feature" && key === "variablesSchema")
      return variables(oldValue, newValue, false, view);
    if ((context === "rule" || context === "variation") && key === "variableOverrides")
      return variables(oldValue, newValue, true, view);
    if (context === "override" && key === "mutate") return mutations(oldValue, newValue, view);
    if (record(oldValue) && record(newValue)) {
      // Arbitrary variable values never acquire rule or override semantics just from their field names.
      return group(label(key), fields(oldValue, newValue, "plain", view));
    }
    return changed(label(key), oldValue, newValue);
  });
}

/** Conditions read as every command reads them, shown as trees */
const TREES: ConditionsView = { options: {}, expressions: false };

export function describeDefinitionChanges(
  entity: string,
  before: unknown,
  after: unknown,
  view: ConditionsView = TREES,
): DiffDetail[] {
  if (before === undefined || after === undefined) return changed("Definition", before, after);
  const context =
    entity === "feature" || entity === "variable" || entity === "segment" ? entity : "plain";
  return fields(before, after, context, view);
}

export function formatDetails(details: DiffDetail[], colour = false, indent = 2): string[] {
  const paint = (value: string, code: number) => (colour ? `\x1b[${code}m${value}\x1b[0m` : value);
  const lines: string[] = [];
  for (const detail of details) {
    const prefix = " ".repeat(indent);
    if (detail.children) {
      lines.push(
        `${prefix}${paint(detail.label, 36)}${/^(Rule|Override|Variation|Variable) "/.test(detail.label) ? " updated" : ""}`,
      );
      lines.push(...formatDetails(detail.children, colour, indent + 2));
      continue;
    }
    if (detail.kind === "changed" || detail.kind === "reordered") {
      const before = detail.text?.before ?? quote(detail.before);
      const after = detail.text?.after ?? quote(detail.after);
      lines.push(
        `${prefix}${detail.label}${detail.kind === "reordered" ? " (reordered)" : ""}: ${paint(before, 31)} → ${paint(after, 32)}`,
      );
    } else {
      const code = detail.kind === "added" ? 32 : 31;
      lines.push(
        `${prefix}${paint(detail.label + " " + detail.kind, code)}${detail.position ? ` (position ${detail.position})` : ""}`,
      );
      const text = detail.kind === "added" ? detail.text?.after : detail.text?.before;
      if (text !== undefined) {
        lines.push(`${prefix}  ${paint(text, code)}`);
        continue;
      }
      const value = detail.kind === "added" ? detail.after : detail.before;
      // Definitions are printed as readable blocks, not long single line JSON objects.
      for (const line of JSON.stringify(value, null, 2).split("\n")) {
        lines.push(`${prefix}  ${paint(line, code)}`);
      }
    }
  }
  return lines;
}
