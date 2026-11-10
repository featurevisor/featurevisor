/**
 * Every code lint reports as a warning. `lint --fail-on` takes these, and makes the warnings with
 * them errors. A new warning code joins this list, which `warningCodes.spec.ts` checks.
 */
export const LINT_WARNING_CODES = [
  "composition_experiment_override",
  "composition_nullable_mutation",
  "context_value_mismatch",
  "deadline_due_today",
  "deadline_overdue",
  "dependency_depth",
  "dependency_expansion_cost",
  "deprecated_reference",
  "expression_mixed_logic",
  "expression_negation_intent",
  "expression_semver_text",
  "mixed_list",
  "mutation_order_changed",
  "untyped_condition",
] as const;

export type LintWarningCode = (typeof LINT_WARNING_CODES)[number];

export function isLintWarningCode(value: unknown): value is LintWarningCode {
  return typeof value === "string" && (LINT_WARNING_CODES as readonly string[]).includes(value);
}
