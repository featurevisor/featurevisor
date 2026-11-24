import * as fs from "fs";
import * as path from "path";

import type {
  Attribute,
  ParsedFeature,
  Schema,
  VariableSchema,
  VariableSchemaWithInline,
  ParsedVariable,
} from "@featurevisor/types";
import { Dependencies } from "../dependencies";
import { FeaturevisorCLIError } from "../error";
import { resolveSchemaEnvironment } from "../builder/schemas";
import { widenSchemaMutations } from "./widenMutations";
import {
  buildDependencyGraph,
  collectDependencyClosure,
  featureFlagNode,
  variableNode,
} from "../datasource/dependencies";
import { isComposedVariable } from "../datasource/composition";
import {
  getTargetSchemaKeys,
  normalizeOptionValues,
  resolveTargets,
  targetIncludesFeature,
  targetIncludesVariable,
} from "../targeting";

export interface TypeScriptGenerationOptions {
  tag?: string | string[];
  target?: string | string[];
  react?: boolean;
  /** A typed `createSchemas` for `@featurevisor/schemas`, and typed schema hooks with `react`. */
  schemas?: boolean;
  /** The environment whose version of each schema types are written from. The one starting with `prod` by default. */
  environment?: string;
  importSdkPath?: string;
  importReactPath?: string;
  importSchemasPath?: string;
}

const DEFAULT_SDK_IMPORT_PATH = "@featurevisor/sdk";
const DEFAULT_REACT_IMPORT_PATH = "@featurevisor/react";
const DEFAULT_SCHEMAS_IMPORT_PATH = "@featurevisor/schemas";

function shouldWrapArrayItemType(typeName: string): boolean {
  const trimmed = typeName.trim();
  return trimmed.includes("|") || trimmed.includes("&");
}

function formatObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Context values are inputs and may be native dates. Variable values are outputs and
 * always arrive as JSON, so a date-time string stays a string there.
 */
type TypePosition = "input" | "output";

function buildObjectTypeFromSchema(
  schema: Schema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
  position: TypePosition = "output",
): string {
  const props = schema.properties;
  const additional = schema.additionalProperties;
  const hasProps = props && typeof props === "object" && Object.keys(props).length > 0;
  const hasAdditional = additional && typeof additional === "object";

  // `additionalProperties: true` allows any other key with any value.
  if (additional === true) {
    if (!hasProps) return "Record<string, unknown>";
    const requiredSet = new Set(schema.required || []);
    const entries = Object.entries(props as Record<string, Schema>).map(([k, v]) => {
      const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames, position);
      return requiredSet.has(k)
        ? `${formatObjectKey(k)}: ${propType}`
        : `${formatObjectKey(k)}?: ${propType}`;
    });
    return `{ ${entries.join("; ")}; [key: string]: unknown }`;
  }

  if (hasProps && hasAdditional) {
    const requiredSet = new Set(schema.required || []);
    const propEntries = Object.entries(props as Record<string, Schema>).map(([k, v]) => {
      const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames, position);
      const optional = !requiredSet.has(k);
      return optional
        ? `${formatObjectKey(k)}?: ${propType}`
        : `${formatObjectKey(k)}: ${propType}`;
    });
    const propUnion = Object.entries(props as Record<string, Schema>)
      .map(([, v]) => schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames, position))
      .join(" | ");
    const additionalType = schemaToTypeScriptType(
      additional as Schema,
      schemasByKey,
      schemaTypeNames,
      position,
    );
    const indexType = [additionalType, propUnion].filter(Boolean).join(" | ");
    return `{ ${propEntries.join("; ")}; [key: string]: ${indexType} }`;
  }

  if (hasProps) {
    const requiredSet = new Set(schema.required || []);
    const entries = Object.entries(props as Record<string, Schema>)
      .map(([k, v]) => {
        const propType = schemaToTypeScriptType(
          v as Schema,
          schemasByKey,
          schemaTypeNames,
          position,
        );
        const optional = !requiredSet.has(k);
        return optional
          ? `${formatObjectKey(k)}?: ${propType}`
          : `${formatObjectKey(k)}: ${propType}`;
      })
      .join("; ");
    return `{ ${entries} }`;
  }

  if (hasAdditional) {
    const additionalType = schemaToTypeScriptType(
      additional as Schema,
      schemasByKey,
      schemaTypeNames,
      position,
    );
    return `Record<string, ${additionalType}>`;
  }

  return "Record<string, unknown>";
}

function formatTypeImport(typeNames: string[], fromPath: string): string {
  if (typeNames.length === 0) {
    return "";
  }

  return `import type {\n${typeNames.map((name) => `  ${name},`).join("\n")}\n} from "${fromPath}";\n\n`;
}

/**
 * Resolve a schema to its full definition, following schema references (schema: key).
 */
