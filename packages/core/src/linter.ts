// for use in node only
import * as fs from "fs";

import * as Joi from "joi";

import { Datasource } from "./datasource/datasource";

import { ProjectConfig } from "./config";
import { FeatureKey, Required } from "@featurevisor/types";

export function getAttributeJoiSchema() {
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

export function getGroupJoiSchema(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  availableFeatureKeys: string[],
) {
  const groupJoiSchema = Joi.object({
    description: Joi.string().required(),
    slots: Joi.array()
      .items(
        Joi.object({
          feature: Joi.string().valid(...availableFeatureKeys),
          percentage: Joi.number().precision(3).min(0).max(100),
        }),
      )
      .custom(function (value) {
        const totalPercentage = value.reduce((acc, slot) => acc + slot.percentage, 0);

        if (totalPercentage !== 100) {
          throw new Error("total percentage is not 100");
        }

        for (const slot of value) {
          const maxPercentageForRule = slot.percentage;

          if (slot.feature) {
            const featureKey = slot.feature;
            const featureExists = datasource.entityExists("feature", featureKey);

            if (!featureExists) {
              throw new Error(`feature ${featureKey} not found`);
            }

            const parsedFeature = datasource.readFeature(featureKey);

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

const tagRegex = /^[a-z0-9-]+$/;

export function getFeatureJoiSchema(
  projectConfig: ProjectConfig,
  conditionsJoiSchema,
  availableSegmentKeys: string[],
  availableFeatureKeys: string[],
) {
  const variationValueJoiSchema = Joi.string().required();
  const variableValueJoiSchema = Joi.alternatives()
    .try(
      // @TODO: make it stricter based on variableSchema.type
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.array().items(Joi.string()),
      Joi.object().custom(function (value) {
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

          enabled: Joi.boolean().optional(),
          variation: variationValueJoiSchema.optional(), // @TODO: only allowed if feature.variations is present
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

        enabled: Joi.boolean().optional(),
        variation: variationValueJoiSchema.optional(),
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
    archived: Joi.boolean().optional(),
    deprecated: Joi.boolean().optional(),
    description: Joi.string().required(),
    tags: Joi.array()
      .items(
        Joi.string().custom((value) => {
          if (!tagRegex.test(value)) {
            throw new Error("tag must be lower cased and alphanumeric, and may contain hyphens.");
          }

          return value;
        }),
      )
      .required(),

    required: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.string()
            .required()
            .valid(...availableFeatureKeys),
          Joi.object({
            key: Joi.string()
              .required()
              .valid(...availableFeatureKeys),
            variation: Joi.string().optional(), // @TODO: can be made stricter
          }),
        ),
      )
      .optional(),

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
      .custom((value) => {
        const total = value.reduce((acc, v) => acc + v.weight, 0);

        if (total !== 100) {
          throw new Error(`Sum of all variation weights must be 100, got ${total}`);
        }

        return value;
      })
      .optional(),

    environments: allEnvironmentsJoiSchema.required(),
  });

  return featureJoiSchema;
}

export function getTestsJoiSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: string[],
  availableSegmentKeys: string[],
) {
  const segmentTestJoiSchema = Joi.object({
    segment: Joi.string()
      .valid(...availableSegmentKeys)
      .required(),
    assertions: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        context: Joi.object(),
        expectedToMatch: Joi.boolean(),
      }),
    ),
  });

  const featureTestJoiSchema = Joi.object({
    feature: Joi.string()
      .valid(...availableFeatureKeys)
      .required(),
    assertions: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        at: Joi.number().precision(3).min(0).max(100),
        environment: Joi.string().valid(...projectConfig.environments),
        context: Joi.object(),

        // @TODO: one or all below
        expectedToBeEnabled: Joi.boolean().required(),
        expectedVariation: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()),
        expectedVariables: Joi.object(),
      }),
    ),
  });

  return Joi.alternatives().try(segmentTestJoiSchema, featureTestJoiSchema);
}

export function printJoiError(e: Joi.ValidationError) {
  const { details } = e;

  details.forEach((detail) => {
    console.error("     => Error:", detail.message);
    console.error("     => Path:", detail.path.join("."));
    console.error("     => Value:", detail.context?.value);
  });
}

