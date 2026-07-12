import * as fs from "fs";
import * as path from "path";

import type {
  Attribute,
  ParsedFeature,
  Schema,
  VariableSchema,
  VariableSchemaWithInline,
} from "@featurevisor/types";
import { Dependencies } from "../dependencies";

export interface TypeScriptGenerationOptions {
  tag?: string | string[];
  react?: boolean;
}

function shouldWrapArrayItemType(typeName: string): boolean {
  const trimmed = typeName.trim();
  return trimmed.includes("|") || trimmed.includes("&");
}

function formatObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function buildObjectTypeFromSchema(
  schema: Schema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
): string {
  const props = schema.properties;
  const additional = schema.additionalProperties;
  const hasProps = props && typeof props === "object" && Object.keys(props).length > 0;
  const hasAdditional = additional && typeof additional === "object";

  if (hasProps && hasAdditional) {
    const requiredSet = new Set(schema.required || []);
    const propEntries = Object.entries(props as Record<string, Schema>).map(([k, v]) => {
      const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames);
      const optional = !requiredSet.has(k);
      return optional
        ? `${formatObjectKey(k)}?: ${propType}`
        : `${formatObjectKey(k)}: ${propType}`;
    });
    const propUnion = Object.entries(props as Record<string, Schema>)
      .map(([, v]) => schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames))
      .join(" | ");
    const additionalType = schemaToTypeScriptType(
      additional as Schema,
      schemasByKey,
      schemaTypeNames,
    );
    const indexType = [additionalType, propUnion].filter(Boolean).join(" | ");
    return `{ ${propEntries.join("; ")}; [key: string]: ${indexType} }`;
  }

  if (hasProps) {
    const requiredSet = new Set(schema.required || []);
    const entries = Object.entries(props as Record<string, Schema>)
      .map(([k, v]) => {
        const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames);
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
  if (constVal === null || constVal === undefined) return null;
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
function schemaToTypeScriptType(
  schema: Schema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
): string {
  if (schema?.schema && schemaTypeNames?.[schema.schema]) {
    return schemaTypeNames[schema.schema];
  }
  const resolved = resolveSchema(schema, schemasByKey);
  if (resolved.oneOf && Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const parts = resolved.oneOf.map((branch) =>
      schemaToTypeScriptType(branch as Schema, schemasByKey, schemaTypeNames),
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
    case "semver":
      return literalFromConst ?? unionFromEnum ?? "string";
    case "date":
      return literalFromConst ?? unionFromEnum ?? "Date | string";
    case "integer":
    case "double":
      return literalFromConst ?? unionFromEnum ?? "number";
    case "array":
      if (resolved.items) {
        const itemType = schemaToTypeScriptType(resolved.items, schemasByKey, schemaTypeNames);
        return shouldWrapArrayItemType(itemType) ? `(${itemType})[]` : `${itemType}[]`;
      }
      return "string[]";
    case "object": {
      return buildObjectTypeFromSchema(resolved, schemasByKey, schemaTypeNames);
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
  if (!parsedFeature.variations || parsedFeature.variations.length === 0) {
    return null;
  }

  const values = Array.from(
    new Set(parsedFeature.variations.map((variation) => JSON.stringify(variation.value))),
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
): string {
  const schemaTypeNames: Record<string, string> = {};
  for (const k of schemaKeys) {
    schemaTypeNames[k] = getPascalCase(k) + "Schema";
  }
  const lines: string[] = [];
  for (const key of schemaKeys) {
    const schema = schemasByKey[key];
    if (!schema) continue;
    const name = schemaTypeNames[key];
    const typeStr = schemaToTypeScriptType(schema, schemasByKey, schemaTypeNames);
    lines.push(`export type ${name} = ${typeStr};`);
  }
  return lines.join("\n") + "\n";
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

  const importLine = formatTypeImport(Array.from(schemaTypesUsed).sort(), "./schemas");
  const lines = attributes.map((attribute) => {
    const typeName = `${getPascalCase(attribute.key)}Attribute`;
    return `export type ${typeName} = ${attribute.typescriptType};`;
  });

  return `${importLine}${lines.join("\n")}\n`;
}

const INDENT_NS = "  ";
const INDENT_NS_BODY = "    ";

const instanceSnippet = `
import type { Featurevisor } from "@featurevisor/sdk";

let _instance: Featurevisor;

export function setInstance(instance: Featurevisor) {
  _instance = instance;
}

export function getInstance(): Featurevisor {
  return _instance as Featurevisor;
}
`.trimStart();

export async function generateTypeScriptCodeForProject(
  deps: Dependencies,
  outputPath: string,
  options: TypeScriptGenerationOptions = {},
) {
  const { rootDirectoryPath, datasource } = deps;
  const selectedTags = options.tag
    ? Array.isArray(options.tag)
      ? options.tag
      : [options.tag]
    : [];
  const shouldGenerateReact = Boolean(options.react);

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
  const schemaKeys = Object.keys(schemasByKey);
  const hasSchemasFile = schemaKeys.length > 0;
  if (hasSchemasFile) {
    const schemasContent = generateSchemasFileContent(schemaKeys, schemasByKey);
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
  fs.writeFileSync(instanceFilePath, instanceSnippet);
  console.log(`Instance file written at: ${getRelativePath(rootDirectoryPath, instanceFilePath)}`);

  // attributes
  const attributeFiles = await datasource.listAttributes();
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
  const contextImport = formatTypeImport(Object.values(attributeTypeNames).sort(), "./attributes");
  const attributeProperties = attributes
    .map((attribute) => {
      return `  ${formatObjectKey(attribute.key)}?: ${attributeTypeNames[attribute.key]};`;
    })
    .join("\n");
  const contextContent = `
import type { AttributeKey, AttributeValue } from "@featurevisor/sdk";
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

  // features
  const featureFiles = await datasource.listFeatures();

  const parsedFeatures: {
    featureKey: string;
    parsedFeature: ParsedFeature;
  }[] = [];

  for (const featureKey of featureFiles) {
    const parsedFeature = (await datasource.readFeature(featureKey)) as ParsedFeature;

    if (typeof parsedFeature.archived !== "undefined" && parsedFeature.archived) {
      continue;
    }

    if (selectedTags.length > 0) {
      const featureTags = Array.isArray(parsedFeature.tags) ? parsedFeature.tags : [];
      const hasTags = selectedTags.every((tag) => featureTags.includes(tag));
      if (!hasTags) {
        continue;
      }
    }

    parsedFeatures.push({ featureKey, parsedFeature });
  }

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
    "./schemas",
  );

  const featuresFileContent = `
${featuresSchemasImportLine}export type Features = {
${featureTypeEntries}
};

export type FeatureKey = keyof Features;
export type VariableKey<F extends FeatureKey> = Features[F] extends Record<string, unknown>
  ? Extract<Exclude<keyof Features[F], "variation">, string>
  : never;
export type VariableType<F extends FeatureKey, V extends VariableKey<F>> = Features[F] extends Record<string, unknown>
  ? Features[F][V]
  : never;
export type Variation<F extends FeatureKey> = Features[F] extends { variation: infer V }
  ? V
  : never;
`.trimStart();
  const featuresFilePath = path.join(outputPath, "features.ts");
  fs.writeFileSync(featuresFilePath, featuresFileContent);
  console.log(`Features file written at: ${getRelativePath(rootDirectoryPath, featuresFilePath)}`);

  const functionsFileContent = `
import { FeatureKey, Variation, VariableKey, VariableType } from "./features";
import { Context } from "./context";
import { getInstance } from "./instance";

export function isEnabled(featureKey: FeatureKey, context: Context = {}): boolean {
  return getInstance().isEnabled(featureKey, context);
}

export function getVariation<F extends FeatureKey>(
  featureKey: F,
  context: Context = {},
): Variation<F> | null {
  return getInstance().getVariation(featureKey, context) as Variation<F> | null;
}

export function getVariable<F extends FeatureKey, V extends VariableKey<F>>(
  featureKey: F,
  variableKey: V,
  context: Context = {},
): VariableType<F, V> | null {
  return getInstance().getVariable(featureKey, variableKey, context) as VariableType<F, V> | null;
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
  useVariation as useVariationOriginal,
  useVariable as useVariableOriginal,
} from "@featurevisor/react";

import type { FeatureKey, Variation, VariableKey, VariableType } from "./features";
import type { Context } from "./context";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  return useFlagOriginal(featureKey, context);
}

export function useVariation<F extends FeatureKey>(
  featureKey: F,
  context: Context = {},
): Variation<F> | null {
  return useVariationOriginal(featureKey, context) as Variation<F> | null;
}

export function useVariable<F extends FeatureKey, V extends VariableKey<F>>(
  featureKey: F,
  variableKey: V,
  context: Context = {},
): VariableType<F, V> | null {
  return useVariableOriginal(featureKey, variableKey, context) as VariableType<F, V> | null;
}
`.trimStart();
    const reactFilePath = path.join(outputPath, "react.ts");
    fs.writeFileSync(reactFilePath, reactFileContent);
    console.log(`React file written at: ${getRelativePath(rootDirectoryPath, reactFilePath)}`);
  }

  // index
  const indexContent =
    [
      `export * from "./attributes";`,
      `export * from "./context";`,
      `export * from "./instance";`,
      ...(hasSchemasFile ? [`export * from "./schemas";`] : []),
      `export * from "./features";`,
      `export * from "./functions";`,
      ...(shouldGenerateReact ? [`export * from "./react";`] : []),
    ].join("\n") + "\n";
  const indexFilePath = path.join(outputPath, "index.ts");
  fs.writeFileSync(indexFilePath, indexContent);
  console.log(`Index file written at: ${getRelativePath(rootDirectoryPath, indexFilePath)}`);
}