function resolveSchema(schema: Schema, schemasByKey: Record<string, Schema>): Schema {
  if (schema.schema && schemasByKey[schema.schema]) {
    return resolveSchema(schemasByKey[schema.schema], schemasByKey);
  }
  return schema;
}

/** Emit a TypeScript literal type for a primitive const value, or null if not a primitive. */
function constToLiteralType(constVal: unknown): string | null {
  if (constVal === null) return "null";
  if (constVal === undefined) return null;
  if (typeof constVal === "string") return JSON.stringify(constVal);
  if (typeof constVal === "number") return String(constVal);
  if (typeof constVal === "boolean") return constVal ? "true" : "false";
  return null;
}

/** Emit a TypeScript union of literal types for an enum array (primitives only), or null. */
function enumToUnionType(enumArr: unknown[]): string | null {
  if (enumArr.length === 0) return null;
  const literals: string[] = [];
  for (const v of enumArr) {
    const lit = constToLiteralType(v);
    if (lit === null) return null;
    literals.push(lit);
  }
  return literals.join(" | ");
}

/**
 * Converts a Schema (items or properties entry) to a TypeScript type string.
 * Handles nested object/array and resolves schema references recursively.
 * When schema has `oneOf`, emits a union of each branch type. When schema has primitive `const` or `enum`, emits a literal or union type.
 * When schemaTypeNames is provided and schema is a reference (schema: key), returns that type name instead of inlining.
 */
/** True when a schema, or anything it references, contains a date-time string. */
function containsDateTime(
  schema: Schema | undefined,
  schemasByKey: Record<string, Schema>,
  seen = new Set<Schema>(),
): boolean {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return false;
  seen.add(schema);
  const resolved = resolveSchema(schema, schemasByKey);
  if (resolved.type === "string" && resolved.format === "date-time") return true;
  return [
    resolved.items,
    resolved.additionalProperties,
    ...Object.values(resolved.properties || {}),
    ...(resolved.oneOf || []),
  ].some((child) => containsDateTime(child as Schema | undefined, schemasByKey, seen));
}

function schemaToTypeScriptType(
  schema: Schema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
  position: TypePosition = "output",
): string {
  // A named schema type describes values as outputs. Inline it where an input may hold a Date.
  if (
    schema?.schema &&
    schemaTypeNames?.[schema.schema] &&
    !(position === "input" && containsDateTime(schema, schemasByKey))
  ) {
    return schemaTypeNames[schema.schema];
  }
  const resolved = resolveSchema(schema, schemasByKey);
  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const parts = resolved.oneOf.map((branch) =>
      schemaToTypeScriptType(branch as Schema, schemasByKey, schemaTypeNames, position),
    );
    return parts.join(" | ");
  }
  const literalFromConst = resolved.const !== undefined ? constToLiteralType(resolved.const) : null;
  const unionFromEnum =
    resolved.enum && Array.isArray(resolved.enum) && resolved.enum.length > 0
      ? enumToUnionType(resolved.enum)
      : null;
  const type = resolved.type as string | undefined;
  if (!type) {
    return literalFromConst ?? unionFromEnum ?? "unknown";
  }
  switch (type) {
    case "boolean":
      return literalFromConst ?? unionFromEnum ?? "boolean";
    case "string":
      return (
        literalFromConst ??
        unionFromEnum ??
        (position === "input" && resolved.format === "date-time" ? "Date | string" : "string")
      );
    case "integer":
    case "number":
      return literalFromConst ?? unionFromEnum ?? "number";
    case "array":
      if (resolved.items) {
        const itemType = schemaToTypeScriptType(
          resolved.items,
          schemasByKey,
          schemaTypeNames,
          position,
        );
        return shouldWrapArrayItemType(itemType) ? `(${itemType})[]` : `${itemType}[]`;
      }
      return "string[]";
    case "object": {
      return buildObjectTypeFromSchema(resolved, schemasByKey, schemaTypeNames, position);
    }
    default:
      return "unknown";
  }
}

/**
 * Resolve variable schema to the schema shape used for code gen (inline or from schema reference).
 */
function getEffectiveVariableSchema(
  variableSchema: VariableSchema,
  schemasByKey: Record<string, Schema>,
): VariableSchemaWithInline | Schema | undefined {
  if ("schema" in variableSchema && variableSchema.schema) {
    return schemasByKey[variableSchema.schema];
  }
  return variableSchema as VariableSchemaWithInline;
}

function getPascalCase(str) {
  // Remove special characters and split the string into an array of words
  const words = str.replace(/[^a-zA-Z0-9]/g, " ").split(" ");

  // Capitalize the first letter of each word and join them together
  const pascalCased = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");

  return pascalCased;
}

function getRelativePath(from, to) {
  const relativePath = path.relative(from, to);

  if (relativePath.startsWith("..")) {
    return path.join(".", relativePath);
  }

  return relativePath;
}

