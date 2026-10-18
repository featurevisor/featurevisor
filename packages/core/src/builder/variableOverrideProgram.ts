import type {
  ParsedVariableOverride,
  VariableMutationOperation,
  VariableMutationPathPart,
  DatafileVariableOverrideStep,
} from "@featurevisor/types";
import { compileConditions } from "../datasource/conditions";
import { mutationEntries } from "./mutationEntries";

const forbidden = (key: string) => ["__proto__", "prototype", "constructor"].includes(key);

/** A strict compiler for the existing notation, not a runtime expression parser. */
export function compileVariableMutation(
  notation: string,
  value: unknown,
): VariableMutationOperation {
  let source = notation.trim();
  const suffix = source.match(/:(append|prepend|appendUnique|removeValue|before|after|remove)$/);
  const op = (suffix ? suffix[1] : "set") as VariableMutationOperation["op"];
  if (suffix) source = source.slice(0, -suffix[0].length);
  const path: VariableMutationPathPart[] = [];
  const invalid = () => {
    throw new Error(`Invalid mutation notation: ${notation}`);
  };
  let i = 0;
  while (i < source.length) {
    if (source[i] === "[") {
      const end = source.indexOf("]", i + 1);
      if (end === -1) invalid();
      const content = source.slice(i + 1, end).trim();
      const eq = content.indexOf("=");
      if (eq === -1) {
        if (!/^(0|[1-9]\d*)$/.test(content) || !Number.isSafeInteger(Number(content))) invalid();
        path.push(Number(content));
      } else {
        const property = content.slice(0, eq).trim();
        let literal = content.slice(eq + 1).trim();
        if (!property || forbidden(property)) invalid();
        if (literal.startsWith('"') || literal.startsWith("'")) {
          if (literal.length < 2 || literal[literal.length - 1] !== literal[0]) invalid();
          literal = literal.slice(1, -1);
        }
        const values: Array<string | number | boolean | null> = [literal];
        // Preserve common numeric/string matching without runtime JS string coercion.
        if (
          literal !== "" &&
          Number.isFinite(Number(literal)) &&
          String(Number(literal)) === literal
        )
          values.push(Number(literal));
        if (literal === "true" || literal === "false") values.push(literal === "true");
        if (literal === "null") values.push(null);
        path.push({ select: { property, values } });
      }
      i = end + 1;
    } else {
      const start = i;
      while (i < source.length && source[i] !== "." && source[i] !== "[") i++;
      const property = source.slice(start, i).trim();
      if (!property || /[:\]]/.test(property) || forbidden(property)) invalid();
      path.push(property);
    }
    if (i < source.length && source[i] === ".") {
      i++;
      if (i === source.length || source[i] === "." || source[i] === "[") invalid();
    } else if (i < source.length && source[i] !== "[") invalid();
  }
  if (!path.length && !["append", "prepend", "appendUnique", "removeValue"].includes(op)) invalid();
  if ((op === "before" || op === "after") && typeof path[path.length - 1] === "string") invalid();
  if (
    (op === "appendUnique" || op === "removeValue") &&
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error(
      `Mutation "${notation}" requires a primitive value (string, number, boolean or null)`,
    );
  }
  return (op === "remove" ? { op, path } : { op, path, value }) as VariableMutationOperation;
}

export function compileVariableOperations(
  override: ParsedVariableOverride,
): VariableMutationOperation[] {
  if (override.mutate !== undefined) {
    return mutationEntries(override.mutate).map(([key, value]) =>
      compileVariableMutation(key, value),
    );
  }
  return [{ op: "set", path: [], value: override.value! }];
}

export function hasContinuingVariableOverrides(
  overrides: ParsedVariableOverride[] | undefined,
): boolean {
  return (overrides || []).some(
    (override) => override.continue === true || hasContinuingVariableOverrides(override.overrides),
  );
}

/** Literal only trees need no runtime mutation program unless they continue. */
export function hasVariableOverrideMutations(
  overrides: ParsedVariableOverride[] | undefined,
): boolean {
  return (overrides || []).some(
    (override) => override.mutate !== undefined || hasVariableOverrideMutations(override.overrides),
  );
}

/** Compile sibling continuation and child return targets into forward only jumps. */
export function buildVariableOverrideProgram(
  overrides: ParsedVariableOverride[],
  stringify = false,
): DatafileVariableOverrideStep[] {
  const result: DatafileVariableOverrideStep[] = [];
  const compile = (
    entries: ParsedVariableOverride[],
    parentPath: string[],
  ): Array<(end: number) => void> => {
    const exits: Array<(end: number) => void> = [];
    for (const override of entries) {
      const index = result.length;
      const keyPath = [...parentPath, override.key];
      const step: DatafileVariableOverrideStep = {
        key: override.key,
        keyPath,
        operations: compileVariableOperations(override),
        onMatch: index + 1,
        onMiss: index + 1,
      };
      step.conditions = compileConditions(override.conditions, stringify);
      result.push(step);
      const children = override.overrides || [];
      const childExits = compile(children, keyPath);
      const following = result.length;
      step.onMiss = following;
      const finish = (target: number) => {
        if (children.length) childExits.forEach((exit) => exit(target));
        else step.onMatch = target;
      };
      if (override.continue === true) finish(following);
      else exits.push(finish);
      // Last sibling misses/continues must return to the enclosing group's continuation.
      if (override === entries[entries.length - 1]) {
        exits.push((target) => {
          step.onMiss = target;
        });
        if (override.continue === true) exits.push(finish);
      }
    }
    return exits;
  };
  compile(overrides, []).forEach((exit) => exit(result.length));
  return result;
}
