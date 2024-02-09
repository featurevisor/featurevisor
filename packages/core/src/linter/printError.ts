import * as Joi from "joi";
import { ZodError } from "zod";

export function printJoiError(e: Joi.ValidationError) {
  const { details } = e;

  details.forEach((detail) => {
    console.error("     => Error:", detail.message);
    console.error("     => Path:", detail.path.join("."));
    console.error("     => Value:", detail.context?.value);
  });
}

export function printZodError(e: ZodError) {
  const { issues } = e;

  issues.forEach((issue) => {
    console.error("     => Error:", issue.message);
    console.error("     => Path:", issue.path.join("."));
    console.error("     => Value:", (issue as any).received);
  });
}
