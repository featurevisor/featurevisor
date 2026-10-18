import type { ParsedVariable, ComposedParsedVariable, ComposeReference } from "@featurevisor/types";

/** Internal authoring discriminator for composed variables. */
export function isComposedVariable(variable: ParsedVariable): variable is ComposedParsedVariable {
  return variable.compose !== undefined;
}

/** A string projects a global getter directly, without a wrapper property. */
export function getCompositionEntries(
  variable: Pick<ParsedVariable, "compose">,
): Array<[string | undefined, ComposeReference]> {
  if (typeof variable.compose === "string")
    return variable.compose.length ? [[undefined, { variable: variable.compose }]] : [];
  return variable.compose &&
    typeof variable.compose === "object" &&
    !Array.isArray(variable.compose)
    ? Object.entries(variable.compose)
    : [];
}
