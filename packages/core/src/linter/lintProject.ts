// for use in node only
import * as fs from "fs";
import * as path from "path";

import type { Attribute, Schema } from "@featurevisor/types";
import type { ZodError } from "zod";

import { getAttributeZodSchema } from "./attributeSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { getSegmentZodSchema } from "./segmentSchema";
import { getGroupZodSchema } from "./groupSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { getSchemaZodSchema } from "./schema";
import { getTestsZodSchema } from "./testSchema";

import { checkForCircularDependencyInRequired } from "./checkCircularDependency";
import { checkForFeatureExceedingGroupSlotPercentage } from "./checkPercentageExceedingSlot";
import { getLintIssuesFromZodError, printZodError } from "./printError";
import { Dependencies } from "../dependencies";
import { CLI_FORMAT_BOLD_UNDERLINE, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "../tester/cliFormat";
import { Plugin } from "../cli";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";

export type LintEntityType = "attribute" | "segment" | "feature" | "group" | "schema" | "test";

export interface LintProjectOptions {
  keyPattern?: string;
  entityType?: string;
  authors?: boolean;
  json?: boolean;
  pretty?: boolean;
}

export interface LintErrorItem {
  filePath: string;
  entityType: LintEntityType;
  key: string;
  message: string;
  path: (string | number)[];
  code?: string;
  value?: unknown;
}

export interface LintResult {
  hasError: boolean;
  errors: LintErrorItem[];
}

const ENTITY_NAME_REGEX = /^[a-zA-Z0-9_\-./]+$/;
const ENTITY_NAME_REGEX_ERROR =
  "Names must be alphanumeric and can contain _, -, /, ., and the configured namespace character";

const ATTRIBUTE_NAME_REGEX_ERROR =
  "Names must be alphanumeric and can contain _, -, /, ., and the configured namespace character";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidEntityKey(key: string, namespaceCharacter: string): boolean {
  const keyWithoutNamespaceCharacter = key.replace(
    new RegExp(escapeRegExp(namespaceCharacter), "g"),
    "",
  );

  return ENTITY_NAME_REGEX.test(keyWithoutNamespaceCharacter);
}

function getPathSegmentsFromKey(
  key: string,
  namespaceCharacter: string,
  entityType?: LintEntityType,
): string[] {
  const pathSegments = key.split(namespaceCharacter);

  if (
    entityType === "test" &&
    pathSegments.length > 1 &&
    ["spec", "feature", "segment"].includes(pathSegments[pathSegments.length - 1])
  ) {
    const suffix = pathSegments[pathSegments.length - 1];
    pathSegments[pathSegments.length - 2] = `${pathSegments[pathSegments.length - 2]}.${suffix}`;
    pathSegments.pop();
  }

  return pathSegments;
}

function getReservedNameCheckValue(
  entityType: LintEntityType,
  name: string,
  isFile: boolean,
  extension: string,
): string {
  let value =
    isFile && name.endsWith(`.${extension}`) ? name.slice(0, -extension.length - 1) : name;

  if (entityType === "test" && isFile) {
    for (const suffix of [".spec", ".feature", ".segment"]) {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length);
        break;
      }
    }
  }

  return value;
}

async function getAuthorsOfEntity(datasource, entityType, entityKey): Promise<string[]> {
  const entries = await datasource.listHistoryEntries(entityType, entityKey);
  const authors: string[] = Array.from(new Set(entries.map((entry) => entry.author)));

  return authors;
}

function collectExplicitAttributePaths(
  attributeKey: string,
  attribute: Attribute,
  result: Set<string>,
): void {
  result.add(attributeKey);

  function visit(prefix: string, schema: Attribute | Attribute["properties"][string]) {
    if (!schema || schema.type !== "object" || !schema.properties) {
      return;
    }

    for (const propertyKey of Object.keys(schema.properties)) {
      const propertyPath = `${prefix}.${propertyKey}`;
      result.add(propertyPath);
      visit(propertyPath, schema.properties[propertyKey]);
    }
  }

  visit(attributeKey, attribute);
}

