/** Every place a definition can have `conditions`, as named in `allowedConditions`. */
export const CONDITION_LOCATIONS = [
  "segments",
  "features",
  "rules",
  "force",
  "featureVariableOverrides",
  "variables",
  "variableOverrides",
] as const;

/** The kinds of condition leaf, named after the key authors write. */
export const CONDITION_KINDS = ["attribute", "segment", "feature", "variable"] as const;

export type ConditionLocation = (typeof CONDITION_LOCATIONS)[number];
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Kinds each location accepts. An omitted location accepts every kind. */
export type AllowedConditions = Partial<Record<ConditionLocation, ConditionKind[]>>;

const list = (values: readonly string[]) => values.join(", ");

export function assertAllowedConditions(value: unknown): asserts value is AllowedConditions {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(
      "Invalid allowedConditions: expected an object mapping locations to lists of condition kinds.",
    );
  }
  for (const [location, kinds] of Object.entries(value)) {
    if (!(CONDITION_LOCATIONS as readonly string[]).includes(location)) {
      throw new Error(
        `Invalid allowedConditions.${location}: unknown location. Use one of: ${list(CONDITION_LOCATIONS)}.`,
      );
    }
    if (!Array.isArray(kinds)) {
      throw new Error(
        `Invalid allowedConditions.${location}: expected an array of condition kinds, such as ["segment"].`,
      );
    }
    const seen = new Set<string>();
    kinds.forEach((kind: unknown, index: number) => {
      if (typeof kind !== "string" || !(CONDITION_KINDS as readonly string[]).includes(kind)) {
        throw new Error(
          `Invalid allowedConditions.${location}[${index}]: ${String(kind)}. Use one of: ${list(CONDITION_KINDS)}.`,
        );
      }
      if (seen.has(kind)) {
        throw new Error(`Invalid allowedConditions.${location}: duplicate kind "${kind}".`);
      }
      seen.add(kind);
    });
  }
}
