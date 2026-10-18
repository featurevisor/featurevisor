import { z } from "zod";

/** Validate list item shape before operands, so malformed items have their own paths. */
export function getMutationSchema<T extends z.ZodTypeAny>(mapSchema: T) {
  return z
    .any()
    .superRefine((value, ctx) => {
      if (!Array.isArray(value)) return;
      value.forEach((item, index) => {
        let message: string | undefined;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          message = "Each mutate item must be a map with one mutation path and its value.";
        } else {
          const keys = Object.keys(item);
          if (!keys.length) message = "A mutate item needs one mutation path.";
          else if (keys.length !== 1) {
            message = `A mutate item must have exactly one mutation path. Put ${keys.map((key) => JSON.stringify(key)).join(" and ")} in separate items.`;
          }
        }
        if (message) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [index], fatal: true });
        }
      });
    })
    .pipe(z.union([mapSchema, z.array(mapSchema)]));
}
