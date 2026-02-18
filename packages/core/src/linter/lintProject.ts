// for use in node only
import * as path from "path";

import type { Schema } from "@featurevisor/types";

import { getAttributeZodSchema } from "./attributeSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { getSegmentZodSchema } from "./segmentSchema";
import { getGroupZodSchema } from "./groupSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getSchemaZodSchema } from "./schema";
import { getTestsZodSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { checkForFeatureExceedingGroupSlotPercentage } from "./checkPercentageExceedingSlot";
import { printZodError } from "./printError";
import { Dependencies } from "../dependencies";
import { CLI_FORMAT_RED, CLI_FORMAT_BOLD_UNDERLINE } from "../tester/cliFormat";
import { Plugin } from "../cli";

export interface LintProjectOptions {
  keyPattern?: string;
  entityType?: string;
  authors?: boolean;
}

const ENTITY_NAME_REGEX = /^[a-zA-Z0-9_\-./]+$/;
const ENTITY_NAME_REGEX_ERROR = "Names must be alphanumeric and can contain _, -, and .";

const ATTRIBUTE_NAME_REGEX = /^[a-zA-Z0-9_\-/]+$/;
const ATTRIBUTE_NAME_REGEX_ERROR = "Names must be alphanumeric and can contain _, and -";

async function getAuthorsOfEntity(datasource, entityType, entityKey): Promise<string[]> {
  const entries = await datasource.listHistoryEntries(entityType, entityKey);
  const authors: string[] = Array.from(new Set(entries.map((entry) => entry.author)));

  return authors;
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
    } else if (type === "schema") {
      fullPath = path.join(projectConfig.schemasDirectoryPath, fileName);
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

      if (!ATTRIBUTE_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "attribute", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);
        console.log(CLI_FORMAT_RED, `     ${ATTRIBUTE_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      try {
        const parsed = await datasource.readAttribute(key);

        const result = attributeZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "attribute", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "attribute", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }
    }
  }

  const flattenedAttributes = await datasource.listFlattenedAttributes();

  // lint segments
  const segments = await datasource.listSegments();
  const conditionsZodSchema = getConditionsZodSchema(
    projectConfig,
    flattenedAttributes as [string, ...string[]],
  );
  const segmentZodSchema = getSegmentZodSchema(projectConfig, conditionsZodSchema);

  if (!options.entityType || options.entityType === "segment") {
    const filteredKeys = !keyPattern ? segments : segments.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} segments...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("segment", key);

      if (!ENTITY_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "segment", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);
        console.log(CLI_FORMAT_RED, `     ${ENTITY_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      try {
        const parsed = await datasource.readSegment(key);

        const result = segmentZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "segment", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "segment", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }
    }
  }

  // List schemas and load parsed schemas for feature variable validation (schema references)
  const schemas = await datasource.listSchemas();
  const schemasByKey: Record<string, Schema> = {};
  for (const key of schemas) {
    try {
      schemasByKey[key] = await datasource.readSchema(key);
    } catch {
      // Schema file may be invalid; skip for feature variable resolution
    }
  }

  // lint features
  const features = await datasource.listFeatures();
  const featureZodSchema = getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    flattenedAttributes as [string, ...string[]],
    segments as [string, ...string[]],
    features as [string, ...string[]],
    schemas,
    schemasByKey,
  );

  if (!options.entityType || options.entityType === "feature") {
    const filteredKeys = !keyPattern ? features : features.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} features...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("feature", key);

      if (!ENTITY_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "feature", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);
        console.log(CLI_FORMAT_RED, `     ${ENTITY_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      let parsed;

      try {
        parsed = await datasource.readFeature(key);

        const result = featureZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "feature", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "feature", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }

      if (parsed && parsed.required) {
        try {
          await checkForCircularDependencyInRequired(datasource, key, parsed.required);
        } catch (e) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "feature", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

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

      if (!ENTITY_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);
        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "group", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `     ${ENTITY_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      let parsed;

      try {
        parsed = await datasource.readGroup(key);

        const result = groupZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "group", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "group", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }

      if (parsed) {
        try {
          await checkForFeatureExceedingGroupSlotPercentage(datasource, parsed, features);
        } catch (e) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);
          console.log(CLI_FORMAT_RED, `  => Error: ${e.message}`);
          hasError = true;
        }
      }
    }
  }

  // @TODO: feature cannot exist in multiple groups

  // lint schemas (schemas and schemasByKey already loaded above for feature linting)
  const schemaZodSchema = getSchemaZodSchema(schemas);

  if (!options.entityType || options.entityType === "schema") {
    const filteredKeys = !keyPattern ? schemas : schemas.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      console.log(`Linting ${filteredKeys.length} schemas...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("schema", key);

      if (!ENTITY_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "schema", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);
        console.log(CLI_FORMAT_RED, `     ${ENTITY_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      try {
        const parsed = await datasource.readSchema(key);

        const result = schemaZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "schema", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "schema", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }
    }
  }

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

      if (!ENTITY_NAME_REGEX.test(key)) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "test", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log(CLI_FORMAT_RED, `  => Error: Invalid name: "${key}"`);
        console.log(CLI_FORMAT_RED, `     ${ENTITY_NAME_REGEX_ERROR}`);
        console.log("");
        hasError = true;
      }

      try {
        const parsed = await datasource.readTest(key);

        const result = testsZodSchema.safeParse(parsed);

        if (!result.success) {
          console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

          if (options.authors) {
            const authors = await getAuthorsOfEntity(datasource, "test", key);
            console.log(`     Authors: ${authors.join(", ")}\n`);
          }

          if ("error" in result) {
            printZodError(result.error);

            process.exit(1);
          }

          hasError = true;
        }
      } catch (e) {
        console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

        if (options.authors) {
          const authors = await getAuthorsOfEntity(datasource, "test", key);
          console.log(`     Authors: ${authors.join(", ")}\n`);
        }

        console.log("");
        console.log(e);

        hasError = true;
      }
    }
  }

  return hasError;
}

export const lintPlugin: Plugin = {
  command: "lint",
  handler: async function (options) {
    const { rootDirectoryPath, projectConfig, datasource, parsed } = options;

    const hasError = await lintProject(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      {
        keyPattern: parsed.keyPattern,
        entityType: parsed.entityType,
        authors: parsed.authors,
      },
    );

    if (hasError) {
      return false;
    }
  },
  examples: [
    {
      command: "lint",
      description: "lint all entities",
    },
    {
      command: "lint --entityType=feature",
      description: "lint only features",
    },
    {
      command: "lint --entityType=segment",
      description: "lint only segments",
    },
    {
      command: "lint --entityType=group",
      description: "lint only groups",
    },
    {
      command: "lint --entityType=schema",
      description: "lint only schemas",
    },
    {
      command: "lint --entityType=test",
      description: "lint only tests",
    },
    {
      command: 'lint --keyPattern="abc"',
      description: `lint only entities with keys containing "abc"`,
    },
  ],
};
