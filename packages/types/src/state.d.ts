import type { FeatureKey, RuleKey, VariationValue, Weight } from "./feature";
import type { Percentage, Allocation } from "./datafile";

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
}

export interface ExistingFeatures {
  [key: FeatureKey]: ExistingFeature;
}

export interface ExistingState {
  features: ExistingFeatures;
}
