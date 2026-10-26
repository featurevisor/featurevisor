// for use in node only
import * as fs from "fs";
import * as path from "path";

import type {
  Attribute,
  ParsedFeature,
  Segment,
  ParsedVariable,
  Schema,
  Target,
} from "@featurevisor/types";
import type { ZodError } from "zod";

import { getAttributeZodSchema } from "./attributeSchema";
import { getConditionsZodSchema } from "./conditionSchema";
import { getArchivedReferenceIssues, getDeprecatedReferenceWarnings } from "./definitionReferences";
import type { ReferenceIndex, ReferringEntityType } from "./definitionReferences";
import { getConditionKindIssues } from "./conditionKinds";
import { getSegmentZodSchema } from "./segmentSchema";
import { getFeatureZodSchema } from "./featureSchema";
import { assertNoLegacyDatasourceGroups } from "../config/removedGroups";
import { getSchemaZodSchema } from "./schema";
import { getScenariosZodSchema, getTestsZodSchema } from "./testSchema";
import { getTargetZodSchema } from "./targetSchema";
import { describeSchemaV2TargetIssue, findSchemaV2TargetIssues } from "./schemaV2Targets";
import { getVariableZodSchema } from "./variableSchema";

import { getLintIssuesFromZodError, printLintIssues } from "./printError";
import { Dependencies } from "../dependencies";
import { CLI_FORMAT_BOLD_UNDERLINE, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "../tester/cliFormat";
import { Plugin } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import {
  isDependencyCycleError,
  findDependencyCycles,
  buildDependencyGraph,
} from "../datasource/dependencies";
import { DEFAULT_RESERVED_KEYS } from "../config";
import { estimateDependencyExpansion } from "./requiredVariableCost";
import { findInheritedPropertyNames, getInheritedPropertyNameError } from "./reservedNames";
import {
  DEPENDENCY_HANDOFF_LIMIT,
  PORTABLE_DEPENDENCY_HANDOFFS,
  describeDependencyChain,
  findDeepDependencyChains,
} from "./dependencyDepth";
import { getMutationOrderChanges } from "./mutationOrder";
import { getTestContextWarnings } from "./contextWarnings";
import { createCompositionWarningInspector } from "./compositionWarnings";
import { diagnosticParseOptions } from "./diagnostics";
import { EntityParseError } from "../datasource/parseError";
import {
  ATTRIBUTE_NAMESPACE_MESSAGE,
  AttributeNamespaceError,
} from "../datasource/attributeNamespaces";

export type LintEntityType =
  | "attribute"
  | "segment"
  | "feature"
  | "schema"
  | "target"
  | "variable"
  | "test"
  | "scenario";

export interface LintProjectOptions {
  keyPattern?: string;
  entityType?: string;
  authors?: boolean;
  json?: boolean;
  pretty?: boolean;
  v3MutationOrder?: boolean;
  verbose?: boolean;
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
  warnings?: LintErrorItem[];
}

const ENTITY_NAME_REGEX = /^[a-zA-Z0-9_\-./]+$/;
const ENTITY_NAME_REGEX_ERROR =
  "Names must be alphanumeric and can contain _, -, /, ., and the configured namespace character";

const ATTRIBUTE_NAME_REGEX = /^[a-zA-Z0-9_\-]+$/;
const ATTRIBUTE_NAME_REGEX_ERROR =
  "Attribute names must be alphanumeric and can contain _ and -. Dots, directory separators and the configured namespace character are not allowed.";

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

function isReservedKey(key: string, reservedKeys: string[]): boolean {
  return reservedKeys.includes(key);
}

function getPathSegmentsFromKey(
  key: string,
  namespaceCharacter: string,
  entityType?: LintEntityType,
): string[] {
  const pathSegments = key.split(namespaceCharacter);

  if (
    (entityType === "test" || entityType === "scenario") &&
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

  if ((entityType === "test" || entityType === "scenario") && isFile) {
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
  await assertNoLegacyDatasourceGroups(datasource);

  const isJsonMode = options.json === true;
  const errors: LintErrorItem[] = [];
  const warnings: LintErrorItem[] = [];
  const reportedParseErrors = new Set<string>();

  function log(...args: unknown[]) {
    if (!isJsonMode) {
      console.log(...args);
    }
  }

  function logProgress(count: number, entityType: LintEntityType) {
    log(`Linting ${count} ${entityType}${count === 1 ? "" : "s"}...\n`);
  }

  function getFullPathFromKey(type: LintEntityType, key: string, relative = false) {
    const fileName = `${getPathSegmentsFromKey(key, projectConfig.namespaceCharacter, type).join(
      path.sep,
    )}.${datasource.getExtension()}`;
    let fullPath = "";

    if (type === "attribute") {
      fullPath = path.join(
        projectConfig.attributesDirectoryPath,
        `${key}.${datasource.getExtension()}`,
      );
    } else if (type === "segment") {
      fullPath = path.join(projectConfig.segmentsDirectoryPath, fileName);
    } else if (type === "feature") {
      fullPath = path.join(projectConfig.featuresDirectoryPath, fileName);
    } else if (type === "schema") {
      fullPath = path.join(projectConfig.schemasDirectoryPath, fileName);
    } else if (type === "target") {
      fullPath = path.join(projectConfig.targetsDirectoryPath, fileName);
    } else if (type === "variable") {
      fullPath = path.join(projectConfig.variablesDirectoryPath, fileName);
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
    if (type === "schema") {
      return projectConfig.schemasDirectoryPath;
    }
    if (type === "target") {
      return projectConfig.targetsDirectoryPath;
    }
    if (type === "variable") {
      return projectConfig.variablesDirectoryPath;
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

  function reportWarning(warning: LintErrorItem) {
    warnings.push(warning);
    if (!isJsonMode)
      console.log(
        `  => Warning: ${warning.message} (${warning.entityType} ${warning.key}: ${warning.path.join(".")})`,
      );
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
    if (error instanceof EntityParseError) {
      if (reportedParseErrors.has(targetPath)) return;
      reportedParseErrors.add(targetPath);
      for (const type of [
        "attribute",
        "segment",
        "feature",
        "variable",
        "schema",
        "target",
        "test",
        "scenario",
      ] as const) {
        if (targetPath === fullPath) break;
        const relativePath = path.relative(getEntityDirectoryPath(type), targetPath);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) continue;
        entityType = type;
        key = relativePath
          .slice(0, -(datasource.getExtension().length + 1))
          .split(path.sep)
          .join(projectConfig.namespaceCharacter);
        break;
      }
    }

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
      console.log(CLI_FORMAT_RED, `  => Error: ${message}`);
      if (options.verbose || deps.options.verbose) {
        console.log(error instanceof EntityParseError ? error.cause : error);
      }
      console.log("");
    }
  }

  async function reportZodValidationError(
    entityType: LintEntityType,
    key: string,
    fullPath: string,
    error: ZodError,
    { ignoreUnknownReferences = false }: { ignoreUnknownReferences?: boolean } = {},
  ) {
    const issues = getLintIssuesFromZodError(error).filter(
      (issue) => !(ignoreUnknownReferences && issue.unknownReference),
    );
    if (issues.length === 0) return;

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
            console.log("     Path:", pathRelativeToFile.join(".") || "(root)");
            if (typeof issue.value !== "undefined" && issue.value !== "undefined") {
              console.log("     Value:", issue.value);
            }
            console.log("");
          }
        }
      } else {
        await printEntityHeader(entityType, key, fullPath);
        printLintIssues(issues);
      }
    }
  }

  const keyPattern = options.keyPattern
    ? parseRegexOption("--keyPattern", options.keyPattern)
    : null;

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
  let attributes: string[];
  try {
    attributes = await datasource.listAttributes();
  } catch (error) {
    if (!(error instanceof AttributeNamespaceError)) throw error;
    attributes = error.validKeys;
    for (const { key, filePath } of error.invalidAttributes) {
      await reportSimpleError({
        entityType: "attribute",
        key,
        fullPath: filePath,
        message: ATTRIBUTE_NAMESPACE_MESSAGE,
        code: "invalid_attribute_namespace",
      });
    }
  }
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
    const filteredKeys = !keyPattern
      ? attributes
      : attributes.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "attribute");
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("attribute", key);

      if (!ATTRIBUTE_NAME_REGEX.test(key)) {
        await reportSimpleError({
          entityType: "attribute",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ATTRIBUTE_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      const reservedName = getInheritedPropertyNameError(key, "Attribute name");
      if (reservedName) {
        await reportSimpleError({
          entityType: "attribute",
          key,
          fullPath,
          message: reservedName,
          code: "reserved_name",
        });
      }

      try {
        const parsed = attributesByKey[key] ?? (await datasource.readAttribute(key));
        for (const property of findInheritedPropertyNames(parsed)) {
          await reportSimpleError({
            entityType: "attribute",
            key,
            fullPath,
            message: getInheritedPropertyNameError(property.name, "Property name")!,
            pathParts: property.path,
            code: "reserved_name",
          });
        }
        const result = attributeZodSchema.safeParse(parsed, diagnosticParseOptions);

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

  // Load both key spaces before linting either one so a focused feature or
  // variable lint can report collisions independently.
  const variables = await datasource.listVariables();
  const variablesByKey: Record<string, ParsedVariable> = {};
  for (const key of variables) {
    try {
      variablesByKey[key] = await datasource.readVariable(key);
    } catch {
      // Variable read failures are reported during variable linting below.
    }
  }

  // lint features
  const features = await datasource.listFeatures();
  const featuresByKey: Record<string, ParsedFeature> = {};
  for (const key of features) {
    try {
      featuresByKey[key] = await datasource.readFeature(key);
    } catch {
      // Feature read failures are reported during feature linting below.
    }
  }
  // lint segments
  const segments = await datasource.listSegments();
  const segmentsByKey: Record<string, Segment> = {};
  for (const key of segments) {
    try {
      segmentsByKey[key] = await datasource.readSegment(key);
    } catch {
      // Read errors are reported alongside the segment's schema diagnostics.
    }
  }
  const referenceIndex: ReferenceIndex = {
    attributes: attributesByKey,
    segments: segmentsByKey,
    features: featuresByKey,
    variables: variablesByKey,
  };
  async function reportArchivedReferences(
    entityType: ReferringEntityType,
    key: string,
    fullPath: string,
    definition: unknown,
  ) {
    for (const issue of getArchivedReferenceIssues(entityType, definition, referenceIndex)) {
      await reportSimpleError({
        entityType,
        key,
        fullPath,
        message: issue.message,
        pathParts: issue.path,
        code: "archived_reference",
      });
    }
  }

  function reportDeprecatedReferences(
    entityType: "segment" | "feature" | "variable",
    key: string,
    fullPath: string,
    definition: unknown,
  ) {
    for (const warning of getDeprecatedReferenceWarnings(entityType, definition, referenceIndex)) {
      reportWarning({
        filePath: path.relative(process.cwd(), fullPath),
        entityType,
        key,
        path: warning.path,
        code: "deprecated_reference",
        message: warning.message,
      });
    }
  }
  async function reportConditionKinds(
    entityType: "segment" | "feature" | "variable",
    key: string,
    fullPath: string,
    definition: unknown,
  ) {
    for (const issue of getConditionKindIssues(
      entityType,
      definition,
      projectConfig.allowedConditions,
    )) {
      await reportSimpleError({
        entityType,
        key,
        fullPath,
        message: issue.message,
        pathParts: issue.path,
        code: "disallowed_condition",
      });
    }
  }
  const isArchived = (definition: unknown) =>
    !!definition &&
    typeof definition === "object" &&
    (definition as { archived?: unknown }).archived === true;

  const conditionsZodSchema = getConditionsZodSchema(
    projectConfig,
    attributesByKey,
    schemasByKey,
    featuresByKey,
    variablesByKey,
    segments,
  );
  const segmentZodSchema = getSegmentZodSchema(projectConfig, conditionsZodSchema);
  // Archived definitions never reach a datafile. Lint checks their shape alone, resolving
  // no attribute, segment, feature or global variable, so what they used can change or go.
  const isolatedConditionsZodSchema = getConditionsZodSchema(
    projectConfig,
    {},
    schemasByKey,
    {},
    {},
    [],
  );
  const isolatedSegmentZodSchema = getSegmentZodSchema(projectConfig, isolatedConditionsZodSchema);

  if (!options.entityType || options.entityType === "segment") {
    await lintReservedNamespaceCharacterInEntityPaths("segment");

    const filteredKeys = !keyPattern ? segments : segments.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "segment");
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
        const archived = isArchived(parsed);
        const result = (archived ? isolatedSegmentZodSchema : segmentZodSchema).safeParse(
          parsed,
          diagnosticParseOptions,
        );

        if (!result.success && "error" in result) {
          await reportZodValidationError("segment", key, fullPath, result.error, {
            ignoreUnknownReferences: archived,
          });
        }
        await reportArchivedReferences("segment", key, fullPath, parsed);
        await reportConditionKinds("segment", key, fullPath, parsed);
        reportDeprecatedReferences("segment", key, fullPath, parsed);
      } catch (error) {
        await reportThrownError("segment", key, fullPath, error);
      }
    }
  }

  const featureZodSchema = getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    flattenedAttributes as [string, ...string[]],
    segments as [string, ...string[]],
    features as [string, ...string[]],
    schemas,
    schemasByKey,
    featuresByKey,
    variablesByKey,
  );
  const isolatedFeatureZodSchema = getFeatureZodSchema(
    projectConfig,
    isolatedConditionsZodSchema,
    [] as unknown as [string, ...string[]],
    [] as unknown as [string, ...string[]],
    [] as unknown as [string, ...string[]],
    schemas,
    schemasByKey,
    {},
    {},
  );

  if (!options.entityType || options.entityType === "feature") {
    await lintReservedNamespaceCharacterInEntityPaths("feature");

    const filteredKeys = !keyPattern ? features : features.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "feature");
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("feature", key);

      if (isReservedKey(key, projectConfig.reservedKeys || DEFAULT_RESERVED_KEYS)) {
        await reportSimpleError({
          entityType: "feature",
          key,
          fullPath,
          message: `Feature key "${key}" is reserved and cannot be used`,
          detail: "Choose another key, or customize reservedKeys in featurevisor.config.js.",
          code: "reserved_key",
        });
      }

      if (
        options.entityType === "feature" &&
        !projectConfig.allowFeatureAndVariableKeyCollisions &&
        variables.includes(key)
      ) {
        await reportSimpleError({
          entityType: "feature",
          key,
          fullPath,
          message: `Feature "${key}" conflicts with a global variable using the same key`,
          detail:
            "Rename either entity, or set allowFeatureAndVariableKeyCollisions to true in featurevisor.config.js.",
          code: "feature_variable_key_collision",
        });
      }

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
        parsed = featuresByKey[key] ?? (await datasource.readFeature(key));
        const archived = isArchived(parsed);

        const result = (archived ? isolatedFeatureZodSchema : featureZodSchema).safeParse(
          parsed,
          diagnosticParseOptions,
        );

        if (!result.success && "error" in result) {
          await reportZodValidationError("feature", key, fullPath, result.error, {
            ignoreUnknownReferences: archived,
          });
        }
        await reportArchivedReferences("feature", key, fullPath, parsed);
        await reportConditionKinds("feature", key, fullPath, parsed);
        reportDeprecatedReferences("feature", key, fullPath, parsed);
        if (options.v3MutationOrder) {
          for (const change of getMutationOrderChanges(parsed)) {
            reportWarning({
              filePath: path.relative(process.cwd(), fullPath),
              entityType: "feature",
              key,
              path: change.path,
              code: "mutation_order_changed",
              message: change.message,
            });
          }
        }
      } catch (error) {
        await reportThrownError("feature", key, fullPath, error);
      }
    }
  }

  // lint global variables
  const getCompositionWarnings = createCompositionWarningInspector(
    featuresByKey,
    variablesByKey,
    schemasByKey,
  );
  let currentVariableKey = "value";
  const variableZodSchema = getVariableZodSchema(
    projectConfig,
    attributesByKey,
    segments,
    featuresByKey,
    schemasByKey,
    variablesByKey,
    () => currentVariableKey,
  );
  const isolatedVariableZodSchema = getVariableZodSchema(
    projectConfig,
    {},
    [],
    {},
    schemasByKey,
    {},
    () => currentVariableKey,
  );
  if (!options.entityType || options.entityType === "variable") {
    await lintReservedNamespaceCharacterInEntityPaths("variable");

    const filteredKeys = !keyPattern ? variables : variables.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "variable");
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("variable", key);

      if (isReservedKey(key, projectConfig.reservedKeys || DEFAULT_RESERVED_KEYS)) {
        await reportSimpleError({
          entityType: "variable",
          key,
          fullPath,
          message: `Variable key "${key}" is reserved and cannot be used`,
          detail: "Choose another key, or customize reservedKeys in featurevisor.config.js.",
          code: "reserved_key",
        });
      }

      if (!projectConfig.allowFeatureAndVariableKeyCollisions && features.includes(key)) {
        await reportSimpleError({
          entityType: "variable",
          key,
          fullPath,
          message: `Variable "${key}" conflicts with a feature using the same key`,
          detail:
            "Rename either entity, or set allowFeatureAndVariableKeyCollisions to true in featurevisor.config.js.",
          code: "feature_variable_key_collision",
        });
      }

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "variable",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = variablesByKey[key] ?? (await datasource.readVariable(key));
        currentVariableKey = key;
        const archived = isArchived(parsed);
        const result = (archived ? isolatedVariableZodSchema : variableZodSchema).safeParse(
          parsed,
          diagnosticParseOptions,
        );
        await reportArchivedReferences("variable", key, fullPath, parsed);
        await reportConditionKinds("variable", key, fullPath, parsed);
        reportDeprecatedReferences("variable", key, fullPath, parsed);

        if (!result.success && "error" in result) {
          await reportZodValidationError("variable", key, fullPath, result.error, {
            ignoreUnknownReferences: archived,
          });
        } else if (result.success && !archived) {
          for (const warning of getCompositionWarnings(result.data)) {
            reportWarning({
              ...warning,
              filePath: path.relative(process.cwd(), fullPath),
              entityType: "variable",
              key,
            });
          }
        }
      } catch (error) {
        await reportThrownError("variable", key, fullPath, error);
      }
    }
  }

  // lint schemas (schemas and schemasByKey already loaded above for feature linting)
  const schemaZodSchema = getSchemaZodSchema(schemas, schemasByKey);

  if (!options.entityType || options.entityType === "schema") {
    await lintReservedNamespaceCharacterInEntityPaths("schema");

    const filteredKeys = !keyPattern ? schemas : schemas.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "schema");
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

        const result = schemaZodSchema.safeParse(parsed, diagnosticParseOptions);

        if (!result.success && "error" in result) {
          await reportZodValidationError("schema", key, fullPath, result.error);
        }
      } catch (error) {
        await reportThrownError("schema", key, fullPath, error);
      }
    }
  }

  // lint targets
  const targets = await datasource.listTargets();
  const targetZodSchema = getTargetZodSchema(projectConfig);
  const parsedTargets = new Map<string, Target>();
  const checkedTargets = new Set<string>();

  if (!options.entityType || options.entityType === "target") {
    await lintReservedNamespaceCharacterInEntityPaths("target");

    const filteredKeys = !keyPattern ? targets : targets.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "target");
    }

    for (const key of filteredKeys) {
      const fullPath = getFullPathFromKey("target", key);

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "target",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      checkedTargets.add(key);
      try {
        const parsed = await datasource.readTarget(key);

        const result = targetZodSchema.safeParse(parsed, diagnosticParseOptions);

        if (!result.success && "error" in result) {
          await reportZodValidationError("target", key, fullPath, result.error);
        } else {
          parsedTargets.set(key, parsed);
        }
        await reportArchivedReferences("target", key, fullPath, parsed);
      } catch (error) {
        await reportThrownError("target", key, fullPath, error);
      }
    }
  }

  // Definitions that schemaVersion "2" targets carry must have a schema "2"
  // form. Projects without such a target only read their target files.
  if (
    !options.entityType ||
    ["feature", "segment", "variable", "target"].includes(options.entityType)
  ) {
    // Targets the loop above skipped, because of --entityType or --keyPattern.
    for (const key of targets) {
      if (checkedTargets.has(key)) continue;
      try {
        const parsed = await datasource.readTarget(key);
        if (targetZodSchema.safeParse(parsed, diagnosticParseOptions).success) {
          parsedTargets.set(key, parsed);
        }
      } catch {
        // Linting targets reports this.
      }
    }
    const byTarget = options.entityType === "target";
    const schemaV2Issues = await findSchemaV2TargetIssues(
      projectConfig,
      datasource,
      [...parsedTargets]
        .filter(([key]) => !byTarget || !keyPattern || keyPattern.test(key))
        .map(([key, target]) => ({ ...target, key })),
    );
    for (const issue of schemaV2Issues) {
      if (!byTarget && options.entityType && options.entityType !== issue.entityType) continue;
      if (!byTarget && keyPattern && !keyPattern.test(issue.key)) continue;
      await reportSimpleError({
        entityType: issue.entityType,
        key: issue.key,
        fullPath: getFullPathFromKey(issue.entityType, issue.key),
        message: describeSchemaV2TargetIssue(issue),
        pathParts: issue.path,
        code: "schema_v2_unsupported",
        value: { targets: issue.targets, environments: issue.environments },
      });
    }
  }

  // lint tests
  const tests = await datasource.listTests();

  const testsZodSchema = getTestsZodSchema(
    projectConfig,
    features as [string, ...string[]],
    segments as [string, ...string[]],
    targets as [string, ...string[]],
    variables as [string, ...string[]],
    featuresByKey,
    segmentsByKey,
  );

  if (!options.entityType || options.entityType === "test") {
    await lintReservedNamespaceCharacterInEntityPaths("test");

    const filteredKeys = !keyPattern ? tests : tests.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "test");
    }

    for (const key of filteredKeys) {
      const fullPath = datasource.getTestSourcePath
        ? datasource.getTestSourcePath(key)
        : getFullPathFromKey("test", key);

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

        for (const warning of getTestContextWarnings(parsed, attributesByKey, schemasByKey)) {
          reportWarning({
            filePath: path.relative(process.cwd(), fullPath),
            entityType: "test",
            key,
            path: warning.path,
            code: "context_value_mismatch",
            message: warning.message,
          });
        }

        const result = testsZodSchema.safeParse(parsed, diagnosticParseOptions);

        if (!result.success && "error" in result) {
          await reportZodValidationError("test", key, fullPath, result.error);
        }
        await reportArchivedReferences("test", key, fullPath, parsed);
      } catch (error) {
        await reportThrownError("test", key, fullPath, error);
      }
    }
  }

  // lint scenarios
  const scenarios = await datasource.listScenarios();
  const scenariosZodSchema = getScenariosZodSchema(
    projectConfig,
    features as [string, ...string[]],
    segments as [string, ...string[]],
    targets as [string, ...string[]],
    variables as [string, ...string[]],
    featuresByKey,
  );

  if (!options.entityType || options.entityType === "scenario") {
    if (options.entityType === "scenario") {
      await lintReservedNamespaceCharacterInEntityPaths("scenario");
    }

    const filteredKeys = !keyPattern ? scenarios : scenarios.filter((key) => keyPattern.test(key));

    if (filteredKeys.length > 0) {
      logProgress(filteredKeys.length, "scenario");
    }

    for (const key of filteredKeys) {
      let fullPath = getFullPathFromKey("scenario", key);
      try {
        fullPath = datasource.getScenarioSourcePath(key);
      } catch {
        // Custom adapters may not expose a source path.
      }

      if (!isValidEntityKey(key, projectConfig.namespaceCharacter)) {
        await reportSimpleError({
          entityType: "scenario",
          key,
          fullPath,
          message: `Invalid name: "${key}"`,
          detail: ENTITY_NAME_REGEX_ERROR,
          code: "invalid_name",
        });
      }

      try {
        const parsed = await datasource.readScenario(key);
        for (const warning of getTestContextWarnings(parsed, attributesByKey, schemasByKey, true)) {
          reportWarning({
            filePath: path.relative(process.cwd(), fullPath),
            entityType: "scenario",
            key,
            path: warning.path,
            code: "context_value_mismatch",
            message: warning.message,
          });
        }
        const result = scenariosZodSchema.safeParse(parsed, diagnosticParseOptions);

        if (!result.success && "error" in result) {
          await reportZodValidationError("scenario", key, fullPath, result.error);
        }
        await reportArchivedReferences("scenario", key, fullPath, parsed);
      } catch (error) {
        await reportThrownError("scenario", key, fullPath, error);
      }
    }
  }

  if (
    !options.entityType ||
    options.entityType === "feature" ||
    options.entityType === "variable" ||
    options.entityType === "segment"
  ) {
    const reportDependencyError = async (error: unknown) => {
      const cycleError = isDependencyCycleError(error) ? error : null;
      const cycleOrigin = cycleError?.origin;
      const entityType: LintEntityType = cycleOrigin
        ? cycleOrigin[0] === "variable"
          ? "variable"
          : cycleOrigin[0] === "segment"
            ? "segment"
            : "feature"
        : variables.length > 0
          ? "variable"
          : "feature";
      const key = cycleOrigin
        ? cycleOrigin[1]
        : entityType === "variable"
          ? variables[0] || ""
          : features[0] || "";
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof EntityParseError) {
        await reportThrownError(entityType, key, getFullPathFromKey(entityType, key), error);
      } else if (
        !message.startsWith("Legacy feature `required` was removed") ||
        !errors.some((item) => item.path.join(".") === "required")
      ) {
        await reportSimpleError({
          entityType,
          key,
          fullPath: key ? getFullPathFromKey(entityType, key) : process.cwd(),
          message,
          pathParts: cycleError ? cycleError.path : [],
          code: cycleError ? cycleError.code : "dependency_validation_failed",
        });
      }
    };
    try {
      const graph = await buildDependencyGraph(datasource);
      const cycles = await findDependencyCycles(datasource, graph);
      for (const cycle of cycles) await reportDependencyError(cycle);
      // Depth and cost estimation are useful only for an acyclic evaluation graph.
      const deepChains = cycles.length
        ? []
        : findDeepDependencyChains(graph, PORTABLE_DEPENDENCY_HANDOFFS);
      for (const chain of deepChains) {
        const node = JSON.parse(chain.root) as string[];
        const entityType: LintEntityType = node[0] === "variable" ? "variable" : "feature";
        const key = node[1];
        if (options.entityType && options.entityType !== entityType) continue;
        const location =
          node[0] === "feature-variable"
            ? ["variablesSchema", node[2]]
            : entityType === "variable" && variablesByKey[key]?.compose
              ? ["compose"]
              : ["conditions"];
        const description = describeDependencyChain(chain.nodes);
        if (chain.handoffs > DEPENDENCY_HANDOFF_LIMIT) {
          await reportSimpleError({
            entityType,
            key,
            fullPath: getFullPathFromKey(entityType, key),
            message: `Evaluation needs ${chain.handoffs} dependency handoffs, more than the runtime limit of ${DEPENDENCY_HANDOFF_LIMIT}, so SDKs fail it: ${description}. Shorten the chain.`,
            pathParts: location,
            code: "dependency_depth_exceeded",
          });
        } else {
          reportWarning({
            filePath: path.relative(process.cwd(), getFullPathFromKey(entityType, key)),
            entityType,
            key,
            path: location,
            code: "dependency_depth",
            message: `Evaluation needs ${chain.handoffs} dependency handoffs: ${description}. Small native thread stacks, such as 512 KB mobile threads, can fail deep chains. Keep chains at ${PORTABLE_DEPENDENCY_HANDOFFS} or fewer where you can.`,
          });
        }
      }
      for (const estimate of cycles.length ? [] : estimateDependencyExpansion(graph)) {
        const node = JSON.parse(estimate.root) as string[];
        const entityType: LintEntityType =
          node[0] === "variable" ? "variable" : node[0] === "segment" ? "segment" : "feature";
        const key = node[1];
        if (options.entityType && options.entityType !== entityType) continue;
        reportWarning({
          filePath: path.relative(process.cwd(), getFullPathFromKey(entityType, key)),
          entityType,
          key,
          path:
            entityType === "variable" && variablesByKey[key]?.compose
              ? ["compose"]
              : ["conditions"],
          code: "dependency_expansion_cost",
          message: `More than 1000 distinct dependency edges are reachable from this request (estimate capped at 1001). Memoization avoids counting shared paths repeatedly.`,
        });
      }
    } catch (error) {
      await reportDependencyError(error);
    }
  }

  return {
    hasError: errors.length > 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
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
          v3MutationOrder: parsed.v3MutationOrder,
          verbose: parsed.verbose,
        },
      );

      if (parsed.json) {
        const payload = { errors: result.errors, warnings: result.warnings || [] };
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
      description: "Lint all entities",
    },
    {
      command: "lint --v3-mutation-order",
      description: "Show values that change because v4 applies mutations in authored order",
    },
    {
      command: "lint --entity-type=feature",
      description: "Lint only features",
    },
    {
      command: "lint --entity-type=segment",
      description: "Lint only segments",
    },
    {
      command: "lint --entity-type=schema",
      description: "Lint only schemas",
    },
    {
      command: "lint --entity-type=test",
      description: "Lint only tests",
    },
    {
      command: "lint --entity-type=scenario",
      description: "Lint only scenarios",
    },
    {
      command: 'lint --key-pattern="abc"',
      description: `Lint only entities with keys containing "abc"`,
    },
    {
      command: "lint --json",
      description: "Print lint errors as JSON",
    },
    {
      command: "lint --json --pretty",
      description: "Print lint errors as pretty JSON",
    },
  ],
};