function getVariationUnionFromFeature(parsedFeature: ParsedFeature): string | null {
  const values = Array.from(
    new Set([
      ...(parsedFeature.variations || []).map((variation) => JSON.stringify(variation.value)),
      ...(parsedFeature.disabledVariationValue !== undefined
        ? [JSON.stringify(parsedFeature.disabledVariationValue)]
        : []),
    ]),
  );

  return values.length > 0 ? values.join(" | ") : null;
}

function getVariableTypeForFeaturesMap(
  variableSchema: VariableSchema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
): { typeName: string; schemaTypesUsed: string[] } {
  const schemaTypesUsed: string[] = [];
  const addSchemaUsed = (name: string) => {
    if (name && !schemaTypesUsed.includes(name)) {
      schemaTypesUsed.push(name);
    }
  };

  if (
    schemaTypeNames &&
    "schema" in variableSchema &&
    variableSchema.schema &&
    schemasByKey[variableSchema.schema]
  ) {
    const schemaTypeName = schemaTypeNames[variableSchema.schema];
    addSchemaUsed(schemaTypeName);
    return { typeName: schemaTypeName, schemaTypesUsed };
  }

  const effective = getEffectiveVariableSchema(variableSchema, schemasByKey);
  if (!effective) {
    return { typeName: "unknown", schemaTypesUsed };
  }

  if ("type" in effective && effective.type === "json") {
    return { typeName: "unknown", schemaTypesUsed };
  }

  const typeName = schemaToTypeScriptType(effective as Schema, schemasByKey, schemaTypeNames);

  if (schemaTypeNames) {
    Object.values(schemaTypeNames).forEach((name) => {
      if (typeName.includes(name)) {
        addSchemaUsed(name);
      }
    });
  }

  return { typeName, schemaTypesUsed };
}

/**
 * Generates the content of Schemas.ts: one exported type per schema key, using schema refs between schemas.
 */
function generateSchemasFileContent(
  schemaKeys: string[],
  schemasByKey: Record<string, Schema>,
  delivered: {
    keys: string[];
    createSchemas: boolean;
    importSdkPath: string;
    importSchemasPath: string;
  },
): string {
  const schemaTypeNames: Record<string, string> = {};
  for (const k of schemaKeys) {
    schemaTypeNames[k] = getPascalCase(k) + "Schema";
  }
  const lines: string[] = [];
  if (delivered.createSchemas) {
    lines.push(
      `import { createSchemas as createSchemasBase, type SchemasOptions } from ${JSON.stringify(delivered.importSchemasPath)};`,
      `import type { Featurevisor } from ${JSON.stringify(delivered.importSdkPath)};`,
      "",
    );
  }
  for (const key of schemaKeys) {
    const schema = schemasByKey[key];
    if (!schema) continue;
    const name = schemaTypeNames[key];
    const typeStr = schemaToTypeScriptType(schema, schemasByKey, schemaTypeNames);
    lines.push(`export type ${name} = ${typeStr};`);
  }

  // The schemas the selected targets deliver, by key, for typed handles from @featurevisor/schemas.
  lines.push("", "export interface SchemaTypes {");
  for (const key of delivered.keys) {
    lines.push(`  ${formatObjectKey(key)}: ${schemaTypeNames[key]};`);
  }
  lines.push("}");

  // What each delivered schema's vocabularies declare, so annotations and options are typed too.
  lines.push(
    "",
    "/** What each schema's annotationsSchema and optionSchema declare, by key. */",
    "export interface SchemaVocabularies {",
  );
  for (const key of delivered.keys) {
    const schema = schemasByKey[key];
    // Both keys always, `{}` for a vocabulary the schema lacks, so it reads as typed in every compiler mode.
    const parts = (
      [
        ["annotationsSchema", "annotations"],
        ["optionSchema", "options"],
      ] as const
    ).map(([field, name]) => {
      const vocabulary = schema?.[field];
      return `${name}: ${vocabulary ? schemaToTypeScriptType(vocabulary, schemasByKey, schemaTypeNames) : "{}"}`;
    });
    lines.push(`  ${formatObjectKey(key)}: { ${parts.join("; ")} };`);
  }
  lines.push("}");

  if (delivered.createSchemas) {
    lines.push(
      "",
      "/** createSchemas from @featurevisor/schemas, with keys, values, annotations and options typed. */",
      "export function createSchemas(f: Featurevisor, options?: SchemasOptions) {",
      "  return createSchemasBase<SchemaTypes, SchemaVocabularies>(f, options);",
      "}",
    );
  }
  return lines.join("\n") + "\n";
}

