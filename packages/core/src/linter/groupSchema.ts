import * as Joi from "joi";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

export function getGroupJoiSchema(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  availableFeatureKeys: string[],
) {
  const groupJoiSchema = Joi.object({
    description: Joi.string().required(),
    slots: Joi.array()
      .items(
        Joi.object({
          feature: Joi.string().valid(...availableFeatureKeys),
          percentage: Joi.number().precision(3).min(0).max(100),
        }),
      )
      .custom(function (value) {
        const totalPercentage = value.reduce((acc, slot) => acc + slot.percentage, 0);

        if (totalPercentage !== 100) {
          throw new Error("total percentage is not 100");
        }

        for (const slot of value) {
          const maxPercentageForRule = slot.percentage;

          if (slot.feature) {
            const featureKey = slot.feature;
            const featureExists = datasource.entityExists("feature", featureKey);

            if (!featureExists) {
              throw new Error(`feature ${featureKey} not found`);
            }

            const parsedFeature = datasource.readFeature(featureKey);

            const environmentKeys = Object.keys(parsedFeature.environments);
            for (const environmentKey of environmentKeys) {
              const environment = parsedFeature.environments[environmentKey];
              const rules = environment.rules;

              for (const rule of rules) {
                if (rule.percentage > maxPercentageForRule) {
                  // @TODO: this does not help with same feature belonging to multiple slots. fix that.
                  throw new Error(
                    `Feature ${featureKey}'s rule ${rule.key} in ${environmentKey} has a percentage of ${rule.percentage} which is greater than the maximum percentage of ${maxPercentageForRule} for the slot`,
                  );
                }
              }
            }
          }
        }

        return value;
      })
      .required(),
  });

  return groupJoiSchema;
}