function checkForCircularDependencyInRequired(
  datasource: Datasource,
  featureKey: FeatureKey,
  required?: Required[],
  chain: FeatureKey[] = [],
) {
  if (!required) {
    return;
  }

  const requiredKeys = required.map((r) => (typeof r === "string" ? r : r.key));

  if (requiredKeys.length === 0) {
    return;
  }

  for (const requiredKey of requiredKeys) {
    chain.push(requiredKey);

    if (chain.indexOf(featureKey) > -1) {
      throw new Error(`circular dependency found: ${chain.join(" -> ")}`);
    }

    const requiredFeatureExists = datasource.entityExists("feature", requiredKey);

    if (!requiredFeatureExists) {
      throw new Error(`required feature "${requiredKey}" not found`);
    }

    const requiredParsedFeature = datasource.readFeature(requiredKey);

    if (requiredParsedFeature.required) {
      checkForCircularDependencyInRequired(
        datasource,
        featureKey,
        requiredParsedFeature.required,
        chain,
      );
    }
  }
}

export async function lintProject(projectConfig: ProjectConfig): Promise<boolean> {
  let hasError = false;
  const datasource = new Datasource(projectConfig);

  const availableAttributeKeys: string[] = [];
  const availableSegmentKeys: string[] = [];
  const availableFeatureKeys: string[] = [];

  // lint attributes
  const attributes = datasource.listAttributes();
  console.log(`Linting ${attributes.length} attributes...\n`);

  const attributeJoiSchema = getAttributeJoiSchema();

  for (const key of attributes) {
    const parsed = datasource.readAttribute(key);
    availableAttributeKeys.push(key);

    try {
      await attributeJoiSchema.validateAsync(parsed);
    } catch (e) {
      console.log("  =>", key);

      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }
  }

  // lint segments
  const segments = datasource.listSegments();
  console.log(`\nLinting ${segments.length} segments...\n`);

  const conditionsJoiSchema = getConditionsJoiSchema(projectConfig, availableAttributeKeys);
  const segmentJoiSchema = getSegmentJoiSchema(projectConfig, conditionsJoiSchema);

  for (const key of segments) {
    const parsed = datasource.readSegment(key);
    availableSegmentKeys.push(key);

    try {
      await segmentJoiSchema.validateAsync(parsed);
    } catch (e) {
      console.log("  =>", key);

      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }
  }

  // lint groups

  if (fs.existsSync(projectConfig.groupsDirectoryPath)) {
    const groups = datasource.listGroups();
    console.log(`\nLinting ${groups.length} groups...\n`);

    // @TODO: feature it slots can be from availableFeatureKeys only
    const groupJoiSchema = getGroupJoiSchema(projectConfig, datasource, availableFeatureKeys);

    for (const key of groups) {
      const parsed = datasource.readGroup(key);

      try {
        await groupJoiSchema.validateAsync(parsed);
      } catch (e) {
        console.log("  =>", key);

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
  const features = datasource.listFeatures();
  console.log(`\nLinting ${features.length} features...\n`);

  const featureJoiSchema = getFeatureJoiSchema(
    projectConfig,
    conditionsJoiSchema,
    availableSegmentKeys,
    availableFeatureKeys,
  );

  for (const key of features) {
    const parsed = datasource.readFeature(key);
    availableFeatureKeys.push(key);

    try {
      await featureJoiSchema.validateAsync(parsed);
    } catch (e) {
      console.log("  =>", key);

      if (e instanceof Joi.ValidationError) {
        printJoiError(e);
      } else {
        console.log(e);
      }

      hasError = true;
    }

    if (parsed.required) {
      try {
        checkForCircularDependencyInRequired(datasource, key, parsed.required);
      } catch (e) {
        console.log("  =>", key);
        console.log("     => Error:", e.message);
        hasError = true;
      }
    }
  }

  // lint tests
  if (fs.existsSync(projectConfig.testsDirectoryPath)) {
    const tests = datasource.listTests();
    console.log(`\nLinting ${tests.length} tests...\n`);

    const testsJoiSchema = getTestsJoiSchema(
      projectConfig,
      availableFeatureKeys,
      availableSegmentKeys,
    );

    for (const key of tests) {
      const parsed = datasource.readTest(key);

      try {
        await testsJoiSchema.validateAsync(parsed);
      } catch (e) {
        console.log("  =>", key);

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
