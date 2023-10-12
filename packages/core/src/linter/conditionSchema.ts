import * as Joi from "joi";

import { ProjectConfig } from "../config";

export function getConditionsJoiSchema(
  projectConfig: ProjectConfig,
  availableAttributeKeys: string[],
) {
  const plainConditionJoiSchema = Joi.object({
    attribute: Joi.string()
      .valid(...availableAttributeKeys)
      .required(),
    operator: Joi.string()
      .valid(
        "equals",
        "notEquals",

        // numeric
        "greaterThan",
        "greaterThanOrEquals",
        "lessThan",
        "lessThanOrEquals",

        // string
        "contains",
        "notContains",
        "startsWith",
        "endsWith",

        // semver (string)
        "semverEquals",
        "semverNotEquals",
        "semverGreaterThan",
        "semverGreaterThanOrEquals",
        "semverLessThan",
        "semverLessThanOrEquals",

        // date comparisons
        "before",
        "after",

        // array of strings
        "in",
        "notIn",
      )
      .required(),
    value: Joi.when("operator", {
      is: Joi.string().valid("equals", "notEquals"),
      then: Joi.alternatives()
        .try(Joi.string(), Joi.number(), Joi.boolean(), Joi.date())
        .allow(null)
        .required(),
    })
      .when("operator", {
        is: Joi.string().valid(
          "greaterThan",
          "greaterThanOrEquals",
          "lessThan",
          "lessThanOrEquals",
        ),
        then: Joi.number().required(),
      })
      .when("operator", {
        is: Joi.string().valid("contains", "notContains", "startsWith", "endsWith"),
        then: Joi.string().required(),
      })
      .when("operator", {
        is: Joi.string().valid(
          "semverEquals",
          "semverNotEquals",
          "semverGreaterThan",
          "semverGreaterThanOrEquals",
          "semverLessThan",
          "semverLessThanOrEquals",
        ),
        then: Joi.string().required(),
      })
      .when("operator", {
        is: Joi.string().valid("before", "after"),
        then: Joi.alternatives(Joi.date(), Joi.string()).required(),
      })
      .when("operator", {
        is: Joi.string().valid("in", "notIn"),
        then: Joi.array().items(Joi.string()).required(),
      }),
  });

  const andOrNotConditionJoiSchema = Joi.alternatives()
    .try(
      Joi.object({
        and: Joi.array().items(Joi.link("#andOrNotCondition"), plainConditionJoiSchema),
      }),
      Joi.object({
        or: Joi.array().items(Joi.link("#andOrNotCondition"), plainConditionJoiSchema),
      }),
      Joi.object({
        // @TODO: allow plainConditionJoiSchema as well?
        not: Joi.array().items(Joi.link("#andOrNotCondition"), plainConditionJoiSchema),
      }),
    )
    .id("andOrNotCondition");

  const conditionJoiSchema = Joi.alternatives().try(
    andOrNotConditionJoiSchema,
    plainConditionJoiSchema,
  );

  const conditionsJoiSchema = Joi.alternatives().try(
    conditionJoiSchema,
    Joi.array().items(conditionJoiSchema),
  );

  return conditionsJoiSchema;
}
