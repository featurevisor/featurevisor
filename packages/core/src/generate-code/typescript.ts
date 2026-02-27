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
  individualFeatures?: boolean;
}

function convertFeaturevisorTypeToTypeScriptType(featurevisorType: string): string {
  switch (featurevisorType) {
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "integer":
      return "number";
    case "double":
      return "number";
    case "date":
      return "Date | string";
    case "array":
      return "string[]";
    case "object":
      return "Record<string, unknown>";
    case "json":
      return "unknown";
    default:
      throw new Error(`Unknown type: ${featurevisorType}`);
  }
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
  const type = resolved.type;
  if (!type) {
    return literalFromConst ?? unionFromEnum ?? "unknown";
  }
  switch (type) {
    case "boolean":
      return literalFromConst ?? unionFromEnum ?? "boolean";
    case "string":
      return literalFromConst ?? unionFromEnum ?? "string";
    case "integer":
    case "double":
      return literalFromConst ?? unionFromEnum ?? "number";
    case "array":
      if (resolved.items) {
        return `(${schemaToTypeScriptType(resolved.items, schemasByKey, schemaTypeNames)})[]`;
      }
      return "string[]";
    case "object": {
      const props = resolved.properties;
      if (props && typeof props === "object" && Object.keys(props).length > 0) {
        const requiredSet = new Set(resolved.required || []);
        const entries = Object.entries(props)
          .map(([k, v]) => {
            const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames);
            const optional = !requiredSet.has(k);
            return optional ? `${k}?: ${propType}` : `${k}: ${propType}`;
          })
          .join("; ");
        return `{ ${entries} }`;
      }
      return "Record<string, unknown>";
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

/**
 * Generates TypeScript type/interface declarations and metadata for a variable.
 * Returns declarations to emit (interface or type alias) plus the type name and generic to use in the getter.
 * When isLiteralType is true, the getter return must be asserted so the SDK's primitive return type matches the literal.
 * When schemaTypeNames is provided, direct schema refs and schema refs in array items use those type names and schemaTypesUsed is populated.
 */
function generateVariableTypeDeclarations(
  variableKey: string,
  variableSchema: VariableSchema,
  schemasByKey: Record<string, Schema>,
  schemaTypeNames?: Record<string, string>,
): {
  declarations: string[];
  returnTypeName: string;
  genericArg: string;
  isLiteralType?: boolean;
  useGetVariable?: boolean;
  schemaTypesUsed: string[];
} {
  const typeName = getPascalCase(variableKey) + "Variable";
  const itemTypeName = getPascalCase(variableKey) + "VariableItem";
  const schemaTypesUsed: string[] = [];

  const addSchemaUsed = (name: string) => {
    if (name && !schemaTypesUsed.includes(name)) schemaTypesUsed.push(name);
  };

  // Direct schema reference: emit type alias to schema type and reuse it
  if (
    schemaTypeNames &&
    "schema" in variableSchema &&
    variableSchema.schema &&
    schemasByKey[variableSchema.schema]
  ) {
    const schemaKey = variableSchema.schema;
    const schemaTypeName = schemaTypeNames[schemaKey];
    const resolvedSchema = resolveSchema(schemasByKey[schemaKey], schemasByKey);
    const isOneOf =
      resolvedSchema.oneOf &&
      Array.isArray(resolvedSchema.oneOf) &&
      resolvedSchema.oneOf.length > 0 &&
      !resolvedSchema.type;
    const isLiteralSchema =
      resolvedSchema.const !== undefined ||
      (resolvedSchema.enum && Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length > 0);
    addSchemaUsed(schemaTypeName);
    // getVariableArray<T> expects T to be the element type, not the full array type
    let genericArg = schemaTypeName;
    if (resolvedSchema.type === "array" && resolvedSchema.items) {
      const itemsSchema = resolvedSchema.items as Schema;
      if ("schema" in itemsSchema && itemsSchema.schema && schemaTypeNames[itemsSchema.schema]) {
        genericArg = schemaTypeNames[itemsSchema.schema];
        addSchemaUsed(genericArg);
      } else {
        genericArg = schemaToTypeScriptType(itemsSchema, schemasByKey, schemaTypeNames);
      }
    }
    return {
      declarations: [`${INDENT_NS}export type ${typeName} = ${schemaTypeName};`],
      returnTypeName: schemaTypeName,
      genericArg,
      useGetVariable: isOneOf,
      isLiteralType: isOneOf || isLiteralSchema,
      schemaTypesUsed,
    };
  }

  const effective = getEffectiveVariableSchema(variableSchema, schemasByKey);
  const type = effective?.type;
  const declarations: string[] = [];

  if (type === "json") {
    return { declarations: [], returnTypeName: "T", genericArg: "T", schemaTypesUsed };
  }

  const effectiveOneOf =
    effective && "oneOf" in effective && Array.isArray((effective as Schema).oneOf)
      ? (effective as Schema).oneOf
      : undefined;
  if (effectiveOneOf && effectiveOneOf.length > 0 && !type) {
    const unionType = effectiveOneOf
      .map((branch) => schemaToTypeScriptType(branch as Schema, schemasByKey, schemaTypeNames))
      .join(" | ");
    if (schemaTypeNames) {
      Object.values(schemaTypeNames).forEach((n) => {
        if (unionType.includes(n)) addSchemaUsed(n);
      });
    }
    declarations.push(`${INDENT_NS}export type ${typeName} = ${unionType};`);
    return {
      declarations,
      returnTypeName: typeName,
      genericArg: typeName,
      isLiteralType: true,
      useGetVariable: true,
      schemaTypesUsed,
    };
  }

  if (type === "object") {
    const resolvedEffective =
      effective && "properties" in effective
        ? (resolveSchema(effective as Schema, schemasByKey) as Schema)
        : undefined;
    const props = resolvedEffective?.properties;
    if (props && typeof props === "object" && Object.keys(props).length > 0) {
      const requiredSet = new Set(resolvedEffective?.required || []);
      const entries = Object.entries(props)
        .map(([k, v]) => {
          const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames);
          if (schemaTypeNames)
            Object.values(schemaTypeNames).forEach((n) => {
              if (propType.includes(n)) addSchemaUsed(n);
            });
          const optional = !requiredSet.has(k);
          return optional
            ? `${INDENT_NS_BODY}${k}?: ${propType};`
            : `${INDENT_NS_BODY}${k}: ${propType};`;
        })
        .join("\n");
      declarations.push(`${INDENT_NS}export interface ${typeName} {\n${entries}\n${INDENT_NS}}`);
      return { declarations, returnTypeName: typeName, genericArg: typeName, schemaTypesUsed };
    }
    declarations.push(`${INDENT_NS}export type ${typeName} = Record<string, unknown>;`);
    return { declarations, returnTypeName: typeName, genericArg: typeName, schemaTypesUsed };
  }

  if (type === "array") {
    const itemsSchema = effective && "items" in effective ? (effective.items as Schema) : undefined;
    if (itemsSchema) {
      const itemsRef =
        schemaTypeNames &&
        "schema" in itemsSchema &&
        itemsSchema.schema &&
        schemasByKey[itemsSchema.schema]
          ? schemaTypeNames[itemsSchema.schema]
          : null;
      if (itemsRef) {
        addSchemaUsed(itemsRef);
        declarations.push(`${INDENT_NS}export type ${itemTypeName} = ${itemsRef};`);
        return {
          declarations,
          returnTypeName: `${itemTypeName}[]`,
          genericArg: itemTypeName,
          schemaTypesUsed,
        };
      }
      const resolvedItems = resolveSchema(itemsSchema, schemasByKey);
      if (
        resolvedItems.type === "object" &&
        resolvedItems.properties &&
        Object.keys(resolvedItems.properties).length > 0
      ) {
        const requiredSet = new Set(resolvedItems.required || []);
        const entries = Object.entries(resolvedItems.properties)
          .map(([k, v]) => {
            const propType = schemaToTypeScriptType(v as Schema, schemasByKey, schemaTypeNames);
            if (schemaTypeNames)
              Object.values(schemaTypeNames).forEach((n) => {
                if (propType.includes(n)) addSchemaUsed(n);
              });
            const optional = !requiredSet.has(k);
            return optional
              ? `${INDENT_NS_BODY}${k}?: ${propType};`
              : `${INDENT_NS_BODY}${k}: ${propType};`;
          })
          .join("\n");
        declarations.push(
          `${INDENT_NS}export interface ${itemTypeName} {\n${entries}\n${INDENT_NS}}`,
        );
        return {
          declarations,
          returnTypeName: `${itemTypeName}[]`,
          genericArg: itemTypeName,
          schemaTypesUsed,
        };
      }
      const itemType = schemaToTypeScriptType(resolvedItems, schemasByKey, schemaTypeNames);
      if (schemaTypeNames)
        Object.values(schemaTypeNames).forEach((n) => {
          if (itemType.includes(n)) addSchemaUsed(n);
        });
      declarations.push(`${INDENT_NS}export type ${itemTypeName} = ${itemType};`);
      return {
        declarations,
        returnTypeName: `${itemTypeName}[]`,
        genericArg: itemTypeName,
        schemaTypesUsed,
      };
    }
    declarations.push(`${INDENT_NS}export type ${itemTypeName} = string;`);
    return {
      declarations,
      returnTypeName: `${itemTypeName}[]`,
      genericArg: itemTypeName,
      schemaTypesUsed,
    };
  }

  // primitive: boolean, string, integer, double (or unknown when schema ref unresolved)
  // When schema has primitive const or enum, emit literal or union type
  const effectiveConst =
    effective && "const" in effective && (effective as Schema).const !== undefined
      ? (effective as Schema).const
      : undefined;
  const effectiveEnum =
    effective && "enum" in effective && Array.isArray((effective as Schema).enum)
      ? (effective as Schema).enum
      : undefined;
  const literalType = effectiveConst !== undefined ? constToLiteralType(effectiveConst) : null;
  const enumUnion =
    effectiveEnum && effectiveEnum.length > 0 ? enumToUnionType(effectiveEnum) : null;
  const primitiveType =
    literalType ?? enumUnion ?? (type ? convertFeaturevisorTypeToTypeScriptType(type) : "unknown");
  declarations.push(`${INDENT_NS}export type ${typeName} = ${primitiveType};`);
  return {
    declarations,
    returnTypeName: typeName,
    genericArg: typeName,
    isLiteralType: literalType !== null || enumUnion !== null,
    schemaTypesUsed,
  };
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

// Indentation for generated namespace content (2 spaces per level)
const INDENT_NS = "  ";
const INDENT_NS_BODY = "    ";

const instanceSnippet = `
import { FeaturevisorInstance } from "@featurevisor/sdk";

let _instance: FeaturevisorInstance;

export function setInstance(instance: FeaturevisorInstance) {
  _instance = instance;
}

export function getInstance(): FeaturevisorInstance {
  return _instance as FeaturevisorInstance;
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
  const shouldGenerateIndividualFeatures = options.individualFeatures !== false;

  console.log("\nGenerating TypeScript code...\n");

  // instance
  const instanceFilePath = path.join(outputPath, "instance.ts");
  fs.writeFileSync(instanceFilePath, instanceSnippet);
  console.log(`Instance file written at: ${getRelativePath(rootDirectoryPath, instanceFilePath)}`);

  // attributes
  const attributeFiles = await datasource.listAttributes();
  const attributes: (Attribute & { typescriptType })[] = [];

  for (const attributeKey of attributeFiles) {
    const parsedAttribute = await datasource.readAttribute(attributeKey);

    if (typeof parsedAttribute.archived === "undefined") {
      continue;
    }

    attributes.push({
      archived: parsedAttribute.archived,
      key: attributeKey,
      type: parsedAttribute.type,
      typescriptType: convertFeaturevisorTypeToTypeScriptType(parsedAttribute.type),
    });
  }

  // context
  const attributeProperties = attributes
    .map((attribute) => {
      return `  ${attribute.key}?: ${attribute.typescriptType};`;
    })
    .join("\n");
  const contextContent = `
import type { AttributeKey, AttributeValue } from "@featurevisor/sdk";

export interface Context {
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

  const parsedFeatures: {
    featureKey: string;
    parsedFeature: ParsedFeature;
    namespaceValue: string;
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

    const namespaceValue = getPascalCase(featureKey) + "Feature";
    parsedFeatures.push({ featureKey, parsedFeature, namespaceValue });
  }

  const featureNamespaces: string[] = [];
  if (shouldGenerateIndividualFeatures) {
    for (const { featureKey, parsedFeature, namespaceValue } of parsedFeatures) {
      featureNamespaces.push(namespaceValue);

      let variableTypeDeclarations = "";
      let variableMethods = "";
      const featureSchemaTypesUsed = new Set<string>();

      if (parsedFeature.variablesSchema) {
        const variableKeys = Object.keys(parsedFeature.variablesSchema);
        const allDeclarations: string[] = [];

        for (const variableKey of variableKeys) {
          const variableSchema = parsedFeature.variablesSchema[variableKey];
          const effective = getEffectiveVariableSchema(variableSchema, schemasByKey);
          const variableType = effective?.type;
          const {
            declarations,
            returnTypeName,
            genericArg,
            isLiteralType,
            useGetVariable,
            schemaTypesUsed,
          } = generateVariableTypeDeclarations(
            variableKey,
            variableSchema,
            schemasByKey,
            hasSchemasFile ? schemaTypeNames : undefined,
          );
          schemaTypesUsed.forEach((t) => featureSchemaTypesUsed.add(t));
          allDeclarations.push(...declarations);

          const internalMethodName = `getVariable${
            variableType === "json" ? "JSON" : getPascalCase(variableType ?? "string")
          }`;

          const hasGeneric =
            variableType === "json" || variableType === "array" || variableType === "object";
          const literalAssertion = isLiteralType ? ` as ${returnTypeName} | null` : "";
          if (useGetVariable) {
            variableMethods += `

${INDENT_NS}export function get${getPascalCase(variableKey)}(context: Context = {}): ${returnTypeName} | null {
${INDENT_NS_BODY}return getInstance().getVariable(key, "${variableKey}", context)${literalAssertion};
${INDENT_NS}}`;
          } else if (variableType === "json") {
            variableMethods += `

${INDENT_NS}export function get${getPascalCase(variableKey)}<T = unknown>(context: Context = {}): T | null {
${INDENT_NS_BODY}return getInstance().${internalMethodName}<T>(key, "${variableKey}", context);
${INDENT_NS}}`;
          } else if (hasGeneric) {
            variableMethods += `

${INDENT_NS}export function get${getPascalCase(variableKey)}(context: Context = {}): ${returnTypeName} | null {
${INDENT_NS_BODY}return getInstance().${internalMethodName}<${genericArg}>(key, "${variableKey}", context);
${INDENT_NS}}`;
          } else {
            variableMethods += `

${INDENT_NS}export function get${getPascalCase(variableKey)}(context: Context = {}): ${returnTypeName} | null {
${INDENT_NS_BODY}return getInstance().${internalMethodName}(key, "${variableKey}", context)${literalAssertion};
${INDENT_NS}}`;
          }
        }

        if (allDeclarations.length > 0) {
          variableTypeDeclarations = "\n\n" + allDeclarations.join("\n\n");
        }
      }

      const schemasImportLine =
        featureSchemaTypesUsed.size > 0
          ? `import type { ${[...featureSchemaTypesUsed].sort().join(", ")} } from "./schemas";\n\n`
          : "";

      const featureContent = `
import { Context } from "./context";
import { getInstance } from "./instance";
${schemasImportLine}export namespace ${namespaceValue} {
${INDENT_NS}export const key = "${featureKey}";${variableTypeDeclarations}

${INDENT_NS}export function isEnabled(context: Context = {}) {
${INDENT_NS_BODY}return getInstance().isEnabled(key, context);
${INDENT_NS}}

${INDENT_NS}export function getVariation(context: Context = {}) {
${INDENT_NS_BODY}return getInstance().getVariation(key, context);
${INDENT_NS}}${variableMethods}
}
`.trimStart();

      const featureNamespaceFilePath = path.join(outputPath, `${namespaceValue}.ts`);
      fs.writeFileSync(featureNamespaceFilePath, featureContent);
      console.log(
        `Feature ${featureKey} file written at: ${getRelativePath(
          rootDirectoryPath,
          featureNamespaceFilePath,
        )}`,
      );
    }
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
          featureLines.push(`${INDENT_NS_BODY}${JSON.stringify(variableKey)}: ${typeName};`);
        }
      }

      return `${INDENT_NS}${JSON.stringify(featureKey)}: {\n${featureLines.join("\n")}\n${INDENT_NS}};`;
    })
    .join("\n");

  const featuresSchemasImportLine =
    featuresTypeSchemasUsed.size > 0
      ? `import type { ${[...featuresTypeSchemasUsed].sort().join(", ")} } from "./schemas";\n\n`
      : "";

  const featuresFileContent = `
${featuresSchemasImportLine}export type Features = {
${featureTypeEntries}
};

export type FeatureKey = keyof Features;
export type VariableKey<F extends FeatureKey> = Extract<Exclude<keyof Features[F], "variation">, string>;
export type VariableType<F extends FeatureKey, V extends VariableKey<F>> = Features[F][V];
export type Variation<F extends FeatureKey> = Features[F] extends { variation: infer V } ? V : never;
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

export function getVariation<F extends FeatureKey>(featureKey: F, context: Context = {}): Variation<F> | null {
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

import { FeatureKey, Variation, VariableKey, VariableType } from "./features";
import { Context } from "./context";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  return useFlagOriginal(featureKey, context);
}

export function useVariation<F extends FeatureKey>(featureKey: F, context: Context = {}): Variation<F> | null {
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
      `export * from "./context";`,
      `export * from "./instance";`,
      ...(hasSchemasFile ? [`export * from "./schemas";`] : []),
      `export * from "./features";`,
      `export * from "./functions";`,
      ...(shouldGenerateReact ? [`export * from "./react";`] : []),
      ...featureNamespaces.map((featureNamespace) => {
        return `export * from "./${featureNamespace}";`;
      }),
    ].join("\n") + "\n";
  const indexFilePath = path.join(outputPath, "index.ts");
  fs.writeFileSync(indexFilePath, indexContent);
  console.log(`Index file written at: ${getRelativePath(rootDirectoryPath, indexFilePath)}`);
}
