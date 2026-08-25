import type { Condition } from "./condition";
import type { EnvironmentKey, Required, Tag, VariableType, VariableValue } from "./feature";
import type { Schema, SchemaKey } from "./schema";
import type { GroupSegment } from "./segment";

export type GlobalVariableKey = string;

export interface ParsedVariableOverride {
  key: string;
  description?: string;
  promotable?: boolean;
  segments?: GroupSegment | GroupSegment[] | "*";
  conditions?: Condition | Condition[];
  requiredFeatures?: Required[];
  value?: VariableValue;
  mutate?: Record<string, VariableValue>;
}

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
  requiredFeatures?: Required[];
  overrides?: ParsedVariableOverrides;
};

export interface DatafileVariableOverride {
  key: string;
  segments?: GroupSegment | GroupSegment[] | string;
  conditions?: Condition | Condition[] | string;
  requiredFeatures?: Required[];
  value: VariableValue;
}

export interface DatafileVariable {
  hash?: string;
  deprecated?: boolean;
  type: VariableType;
  defaultValue: VariableValue;
  disabledValue?: VariableValue;
  useDefaultWhenDisabled?: boolean;
  requiredFeatures?: Required[];
  overrides?: DatafileVariableOverride[];
}

export type StickyVariables = Record<GlobalVariableKey, VariableValue>;
