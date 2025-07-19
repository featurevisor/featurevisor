import type { FeatureKey, RuleKey, VariationValue, Weight } from "./feature";
import type { Percentage, Allocation, Range } from "./datafile";

export interface ExistingFeature {
  hash?: string;
  variations?: {
    value: VariationValue;
    weight: Weight;
  }[];
  traffic: {
    key: RuleKey;
    percentage: Percentage;
    allocation?: Allocation[];
  }[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface ExistingFeatures {
  [key: FeatureKey]: ExistingFeature;
}

export interface ExistingState {
  features: ExistingFeatures;
}
