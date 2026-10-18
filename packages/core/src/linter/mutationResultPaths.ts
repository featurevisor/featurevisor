import type {
  VariableMutations,
  VariableMutationOperation,
  VariableValue,
} from "@featurevisor/types";
import type { z } from "zod";
import { applyVariableOperations } from "@featurevisor/sdk";
import { mutationEntries } from "../builder/mutationEntries";
import { compileVariableMutation } from "../builder/variableOverrideProgram";

type Path = (string | number)[];
interface MutationTrace {
  key: string;
  index: number;
  path: Path;
  arrayChange?: { path: Path; inserted?: number; removed?: number[] };
}

function at(value: unknown, path: Path): any {
  return path.reduce<any>((node, key) => node?.[key], value);
}

function concretePath(value: unknown, operation: VariableMutationOperation): Path | undefined {
  let node: any = value;
  const path: Path = [];
  for (const part of operation.path) {
    let key: string | number;
    if (typeof part === "object") {
      if (!Array.isArray(node)) return;
      key = node.findIndex(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.prototype.hasOwnProperty.call(item, part.select.property) &&
          part.select.values.some((value) => item[part.select.property] === value),
      );
      if (key === -1) return;
    } else key = part;
    path.push(key);
    node = node?.[key];
  }
  return path;
}

function traceMutations(
  mutations: VariableMutations,
  baseValue: VariableValue,
  rootAlias?: string,
): MutationTrace[] {
  const traces: MutationTrace[] = [];
  let value = baseValue;
  mutationEntries(mutations).forEach(([key, operand], index) => {
    try {
      const operation =
        key === rootAlias
          ? { op: "set" as const, path: [], value: operand }
          : compileVariableMutation(key, operand);
      const path = concretePath(value, operation);
      if (!path || value === undefined) return;
      const next = applyVariableOperations(value, [operation]);
      if (next === value) return;
      const trace: MutationTrace = { key, index, path };
      const parentPath = path.slice(0, -1);
      const parent = at(value, parentPath);
      const last = path[path.length - 1];
      const target = at(value, path);
      if (operation.op === "remove" && typeof last === "number" && Array.isArray(parent)) {
        trace.arrayChange = { path: parentPath, removed: [last] };
      } else if (
        (operation.op === "before" || operation.op === "after" || operation.op === "set") &&
        typeof last === "number" &&
        Array.isArray(parent) &&
        (operation.op !== "set" || last === parent.length)
      ) {
        trace.arrayChange = {
          path: parentPath,
          inserted: last + (operation.op === "after" ? 1 : 0),
        };
      } else if (
        ["append", "prepend", "appendUnique", "removeValue"].includes(operation.op) &&
        Array.isArray(target)
      ) {
        trace.arrayChange =
          operation.op === "removeValue"
            ? {
                path,
                removed: target.flatMap((item, position) => (item === operand ? [position] : [])),
              }
            : { path, inserted: operation.op === "prepend" ? 0 : target.length };
      }
      traces.push(trace);
      value = next;
    } catch {
      // Operand and notation validation already reports this item.
    }
  });
  return traces;
}

const prefix = (parent: Path, child: Path) =>
  parent.length <= child.length && parent.every((part, index) => part === child[index]);

/** Follow final array positions back to the mutation that actually changed them. */
function findMutation(traces: MutationTrace[], finalPath: Path): MutationTrace | undefined {
  const path = [...finalPath];
  for (const trace of [...traces].reverse()) {
    const change = trace.arrayChange;
    if (change && prefix(change.path, path) && path.length > change.path.length) {
      const position = path[change.path.length];
      if (typeof position === "number") {
        if (change.inserted !== undefined) {
          if (position === change.inserted) return trace;
          if (position > change.inserted) path[change.path.length] = position - 1;
        } else if (change.removed) {
          let previous = position;
          for (const removed of change.removed) if (removed <= previous) previous++;
          path[change.path.length] = previous;
        }
        continue;
      }
    }
    const affected = change?.path || trace.path;
    if (prefix(affected, path) || prefix(path, affected)) return trace;
  }
}

/** Attribute final value errors without validating temporarily incomplete intermediate values. */
export function withMutationResultPaths(
  ctx: z.RefinementCtx,
  mutations: VariableMutations | undefined,
  valuePath: (string | number)[],
  baseValue: VariableValue,
  rootAlias?: string,
): z.RefinementCtx {
  if (!Array.isArray(mutations) || mutations.length === 0) return ctx;
  let traces: MutationTrace[] | undefined;
  return {
    ...ctx,
    addIssue(issue) {
      if (typeof issue === "string") return ctx.addIssue(issue);
      const path = issue.path || valuePath;
      // Valid projects pay no tracing cost. Replay only when a final schema issue exists.
      traces ??= traceMutations(mutations, baseValue, rootAlias);
      const entry = findMutation(traces, path.slice(valuePath.length) as Path);
      ctx.addIssue(entry ? { ...issue, path: [...valuePath, entry.index, entry.key] } : issue);
    },
  };
}
