import type {
  DatafileContentV1,
  FeatureV1,
  VariableSchema,
  VariationV1,
  Variation,
  VariableV1,
  Feature,
  Segment,
  Attribute,
} from "@featurevisor/types";

import { ProjectConfig } from "../config";

export interface ConvertToV1Options {
  revision: string;
  projectConfig: ProjectConfig;
  attributes: Attribute[];
  features: Feature[];
  segments: Segment[];
}

export function convertToV1(options: ConvertToV1Options): DatafileContentV1 {
  const datafileContent: DatafileContentV1 = {
    schemaVersion: "1",
    revision: options.revision,
    attributes: options.attributes,
    segments: options.segments,
    features: [],
  };

  const { features, projectConfig } = options;

  for (const feature of features) {
    const featureV1: FeatureV1 = {
      key: feature.key,
      deprecated: feature.deprecated,
      bucketBy: feature.bucketBy,
      required: feature.required,
      traffic: feature.traffic,
      force: feature.force,
      ranges: feature.ranges,
    };

    if (feature.variablesSchema && !Array.isArray(feature.variablesSchema)) {
      const variablesSchemaObject = feature.variablesSchema;
      const variablesSchemaArray: VariableSchema[] = [];
      const variableKeys = Object.keys(variablesSchemaObject);

      for (const variableKey of variableKeys) {
        const v = variablesSchemaObject[variableKey];
        variablesSchemaArray.push({
          key: variableKey,
          type: v.type,
          defaultValue: v.defaultValue,
          deprecated: v.deprecated === true ? true : undefined,
        });
      }

      featureV1.variablesSchema = variablesSchemaArray;
    }

    if (feature.variations) {
      const variationsV1: VariationV1[] = feature.variations.map((variation: Variation) => {
        const variationV1: VariationV1 = {
          value: variation.value,
          weight: variation.weight || 0, // weight is not used in v1 datafile, but needed for state files
        };

        // variables
        const variablesResult: { [key: string]: VariableV1 } = {};

        if (variation.variables) {
          const variableKeys = Object.keys(variation.variables);

          for (const variableKey of variableKeys) {
            const variableValue = variation.variables[variableKey];

            variablesResult[variableKey] = {
              key: variableKey,
              value: variableValue,
            };
          }
        }

        if (variation.variableOverrides) {
          const variableKeys = Object.keys(variation.variableOverrides);

          for (const variableKey of variableKeys) {
            const overrides = variation.variableOverrides[variableKey];

            if (typeof variablesResult[variableKey] === "undefined") {
              const variableSchema = feature.variablesSchema?.[variableKey];

              variablesResult[variableKey] = {
                key: variableKey,
                value: variableSchema?.defaultValue, // default value if no variable is defined
              };
            }

            variablesResult[variableKey].overrides = overrides.map((override) => {
              if (typeof override.conditions !== "undefined") {
                return {
                  conditions: projectConfig.stringify
                    ? JSON.stringify(override.conditions)
                    : override.conditions,
                  value: override.value,
                };
              }

              if (typeof override.segments !== "undefined") {
                return {
                  segments:
                    typeof override.segments !== "string" && projectConfig.stringify
                      ? JSON.stringify(override.segments)
                      : override.segments,
                  value: override.value,
                };
              }

              return {
                value: override.value,
              };
            });
          }
        }

        variationV1.variables = Object.keys(variablesResult).map((variableKey) => {
          const variable = variablesResult[variableKey];

          return {
            key: variable.key,
            value: variable.value,
            overrides: variable.overrides,
          };
        });

        return variationV1;
      });

      featureV1.variations = variationsV1;

      if (featureV1.force) {
        featureV1.force = featureV1.force.map((force) => {
          if (
            force.conditions &&
            typeof force.conditions === "string" &&
            force.conditions !== "*"
          ) {
            force.conditions = JSON.parse(force.conditions);
          }

          if (force.segments && typeof force.segments === "string" && force.segments !== "*") {
            force.segments = JSON.parse(force.segments);
          }

          return force;
        });
      }

      datafileContent.features.push(featureV1);
    }
  }

  return datafileContent;
}
