import type { Condition } from "./condition";
import type {
  EnvironmentKey,
  RequiredFeature,
  RequiredFeatures,
  Tag,
  VariableType,
  VariableValue,
} from "./feature";
import type { Schema, SchemaKey } from "./schema";
import type { GroupSegment } from "./segment";

export type GlobalVariableKey = string;

interface ParsedVariableOverrideBase {
  key: string;
  description?: string;
  promotable?: boolean;
}

type ParsedVariableOverrideSelector =
  | {
      conditions: Condition | Condition[];
      segments?: never;
      requiredFeatures?: RequiredFeatures;
    }
  | {
      segments: GroupSegment | GroupSegment[] | "*";
      conditions?: never;
      requiredFeatures?: RequiredFeatures;
    }
  | {
      requiredFeatures: RequiredFeatures;
      conditions?: never;
      segments?: never;
    };

type ParsedVariableOverrideValue =
  | { value: VariableValue; mutate?: never }
  | { mutate: Record<string, VariableValue>; value?: never };

export type ParsedVariableOverride = ParsedVariableOverrideBase &
  ParsedVariableOverrideSelector &
  ParsedVariableOverrideValue;

export type ParsedVariableOverrides =
  | ParsedVariableOverride[]
  | Record<EnvironmentKey, ParsedVariableOverride[]>;

export type ParsedVariable = Omit<Schema, "type" | "schema"> & {
  type?: VariableType;
  schema?: SchemaKey;
  defaultValue: VariableValue;
  disabledValue?: VariableValue;
  useDefaultWhenDisabled?: boolean;
  deprecated?: boolean;
  archived?: boolean;
  promotable?: boolean;
  tags?: Tag[];
  requiredFeatures?: RequiredFeatures;
  overrides?: ParsedVariableOverrides;
};

interface DatafileVariableOverrideBase {
  key: string;
  value: VariableValue;
}

type DatafileVariableOverrideSelector =
  | {
      segments: GroupSegment | GroupSegment[] | string;
      conditions?: never;
      requiredFeatures?: RequiredFeature[];
    }
  | {
      conditions: Condition | Condition[] | string;
      segments?: never;
      requiredFeatures?: RequiredFeature[];
    }
  | {
      requiredFeatures: RequiredFeature[];
      segments?: never;
      conditions?: never;
    };

export type DatafileVariableOverride = DatafileVariableOverrideBase &
  DatafileVariableOverrideSelector;

export interface DatafileVariable {
  hash?: string;
  deprecated?: boolean;
  type: VariableType;
  defaultValue: VariableValue;
  disabledValue?: VariableValue;
  useDefaultWhenDisabled?: boolean;
  requiredFeatures?: RequiredFeature[];
  overrides?: DatafileVariableOverride[];
}

export type EvaluatedVariables = Record<GlobalVariableKey, VariableValue>;

export type StickyVariables = EvaluatedVariables;
