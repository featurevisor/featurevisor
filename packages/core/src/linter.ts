// for use in node only
import * as fs from "fs";
import * as path from "path";

import * as Joi from "joi";

import { getYAMLFiles, parseYaml } from "./utils";

import { ProjectConfig } from "./config";
import { ParsedFeature } from "@featurevisor/types";

export function getAttributeJoiSchema(projectConfig: ProjectConfig) {
  const attributeJoiSchema = Joi.object({
    archived: Joi.boolean(),
    type: Joi.string().allow("boolean", "string", "integer", "double", "date").required(),
    description: Joi.string().required(),
    capture: Joi.boolean(),
  });

  return attributeJoiSchema;
}

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
    value: Joi.alternatives()
      .try(
        // @TODO: make them more specific
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.date(),
        Joi.array().items(Joi.string()),
      )
      .required(),
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

export function getSegmentJoiSchema(projectConfig: ProjectConfig, conditionsJoiSchema) {
  const segmentJoiSchema = Joi.object({
    archived: Joi.boolean().optional(),
    description: Joi.string().required(),
    conditions: conditionsJoiSchema.required(),
  });

  return segmentJoiSchema;
}

export function getGroupJoiSchema(projectConfig: ProjectConfig, availableFeatureKeys: string[]) {
  const groupJoiSchema = Joi.object({
    description: Joi.string().required(),
    slots: Joi.array()
      .items(
        Joi.object({
          feature: Joi.string().valid(...availableFeatureKeys),
          percentage: Joi.number().precision(3).min(0).max(100),
        }),
      )
      .custom(function (value, helper) {
        const totalPercentage = value.reduce((acc, slot) => acc + slot.percentage, 0);

        if (totalPercentage !== 100) {
          throw new Error("total percentage is not 100");
        }

        for (const slot of value) {
          const maxPercentageForRule = slot.percentage;

          if (slot.feature) {
            const featureKey = slot.feature;
            const featurePath = path.join(projectConfig.featuresDirectoryPath, `${featureKey}.yml`);
            const parsedFeature = parseYaml(fs.readFileSync(featurePath, "utf8")) as ParsedFeature;

            if (!parsedFeature) {
              throw new Error(`feature ${featureKey} not found`);
            }

            const environmentKeys = Object.keys(parsedFeature.environments);
            for (const environmentKey of environmentKeys) {
              const environment = parsedFeature.environments[environmentKey];
              const rules = environment.rules;

              for (const rule of rules) {
                if (rule.percentage > maxPercentageForRule) {
                  // @TODO: this does not help with same feature belonging to multiple slots. fix that.
                  throw new Error(
                    `Feature ${featureKey}'s rule ${rule.key} in ${environmentKey} has a percentage of ${rule.percentage} which is greater than the maximum percentage of ${maxPercentageForRule} for the slot`,
                  );
                }
              }
            }
          }
        }

        return value;
      })
      .required(),
  });

  return groupJoiSchema;
}

const tagRegex = /^[a-z0-9\-]+$/;

