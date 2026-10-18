import type { VariableMutations, VariableValue } from "@featurevisor/types";

/** Preserve map enumeration order and explicit list order, including repeated paths. */
export function mutationEntries(mutations: VariableMutations): Array<[string, VariableValue]> {
  if (!Array.isArray(mutations)) return Object.entries(mutations);
  return mutations.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).length !== 1
    ) {
      throw new Error(
        "Each mutate item must be a map with exactly one mutation path and its value.",
      );
    }
    return Object.entries(item)[0];
  });
}

/** The authored location of an entry, retaining list indexes in lint diagnostics. */
export function mutationEntryPath(mutations: VariableMutations, index: number, key: string) {
  return Array.isArray(mutations) ? [index, key] : [key];
}
