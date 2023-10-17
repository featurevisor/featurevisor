import * as fs from "fs";
import * as path from "path";

import { Attribute } from "@featurevisor/types";
import { Dependencies } from "../dependencies";

function convertFeaturevisorTypeToTypeScriptType(featurevisorType: string) {
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
      return "any"; // @TODO: do a flat dictionary
    case "json":
      return "any";
    default:
      throw new Error(`Unknown type: ${featurevisorType}`);
  }
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getFeaturevisorTypeFromValue(value) {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return "integer";
    }

    return "double";
  }

  if (value instanceof Date) {
    return "date";
  }

  throw new Error("Could not detect Featurevisor type from value");
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
import { AttributeKey, AttributeValue } from "@featurevisor/types";

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

    let variableMethods = "";

    if (parsedFeature.variablesSchema) {
      for (const variableSchema of parsedFeature.variablesSchema) {
        const variableKey = variableSchema.key;
        const variableType = variableSchema.type;

        const internalMethodName = `getVariable${
          variableType === "json" ? "JSON" : getPascalCase(variableType)
        }`;

        if (variableType === "json" || variableType === "object") {
          variableMethods += `

  export function get${getPascalCase(variableKey)}<T>(context: Context = {}) {
    return getInstance().${internalMethodName}<T>(key, "${variableKey}", context);
  }`;
        } else {
          variableMethods += `

  export function get${getPascalCase(variableKey)}(context: Context = {}) {
    return getInstance().${internalMethodName}(key, "${variableKey}", context);
  }`;
        }
      }
    }

    const featureContent = `
import { Context } from "./Context";
import { getInstance } from "./instance";

export namespace ${namespaceValue} {
  export const key = "${featureKey}";

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