export function getFeatureJoiSchema(
  projectConfig: ProjectConfig,
  conditionsJoiSchema,
  availableSegmentKeys: string[],
) {
  const variationValueJoiSchema = Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean());
  const variableValueJoiSchema = Joi.alternatives()
    .try(
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.array().items(Joi.string()),
      Joi.object().custom(function (value, helper) {
        let isFlat = true;

        Object.keys(value).forEach((key) => {
          if (typeof value[key] === "object") {
            isFlat = false;
          }
        });

        if (!isFlat) {
          throw new Error("object is not flat");
        }

        return value;
      }),
    )
    .allow("");

  const plainGroupSegment = Joi.string().valid("*", ...availableSegmentKeys);

  const andOrNotGroupSegment = Joi.alternatives()
    .try(
      Joi.object({
        and: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
      Joi.object({
        or: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
      Joi.object({
        // @TODO: allow plainGroupSegment as well?
        not: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
    )
    .id("andOrNotGroupSegment");

  const groupSegment = Joi.alternatives().try(andOrNotGroupSegment, plainGroupSegment);

  const groupSegmentsJoiSchema = Joi.alternatives().try(
    Joi.array().items(groupSegment),
    groupSegment,
  );

  const environmentJoiSchema = Joi.object({
    expose: Joi.boolean(),
    rules: Joi.array()
      .items(
        Joi.object({
          key: Joi.string(),
          segments: groupSegmentsJoiSchema,
          percentage: Joi.number().precision(3).min(0).max(100),
          variation: variationValueJoiSchema.optional(),
          variables: Joi.object().optional(), // @TODO: make it stricter
        }),
      )
      .unique("key")
      .required(),
    force: Joi.array().items(
      Joi.object({
        // @TODO: either of the two below
        segments: groupSegmentsJoiSchema.optional(),
        conditions: conditionsJoiSchema.optional(),

        variation: variationValueJoiSchema,
        variables: Joi.object().optional(), // @TODO: make it stricter
      }),
    ),
  });

  const allEnvironmentsSchema = {};
  projectConfig.environments.forEach((environmentKey) => {
    allEnvironmentsSchema[environmentKey] = environmentJoiSchema.required();
  });
  const allEnvironmentsJoiSchema = Joi.object(allEnvironmentsSchema);

  const featureJoiSchema = Joi.object({
    archived: Joi.boolean(),
    description: Joi.string().required(),
    tags: Joi.array()
      .items(
        Joi.string().custom((value, helpers) => {
          if (!tagRegex.test(value)) {
            throw new Error("tag must be lower cased and alphanumeric, and may contain hyphens.");
          }

          return value;
        }),
      )
      .required(),

    defaultVariation: variationValueJoiSchema,

    bucketBy: Joi.alternatives()
      .try(
        // plain
        Joi.string(),

        // and
        Joi.array().items(Joi.string()),

        // or
        Joi.object({
          or: Joi.array().items(Joi.string()),
        }),
      )
      .required(),

    variablesSchema: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().disallow("variation"),
          type: Joi.string().valid(
            "string",
            "integer",
            "boolean",
            "double",
            "array",
            "object",
            "json",
          ),
          defaultValue: variableValueJoiSchema, // @TODO: make it stricter based on `type`
        }),
      )
      .unique("key"),

    variations: Joi.array()
      .items(
        Joi.object({
          description: Joi.string(),
          value: variationValueJoiSchema.required(),
          weight: Joi.number().precision(3).min(0).max(100).required(),
          variables: Joi.array()
            .items(
              Joi.object({
                key: Joi.string(),
                value: variableValueJoiSchema,
                overrides: Joi.array().items(
                  Joi.object({
                    // @TODO: either segments or conditions prsent at a time
                    segments: groupSegmentsJoiSchema,
                    conditions: conditionsJoiSchema,

                    // @TODO: make it stricter based on `type`
                    value: variableValueJoiSchema,
                  }),
                ),
              }),
            )
            .unique("key"),
        }),
      )
      .custom((value, helpers) => {
        var total = value.reduce((a, b) => a + b.weight, 0);

        if (total !== 100) {
          throw new Error(`Sum of all variation weights must be 100, got ${total}`);
        }

        const typeOf = new Set(value.map((v) => typeof v.value));

        if (typeOf.size > 1) {
          throw new Error(
            `All variations must have the same type, got ${Array.from(typeOf).join(", ")}`,
          );
        }

        return value;
      })
      .required(),

    environments: allEnvironmentsJoiSchema.required(),
  });

  return featureJoiSchema;
}

export function getTestsJoiSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: string[],
  availableSegmentKeys: string[],
) {
  const testsJoiSchema = Joi.object({
    tests: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        tag: Joi.string()
          .valid(...projectConfig.tags)
          .optional(),
        environment: Joi.string()
          .valid(...projectConfig.environments)
          .optional(),
        features: Joi.array()
          .items(
            Joi.object({
              key: Joi.string()
                .valid(...availableFeatureKeys)
                .required(),
              assertions: Joi.array().items(
                Joi.object({
                  description: Joi.string().optional(),
                  at: Joi.number().precision(3).min(0).max(100),
                  attributes: Joi.object(),

                  // @TODO: one or both below
                  expectedVariation: Joi.alternatives().try(
                    Joi.string(),
                    Joi.number(),
                    Joi.boolean(),
                  ),
                  expectedVariables: Joi.object(),
                }),
              ),
            }),
          )
          .optional(),
        segments: Joi.array().items(
          Joi.object({
            key: Joi.string()
              .valid(...availableSegmentKeys)
              .required(),
            assertions: Joi.array().items(
              Joi.object({
                description: Joi.string().optional(),
                attributes: Joi.object(),
                expected: Joi.boolean(),
              }),
            ),
          }),
        ),
      }),
    ),
  });

  return testsJoiSchema;
}

