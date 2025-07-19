import type { Attribute } from "./attribute";
import type { BucketBy } from "./bucket";
import type {
  VariationValue,
  RuleKey,
  VariableValue,
  Weight,
  FeatureKey,
  Required,
  VariableKey,
  VariableSchema,
  Variation,
  Force,
  VariationV1,
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

  allocation?: Allocation[];
}

export interface Feature {
  key?: FeatureKey; // needed for supporting v1 datafile generation
  hash?: string;
  deprecated?: boolean;
  required?: Required[];
  variablesSchema?: Record<VariableKey, VariableSchema>;
  disabledVariationValue?: VariationValue;
  variations?: Variation[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface FeatureV1 {
  key?: FeatureKey;
  hash?: string;
  deprecated?: boolean;
  required?: Required[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges

  variablesSchema?: VariableSchema[];
  variations?: VariationV1[];
}

export interface DatafileContentV1 {
  schemaVersion: string;
  revision: string;
  attributes: Attribute[];
  segments: Segment[];
  features: FeatureV1[];
}

export interface DatafileContent {
  schemaVersion: string;
  revision: string;
  segments: {
    [key: SegmentKey]: Segment;
  };
  features: {
    [key: FeatureKey]: Feature;
  };
}
