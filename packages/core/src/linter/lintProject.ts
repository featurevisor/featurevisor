// for use in node only
import * as path from "path";

import { getAttributeZodSchema } from "./attributeSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { getSegmentZodSchema } from "./segmentSchema";
import { getGroupZodSchema } from "./groupSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getTestsZodSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { checkForFeatureExceedingGroupSlotPercentage } from "./checkPercentageExceedingSlot";
import { printZodError } from "./printError";
import { Dependencies } from "../dependencies";
import { CLI_FORMAT_RED, CLI_FORMAT_UNDERLINE } from "../tester/cliFormat";

export async function lintProject(deps: Dependencies): Promise<boolean> {
  const { projectConfig, datasource } = deps;

  let hasError = false;

  const availableAttributeKeys: string[] = [];
  const availableSegmentKeys: string[] = [];
  const availableFeatureKeys: string[] = [];

  function getFullPathFromKey(type: string, key: string, relative = false) {
    const fileName = `${key}.${datasource.getExtension()}`;
    let fullPath = "";

    if (type === "attribute") {
      fullPath = path.join(projectConfig.attributesDirectoryPath, fileName);
    } else if (type === "segment") {
      fullPath = path.join(projectConfig.segmentsDirectoryPath, fileName);
    } else if (type === "feature") {
      fullPath = path.join(projectConfig.featuresDirectoryPath, fileName);
    } else if (type === "group") {
      fullPath = path.join(projectConfig.groupsDirectoryPath, fileName);
    } else if (type === "test") {
      fullPath = path.join(projectConfig.testsDirectoryPath, fileName);
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    if (relative) {
      fullPath = path.relative(process.cwd(), fullPath);
    }

    return fullPath;
  }

  // lint attributes
  const attributes = await datasource.listAttributes();
  console.log(`Linting ${attributes.length} attributes...\n`);

  const attributeZodSchema = getAttributeZodSchema();

  for (const key of attributes) {
    const fullPath = getFullPathFromKey("attribute", key);

    try {
      const parsed = await datasource.readAttribute(key);
      availableAttributeKeys.push(key);

      const result = attributeZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log(CLI_FORMAT_UNDERLINE, fullPath);
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
    const fullPath = getFullPathFromKey("segment", key);

    try {
      const parsed = await datasource.readSegment(key);
      availableSegmentKeys.push(key);

      const result = segmentZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log(CLI_FORMAT_UNDERLINE, fullPath);
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
    availableAttributeKeys as [string, ...string[]],
    availableSegmentKeys as [string, ...string[]],
    features as [string, ...string[]],
  );

  for (const key of features) {
    const fullPath = getFullPathFromKey("feature", key);
    let parsed;

    try {
      parsed = await datasource.readFeature(key);
      availableFeatureKeys.push(key);

      const result = featureZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log(CLI_FORMAT_UNDERLINE, fullPath);
      console.log("");
      console.log(e);

      hasError = true;
    }

    if (parsed && parsed.required) {
      try {
        await checkForCircularDependencyInRequired(datasource, key, parsed.required);
      } catch (e) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);
        console.log(CLI_FORMAT_RED, `  => Error: ${e.message}`);
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
    const fullPath = getFullPathFromKey("group", key);
    let parsed;

    try {
      parsed = await datasource.readGroup(key);

      const result = groupZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);

        if ("error" in result) {
          printZodError(result.error);
        }

        hasError = true;
      }
    } catch (e) {
      console.log(CLI_FORMAT_UNDERLINE, fullPath);
      console.log("");
      console.log(e);

      hasError = true;
    }

    if (parsed) {
      try {
        await checkForFeatureExceedingGroupSlotPercentage(datasource, parsed, availableFeatureKeys);
      } catch (e) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);
        console.log(CLI_FORMAT_RED, `  => Error: ${e.message}`);
        hasError = true;
      }
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
    const fullPath = getFullPathFromKey("test", key);

    try {
      const parsed = await datasource.readTest(key);

      const result = testsZodSchema.safeParse(parsed);

      if (!result.success) {
        console.log(CLI_FORMAT_UNDERLINE, fullPath);

        if ("error" in result) {
          printZodError(result.error);

          process.exit(1);
        }

        hasError = true;
      }
    } catch (e) {
      console.log(CLI_FORMAT_UNDERLINE, fullPath);
      console.log("");
      console.log(e);

      hasError = true;
    }
  }

  return hasError;
}
