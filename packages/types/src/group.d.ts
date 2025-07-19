import type { FeatureKey, Weight } from "./feature";

export interface Slot {
  feature: FeatureKey | false;
  percentage: Weight; // 0 to 100
}

export interface Group {
  key: string;
  description: string;
  slots: Slot[];
}
