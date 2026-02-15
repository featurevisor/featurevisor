import * as fs from "fs";
import * as path from "path";

import type { Attribute, PropertySchema, VariableSchema } from "@featurevisor/types";
import { Dependencies } from "../dependencies";

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
 * Converts a PropertySchema (items or properties entry) to a TypeScript type string.
 * Handles nested object/array with structured items and properties.
 */
function propertySchemaToTypeScriptType(schema: PropertySchema): string {
  const type = schema.type;
  if (!type) {
    return "unknown";
  }
  switch (type) {
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "integer":
    case "double":
      return "number";
    case "array":
      if (schema.items) {
        return `(${propertySchemaToTypeScriptType(schema.items)})[]`;
      }
      return "string[]";
    case "object": {
      const props = schema.properties;
      if (props && typeof props === "object" && Object.keys(props).length > 0) {
        const requiredSet = new Set(schema.required || []);
        const entries = Object.entries(props)
          .map(([k, v]) => {
            const propType = propertySchemaToTypeScriptType(v);
            const optional = requiredSet.size > 0 && !requiredSet.has(k);
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
 * Converts a VariableSchema to the TypeScript return type for its getter.
 * Uses structured items/properties when present for full type safety.
 */
function variableSchemaToTypeScriptType(variableSchema: VariableSchema): string {
  const type = variableSchema.type;

  if (type === "json") {
    return "T"; // generic, caller supplies T
  }

  if (type === "object") {
    const props = variableSchema.properties;
    if (props && typeof props === "object" && Object.keys(props).length > 0) {
      const requiredSet = new Set((variableSchema.required as string[]) || []);
      const entries = Object.entries(props)
        .map(([k, v]) => {
          const propType = propertySchemaToTypeScriptType(v as PropertySchema);
          const optional = requiredSet.size > 0 && !requiredSet.has(k);
          return optional ? `${k}?: ${propType}` : `${k}: ${propType}`;
        })
        .join("; ");
      return `{ ${entries} }`;
    }
    return "Record<string, unknown>";
  }

  if (type === "array") {
    if (variableSchema.items) {
      const itemType = propertySchemaToTypeScriptType(variableSchema.items as PropertySchema);
      return `${itemType}[]`;
    }
    return "string[]";
  }

  return convertFeaturevisorTypeToTypeScriptType(type);
}

/**
 * Generates TypeScript type/interface declarations and metadata for a variable.
 * Returns declarations to emit (interface or type alias) plus the type name and generic to use in the getter.
 */
function generateVariableTypeDeclarations(
  variableKey: string,
  variableSchema: VariableSchema,
): { declarations: string[]; returnTypeName: string; genericArg: string } {
  const typeName = getPascalCase(variableKey) + "Variable";
  const itemTypeName = getPascalCase(variableKey) + "Item";
  const type = variableSchema.type;
  const declarations: string[] = [];

  if (type === "json") {
    return { declarations: [], returnTypeName: "T", genericArg: "T" };
  }

  if (type === "object") {
    const props = variableSchema.properties;
    if (props && typeof props === "object" && Object.keys(props).length > 0) {
      const requiredSet = new Set((variableSchema.required as string[]) || []);
      const entries = Object.entries(props)
        .map(([k, v]) => {
          const propType = propertySchemaToTypeScriptType(v as PropertySchema);
          const optional = requiredSet.size > 0 && !requiredSet.has(k);
          return optional ? `    ${k}?: ${propType};` : `    ${k}: ${propType};`;
        })
        .join("\n");
      declarations.push(`  export interface ${typeName} {\n${entries}\n  }`);
      return { declarations, returnTypeName: typeName, genericArg: typeName };
    }
    declarations.push(`  export type ${typeName} = Record<string, unknown>;`);
    return { declarations, returnTypeName: typeName, genericArg: typeName };
  }

  if (type === "array") {
    if (variableSchema.items) {
      const items = variableSchema.items as PropertySchema;
      if (items.type === "object" && items.properties && Object.keys(items.properties).length > 0) {
        const requiredSet = new Set(items.required || []);
        const entries = Object.entries(items.properties)
          .map(([k, v]) => {
            const propType = propertySchemaToTypeScriptType(v);
            const optional = requiredSet.size > 0 && !requiredSet.has(k);
            return optional ? `    ${k}?: ${propType};` : `    ${k}: ${propType};`;
          })
          .join("\n");
        declarations.push(`  export interface ${itemTypeName} {\n${entries}\n  }`);
        const returnType = `${itemTypeName}[]`;
        return { declarations, returnTypeName: returnType, genericArg: returnType };
      }
      // array of primitive (e.g. string)
      const itemType = propertySchemaToTypeScriptType(items);
      declarations.push(`  export type ${typeName} = ${itemType}[];`);
      return { declarations, returnTypeName: typeName, genericArg: typeName };
    }
    // array without items (default string[])
    declarations.push(`  export type ${typeName} = string[];`);
    return { declarations, returnTypeName: typeName, genericArg: typeName };
  }

  // primitive: boolean, string, integer, double
  const primitiveType = convertFeaturevisorTypeToTypeScriptType(type);
  declarations.push(`  export type ${typeName} = ${primitiveType};`);
  return { declarations, returnTypeName: typeName, genericArg: typeName };
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

export async function generateTypeScriptCodeForProject(deps: Dependencies, outputPath: string) {
  const { rootDirectoryPath, datasource } = deps;

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
import type { AttributeKey, AttributeValue } from "@featurevisor/types";

export interface Context {
${attributeProperties}
  [key: AttributeKey]: AttributeValue;
}
`.trimStart();

  const contextTypeFilePath = path.join(outputPath, "Context.ts");
  fs.writeFileSync(contextTypeFilePath, contextContent);
  console.log(
    `Context type file written at: ${getRelativePath(rootDirectoryPath, contextTypeFilePath)}`,
  );

  // features
  const featureNamespaces: string[] = [];
  const featureFiles = await datasource.listFeatures();

  for (const featureKey of featureFiles) {
    const parsedFeature = await datasource.readFeature(featureKey);

    if (typeof parsedFeature.archived !== "undefined" && parsedFeature.archived) {
      continue;
    }

    const namespaceValue = getPascalCase(featureKey) + "Feature";
    featureNamespaces.push(namespaceValue);

    let variableTypeDeclarations = "";
    let variableMethods = "";

    if (parsedFeature.variablesSchema) {
      const variableKeys = Object.keys(parsedFeature.variablesSchema);
      const allDeclarations: string[] = [];

      for (const variableKey of variableKeys) {
        const variableSchema = parsedFeature.variablesSchema[variableKey];
        const variableType = variableSchema.type;
        const { declarations, returnTypeName, genericArg } = generateVariableTypeDeclarations(
          variableKey,
          variableSchema,
        );
        allDeclarations.push(...declarations);

        const internalMethodName = `getVariable${
          variableType === "json" ? "JSON" : getPascalCase(variableType)
        }`;

        const hasGeneric = variableType === "json" || variableType === "array" || variableType === "object";
        if (variableType === "json") {
          variableMethods += `

  export function get${getPascalCase(variableKey)}<T = unknown>(context: Context = {}): T | null {
    return getInstance().${internalMethodName}<T>(key, "${variableKey}", context);
  }`;
        } else if (hasGeneric) {
          variableMethods += `

  export function get${getPascalCase(variableKey)}(context: Context = {}): ${returnTypeName} | null {
    return getInstance().${internalMethodName}<${genericArg}>(key, "${variableKey}", context);
  }`;
        } else {
          variableMethods += `

  export function get${getPascalCase(variableKey)}(context: Context = {}): ${returnTypeName} | null {
    return getInstance().${internalMethodName}(key, "${variableKey}", context);
  }`;
        }
      }

      if (allDeclarations.length > 0) {
        variableTypeDeclarations = "\n\n  // Variable types (from variablesSchema)\n" + allDeclarations.join("\n\n");
      }
    }

    const featureContent = `
import { Context } from "./Context";
import { getInstance } from "./instance";

export namespace ${namespaceValue} {
  export const key = "${featureKey}";${variableTypeDeclarations}

  export function isEnabled(context: Context = {}) {
    return getInstance().isEnabled(key, context);
  }

  export function getVariation(context: Context = {}) {
    return getInstance().getVariation(key, context);
  }${variableMethods}
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

  // index
  const indexContent =
    [`export * from "./Context";`, `export * from "./instance";`]
      .concat(
        featureNamespaces.map((featureNamespace) => {
          return `export * from "./${featureNamespace}";`;
        }),
      )
      .join("\n") + "\n";
  const indexFilePath = path.join(outputPath, "index.ts");
  fs.writeFileSync(indexFilePath, indexContent);
  console.log(`Index file written at: ${getRelativePath(rootDirectoryPath, indexFilePath)}`);
}
