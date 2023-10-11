// for use in node only
import * as fs from "fs";

import * as Joi from "joi";

import { Datasource } from "../datasource/datasource";
import { ProjectConfig } from "../config";

import { getAttributeJoiSchema } from "./attributeSchema";
import { getConditionsJoiSchema } from "./conditionSchema";
import { getSegmentJoiSchema } from "./segmentSchema";
import { getGroupJoiSchema } from "./groupSchema";
import { getFeatureJoiSchema } from "./featureSchema";
import { getTestsJoiSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { printJoiError } from "./printJoiError";

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
