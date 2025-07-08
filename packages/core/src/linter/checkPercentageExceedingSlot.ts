import { Group, Rule } from "@featurevisor/types";

import { Datasource } from "../datasource";

// @NOTE: ideally in future, this check should be done from Feature level,
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

      const hasEnvironments =
        parsedFeature.rules &&
        !Array.isArray(parsedFeature.rules) &&
        Object.keys(parsedFeature.rules).length > 0;

      if (hasEnvironments && parsedFeature.rules) {
        // with environments
        const environmentKeys = Object.keys(parsedFeature.rules);

        for (const environmentKey of environmentKeys) {
          const rules = parsedFeature.rules[environmentKey];

          for (const rule of rules) {
            if (rule.percentage > maxPercentageForRule) {
              // @NOTE: this does not help with same feature belonging to multiple slots. fix that.
              throw new Error(
                `Feature ${featureKey}'s rule ${rule.key} in ${environmentKey} has a percentage of ${rule.percentage} which is greater than the maximum percentage of ${maxPercentageForRule} for the slot`,
              );
            }
          }
        }
      } else if (parsedFeature.rules) {
        // no environments
        const rules = parsedFeature.rules as Rule[];

        for (const rule of rules) {
          if (rule.percentage > maxPercentageForRule) {
            // @NOTE: this does not help with same feature belonging to multiple slots. fix that.
            throw new Error(
              `Feature ${featureKey}'s rule ${rule.key} has a percentage of ${rule.percentage} which is greater than the maximum percentage of ${maxPercentageForRule} for the slot`,
            );
          }
        }
      }
    }
  }
}