function generateSchemasReactFileContent(importSchemasPath: string): string {
  return `
import {
  useSchema as useSchemaBase,
  useSchemas as useSchemasBase,
  useValidation as useValidationBase,
  type ValidationOptions,
  type ValidationResult,
} from ${JSON.stringify(`${importSchemasPath}/react`)};
import type { HandleOptions, IsAsync, SchemaHandle, Schemas } from ${JSON.stringify(importSchemasPath)};

import type { SchemaTypes, SchemaVocabularies } from "./schemas.js";

/** useSchema from @featurevisor/schemas/react, with keys, values, annotations and options typed. */
export function useSchema<
  K extends keyof SchemaTypes & string,
  TResult extends boolean | Promise<boolean> = boolean,
>(
  key: K,
  options?: HandleOptions<SchemaTypes[K], TResult>,
): SchemaHandle<SchemaTypes[K], IsAsync<TResult>, SchemaVocabularies[K]> {
  // Typed by this wrapper's own signature, which the base hook cannot relate for an open K.
  return useSchemaBase<SchemaTypes[K], TResult, SchemaVocabularies[K]>(key, options as never);
}

/** useSchemas from @featurevisor/schemas/react, with keys, values, annotations and options typed. */
export function useSchemas(): Schemas<SchemaTypes, SchemaVocabularies> {
  return useSchemasBase<SchemaTypes, SchemaVocabularies>();
}

/** useValidation from @featurevisor/schemas/react, with keys and values typed, for a schema's key or any handle, such as a field's. */
export function useValidation<K extends keyof SchemaTypes & string>(
  key: K,
  value: unknown,
  options?: ValidationOptions,
): ValidationResult<SchemaTypes[K]>;
export function useValidation<T>(
  handle: SchemaHandle<T, boolean>,
  value: unknown,
  options?: ValidationOptions,
): ValidationResult<T>;
export function useValidation(
  keyOrHandle: string | SchemaHandle<unknown, boolean>,
  value: unknown,
  options?: ValidationOptions,
): ValidationResult<unknown> {
  return useValidationBase(keyOrHandle, value, options);
}
`.trimStart();
}

function generateAttributesFileContent(
  attributes: Array<Attribute & { key: string; typescriptType: string }>,
  schemaTypeNames: Record<string, string>,
): string {
  const schemaTypesUsed = new Set<string>();

  for (const attribute of attributes) {
    Object.values(schemaTypeNames).forEach((typeName) => {
      if (attribute.typescriptType.includes(typeName)) {
        schemaTypesUsed.add(typeName);
      }
    });
  }

  const importLine = formatTypeImport(Array.from(schemaTypesUsed).sort(), "./schemas.js");
  const lines = attributes.map((attribute) => {
    const typeName = `${getPascalCase(attribute.key)}Attribute`;
    return `export type ${typeName} = ${attribute.typescriptType};`;
  });

  return `${importLine}${lines.join("\n")}\n`;
}

const INDENT_NS = "  ";
const INDENT_NS_BODY = "    ";

function generateInstanceFileContent(importSdkPath: string): string {
  return `
import type { Featurevisor } from ${JSON.stringify(importSdkPath)};

let _instance: Featurevisor | undefined;

export function setInstance(instance: Featurevisor) {
  _instance = instance;
}

export function getInstance(): Featurevisor {
  if (!_instance) throw new Error("Call setInstance() before using generated functions");
  return _instance;
}
`.trimStart();
}

