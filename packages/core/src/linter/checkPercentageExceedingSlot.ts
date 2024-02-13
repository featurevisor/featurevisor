import { Group } from "@featurevisor/types";

import { Datasource } from "../datasource";

// @TODO: ideally in future, this check should be done from Feature level,
// as well as Group level as done here
export async function checkForFeatureExceedingGroupSlotPercentage(
  datasource: Datasource,
  group: Group,
  availableFeatureKeys: string[],
) {
  for (const slot of group.slots) {
    const maxPercentageForRule = slot.percentage;

    if (slot.feature) {
      const featureKey = slot.feature;
      const featureExists = availableFeatureKeys.indexOf(featureKey) > -1;

      if (!featureExists) {
        throw new Error(`Unknown feature "${featureKey}"`);
      }

      const parsedFeature = await datasource.readFeature(featureKey);

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
}