export function printJoiError(e: Joi.ValidationError) {
  const { details } = e;

  details.forEach((detail) => {
    console.error("     => Error:", detail.message);
    console.error("     => Path:", detail.path.join("."));
    console.error("     => Value:", detail.context?.value);
  });
}

export async function lintProject(projectConfig: ProjectConfig): Promise<boolean> {
  let hasError = false;

  const availableAttributeKeys: string[] = [];
  const availableSegmentKeys: string[] = [];
  const availableFeatureKeys: string[] = [];

  // lint attributes
  console.log("Linting attributes...\n");
  const attributeFilePaths = getYAMLFiles(path.join(projectConfig.attributesDirectoryPath));
  const attributeJoiSchema = getAttributeJoiSchema(projectConfig);

  for (const filePath of attributeFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
    availableAttributeKeys.push(key);

    console.log("  =>", key);

    try {
      await attributeJoiSchema.validateAsync(parsed);
    } catch (e) {
      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }
  }

  // lint segments
  console.log("\nLinting segments...\n");
  const segmentFilePaths = getYAMLFiles(path.join(projectConfig.segmentsDirectoryPath));
  const conditionsJoiSchema = getConditionsJoiSchema(projectConfig, availableAttributeKeys);
  const segmentJoiSchema = getSegmentJoiSchema(projectConfig, conditionsJoiSchema);

  for (const filePath of segmentFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
    availableSegmentKeys.push(key);

    console.log("  =>", key);

    try {
      await segmentJoiSchema.validateAsync(parsed);
    } catch (e) {
      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }
  }

  // lint groups
  console.log("\nLinting groups...\n");
  if (fs.existsSync(projectConfig.groupsDirectoryPath)) {
    const groupFilePaths = getYAMLFiles(path.join(projectConfig.groupsDirectoryPath));
    const groupJoiSchema = getGroupJoiSchema(projectConfig, availableFeatureKeys);

    for (const filePath of groupFilePaths) {
      const key = path.basename(filePath, ".yml");
      const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
      console.log("  =>", key);

      try {
        await groupJoiSchema.validateAsync(parsed);
      } catch (e) {
        if (e instanceof Joi.ValidationError) {
          printJoiError(e);
        } else {
          console.log(e);
        }

        hasError = true;
      }
    }
  }

  // @TODO: feature cannot exist in multiple groups

  // lint features
  console.log("\nLinting features...\n");
  const featureFilePaths = getYAMLFiles(path.join(projectConfig.featuresDirectoryPath));
  const featureJoiSchema = getFeatureJoiSchema(
    projectConfig,
    conditionsJoiSchema,
    availableSegmentKeys,
  );

  for (const filePath of featureFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
    availableFeatureKeys.push(key);

    console.log("  =>", key);

    try {
      await featureJoiSchema.validateAsync(parsed);
    } catch (e) {
      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }
  }

  // lint tests
  console.log("\nLinting tests...\n");
  if (fs.existsSync(projectConfig.testsDirectoryPath)) {
    const testFilePaths = getYAMLFiles(path.join(projectConfig.testsDirectoryPath));
    const testsJoiSchema = getTestsJoiSchema(
      projectConfig,
      availableFeatureKeys,
      availableSegmentKeys,
    );

    for (const filePath of testFilePaths) {
      const key = path.basename(filePath, ".yml");
      const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
      console.log("  =>", key);

      try {
        await testsJoiSchema.validateAsync(parsed);
      } catch (e) {
        if (e instanceof Joi.ValidationError) {
          printJoiError(e);
        } else {
          console.log(e);
        }

        hasError = true;
      }
    }
  }

  return hasError;
}
