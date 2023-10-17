import * as fs from "fs";

import { FeatureKey, Group, Range } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

export type FeatureRanges = Map<FeatureKey, Range[]>;

export interface FeatureRangesResult {
  featureRanges: FeatureRanges;
  featureIsInGroup: { [key: string]: boolean };
}

export async function getFeatureRanges(
  projectConfig: ProjectConfig,
  datasource: Datasource,
): Promise<FeatureRangesResult> {
  const featureRanges = new Map<FeatureKey, Range[]>();
  const featureIsInGroup = {}; // featureKey => boolean

  const groups: Group[] = [];
  if (fs.existsSync(projectConfig.groupsDirectoryPath)) {
    const groupFiles = await datasource.listGroups();

    for (const groupKey of groupFiles) {
      const parsedGroup = await datasource.readGroup(groupKey);

      groups.push({
        ...parsedGroup,
        key: groupKey,
      });

      let accumulatedPercentage = 0;
      parsedGroup.slots.forEach(function (slot, slotIndex) {
        const isFirstSlot = slotIndex === 0;

        if (slot.feature) {
          const featureKey = slot.feature;

          if (typeof featureKey === "string") {
            featureIsInGroup[featureKey] = true;
          }

          const featureRangesForFeature = featureRanges.get(featureKey) || [];

          const start = isFirstSlot ? accumulatedPercentage : accumulatedPercentage + 1;
          const end = accumulatedPercentage + slot.percentage * 1000;

          featureRangesForFeature.push([start, end]);

          featureRanges.set(slot.feature, featureRangesForFeature);
        }

        accumulatedPercentage += slot.percentage * 1000;
      });
    }
  }

  return { featureRanges, featureIsInGroup };
}