/** The environment schema types come from: the one named, or the only one whose name starts with `prod`. */
function getTypesEnvironment(environments: unknown, named: string | undefined): string {
  const configured = Array.isArray(environments) ? (environments as string[]) : [];
  if (named !== undefined) {
    if (!configured.includes(named)) {
      throw new FeaturevisorCLIError(
        `Unknown environment "${named}". Available environments: ${configured.join(", ")}.`,
        { code: "invalid_environment", details: { environment: named, available: configured } },
      );
    }
    return named;
  }
  const production = configured.filter((environment) => environment.startsWith("prod"));
  if (production.length === 1) return production[0];
  throw new FeaturevisorCLIError(
    `A schema varies by environment, so code generation needs to know which environment's version to type. ${
      production.length === 0
        ? "No environment's name starts with prod."
        : `Several environments' names start with prod: ${production.join(", ")}.`
    } Pass --environment.`,
    { code: "invalid_environment", details: { available: configured } },
  );
}

export async function generateTypeScriptCodeForProject(
  deps: Dependencies,
  outputPath: string,
  options: TypeScriptGenerationOptions = {},
) {
  const { rootDirectoryPath, projectConfig, datasource } = deps;
  const selectedTags = normalizeOptionValues(options.tag);
  const shouldGenerateReact = Boolean(options.react || options.importReactPath);
  const importSdkPath = options.importSdkPath || DEFAULT_SDK_IMPORT_PATH;
  const importReactPath = options.importReactPath || DEFAULT_REACT_IMPORT_PATH;

  const unknownTag = selectedTags.find((tag) => !projectConfig.tags.includes(tag));
  if (unknownTag) {
    throw new Error(
      `Unknown tag "${unknownTag}". Available tags: ${projectConfig.tags.join(", ") || "none"}.`,
    );
  }

  const selectedTargets = await resolveTargets(datasource, options.target, {
    defaultToAll: false,
    requireTargets: false,
  });

  // Reject invalid attribute layout before writing generated files.
  const attributeFiles = await datasource.listAttributes();

  console.log("\nGenerating TypeScript code...\n");

  // Load schemas for resolving variable schema references
  const schemaListKeys = await datasource.listSchemas();
  const schemasByKey: Record<string, Schema> = {};
  for (const key of schemaListKeys) {
    try {
      schemasByKey[key] = await datasource.readSchema(key);
    } catch {
      // Schema file may be invalid; skip for code gen
    }
  }
  // A schema that varies by environment is typed from one environment's version.
  if (Object.values(schemasByKey).some((schema) => schema?.environments !== undefined)) {
    const environment = getTypesEnvironment(projectConfig.environments, options.environment);
    for (const key of Object.keys(schemasByKey)) {
      schemasByKey[key] = resolveSchemaEnvironment(schemasByKey[key], environment, projectConfig);
    }
  }
  // Any mutation can match when a value is validated, so types hold whatever one widens.
  for (const key of Object.keys(schemasByKey)) {
    schemasByKey[key] = widenSchemaMutations(schemasByKey[key]);
  }
  const schemaKeys = Object.keys(schemasByKey);
  const hasSchemasFile = schemaKeys.length > 0 || Boolean(options.schemas);
  const importSchemasPath = options.importSchemasPath || DEFAULT_SCHEMAS_IMPORT_PATH;
  // Schemas the selected targets deliver, or those with a selected tag, or every schema.
  const deliveredSchemaKeys =
    selectedTargets.length > 0
      ? schemaKeys.filter((key) =>
          selectedTargets.some((target) =>
            getTargetSchemaKeys(target, schemaKeys, schemasByKey).includes(key),
          ),
        )
      : selectedTags.length > 0
        ? getTargetSchemaKeys({ tags: { or: selectedTags } }, schemaKeys, schemasByKey)
        : schemaKeys;
  if (hasSchemasFile) {
    const schemasContent = generateSchemasFileContent(schemaKeys, schemasByKey, {
      keys: deliveredSchemaKeys,
      createSchemas: Boolean(options.schemas),
      importSdkPath,
      importSchemasPath,
    });
    const schemasFilePath = path.join(outputPath, "schemas.ts");
    fs.writeFileSync(schemasFilePath, schemasContent);
    console.log(
      `Schemas type file written at: ${getRelativePath(rootDirectoryPath, schemasFilePath)}`,
    );
  }

  const schemaTypeNames: Record<string, string> = {};
  for (const k of schemaKeys) {
    schemaTypeNames[k] = getPascalCase(k) + "Schema";
  }

  // instance
  const instanceFilePath = path.join(outputPath, "instance.ts");
  fs.writeFileSync(instanceFilePath, generateInstanceFileContent(importSdkPath));
  console.log(`Instance file written at: ${getRelativePath(rootDirectoryPath, instanceFilePath)}`);

  // attributes
  const attributes: (Attribute & { typescriptType: string })[] = [];
  const attributeTypeNames: Record<string, string> = {};

  for (const attributeKey of attributeFiles) {
    const parsedAttribute = await datasource.readAttribute(attributeKey);

    if (parsedAttribute.archived) {
      continue;
    }

    const typescriptType = schemaToTypeScriptType(
      parsedAttribute as Schema,
      schemasByKey,
      hasSchemasFile ? schemaTypeNames : undefined,
      "input",
    );

    attributes.push({
      ...parsedAttribute,
      key: attributeKey,
      typescriptType,
    });
    attributeTypeNames[attributeKey] = `${getPascalCase(attributeKey)}Attribute`;
  }

  const attributesFileContent = generateAttributesFileContent(
    attributes as Array<Attribute & { key: string; typescriptType: string }>,
    hasSchemasFile ? schemaTypeNames : {},
  );
  const attributesFilePath = path.join(outputPath, "attributes.ts");
  fs.writeFileSync(attributesFilePath, attributesFileContent);
  console.log(
    `Attributes type file written at: ${getRelativePath(rootDirectoryPath, attributesFilePath)}`,
  );

  // context
  const contextImport = formatTypeImport(
    Object.values(attributeTypeNames).sort(),
    "./attributes.js",
  );
  const attributeProperties = attributes
    .map((attribute) => {
      return `  ${formatObjectKey(attribute.key)}?: ${attributeTypeNames[attribute.key]};`;
    })
    .join("\n");
  const contextContent = `
import type { AttributeKey, AttributeValue } from ${JSON.stringify(importSdkPath)};
${contextImport}export interface Context {
${attributeProperties}
  [key: AttributeKey]: AttributeValue;
}
`.trimStart();

  const contextTypeFilePath = path.join(outputPath, "context.ts");
  fs.writeFileSync(contextTypeFilePath, contextContent);
  console.log(
    `Context type file written at: ${getRelativePath(rootDirectoryPath, contextTypeFilePath)}`,
  );

  // Resolve global variables before features so required feature chains are
  // represented in generated types just as they are in target datafiles.
  const parsedVariables: Array<{ key: string; value: ParsedVariable }> = [];
  const dependencyGraph = await buildDependencyGraph(datasource);
  const allVariables = new Map<string, ParsedVariable>();
  const featureKeysRequiredByVariables = new Set<string>();
  for (const key of await datasource.listVariables()) {
    const variable = await datasource.readVariable(key);
    allVariables.set(key, variable);
    if (variable.archived) continue;
    const matchesSelectedTag = selectedTags.some((tag) => (variable.tags || []).includes(tag));
    const matchesSelectedTarget = selectedTargets.some((target) =>
      targetIncludesVariable(target, key, variable),
    );
    if (
      (selectedTags.length > 0 || selectedTargets.length > 0) &&
      !matchesSelectedTag &&
      !matchesSelectedTarget
    ) {
      continue;
    }
    parsedVariables.push({ key, value: variable });
    const closure = await collectDependencyClosure(datasource, [variableNode(key)], {
      graph: dependencyGraph,
    });
    closure.features.forEach((featureKey) => featureKeysRequiredByVariables.add(featureKey));
  }

  // features
  const featureFiles = await datasource.listFeatures();

  const featureCandidates: {
    featureKey: string;
    parsedFeature: ParsedFeature;
  }[] = [];
  const directlySelectedFeatureKeys = new Set<string>();
  const selectedFeatureKeys = new Set(featureKeysRequiredByVariables);
  const hasSelection = selectedTags.length > 0 || selectedTargets.length > 0;

  for (const featureKey of featureFiles) {
    const parsedFeature = (await datasource.readFeature(featureKey)) as ParsedFeature;

    if (typeof parsedFeature.archived !== "undefined" && parsedFeature.archived) {
      continue;
    }

    const featureTags = Array.isArray(parsedFeature.tags) ? parsedFeature.tags : [];
    const matchesSelectedTag = selectedTags.some((tag) => featureTags.includes(tag));
    const matchesSelectedTarget = selectedTargets.some((target) =>
      targetIncludesFeature(target, featureKey, parsedFeature),
    );
    if (!hasSelection || matchesSelectedTag || matchesSelectedTarget) {
      directlySelectedFeatureKeys.add(featureKey);
      selectedFeatureKeys.add(featureKey);
    }

    featureCandidates.push({ featureKey, parsedFeature });
  }

  if (hasSelection) {
    for (const featureKey of directlySelectedFeatureKeys) {
      const closure = await collectDependencyClosure(datasource, [featureFlagNode(featureKey)], {
        graph: dependencyGraph,
      });
      closure.features.forEach((requiredFeatureKey) => selectedFeatureKeys.add(requiredFeatureKey));
    }
  }

  const parsedFeatures = hasSelection
    ? featureCandidates.filter(({ featureKey }) => selectedFeatureKeys.has(featureKey))
    : featureCandidates;

  const featuresTypeSchemasUsed = new Set<string>();
  const featureTypeEntries = parsedFeatures
    .map(({ featureKey, parsedFeature }) => {
      const featureLines: string[] = [];
      const variationUnion = getVariationUnionFromFeature(parsedFeature);

      if (variationUnion) {
        featureLines.push(`${INDENT_NS_BODY}variation: ${variationUnion};`);
      }

      if (parsedFeature.variablesSchema) {
        for (const [variableKey, variableSchema] of Object.entries(parsedFeature.variablesSchema)) {
          const { typeName, schemaTypesUsed } = getVariableTypeForFeaturesMap(
            variableSchema,
            schemasByKey,
            hasSchemasFile ? schemaTypeNames : undefined,
          );
          schemaTypesUsed.forEach((name) => featuresTypeSchemasUsed.add(name));
          featureLines.push(`${INDENT_NS_BODY}${formatObjectKey(variableKey)}: ${typeName};`);
        }
      }

      if (featureLines.length === 0) {
        return `${INDENT_NS}${formatObjectKey(featureKey)}: null;`;
      }

      return `${INDENT_NS}${formatObjectKey(featureKey)}: {\n${featureLines.join("\n")}\n${INDENT_NS}};`;
    })
    .join("\n");

  const featuresSchemasImportLine = formatTypeImport(
    [...featuresTypeSchemasUsed].sort(),
    "./schemas.js",
  );

  const featuresFileContent = `
${featuresSchemasImportLine}export type Features = {
${featureTypeEntries}
};

export type FeatureKey = keyof Features;
export type FeatureVariableKey<F extends FeatureKey> = Features[F] extends Record<string, unknown>
  ? Extract<Exclude<keyof Features[F], "variation">, string>
  : never;
export type FeatureVariableType<F extends FeatureKey, V extends FeatureVariableKey<F>> = Features[F] extends Record<string, unknown>
  ? Features[F][V]
  : never;
export type Variation<F extends FeatureKey> = Features[F] extends { variation: infer V }
  ? Extract<V, string>
  : never;
`.trimStart();
  const featuresFilePath = path.join(outputPath, "features.ts");
  fs.writeFileSync(featuresFilePath, featuresFileContent);
  console.log(`Features file written at: ${getRelativePath(rootDirectoryPath, featuresFilePath)}`);

  const variableSchemaTypesUsed = new Set<string>();
  const allFeatures = new Map(
    featureCandidates.map(({ featureKey, parsedFeature }) => [featureKey, parsedFeature]),
  );
  interface ResolvedVariableType {
    typeName: string;
    sourceTypeName: string;
  }
  const resolvedVariableTypes = new Map<string, ResolvedVariableType>();
  const resolvingVariableKeys = new Set<string>();
  let hasCompositionTypes = false;
  const sourceVariableType = (value: VariableSchema): string => {
    const { typeName, schemaTypesUsed } = getVariableTypeForFeaturesMap(
      value,
      schemasByKey,
      hasSchemasFile ? schemaTypeNames : undefined,
    );
    schemaTypesUsed.forEach((name) => variableSchemaTypesUsed.add(name));
    return typeName;
  };
  const resolveVariableType = (key: string): ResolvedVariableType => {
    const cached = resolvedVariableTypes.get(key);
    if (cached !== undefined) return cached;
    if (resolvingVariableKeys.has(key)) {
      throw new Error(`Circular composition reference: ${key}`);
    }
    const value = allVariables.get(key);
    if (!value) throw new Error(`Unknown composition variable: ${key}`);
    resolvingVariableKeys.add(key);
    let resolved: ResolvedVariableType;
    if (isComposedVariable(value)) {
      hasCompositionTypes = true;
      if (typeof value.compose === "string") {
        const { sourceTypeName } = resolveVariableType(value.compose);
        resolved = { typeName: sourceTypeName, sourceTypeName };
      } else {
        const members = Object.entries(value.compose)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([property, reference]) => {
            let memberType: string;
            if (reference.feature !== undefined) {
              const feature = allFeatures.get(reference.feature);
              if (!feature) throw new Error(`Unknown composition feature: ${reference.feature}`);
              if (reference.variable !== undefined) {
                const schema = feature.variablesSchema?.[reference.variable];
                if (!schema) {
                  throw new Error(
                    `Unknown composition feature variable: ${reference.feature}.${reference.variable}`,
                  );
                }
                memberType = `CompositionSource<${sourceVariableType(schema)}> | null`;
              } else if (reference.variation) {
                const variations = getVariationUnionFromFeature(feature);
                memberType = variations ? `${variations} | null` : "null";
              } else {
                memberType = "boolean";
              }
            } else {
              memberType = resolveVariableType(reference.variable).sourceTypeName;
            }
            return `${formatObjectKey(property)}: ${memberType}`;
          });
        resolved = {
          typeName: `{ ${members.join("; ")} }`,
          sourceTypeName: `{ ${members.map((member) => `readonly ${member}`).join("; ")} } | null`,
        };
      }
    } else {
      const typeName = sourceVariableType(value);
      resolved = { typeName, sourceTypeName: `CompositionSource<${typeName}> | null` };
    }
    resolvingVariableKeys.delete(key);
    resolvedVariableTypes.set(key, resolved);
    return resolved;
  };
  const variableTypeEntries = parsedVariables.map(
    ({ key }) => `  ${formatObjectKey(key)}: ${resolveVariableType(key).typeName};`,
  );
  // Map roots are owned by the caller. Alias roots and source members may be borrowed.
  const compositionSourceType = hasCompositionTypes
    ? `type CompositionSource<T> = T extends object ? { readonly [K in keyof T]: CompositionSource<T[K]> } : T;\n\n`
    : "";
  const variablesFileContent = `${formatTypeImport(
    [...variableSchemaTypesUsed].sort(),
    "./schemas.js",
  )}${compositionSourceType}export type Variables = {\n${variableTypeEntries.join("\n")}\n};\n\nexport type VariableKey = keyof Variables;\nexport type VariableType<K extends VariableKey> = Variables[K];\n`;
  const variablesFilePath = path.join(outputPath, "variables.ts");
  fs.writeFileSync(variablesFilePath, variablesFileContent);
  console.log(
    `Variables file written at: ${getRelativePath(rootDirectoryPath, variablesFilePath)}`,
  );

  const functionsFileContent = `
import type { FeatureKey, Variation, FeatureVariableKey, FeatureVariableType } from "./features.js";
import type { VariableKey, VariableType } from "./variables.js";
import type { Context } from "./context.js";
import { getInstance } from "./instance.js";

export function isEnabled(featureKey: FeatureKey, context: Context = {}): boolean {
  return getInstance().isEnabled(featureKey, context);
}

export function getVariation<F extends FeatureKey>(
  featureKey: F,
  context: Context = {},
): Variation<F> | null {
  return getInstance().getVariation<Variation<F>>(featureKey, context);
}

export function getVariable<F extends FeatureKey, V extends FeatureVariableKey<F>>(
  featureKey: F,
  variableKey: V,
  context?: Context,
): FeatureVariableType<F, V> | null;
export function getVariable<K extends VariableKey>(
  variableKey: K,
  context?: Context,
): VariableType<K> | null;
export function getVariable(
  featureKeyOrVariableKey: FeatureKey | VariableKey,
  variableKeyOrContext: string | Context = {},
  context: Context = {},
): unknown {
  return typeof variableKeyOrContext === "string"
    ? getInstance().getVariable(featureKeyOrVariableKey, variableKeyOrContext, context)
    : getInstance().getVariable(featureKeyOrVariableKey, variableKeyOrContext);
}
`.trimStart();
  const functionsFilePath = path.join(outputPath, "functions.ts");
  fs.writeFileSync(functionsFilePath, functionsFileContent);
  console.log(
    `Functions file written at: ${getRelativePath(rootDirectoryPath, functionsFilePath)}`,
  );

  if (shouldGenerateReact) {
    const reactFileContent = `
import {
  useFlag as useFlagOriginal,
  useFlags as useFlagsOriginal,
  useEveryFlag as useEveryFlagOriginal,
  useSomeFlag as useSomeFlagOriginal,
  useVariation as useVariationOriginal,
  useVariable as useVariableOriginal,
  type FlagValues,
  type NonEmptyFeatureKeys,
} from ${JSON.stringify(importReactPath)};

import type { FeatureKey, Variation, FeatureVariableKey, FeatureVariableType } from "./features.js";
import type { VariableKey, VariableType } from "./variables.js";
import type { Context } from "./context.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  return useFlagOriginal(featureKey, context);
}

