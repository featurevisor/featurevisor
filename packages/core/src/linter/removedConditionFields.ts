import { z } from "zod";

export const removedConditionFields = {
  segments: z.unknown().optional(),
  requiredFeatures: z.unknown().optional(),
  requiredVariables: z.unknown().optional(),
};

export function refineRequiredConditions(
  value: { conditions?: unknown },
  ctx: z.RefinementCtx,
): void {
  refineRemovedConditionFields(value, ctx);
  if (
    value.conditions === undefined &&
    !Object.keys(removedConditionFields).some((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["conditions"],
      message: "A selector must define `conditions`. Use `conditions: '*'` to match everything.",
      params: { code: "missing_conditions" },
    });
  }
}

export function refineRemovedConditionFields(value: object, ctx: z.RefinementCtx): void {
  const messages = {
    segments: "Replace `segments` with `conditions`. Segment keys stay as strings.",
    requiredFeatures:
      "Move into `conditions`. Write each feature key as { feature: <key> }. Object entries keep their shape.",
    requiredVariables: "Move into `conditions`. Each entry keeps its shape.",
  };
  const fields = Object.keys(messages).filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  for (const field of fields)
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: messages[field],
      params: { code: "removed_condition_field" },
    });
  if (fields.length + Number(Object.prototype.hasOwnProperty.call(value, "conditions")) > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["conditions"],
      message:
        "Combine `segments`, `conditions`, `requiredFeatures` and `requiredVariables` into one `conditions` array. An array means AND.",
      params: { code: "removed_condition_field" },
    });
  }
}
