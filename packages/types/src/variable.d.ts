import type { Conditions } from "./condition";
import type {
  EnvironmentKey,
  RequiredFeature,
  Tag,
  VariableKey,
  VariableType,
  DatafileVariableType,
  VariableValue,
  VariableMutations,
} from "./feature";
import type { Schema, SchemaKey } from "./schema";
import type { GroupSegment } from "./segment";

interface ParsedVariableOverrideBase {
  key: string;
  /** Continue with sibling overrides after this override and its children match. */
  continue?: boolean;
  description?: string;
  promotable?: boolean;
  conditions: Conditions;
}

type ParsedVariableOverrideValue =
  | { value: VariableValue; mutate?: never }
  | { mutate: VariableMutations; value?: never };

export type ParsedVariableOverride = ParsedVariableOverrideBase &
  ParsedVariableOverrideValue & {
    /** Ordered refinements evaluated after this override matches. */
    overrides?: ParsedVariableOverride[];
  };

export type ParsedVariableOverrides =
  | ParsedVariableOverride[]
  | Record<EnvironmentKey, ParsedVariableOverride[]>;

export type OrdinaryParsedVariable = Omit<Schema, "type" | "schema"> & {
  compose?: never;
  type?: VariableType;
  schema?: SchemaKey;
  defaultValue: VariableValue;
  disabledValue?: VariableValue;
  useDefaultWhenDisabled?: boolean;
  deprecated?: boolean;
  archived?: boolean;
  promotable?: boolean;
  tags?: Tag[];
  conditions?: Conditions;
  overrides?: ParsedVariableOverrides;
};

/** Evaluated references, not literals or selectors. */
export type ComposeReference =
  | { feature: string; variation?: true; variable?: never }
  | { feature: string; variable: string; variation?: never }
  | { variable: string; feature?: never; variation?: never };

export type ComposedParsedVariable = {
  /** A source variable key, or named references assembled into an object. */
  compose: string | Record<string, ComposeReference>;
  conditions?: Conditions;
  /** Returned when root conditions fail. Otherwise the disabled result is null. */
  disabledValue?: VariableValue;
  overrides?: ParsedVariableOverrides;
  description?: string;
  tags?: Tag[];
  deprecated?: boolean;
  archived?: boolean;
  promotable?: boolean;
} & Partial<
  Record<
    Exclude<
      keyof OrdinaryParsedVariable,
      | "compose"
      | "conditions"
      | "disabledValue"
      | "overrides"
      | "description"
      | "tags"
      | "deprecated"
      | "archived"
      | "promotable"
    >,
    never
  >
>;

export type ParsedVariable = OrdinaryParsedVariable | ComposedParsedVariable;

export interface DatafileVariableOverride {
  key: string;
  /** Authored key route for a flattened nested override. */
  keyPath?: string[];
  value: VariableValue;
  /** @deprecated Legacy v3 selector, normalized when loaded. */
  segments?: GroupSegment | GroupSegment[] | string;
  conditions?: Conditions;
  /** @deprecated Legacy v3 gate, normalized when loaded. */
  requiredFeatures?: RequiredFeature[];
}

/** Paths are compiled by the CLI; SDKs never parse mutation notation. */
export type VariableMutationPathPart =
  | string
  | number
  | { select: { property: string; values: Array<string | number | boolean | null> } };

export type VariableMutationOperation = {
  path: VariableMutationPathPart[];
} & (
  | { op: "set" | "append" | "prepend" | "before" | "after"; value: VariableValue }
  | { op: "appendUnique" | "removeValue"; value: string | number | boolean | null }
  | { op: "remove" }
);

/** Forward only control flow compiled from a nested override tree. */
export interface DatafileVariableOverrideStep extends Omit<DatafileVariableOverride, "value"> {
  operations: VariableMutationOperation[];
  onMatch: number;
  onMiss: number;
}

export interface OrdinaryDatafileVariable {
  compose?: never;
  conditions?: Conditions;
  hash?: string;
  deprecated?: boolean;
  type: DatafileVariableType;
  defaultValue: VariableValue;
  disabledValue?: VariableValue;
  useDefaultWhenDisabled?: boolean;
  /** @deprecated Legacy v3 gate, normalized when loaded. */
  requiredFeatures?: RequiredFeature[];
  overrides?: DatafileVariableOverride[];
  /** Requires an SDK supporting runtime variable override programs. */
  overrideProgram?: DatafileVariableOverrideStep[];
}

export type DatafileComposeEntry = ComposeReference & { key: string };

export type ComposedDatafileVariable = {
  type: DatafileVariableType;
  compose: string | DatafileComposeEntry[];
  conditions?: Conditions;
  disabledValue?: VariableValue;
  overrideProgram?: DatafileVariableOverrideStep[];
  hash?: string;
  deprecated?: boolean;
} & Partial<
  Record<
    Exclude<
      keyof OrdinaryDatafileVariable,
      | "compose"
      | "conditions"
      | "disabledValue"
      | "overrideProgram"
      | "type"
      | "hash"
      | "deprecated"
    >,
    never
  >
>;

export type DatafileVariable = OrdinaryDatafileVariable | ComposedDatafileVariable;

export type EvaluatedVariables = Record<VariableKey, VariableValue>;

export type StickyVariables = EvaluatedVariables;
