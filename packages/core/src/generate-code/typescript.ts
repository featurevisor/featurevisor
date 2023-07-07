import * as fs from "fs";
import * as path from "path";

import { Attribute } from "@featurevisor/types";

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
}`;

  const attributesTypeFilePath = path.join(outputPath, "Attributes.ts");
  fs.writeFileSync(attributesTypeFilePath, attributesContent);
}
