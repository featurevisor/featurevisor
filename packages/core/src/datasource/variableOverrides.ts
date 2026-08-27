import type { ParsedVariableOverride, ParsedVariableOverrides } from "@featurevisor/types";

/** Visit an authored override tree in declaration order. */
export function visitVariableOverrides(
  overrides: ParsedVariableOverride[] | undefined,
  visit: (override: ParsedVariableOverride) => void,
): void {
  for (const override of overrides || []) {
    visit(override);
    visitVariableOverrides(override.overrides, visit);
  }
}

/** Return every authored override from every environment as a flat list. */
export function flattenVariableOverrides(
  overrides: ParsedVariableOverrides | undefined,
): ParsedVariableOverride[] {
  const result: ParsedVariableOverride[] = [];
  const groups = Array.isArray(overrides) ? [overrides] : Object.values(overrides || {});

  for (const group of groups) {
    visitVariableOverrides(group, (override) => result.push(override));
  }

  return result;
}
