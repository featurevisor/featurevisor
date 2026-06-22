import type { BucketBy } from "./bucket";
import type {
  VariationValue,
  RuleKey,
  VariableValue,
  Weight,
  FeatureKey,
  Required,
  VariableKey,
  ResolvedVariableSchema,
  Variation,
  Force,
  VariableOverride,
} from "./feature";
import type { GroupSegment, Segment, SegmentKey } from "./segment";

export type Percentage = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

export type Range = [Percentage, Percentage]; // 0 to 100k

export interface Allocation {
  variation: VariationValue;
  range: Range;
}

export interface Traffic {
  key: RuleKey;
  segments: GroupSegment | GroupSegment[] | "*";
  percentage: Percentage;

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
  variationWeights?: {
    [key: string]: Weight;
  };
  variableOverrides?: {
    [key: VariableKey]: VariableOverride[];
  };

  allocation?: Allocation[];
}

export interface Feature {
  key?: FeatureKey; // available while building, omitted from generated datafiles
  hash?: string;
  deprecated?: boolean;
  required?: Required[];
  variablesSchema?: Record<VariableKey, ResolvedVariableSchema>;
  disabledVariationValue?: VariationValue;
  variations?: Variation[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface DatafileContent {
  schemaVersion: string;
  revision: string;
  featurevisorVersion?: string; // @TODO: make it required in v3
  segments: {
    [key: SegmentKey]: Segment;
  };
  features: {
    [key: FeatureKey]: Feature;
  };
}
