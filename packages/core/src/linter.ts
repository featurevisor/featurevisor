// for use in node only
import * as fs from "fs";
import * as path from "path";

import * as Joi from "joi";

import { getYAMLFiles, parseYaml } from "./utils";

import { ProjectConfig } from "./config";

export function getAttributeJoiSchema(projectConfig: ProjectConfig) {
  const attributeJoiSchema = Joi.object({
    archived: Joi.boolean(),
    type: Joi.string().allow("boolean", "string", "integer", "double"),
    description: Joi.string(),
    capture: Joi.boolean().optional(),
  });

  return attributeJoiSchema;
}

export function getConditionsJoiSchema(projectConfig: ProjectConfig) {
  const plainConditionJoiSchema = Joi.object({
    attribute: Joi.string(),
    operator: Joi.string().valid(
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

      // array of strings
      "in",
      "notIn",
    ),
    value: Joi.alternatives().try(
      // @TODO: make them more specific
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.array().items(Joi.string()),
    ),
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
    description: Joi.string(),
    conditions: conditionsJoiSchema,
  });

  return segmentJoiSchema;
}

export function getFeatureJoiSchema(projectConfig: ProjectConfig, conditionsJoiSchema) {
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

  const plainGroupSegment = Joi.string();

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
    rules: Joi.array().items(
      Joi.object({
        key: Joi.string(), // @TODO: make it unique among siblings
        segments: groupSegmentsJoiSchema,
        percentage: Joi.number().precision(3).min(0).max(100),
        variables: Joi.object().optional(), // @TODO: make it stricter
      }),
    ),
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

  const allEnvironomentsSchema = {};
  projectConfig.environments.forEach((environmentKey) => {
    allEnvironomentsSchema[environmentKey] = environmentJoiSchema;
  });
  const allEnvironomentsJoiSchema = Joi.object(allEnvironomentsSchema);

  const featureJoiSchema = Joi.object({
    archived: Joi.boolean().optional(),
    description: Joi.string(),
    tags: Joi.array().items(Joi.string()),

    defaultVariation: variationValueJoiSchema,

    bucketBy: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())),

    variablesSchema: Joi.array().items(
      Joi.object({
        key: Joi.string(), // @TODO: make it unique among siblings
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
    ),

    variations: Joi.array()
      .items(
        Joi.object({
          description: Joi.string().optional(),
          type: Joi.string().valid("string", "integer", "boolean", "double"),
          value: variationValueJoiSchema, // @TODO: make it unique among siblings
          weight: Joi.number().precision(3).min(0).max(100),
          variables: Joi.array().items(
            Joi.object({
              key: Joi.string(), // @TODO: make it unique among siblings
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
          ),
        }),
      )
      .custom((value, helpers) => {
        var total = value.reduce((a, b) => a + b.weight, 0);

        if (total !== 100) {
          throw new Error(`Sum of all variation weights must be 100, got ${total}`);
        }

        return value;
      }),

    environments: allEnvironomentsJoiSchema,
  });

  return featureJoiSchema;
}

export function getTestsJoiSchema(projectConfig: ProjectConfig) {
  const testsJoiSchema = Joi.object({
    tests: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        tag: Joi.string().valid(...projectConfig.tags),
        environment: Joi.string().valid(...projectConfig.environments),
        features: Joi.array().items(
          Joi.object({
            key: Joi.string(), // @TODO: make it specific
            assertions: Joi.array().items(
              Joi.object({
                description: Joi.string().optional(),
                at: Joi.number().precision(3).min(0).max(100),
                attributes: Joi.object(), // @TODO: make it specific

                // @TODO: one or both below
                expectedVariation: Joi.alternatives().try(
                  Joi.string(),
                  Joi.number(),
                  Joi.boolean(),
                ), // @TODO: make it specific
                expectedVariables: Joi.object(), // @TODO: make it specific
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

  // lint attributes
  console.log("Linting attributes...\n");
  const attributeFilePaths = getYAMLFiles(path.join(projectConfig.attributesDirectoryPath));
  const attributeJoiSchema = getAttributeJoiSchema(projectConfig);

  for (const filePath of attributeFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
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
  const conditionsJoiSchema = getConditionsJoiSchema(projectConfig);
  const segmentJoiSchema = getSegmentJoiSchema(projectConfig, conditionsJoiSchema);

  for (const filePath of segmentFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
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

  // lint features
  console.log("\nLinting features...\n");
  const featureFilePaths = getYAMLFiles(path.join(projectConfig.featuresDirectoryPath));
  const featureJoiSchema = getFeatureJoiSchema(projectConfig, conditionsJoiSchema);

  for (const filePath of featureFilePaths) {
    const key = path.basename(filePath, ".yml");
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as any;
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
  const testFilePaths = getYAMLFiles(path.join(projectConfig.testsDirectoryPath));
  const testsJoiSchema = getTestsJoiSchema(projectConfig);

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

  return hasError;
}
