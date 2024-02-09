// for use in node only
import * as Joi from "joi";

import { getAttributeZodSchema } from "./attributeSchema";
import { getConditionsZodSchema, getConditionsJoiSchema } from "./conditionSchema";
import { getSegmentZodSchema } from "./segmentSchema";
import { getGroupZodSchema } from "./groupSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getTestsZodSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { printZodError } from "./printError";
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

  const attributeZodSchema = getAttributeZodSchema();

  for (const key of attributes) {
    try {
      const parsed = await datasource.readAttribute(key);
      availableAttributeKeys.push(key);

      const result = attributeZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log("  =>", key);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log("  =>", key);
      console.log("");
      console.log(e);

      hasError = true;
    }
  }

  // lint segments
  const segments = await datasource.listSegments();
  console.log(`\nLinting ${segments.length} segments...\n`);

  const conditionsZodSchema = getConditionsZodSchema(
    projectConfig,
    availableAttributeKeys as [string, ...string[]],
  );
  const segmentZodSchema = getSegmentZodSchema(projectConfig, conditionsZodSchema);

  for (const key of segments) {
    try {
      const parsed = await datasource.readSegment(key);
      availableSegmentKeys.push(key);

      const result = segmentZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log("  =>", key);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log("  =>", key);
      console.log("");
      console.log(e);

      hasError = true;
    }
  }

  // lint features
  const features = await datasource.listFeatures();
  console.log(`\nLinting ${features.length} features...\n`);

  const featureZodSchema = getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    availableSegmentKeys as [string, ...string[]],
    availableFeatureKeys as [string, ...string[]],
  );

  for (const key of features) {
    let parsed;

    try {
      parsed = await datasource.readFeature(key);
      availableFeatureKeys.push(key);

      const result = featureZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log("  =>", key);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log("  =>", key);
      console.log("");
      console.log(e);

      hasError = true;
    }

    if (parsed && parsed.required) {
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
  const groupZodSchema = getGroupZodSchema(projectConfig, datasource, availableFeatureKeys);

  for (const key of groups) {
    try {
      const parsed = await datasource.readGroup(key);

      const result = groupZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log("  =>", key);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log("  =>", key);
      console.log("");
      console.log(e);

      hasError = true;
    }
  }

  // @TODO: feature cannot exist in multiple groups

  // lint tests
  const tests = await datasource.listTests();
  console.log(`\nLinting ${tests.length} tests...\n`);

  const testsZodSchema = getTestsZodSchema(
    projectConfig,
    availableFeatureKeys as [string, ...string[]],
    availableSegmentKeys as [string, ...string[]],
  );

  for (const key of tests) {
    try {
      const parsed = await datasource.readTest(key);

      const result = testsZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log("  =>", key);

        if ("error" in result) {
          printZodError(result.error);

          process.exit(1);
        }

        hasError = true;
      }
    } catch (e) {
      console.log("  =>", key);
      console.log("");
      console.log(e);

      hasError = true;
    }
  }

  return hasError;
}
