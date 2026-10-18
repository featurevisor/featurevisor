import { z } from "zod";

/**
 * Marks an issue about a key that names no definition. Lint drops these for archived
 * definitions, which are checked for their shape alone so their dependencies can go.
 */
export const UNKNOWN_REFERENCE = { unknownReference: true } as const;

export function refineWithMessage<T>(
  schema: z.ZodType<T>,
  predicate: (value: T) => boolean,
  getMessage: (value: T) => string,
  getParams?: (value: T) => Record<string, unknown> | undefined,
) {
  return schema.superRefine((value, ctx) => {
    if (!predicate(value)) {
      const params = getParams?.(value);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: getMessage(value),
        ...(params ? { params } : {}),
      });
    }
  });
}
