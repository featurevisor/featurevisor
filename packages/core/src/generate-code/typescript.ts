import * as fs from "fs";
import * as path from "path";

import { Attribute, ParsedFeature } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { getYAMLFiles, parseYaml } from "../utils";

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

export function generateTypeScriptCodeForProject(
  rootDirectoryPath: string,
  projectConfig: ProjectConfig,
  outputPath: string,
) {
  console.log("Generating TypeScript code...");

  // attributes
  const attributeFiles = getYAMLFiles(projectConfig.attributesDirectoryPath);
  const attributes = attributeFiles
    .map((attributeFile) => {
      const parsedAttribute = parseYaml(fs.readFileSync(attributeFile, "utf8")) as Attribute;

      const attributeKey = path.basename(attributeFile, ".yml");

      return {
        archived: parsedAttribute.archived,
        key: attributeKey,
        type: parsedAttribute.type,
        typescriptType: convertFeaturevisorTypeToTypeScriptType(parsedAttribute.type),
      };
    })
    .filter((attribute) => {
      if (typeof attribute.archived === "undefined") {
        return true;
      }

      return !attribute.archived;
    });

  const attributeProperties = attributes
    .map((attribute) => {
      return `  ${attribute.key}?: ${attribute.typescriptType};`;
    })
    .join("\n");
  const attributesContent = `export interface Attributes {
${attributeProperties}
  [key: string]: any;
}
`;

  const attributesTypeFilePath = path.join(outputPath, "Attributes.ts");
  fs.writeFileSync(attributesTypeFilePath, attributesContent);
  console.log(`Attributes type file written at: ${attributesTypeFilePath}`);

  // features
  const featureNamespaces: string[] = [];
  const featureFiles = getYAMLFiles(projectConfig.featuresDirectoryPath);
  for (const featureFile of featureFiles) {
    const featureKey = path.basename(featureFile, ".yml");
    const parsedFeature = parseYaml(fs.readFileSync(featureFile, "utf8")) as ParsedFeature;

    if (typeof parsedFeature.archived !== "undefined" && parsedFeature.archived) {
      continue;
    }

    const namespaceValue = getPascalCase(featureKey);
    featureNamespaces.push(namespaceValue);

    const featureContent = `export namespace ${namespaceValue} { }
`;

    const featureNamespaceFilePath = path.join(outputPath, `${namespaceValue}.ts`);
    fs.writeFileSync(featureNamespaceFilePath, featureContent);
    console.log(`Feature ${featureKey} file written at: ${featureNamespaceFilePath}`);
  }

  // index
  const indexContent =
    [`export * from "./Attributes";`]
      .concat(
        featureNamespaces.map((featureNamespace) => {
          return `export * from "./${featureNamespace}";`;
        }),
      )
      .join("\n") + "\n";
  const indexFilePath = path.join(outputPath, "index.ts");
  fs.writeFileSync(indexFilePath, indexContent);
  console.log(`Index file written at: ${indexFilePath}`);
}