export function useFlags<K extends readonly FeatureKey[] | []>(
  featureKeys: K,
  context: Context = {},
): FlagValues<K> {
  return useFlagsOriginal<K>(featureKeys, context);
}

export function useEveryFlag<K extends readonly FeatureKey[] | []>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context: Context = {},
): boolean {
  return useEveryFlagOriginal<K>(featureKeys, context);
}

export function useSomeFlag<K extends readonly FeatureKey[] | []>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context: Context = {},
): boolean {
  return useSomeFlagOriginal<K>(featureKeys, context);
}

export function useVariation<F extends FeatureKey>(
  featureKey: F,
  context: Context = {},
): Variation<F> | null {
  return useVariationOriginal<Variation<F>>(featureKey, context);
}

export function useVariable<F extends FeatureKey, V extends FeatureVariableKey<F>>(
  featureKey: F,
  variableKey: V,
  context?: Context,
): FeatureVariableType<F, V> | null;
export function useVariable<K extends VariableKey>(
  variableKey: K,
  context?: Context,
): VariableType<K> | null;
export function useVariable(
  featureKeyOrVariableKey: FeatureKey | VariableKey,
  variableKeyOrContext: string | Context = {},
  context: Context = {},
): unknown {
  return typeof variableKeyOrContext === "string"
    ? useVariableOriginal(featureKeyOrVariableKey, variableKeyOrContext, context)
    : useVariableOriginal(featureKeyOrVariableKey, variableKeyOrContext);
}
`.trimStart();
    const reactFilePath = path.join(outputPath, "react.ts");
    fs.writeFileSync(reactFilePath, reactFileContent);
    console.log(`React file written at: ${getRelativePath(rootDirectoryPath, reactFilePath)}`);
  }

  const shouldGenerateSchemasReact = Boolean(options.schemas) && shouldGenerateReact;
  if (shouldGenerateSchemasReact) {
    const schemasReactFilePath = path.join(outputPath, "schemas-react.ts");
    fs.writeFileSync(schemasReactFilePath, generateSchemasReactFileContent(importSchemasPath));
    console.log(
      `Schemas React file written at: ${getRelativePath(rootDirectoryPath, schemasReactFilePath)}`,
    );
  }

  // index
  const indexContent =
    [
      `export * from "./attributes.js";`,
      `export * from "./context.js";`,
      `export * from "./instance.js";`,
      ...(hasSchemasFile ? [`export * from "./schemas.js";`] : []),
      `export * from "./features.js";`,
      `export * from "./variables.js";`,
      `export * from "./functions.js";`,
      ...(shouldGenerateReact ? [`export * from "./react.js";`] : []),
      ...(shouldGenerateSchemasReact ? [`export * from "./schemas-react.js";`] : []),
    ].join("\n") + "\n";
  const indexFilePath = path.join(outputPath, "index.ts");
  fs.writeFileSync(indexFilePath, indexContent);
  console.log(`Index file written at: ${getRelativePath(rootDirectoryPath, indexFilePath)}`);
}
