import * as fs from "fs";
import * as path from "path";

import type { Attribute, Schema, VariableSchema } from "@featurevisor/types";
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
function schemaToTypeScriptType(schema: Schema): string {
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
        return `(${schemaToTypeScriptType(schema.items)})[]`;
      }
      return "string[]";
    case "object": {
      const props = schema.properties;
      if (props && typeof props === "object" && Object.keys(props).length > 0) {
        const requiredSet = new Set(schema.required || []);
        const entries = Object.entries(props)
          .map(([k, v]) => {
            const propType = schemaToTypeScriptType(v);
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
 * Generates TypeScript type/interface declarations and metadata for a variable.
 * Returns declarations to emit (interface or type alias) plus the type name and generic to use in the getter.
 */
function generateVariableTypeDeclarations(
  variableKey: string,
  variableSchema: VariableSchema,
): { declarations: string[]; returnTypeName: string; genericArg: string } {
  const typeName = getPascalCase(variableKey) + "Variable";
  const itemTypeName = getPascalCase(variableKey) + "VariableItem";
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
          const propType = schemaToTypeScriptType(v as Schema);
          const optional = !requiredSet.has(k);
          return optional
            ? `${INDENT_NS_BODY}${k}?: ${propType};`
            : `${INDENT_NS_BODY}${k}: ${propType};`;
        })
        .join("\n");
      declarations.push(`${INDENT_NS}export interface ${typeName} {\n${entries}\n${INDENT_NS}}`);
      return { declarations, returnTypeName: typeName, genericArg: typeName };
    }
    declarations.push(`${INDENT_NS}export type ${typeName} = Record<string, unknown>;`);
    return { declarations, returnTypeName: typeName, genericArg: typeName };
  }

  if (type === "array") {
    if (variableSchema.items) {
      const items = variableSchema.items as Schema;
      if (items.type === "object" && items.properties && Object.keys(items.properties).length > 0) {
        const requiredSet = new Set(items.required || []);
        const entries = Object.entries(items.properties)
          .map(([k, v]) => {
            const propType = schemaToTypeScriptType(v);
            const optional = !requiredSet.has(k);
            return optional
              ? `${INDENT_NS_BODY}${k}?: ${propType};`
              : `${INDENT_NS_BODY}${k}: ${propType};`;
          })
          .join("\n");
        declarations.push(
          `${INDENT_NS}export interface ${itemTypeName} {\n${entries}\n${INDENT_NS}}`,
        );
        // getVariableArray<T> returns T[] | null, so generic is item type
        return {
          declarations,
          returnTypeName: `${itemTypeName}[]`,
          genericArg: itemTypeName,
        };
      }
      // array of primitive (e.g. string): emit item type only, use item[] in methods
      const itemType = schemaToTypeScriptType(items);
      declarations.push(`${INDENT_NS}export type ${itemTypeName} = ${itemType};`);
      return {
        declarations,
        returnTypeName: `${itemTypeName}[]`,
        genericArg: itemTypeName,
      };
    }
    // array without items (default string[]): emit item type only
    declarations.push(`${INDENT_NS}export type ${itemTypeName} = string;`);
    return {
      declarations,
      returnTypeName: `${itemTypeName}[]`,
      genericArg: itemTypeName,
    };
  }

  // primitive: boolean, string, integer, double
  const primitiveType = convertFeaturevisorTypeToTypeScriptType(type);
  declarations.push(`${INDENT_NS}export type ${typeName} = ${primitiveType};`);
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

        const hasGeneric =
          variableType === "json" || variableType === "array" || variableType === "object";
        if (variableType === "json") {
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
${INDENT_NS_BODY}return getInstance().${internalMethodName}(key, "${variableKey}", context);
${INDENT_NS}}`;
        }
      }

      if (allDeclarations.length > 0) {
        variableTypeDeclarations = "\n\n" + allDeclarations.join("\n\n");
      }
    }

    const featureContent = `
import { Context } from "./Context";
import { getInstance } from "./instance";

export namespace ${namespaceValue} {
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