export async function lintProject(
  deps: Dependencies,
  options: LintProjectOptions = {},
): Promise<LintResult> {
  const { projectConfig, datasource } = deps;

  const isJsonMode = options.json === true;
  const errors: LintErrorItem[] = [];

  function log(...args: unknown[]) {
    if (!isJsonMode) {
      console.log(...args);
    }
  }

  function getFullPathFromKey(type: LintEntityType, key: string, relative = false) {
    const fileName = `${getPathSegmentsFromKey(key, projectConfig.namespaceCharacter, type).join(
      path.sep,
    )}.${datasource.getExtension()}`;
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
    } else {
      fullPath = path.join(projectConfig.testsDirectoryPath, fileName);
    }

    if (relative) {
      fullPath = path.relative(process.cwd(), fullPath);
    }

    return fullPath;
  }

  function getEntityDirectoryPath(type: LintEntityType): string {
    if (type === "attribute") {
      return projectConfig.attributesDirectoryPath;
    }
    if (type === "segment") {
      return projectConfig.segmentsDirectoryPath;
    }
    if (type === "feature") {
      return projectConfig.featuresDirectoryPath;
    }
    if (type === "group") {
      return projectConfig.groupsDirectoryPath;
    }
    if (type === "schema") {
      return projectConfig.schemasDirectoryPath;
    }

    return projectConfig.testsDirectoryPath;
  }

  async function lintReservedNamespaceCharacterInPathNames(
    entityType: LintEntityType,
    directoryPath: string,
  ) {
    if (!fs.existsSync(directoryPath)) {
      return;
    }

    const extension = datasource.getExtension();
    const namespaceCharacter = projectConfig.namespaceCharacter;
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      const isFile = entry.isFile();
      const isDirectory = entry.isDirectory();

      if (!isDirectory && !(isFile && entry.name.endsWith(`.${extension}`))) {
        continue;
      }

      const nameToCheck = getReservedNameCheckValue(entityType, entry.name, isFile, extension);

      if (nameToCheck.includes(namespaceCharacter)) {
        await reportSimpleError({
          entityType,
          key: path.relative(getEntityDirectoryPath(entityType), entryPath),
          fullPath: entryPath,
          message: `Invalid file or directory name: "${entry.name}"`,
          detail: `Namespace character "${namespaceCharacter}" is not allowed in entity file or directory names.`,
          code: "invalid_name",
        });
      }

      if (isDirectory) {
        await lintReservedNamespaceCharacterInPathNames(entityType, entryPath);
      }
    }
  }

  async function lintReservedNamespaceCharacterInEntityPaths(entityType: LintEntityType) {
    await lintReservedNamespaceCharacterInPathNames(entityType, getEntityDirectoryPath(entityType));
  }

  async function printEntityHeader(entityType: LintEntityType, key: string, fullPath: string) {
    if (isJsonMode) {
      return;
    }

    console.log(CLI_FORMAT_BOLD_UNDERLINE, fullPath);

    if (options.authors) {
      const authors = await getAuthorsOfEntity(datasource, entityType, key);
      console.log(`     Authors: ${authors.join(", ")}\n`);
    }
  }

  function recordError(error: LintErrorItem) {
    errors.push(error);
  }

  async function reportSimpleError({
    entityType,
    key,
    fullPath,
    message,
    detail,
    pathParts = [],
    code,
    value,
  }: {
    entityType: LintEntityType;
    key: string;
    fullPath: string;
    message: string;
    detail?: string;
    pathParts?: (string | number)[];
    code?: string;
    value?: unknown;
  }) {
    recordError({
      filePath: path.relative(process.cwd(), fullPath),
      entityType,
      key,
      message,
      path: pathParts,
      code,
      value,
    });

    if (!isJsonMode) {
      await printEntityHeader(entityType, key, fullPath);
      console.log(CLI_FORMAT_RED, `  => Error: ${message}`);
      if (detail) {
        console.log(CLI_FORMAT_RED, `     ${detail}`);
      }
      console.log("");
    }
  }

  async function reportThrownError(
    entityType: LintEntityType,
    key: string,
    fullPath: string,
    error: unknown,
  ) {
    const pathFromError =
      error &&
      typeof error === "object" &&
      "featurevisorFilePath" in error &&
      typeof error.featurevisorFilePath === "string"
        ? error.featurevisorFilePath
        : undefined;
    const targetPath = pathFromError || fullPath;
    const message = error instanceof Error ? error.message : String(error);

    recordError({
      filePath: path.relative(process.cwd(), targetPath),
      entityType,
      key,
      message,
      path: [],
      code: error instanceof Error ? error.name : undefined,
    });

    if (!isJsonMode) {
      await printEntityHeader(entityType, key, targetPath);
      console.log("");
      console.log(error);
    }
  }

  async function reportZodValidationError(
    entityType: LintEntityType,
    key: string,
    fullPath: string,
    error: ZodError,
  ) {
    const issues = getLintIssuesFromZodError(error);

    const issuesWithTargetPath: {
      issue: (typeof issues)[0];
      targetPath: string;
      pathRelativeToFile: (string | number)[];
    }[] = [];
    for (const issue of issues) {
      const targetPath = fullPath;
      const pathRelativeToFile = issue.path;
      issuesWithTargetPath.push({ issue, targetPath, pathRelativeToFile });

      recordError({
        filePath: path.relative(process.cwd(), targetPath),
        entityType,
        key,
        message: issue.message,
        path: pathRelativeToFile,
        code: issue.code,
        value: issue.value,
      });
    }

    if (!isJsonMode) {
      if (entityType === "feature" && issuesWithTargetPath.length > 0) {
        const byPath = new Map<
          string,
          {
            issue: (typeof issuesWithTargetPath)[0]["issue"];
            pathRelativeToFile: (string | number)[];
          }[]
        >();
        for (const { issue, targetPath, pathRelativeToFile } of issuesWithTargetPath) {
          const pathKey = targetPath;
          if (!byPath.has(pathKey)) byPath.set(pathKey, []);
          byPath.get(pathKey)!.push({ issue, pathRelativeToFile });
        }
        for (const [targetPathKey, groupItems] of byPath) {
          await printEntityHeader(entityType, key, targetPathKey);
          for (const { issue, pathRelativeToFile } of groupItems) {
            console.log(CLI_FORMAT_RED, `  => Error: ${issue.message}`);
            console.log("     Path:", pathRelativeToFile.join("."));
            if (typeof issue.value !== "undefined" && issue.value !== "undefined") {
              console.log("     Value:", issue.value);
            }
            console.log("");
          }
        }
      } else {
        await printEntityHeader(entityType, key, fullPath);
        printZodError(error);
      }
    }
  }

  const keyPattern = options.keyPattern ? new RegExp(options.keyPattern) : null;

  if (keyPattern) {
    log("");
    log(`Linting only keys matching pattern: ${keyPattern}`);
    log("");
  }

  // List schemas and load parsed schemas for attribute and feature validation.
  const schemas = await datasource.listSchemas();
  const schemasByKey: Record<string, Schema> = {};
  for (const key of schemas) {
    try {
      schemasByKey[key] = await datasource.readSchema(key);
    } catch {
      // Schema file may be invalid; skip for cross-entity resolution and let schema linting report it.
    }
  }

  // lint attributes
  const attributes = await datasource.listAttributes();
  const attributeZodSchema = getAttributeZodSchema();
  const attributesByKey: Record<string, Attribute> = {};

  for (const key of attributes) {
    try {
      attributesByKey[key] = await datasource.readAttribute(key);
    } catch {
      // Attribute read failures are reported during attribute linting below.
    }
  }

  if (!options.entityType || options.entityType === "attribute") {
    await lintReservedNamespaceCharacterInEntityPaths("attribute");

    const filteredKeys = !keyPattern
      ? attributes
      : attributes.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} attributes...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("attribute", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "attribute",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ATTRIBUTE_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = attributesByKey[key] ?? (await datasource.readAttribute(key));
        const result = attributeZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("attribute", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("attribute", key, fullPath, error);
      }
    }
  }

  const explicitAttributePaths = new Set<string>();
  for (const key of attributes) {
    const parsed = attributesByKey[key];
    if (!parsed) {
      continue;
    }

    collectExplicitAttributePaths(key, parsed, explicitAttributePaths);
  }
  const flattenedAttributes = Array.from(explicitAttributePaths);

  // lint segments
  const segments = await datasource.listSegments();
  const conditionsZodSchema = getConditionsZodSchema(projectConfig, attributesByKey, schemasByKey);
  const segmentZodSchema = getSegmentZodSchema(projectConfig, conditionsZodSchema);

  if (!options.entityType || options.entityType === "segment") {
    await lintReservedNamespaceCharacterInEntityPaths("segment");

    const filteredKeys = !keyPattern ? segments : segments.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} segments...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("segment", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "segment",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = await datasource.readSegment(key);
        const result = segmentZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("segment", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("segment", key, fullPath, error);
      }
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
    await lintReservedNamespaceCharacterInEntityPaths("feature");

    const filteredKeys = !keyPattern ? features : features.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} features...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("feature", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "feature",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      let parsed;

      try {
        parsed = await datasource.readFeature(key);

        const result = featureZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("feature", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("feature", key, fullPath, error);
      }

      if (parsed && parsed.required) {
        try {
          await checkForCircularDependencyInRequired(datasource, key, parsed.required);
        } catch (error) {
          await reportSimpleError({
            entityType: "feature",
            key,
            fullPath,
            message: error instanceof Error ? error.message : String(error),
            code: error instanceof Error ? error.name : "error",
          });
        }
      }
    }
  }

  // lint groups
  const groups = await datasource.listGroups();
  const groupZodSchema = getGroupZodSchema(projectConfig, datasource, features);

  if (!options.entityType || options.entityType === "group") {
    await lintReservedNamespaceCharacterInEntityPaths("group");

    const filteredKeys = !keyPattern ? groups : groups.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} groups...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("group", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "group",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      let parsed;

      try {
        parsed = await datasource.readGroup(key);

        const result = groupZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("group", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("group", key, fullPath, error);
      }

      if (parsed) {
        try {
          await checkForFeatureExceedingGroupSlotPercentage(datasource, parsed, features);
        } catch (error) {
          await reportSimpleError({
            entityType: "group",
            key,
            fullPath,
            message: error instanceof Error ? error.message : String(error),
            code: error instanceof Error ? error.name : "error",
          });
        }
      }
    }
  }

  // @TODO: feature cannot exist in multiple groups

  // lint schemas (schemas and schemasByKey already loaded above for feature linting)
  const schemaZodSchema = getSchemaZodSchema(schemas);

  if (!options.entityType || options.entityType === "schema") {
    await lintReservedNamespaceCharacterInEntityPaths("schema");

    const filteredKeys = !keyPattern ? schemas : schemas.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} schemas...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("schema", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "schema",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = await datasource.readSchema(key);

        const result = schemaZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("schema", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("schema", key, fullPath, error);
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
    await lintReservedNamespaceCharacterInEntityPaths("test");

    const filteredKeys = !keyPattern ? tests : tests.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      log(`Linting ${filteredKeys.length} tests...\n`);
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("test", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "test",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = await datasource.readTest(key);

        const result = testsZodSchema.safeParse(parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("test", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("test", key, fullPath, error);
      }
    }
  }

  return {
    hasError: errors.length > 0,
    errors,
  };
}

export const lintPlugin: Plugin = {
  command: "lint",
  handler: async function (options) {
    const { rootDirectoryPath, projectConfig, datasource, parsed } = options;

    assertProjectSetJsonSelection(projectConfig, parsed.set, parsed.json);

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);
    let hasError = false;

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set, parsed.json);

      const result = await lintProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        {
          keyPattern: parsed.keyPattern,
          entityType: parsed.entityType,
          authors: parsed.authors,
          json: parsed.json,
          pretty: parsed.pretty,
        },
      );

      if (parsed.json) {
        const payload = { errors: result.errors };
        console.log(parsed.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
      }

      if (result.hasError) {
        hasError = true;
      }
    }

    if (hasError) {
      return false;
    }

    if (!parsed.json) {
      console.log("");
      console.log(CLI_FORMAT_GREEN, "✔ No lint errors found");
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
    {
      command: "lint --json",
      description: "print lint errors as JSON",
    },
    {
      command: "lint --json --pretty",
      description: "print lint errors as pretty JSON",
    },
  ],
};
