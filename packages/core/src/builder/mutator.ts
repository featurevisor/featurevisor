import type { VariableMutationOperation, VariableSchema, VariableValue } from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";
import { compileVariableMutation } from "./variableOverrideProgram";

export type PathPart =
  | { key: string }
  | { key: string; index: number }
  | { key: string; selector: { prop: string; value: string } };

export type MutationOperation = VariableMutationOperation["op"];

export interface ParsedNotation {
  segments: PathPart[];
  operation: MutationOperation;
}

/** Adapt compiled paths for schema traversal, using the same strict notation parser. */
export function parseNotation(notation: string): ParsedNotation {
  const compiled = compileVariableMutation(notation, null);
  const segments: PathPart[] = [];
  for (const part of compiled.path) {
    if (typeof part === "string") {
      segments.push({ key: part });
    } else {
      const previous = segments[segments.length - 1];
      const key =
        previous && !("index" in previous) && !("selector" in previous) ? segments.pop()!.key : "";
      segments.push(
        typeof part === "number"
          ? { key, index: part }
          : { key, selector: { prop: part.select.property, value: String(part.select.values[0]) } },
      );
    }
  }
  return { segments, operation: compiled.op };
}

/** Build time and accumulating overrides share exactly the same mutation semantics. */
export function mutate(
  _schema: VariableSchema,
  value: VariableValue,
  notation: string,
  setValue: VariableValue | undefined,
): VariableValue {
  if (!notation.trim()) return value;
  const operation = compileVariableMutation(notation, setValue);
  if (value === undefined) return value;
  return applyVariableOperations(value, [operation]);
}
