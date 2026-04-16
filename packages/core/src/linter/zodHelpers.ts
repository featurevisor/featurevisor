import { z } from "zod";

export function refineWithMessage<T>(
  schema: z.ZodType<T>,
  predicate: (value: T) => boolean,
  getMessage: (value: T) => string,
) {
  return schema.superRefine((value, ctx) => {
    if (!predicate(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: getMessage(value),
      });
    }
  });
}
