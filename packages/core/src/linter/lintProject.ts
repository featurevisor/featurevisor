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

export interface LintProjectOptions {
  keyPattern?: string;
  entityType?: string;
}

export async function lintProject(
  deps: Dependencies,
  options: LintProjectOptions = {},
): Promise<boolean> {
  const { projectConfig, datasource } = deps;

  let hasError = false;

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

  const keyPattern = options.keyPattern ? new RegExp(options.keyPattern) : null;

  if (keyPattern) {
    console.log("");
    console.log(`Linting only keys matching pattern: ${keyPattern}`);
    console.log("");
  }

  // lint attributes
  const attributes = await datasource.listAttributes();
  const attributeZodSchema = getAttributeZodSchema();

  if (!options.entityType || options.entityType === "attribute") {
    const filteredKeys = !keyPattern
      ? attributes
      : attributes.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} attributes...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("attribute", key);

      try {
        const parsed = await datasource.readAttribute(key);

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
  }

  // lint segments
  const segments = await datasource.listSegments();
  const conditionsZodSchema = getConditionsZodSchema(
    projectConfig,
    attributes as [string, ...string[]],
  );
  const segmentZodSchema = getSegmentZodSchema(projectConfig, conditionsZodSchema);

  if (!options.entityType || options.entityType === "segment") {
    const filteredKeys = !keyPattern ? segments : segments.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} segments...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("segment", key);

      try {
        const parsed = await datasource.readSegment(key);

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
  }

  // lint features
  const features = await datasource.listFeatures();
  const featureZodSchema = getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    attributes as [string, ...string[]],
    segments as [string, ...string[]],
    features as [string, ...string[]],
  );

  if (!options.entityType || options.entityType === "feature") {
    const filteredKeys = !keyPattern ? features : features.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} features...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("feature", key);
      let parsed;

      try {
        parsed = await datasource.readFeature(key);

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
  }

  // lint groups
  const groups = await datasource.listGroups();
  const groupZodSchema = getGroupZodSchema(projectConfig, datasource, features);

  if (!options.entityType || options.entityType === "group") {
    const filteredKeys = !keyPattern ? groups : groups.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} groups...\n`);
    }

    for (const key of filteredKeys) {
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
          await checkForFeatureExceedingGroupSlotPercentage(datasource, parsed, features);
        } catch (e) {
          console.log(CLI_FORMAT_UNDERLINE, fullPath);
          console.log(CLI_FORMAT_RED, `  => Error: ${e.message}`);
          hasError = true;
        }
      }
    }
  }

  // @TODO: feature cannot exist in multiple groups

  // lint tests
  const tests = await datasource.listTests();

  const testsZodSchema = getTestsZodSchema(
    projectConfig,
    features as [string, ...string[]],
    segments as [string, ...string[]],
  );

  if (!options.entityType || options.entityType === "test") {
    const filteredKeys = !keyPattern ? tests : tests.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} tests...\n`);
    }

    for (const key of filteredKeys) {
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
  }

  return hasError;
}
