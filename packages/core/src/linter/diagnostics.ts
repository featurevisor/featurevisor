import { z } from "zod";
import { isRemovedSchemaType } from "./schemaFormats";

export function suggestKey(value: string, candidates: string[]): string {
  // Suggestions are optional diagnostics, so bound work even for generated projects.
  if (value.length > 128 || candidates.length > 1000) return "";
  const limit = Math.min(2, Math.floor(value.length / 3));
  const distance = (candidate: string) => {
    if (candidate.length > 128 || Math.abs(candidate.length - value.length) > limit)
      return limit + 1;
    let row = Array.from({ length: candidate.length + 1 }, (_, i) => i);
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < candidate.length; j++) {
        next.push(
          Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (value[i] !== candidate[j] ? 1 : 0)),
        );
      }
      row = next;
      if (Math.min(...row) > limit) return limit + 1;
    }
    return row[candidate.length];
  };
  const ranked = [...new Set(candidates.filter((key) => key.length <= 128))]
    .map((key) => ({ key, distance: distance(key) }))
    .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  const best = ranked[0];
  if (
    !best ||
    best.distance === 0 ||
    best.distance > limit ||
    ranked[1]?.distance === best.distance
  )
    return "";
  return ` Did you mean "${best.key}"?`;
}

export const diagnosticParseOptions = {
  reportInput: true,
  error: ((issue) => {
    const field = issue.path?.[issue.path.length - 1];
    if (issue.code === "unrecognized_keys") {
      const shape = (issue.inst as z.ZodObject).shape;
      return issue.keys
        .map((key) => `Unknown key "${key}".${suggestKey(key, Object.keys(shape || {}))}`)
        .join(" ");
    }
    if (
      (issue.code === "invalid_type" || issue.code === "invalid_union") &&
      issue.input === undefined &&
      field !== undefined
    ) {
      const shapes: Record<string, string> = {
        bucketBy: "an attribute key, an array of attribute keys, or { or: [attribute keys] }",
        segments: '"*", a segment key, an array of segments, or an and/or/not group',
        rules:
          issue.code === "invalid_type" &&
          (issue.expected === "object" || issue.expected === "record")
            ? "an object mapping environments to lists of rules"
            : "a list of rules",
      };
      const expected =
        shapes[String(field)] ||
        (issue.code === "invalid_type" ? issue.expected : "one of the supported shapes");
      return `Missing required \`${String(field)}\`. Expected ${expected}.`;
    }
    if (issue.code === "invalid_value" && (field === "operator" || field === "type")) {
      // Removed types parse only to explain their migration, so never suggest them.
      const allowed = issue.values.map(String).filter((value) => !isRemovedSchemaType(value));
      const suggestion = typeof issue.input === "string" ? suggestKey(issue.input, allowed) : "";
      if (field === "operator" && suggestion) {
        return `Unknown operator ${JSON.stringify(issue.input)}.${suggestion} See https://featurevisor.com/docs/operators/.`;
      }
      return `Unknown ${String(field)} ${JSON.stringify(issue.input)}. Allowed: ${allowed.join(", ")}.${suggestion}`;
    }
    if (issue.code === "invalid_union" && field === "type") {
      const errors: z.core.$ZodIssue[][] = issue.errors;
      if (
        errors.length > 0 &&
        errors.every((branch) => branch.every((item) => item.code === "invalid_value"))
      ) {
        const allowed = errors
          .flatMap((branch) =>
            branch.flatMap((item) =>
              item.code === "invalid_value" ? item.values.map(String) : [],
            ),
          )
          .filter((value) => !isRemovedSchemaType(value));
        return `Unknown type ${JSON.stringify(issue.input)}. Allowed: ${allowed.join(", ")}.${typeof issue.input === "string" ? suggestKey(issue.input, allowed) : ""}`;
      }
    }
    return undefined;
  }) satisfies z.core.$ZodErrorMap,
};
