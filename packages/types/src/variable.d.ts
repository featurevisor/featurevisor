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
  ParsedVariableOverrideValue & {
    /** Ordered refinements evaluated after this override matches. */
    overrides?: ParsedVariableOverride[];
  };

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

export interface DatafileVariableOverride {
  key: string;
  /** Authored key route for a flattened nested override. */
  keyPath?: string[];
  value: VariableValue;
  /** Both selectors may be present after nested authoring selectors are flattened. */
  segments?: GroupSegment | GroupSegment[] | string;
  conditions?: Condition | Condition[] | string;
  requiredFeatures?: RequiredFeature[];
}

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
