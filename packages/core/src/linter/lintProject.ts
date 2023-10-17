// for use in node only
import * as Joi from "joi";

import { getAttributeJoiSchema } from "./attributeSchema";
import { getConditionsJoiSchema } from "./conditionSchema";
import { getSegmentJoiSchema } from "./segmentSchema";
import { getGroupJoiSchema } from "./groupSchema";
import { getFeatureJoiSchema } from "./featureSchema";
import { getTestsJoiSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { printJoiError } from "./printJoiError";
import { Dependencies } from "../dependencies";

export async function lintProject(deps: Dependencies): Promise<boolean> {
  const { projectConfig, datasource } = deps;

  let hasError = false;

  const availableAttributeKeys: string[] = [];
  const availableSegmentKeys: string[] = [];
  const availableFeatureKeys: string[] = [];

  // lint attributes
  const attributes = await datasource.listAttributes();
  console.log(`Linting ${attributes.length} attributes...\n`);

  const attributeJoiSchema = getAttributeJoiSchema();

  for (const key of attributes) {
    const parsed = await datasource.readAttribute(key);
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
  const segments = await datasource.listSegments();
  console.log(`\nLinting ${segments.length} segments...\n`);

  const conditionsJoiSchema = getConditionsJoiSchema(projectConfig, availableAttributeKeys);
  const segmentJoiSchema = getSegmentJoiSchema(projectConfig, conditionsJoiSchema);

  for (const key of segments) {
    const parsed = await datasource.readSegment(key);
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

  // lint features
  const features = await datasource.listFeatures();
  console.log(`\nLinting ${features.length} features...\n`);

  const featureJoiSchema = getFeatureJoiSchema(
    projectConfig,
    conditionsJoiSchema,
    availableSegmentKeys,
    availableFeatureKeys,
  );

  for (const key of features) {
    const parsed = await datasource.readFeature(key);
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
        await checkForCircularDependencyInRequired(datasource, key, parsed.required);
      } catch (e) {
        console.log("  =>", key);
        console.log("     => Error:", e.message);
        hasError = true;
      }
    }
  }

  // lint groups
  const groups = await datasource.listGroups();
  console.log(`\nLinting ${groups.length} groups...\n`);

  // @TODO: feature it slots can be from availableFeatureKeys only
  const groupJoiSchema = getGroupJoiSchema(projectConfig, datasource, availableFeatureKeys);

  for (const key of groups) {
    const parsed = await datasource.readGroup(key);

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

  // @TODO: feature cannot exist in multiple groups

  // lint tests
  const tests = await datasource.listTests();
  console.log(`\nLinting ${tests.length} tests...\n`);

  const testsJoiSchema = getTestsJoiSchema(
    projectConfig,
    availableFeatureKeys,
    availableSegmentKeys,
  );

  for (const key of tests) {
    const parsed = await datasource.readTest(key);

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

  return hasError;
}
