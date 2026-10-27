/**
 * A list in a condition holds one type: strings, or numbers, with `null` allowed beside
 * either. A mix can never match one value consistently, so lint rejects it everywhere,
 * including `json` variables, whose type lint cannot otherwise see.
 */
export function getMixedListMessage(operator: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const hasString = value.some((entry) => typeof entry === "string");
  const hasNumber = value.some((entry) => typeof entry === "number");
  if (!hasString || !hasNumber) return undefined;
  return `when operator is "${operator}", the list mixes strings and numbers. A list holds one type, with null allowed beside it. Quote every value or none.`;
}
