import type { EvaluationOptions, EvaluateDependencies, EvaluationType } from "./evaluate.js";
import type { StickyFeatures, StickyVariables } from "@featurevisor/types";

export interface StickyState {
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  generation?: number;
}

interface StateSource {
  initial: StickyState;
  read: () => StickyState;
  aliases: object[];
}

const stateSources = new WeakMap<object, StateSource>();

export function trackEvaluationState<T extends EvaluateDependencies>(
  options: T,
  read: () => StickyState,
): T {
  stateSources.set(options, {
    initial: { stickyFeatures: options.stickyFeatures, stickyVariables: options.stickyVariables },
    read,
    aliases: [options],
  });
  return options;
}

export function refreshEvaluationState(options: EvaluateDependencies): void {
  const source = stateSources.get(options);
  if (!source) return;
  const current = source.read();
  if (options.stickyFeatures === source.initial.stickyFeatures) {
    options.stickyFeatures = current.stickyFeatures;
    source.initial.stickyFeatures = current.stickyFeatures;
  }
  if (options.stickyVariables === source.initial.stickyVariables) {
    options.stickyVariables = current.stickyVariables;
    source.initial.stickyVariables = current.stickyVariables;
  }
}

export interface DependencyOf {
  type: EvaluationType;
  featureKey?: string;
  variableKey?: string;
}

interface Frame {
  identity: DependencyOf;
  current: DependencyOf;
  parent?: Frame;
  memo?: Map<string, MemoEntry[]>;
  inputSnapshot?: Input;
  aliases: object[];
  segments?: Set<string>;
}

interface Input {
  context: EvaluateDependencies["context"];
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
}

interface MemoEntry {
  input: Input;
  generation: number;
  ownerGeneration?: number;
  value: unknown;
}

// Weak associations keep request plumbing out of public module options.
const frames = new WeakMap<object, Frame>();

export class DependencyError extends Error {}

/** Segment references share the dependency session, including across getter handoffs. */
export function evaluateSegment<T>(
  options: EvaluateDependencies,
  key: string,
  evaluate: () => T,
): T {
  beginEvaluation(options as EvaluationOptions);
  let root = frames.get(options)!;
  let depth = 0;
  while (root.parent) {
    depth++;
    root = root.parent;
  }
  const active = root.segments || (root.segments = new Set());
  if (active.has(key)) throw new DependencyError("Circular dependency");
  if (active.size + depth >= 256) throw new DependencyError("Evaluation dependency depth exceeded");
  active.add(key);
  try {
    return evaluate();
  } finally {
    active.delete(key);
  }
}

export function identity(options: DependencyOf): DependencyOf {
  const result: DependencyOf = { type: options.type };
  if (options.featureKey !== undefined) result.featureKey = options.featureKey;
  if (options.variableKey !== undefined) result.variableKey = options.variableKey;
  return result;
}

function sameIdentity(a: DependencyOf, b: DependencyOf): boolean {
  return a.type === b.type && a.featureKey === b.featureKey && a.variableKey === b.variableKey;
}

function keyOf(options: DependencyOf, requester: DependencyOf): string {
  return JSON.stringify([
    options.type,
    options.featureKey,
    options.variableKey,
    requester.type,
    requester.featureKey,
    requester.variableKey,
  ]);
}

export function beginEvaluation(options: EvaluationOptions): void {
  if (!frames.has(options)) {
    const ownIdentity = identity(options);
    frames.set(options, { identity: ownIdentity, current: ownIdentity, aliases: [options] });
  }
}

export function inheritEvaluation<T extends object>(from: object, to: T): T {
  const frame = frames.get(from);
  if (frame && frames.get(to) !== frame) {
    frames.set(to, frame);
    frame.aliases.push(to);
  }
  const source = stateSources.get(from);
  if (source && stateSources.get(to) !== source) {
    stateSources.set(to, source);
    source.aliases.push(to);
  }
  return to;
}

export function updateEvaluation(from: EvaluationOptions, to: EvaluationOptions): void {
  inheritEvaluation(from, to);
  const frame = frames.get(to);
  if (frame && !sameIdentity(frame.current, to)) frame.current = identity(to);
}

export function endEvaluation(options: EvaluationOptions): void {
  const frame = frames.get(options);
  const source = stateSources.get(options);
  if (frame) {
    frame.memo?.clear();
    frame.memo = undefined;
    frame.inputSnapshot = undefined;
    frame.parent = undefined;
    for (const alias of frame.aliases) frames.delete(alias);
    frame.aliases.length = 0;
  }
  if (source) {
    for (const alias of source.aliases) stateSources.delete(alias);
    source.aliases.length = 0;
  }
}

// Copy once, then compare contents without serialising or sorting the input.
// No mutable caller object becomes the stored snapshot.
function copy<T>(value: T, ancestors: object[] = []): T {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new Error("Not a JSON value");
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return new Date(value.getTime()) as T;
  if (ancestors.indexOf(value) !== -1) throw new Error("Circular input");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new Error("Not a JSON object");
  ancestors.push(value);
  try {
    if (Array.isArray(value)) return value.map((item) => copy(item, ancestors)) as T;
    const result = Object.create(null);
    for (const key of Object.keys(value))
      result[key] = copy((value as Record<string, unknown>)[key], ancestors);
    return result;
  } finally {
    ancestors.pop();
  }
}

