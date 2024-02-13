import { z } from "zod";

import { ProjectConfig } from "../config";

const commonOperators: [string, ...string[]] = ["equals", "notEquals"];
const numericOperators = ["greaterThan", "greaterThanOrEquals", "lessThan", "lessThanOrEquals"];
const stringOperators = ["contains", "notContains", "startsWith", "endsWith"];
const semverOperators = [
  "semverEquals",
  "semverNotEquals",
  "semverGreaterThan",
  "semverGreaterThanOrEquals",
  "semverLessThan",
  "semverLessThanOrEquals",
];
const dateOperators = ["before", "after"];
const arrayOperators = ["in", "notIn"];

export function getConditionsZodSchema(
  projectConfig: ProjectConfig,
  availableAttributeKeys: [string, ...string[]],
) {
  const plainConditionZodSchema = z
    .object({
      attribute: z.string().refine(
        (value) => availableAttributeKeys.includes(value),
        (value) => ({
          message: `Unknown attribute "${value}"`,
        }),
      ),
      operator: z.enum([
        ...commonOperators,
        ...numericOperators,
        ...stringOperators,
        ...semverOperators,
        ...dateOperators,
        ...arrayOperators,
      ]),
      value: z.union([
        z.string(),
        z.array(z.string()),
        z.number(),
        z.boolean(),
        z.date(),
        z.null(),
      ]),
    })
    .superRefine((data, context) => {
      // common
      if (
        commonOperators.includes(data.operator) &&
        !(
          data.value === null ||
          typeof data.value === "string" ||
          typeof data.value === "number" ||
          typeof data.value === "boolean" ||
          data.value instanceof Date ||
          data.value === null
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value has to be either a string, number, boolean, date or null`,
          path: ["value"],
        });
      }

      // numeric
      if (numericOperators.includes(data.operator) && typeof data.value !== "number") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value must be a number`,
          path: ["value"],
        });
      }

      // string
      if (stringOperators.includes(data.operator) && typeof data.value !== "string") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value must be a string`,
          path: ["value"],
        });
      }

      // semver
      if (semverOperators.includes(data.operator) && typeof data.value !== "string") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value must be a string`,
          path: ["value"],
        });
      }

      // date
      if (dateOperators.includes(data.operator) && !(data.value instanceof Date)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value must be a date`,
          path: ["value"],
        });
      }

      // array
      if (arrayOperators.includes(data.operator) && !Array.isArray(data.value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `when operator is "${data.operator}", value must be an array of strings`,
          path: ["value"],
        });
      }
    });

  const andOrNotConditionZodSchema = z.union([
    z
      .object({
        and: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
    z
      .object({
        or: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
    z
      .object({
        not: z.array(z.lazy(() => conditionZodSchema)),
      })
      .strict(),
  ]);

  const conditionZodSchema = z.union([andOrNotConditionZodSchema, plainConditionZodSchema]);

  const conditionsZodSchema = z.union([conditionZodSchema, z.array(conditionZodSchema)]);

  return conditionsZodSchema;
}