function sameValue(snapshot: unknown, value: unknown): boolean {
  if (snapshot === value) return snapshot !== 0 || Object.is(snapshot, value);
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    value === null ||
    typeof value !== "object"
  )
    return false;
  if (snapshot instanceof Date)
    return value instanceof Date && snapshot.getTime() === value.getTime();
  if (Array.isArray(snapshot)) {
    if (!Array.isArray(value) || snapshot.length !== value.length) return false;
    for (let index = 0; index < snapshot.length; index++) {
      if (
        Object.prototype.hasOwnProperty.call(snapshot, index) !==
        Object.prototype.hasOwnProperty.call(value, index)
      )
        return false;
      if (!sameValue(snapshot[index], value[index])) return false;
    }
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(snapshot);
  if (keys.length !== Object.keys(value).length) return false;
  for (const key of keys) {
    if (
      !Object.prototype.hasOwnProperty.call(value, key) ||
      !sameValue(
        (snapshot as Record<string, unknown>)[key],
        (value as Record<string, unknown>)[key],
      )
    )
      return false;
  }
  return true;
}

function sameInput(snapshot: Input, input: Input): boolean {
  try {
    return (
      snapshot.stickyFeatures === input.stickyFeatures &&
      snapshot.stickyVariables === input.stickyVariables &&
      sameValue(snapshot.context, input.context)
    );
  } catch {
    return false;
  }
}

export function evaluateDependency<T>(
  requester: EvaluateDependencies,
  options: EvaluationOptions & EvaluateDependencies,
  generation: () => number,
  evaluate: () => T,
  borrowed = false,
): T {
  beginEvaluation(requester as EvaluationOptions);
  const parent = frames.get(requester)!;
  const source = stateSources.get(requester);
  const current = source?.read();
  const featuresInherited = requester.stickyFeatures === source?.initial.stickyFeatures;
  const variablesInherited = requester.stickyVariables === source?.initial.stickyVariables;
  if (current) {
    if (featuresInherited) options.stickyFeatures = current.stickyFeatures;
    if (variablesInherited) options.stickyVariables = current.stickyVariables;
  }
  const dependencyIdentity = identity(options);
  let root = parent;
  let depth = 0;
  for (let active: Frame | undefined = parent; active; active = active.parent) {
    if (++depth > 256) throw new DependencyError("Evaluation dependency depth exceeded");
    if (
      sameIdentity(active.identity, dependencyIdentity) ||
      sameIdentity(active.current, dependencyIdentity)
    )
      throw new DependencyError("Circular dependency");
    root = active;
  }
  if (depth + (root.segments?.size || 0) > 256)
    throw new DependencyError("Evaluation dependency depth exceeded");
  // Composition consumes ordinary getter values. Conditions keep their owned
  // comparison snapshots. Never share memo entries between these two purposes.
  const key = (borrowed ? "composition:" : "") + keyOf(dependencyIdentity, parent.current);
  const stateGeneration = generation();
  const ownerGeneration = current?.generation;
  const input: Input = {
    context: options.context,
    stickyFeatures: options.stickyFeatures,
    stickyVariables: options.stickyVariables,
  };
  const entries = root.memo?.get(key);
  if (entries) {
    for (const entry of entries) {
      if (
        entry.generation === stateGeneration &&
        entry.ownerGeneration === ownerGeneration &&
        sameInput(entry.input, input)
      )
        // Composition borrows values, just like normal object getters.
        return entry.value as T;
    }
  }
  let snapshot: Input | undefined;
  try {
    // Sticky maps are read only inputs. Setters replace their references and
    // advance generations; walking every sticky entry makes handoffs expensive.
    snapshot =
      root.inputSnapshot && sameInput(root.inputSnapshot, input)
        ? root.inputSnapshot
        : {
            context: copy(input.context),
            stickyFeatures: input.stickyFeatures,
            stickyVariables: input.stickyVariables,
          };
    root.inputSnapshot = snapshot;
  } catch {
    // Unsupported host objects are deliberately not memoised.
  }
  if (source) {
    trackEvaluationState(options, () => {
      const state = source.read();
      return {
        generation: state.generation,
        stickyFeatures: featuresInherited ? state.stickyFeatures : requester.stickyFeatures,
        stickyVariables: variablesInherited ? state.stickyVariables : requester.stickyVariables,
      };
    });
  }
  options.dependencyOf = identity(parent.current);
  options.dependencyPurpose = borrowed ? "composition" : "condition";
  frames.set(options, {
    identity: dependencyIdentity,
    current: dependencyIdentity,
    parent,
    aliases: [options],
  });
  const result = evaluate();
  if (
    snapshot &&
    stateGeneration === generation() &&
    ownerGeneration === source?.read().generation &&
    sameInput(snapshot, input)
  ) {
    try {
      const entry: MemoEntry = {
        input: snapshot,
        generation: stateGeneration,
        ownerGeneration,
        value: borrowed ? result : copy(result),
      };
      if (!root.memo) root.memo = new Map();
      const completed = root.memo.get(key);
      if (completed) completed.push(entry);
      else root.memo.set(key, [entry]);
    } catch {
      // Keep normal getter behaviour for values outside the JSON data model.
    }
  }
  return result;
}
