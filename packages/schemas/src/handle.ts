import type { Context } from "@featurevisor/types";

import { getConstraints, getOptions } from "./derived.js";
import { compileNode, report, type Position, type Run, type Validate } from "./engine.js";
import { readFormData } from "./formData.js";
import type { MessageLookup, MessageScope } from "./messages.js";
import {
  formatPath,
  hasOwn,
  isAtOrInside,
  matchesSteps,
  parsePath,
  type PathStep,
} from "./paths.js";
import { locate, type Store } from "./store.js";
import type { StandardSchemaV1 } from "./standard.js";
import type {
  HandleOptions,
  PathKey,
  Refinement,
  SchemaIssue,
  SchemaResult,
  SchemasOptions,
  ValidateOptions,
} from "./types.js";

/** A check in code, with its path read once, relative to the handle that runs it. */
interface Check {
  readonly refinement: Refinement;
  readonly steps: PathStep[];
  readonly reads: PathStep[][];
}

/** What a handle needs from the instance that made it, read each time it validates. */
export interface HandleContext {
  readonly store: Store;
  readonly instanceOptions: () => SchemasOptions;
}

/** How a framework adapts a handle's checks in code, such as React's kept answers. */
export type CheckWrapper = (
  refinement: Refinement,
  check: Refinement["check"],
) => Refinement["check"];

const neverAborted = (() => {
  let signal: AbortSignal | undefined;
  return () => (signal ||= new AbortController().signal);
})();

export function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function toResult<T>(value: unknown, issues: SchemaIssue[]): SchemaResult<T> {
  return issues.length > 0 ? { issues } : { value: value as T };
}

/** The concrete paths a check's steps reach in a value, with the value at each. */
function expand(
  value: unknown,
  steps: PathStep[],
  index = 0,
  path: PathKey[] = [],
  found: { path: PathKey[]; value: unknown }[] = [],
): { path: PathKey[]; value: unknown }[] {
  if (value === undefined) return found;
  if (index === steps.length) {
    found.push({ path, value });
    return found;
  }
  const step = steps[index];
  if (step.kind === "items") {
    if (Array.isArray(value))
      value.forEach((item, at) => expand(item, steps, index + 1, [...path, at], found));
    return found;
  }
  if (step.kind === "values") {
    if (value && typeof value === "object" && !Array.isArray(value))
      for (const key of Object.keys(value))
        expand((value as Record<string, unknown>)[key], steps, index + 1, [...path, key], found);
    return found;
  }
  const key = step.kind === "index" ? step.index : step.key;
  // An inherited key, such as `constructor`, is never a field.
  if (value && typeof value === "object" && hasOwn(value, key)) {
    expand(
      (value as Record<string | number, unknown>)[key],
      steps,
      index + 1,
      [...path, key],
      found,
    );
  }
  return found;
}

const parsed = new WeakMap<Refinement, { steps: PathStep[]; reads: PathStep[][] }>();

/** A check's path and reads, read once per refinement object. */
function parsedPaths(refinement: Refinement): { steps: PathStep[]; reads: PathStep[][] } {
  let paths = parsed.get(refinement);
  if (!paths) {
    paths = {
      steps: parsePath(refinement.path || ""),
      reads: (refinement.reads || []).map(parsePath),
    };
    parsed.set(refinement, paths);
  }
  return paths;
}

/** The values a check's `reads` name in an input, so its answer can be kept per what it reads. */
export function readValues(refinement: Refinement, input: unknown): unknown[][] {
  return parsedPaths(refinement).reads.map((steps) =>
    expand(input, steps).map((target) => target.value),
  );
}

/** The steps of a concrete path, for finding the field it names in a schema. */
function stepsOf(path: ReadonlyArray<PathKey>): PathStep[] {
  return path.map((part) =>
    typeof part === "number" ? { kind: "index", index: part } : { kind: "key", key: part },
  );
}

/**
 * A schema's handle, or a field's. Everything it does reads the current
 * datafile when it is used, so it stays right for the life of an application.
 */
export class SchemaHandleImpl {
  readonly key: string;
  readonly path: string;
  readonly "~standard": StandardSchemaV1.Props;

  private readonly steps: PathStep[];
  private readonly fields = new Map<string, SchemaHandleImpl>();
  private compiledField?: { node: unknown; validate: Validate };

  constructor(
    private readonly context: HandleContext,
    key: string,
    private readonly getOptions: () => HandleOptions<any, any> | undefined,
    steps: PathStep[] = [],
    private readonly wrapCheck?: CheckWrapper,
  ) {
    this.key = key;
    this.steps = steps;
    this.path = formatPath(
      steps.map((step) =>
        step.kind === "key"
          ? step.key
          : step.kind === "index"
            ? step.index
            : step.kind === "items"
              ? "[]"
              : "*",
      ),
    ).replace(/\.\[\]/g, "[]");
    this["~standard"] = {
      version: 1,
      vendor: "featurevisor",
      validate: (value, options) => {
        const libraryOptions = (options && options.libraryOptions) || {};
        return this.validate(value, {
          signal: libraryOptions.signal as AbortSignal | undefined,
          context: libraryOptions.context as Context | undefined,
        }) as StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;
      },
    };
  }

  /** Where this handle's field sits in its schema, or undefined when the datafile lacks it. */
  private locate(): ({ validate: Validate } & MessageLookup) | undefined {
    const { store } = this.context;
    const root = store.resolve(this.key);
    if (!root) return undefined;
    if (this.steps.length === 0) return { validate: root.validate, mpath: [], scopes: [] };
    const field = locate(store.resolve, root.node, this.steps);
    if (!field) return undefined;
    if (!this.compiledField || this.compiledField.node !== field.node) {
      this.compiledField = { node: field.node, validate: compileNode(field.node, store.resolve) };
    }
    return { validate: this.compiledField.validate, mpath: field.mpath, scopes: field.scopes };
  }

  /** The node this handle validates, for constraints, options and form data. */
  private node(): unknown {
    const { store } = this.context;
    const root = store.resolve(this.key);
    if (!root) return undefined;
    return this.steps.length === 0 ? root.node : locate(store.resolve, root.node, this.steps)?.node;
  }

  /** The checks in code this handle runs: its own options', or a field's share of them. */
  private checks(): Check[] {
    const refine = this.getOptions()?.refine || [];
    const checks: Check[] = [];
    for (const refinement of refine) {
      const { steps, reads } = parsedPaths(refinement);
      if (this.steps.length === 0) {
        checks.push({ refinement, steps, reads });
        continue;
      }
      // A field's handle carries the checks at or inside it that read nothing else.
      if (reads.length > 0 || steps.length < this.steps.length) continue;
      const inside = this.steps.every((own, index) => {
        const step = steps[index];
        if (own.kind === "key") return step.kind === "key" && step.key === own.key;
        if (own.kind === "values") return step.kind === "values";
        if (step.kind === "items") return true;
        return own.kind === "index" && step.kind === "index" && step.index === own.index;
      });
      if (inside) checks.push({ refinement, steps: steps.slice(this.steps.length), reads });
    }
    return checks;
  }

  private run(given: Context | undefined): Run {
    const instance = this.context.instanceOptions();
    const { f } = this.context.store;
    let context: Context | undefined;
    return {
      schema: this.key,
      issues: [],
      failed: false,
      sources: {
        form: this.getOptions()?.messages,
        app: instance.messages,
        // Merged only when a message function or a check reads it.
        info: {
          get context() {
            return context || (context = f.getContext(given));
          },
        },
      },
      translate: instance.message,
    };
  }

  /** The schema's own rules, without checks in code. */
  validateRules(value: unknown, options: ValidateOptions = {}): SchemaResult<unknown> {
    const run = this.run(options.context);
    this.applyRules(value, run);
    return toResult(value, run.issues);
  }

  private applyRules(
    value: unknown,
    run: Run,
  ): ({ validate: Validate } & MessageLookup) | undefined {
    const located = this.locate();
    if (!located) {
      this.context.store.reportMissing(this.key);
      const position: Position = { path: [], mpath: [], scopes: [] };
      report(
        run,
        position,
        "schemaNotFound",
        this.steps.length === 0 ? { schema: this.key } : { schema: this.key, field: this.path },
      );
      return undefined;
    }
    located.validate(value, run, { path: [], mpath: located.mpath, scopes: located.scopes });
    return located;
  }

  /** Whether the handle has checks in code, which can make validation wait for an answer. */
  hasChecks(): boolean {
    return this.checks().length > 0;
  }

  validate(
    value: unknown,
    options: ValidateOptions = {},
  ): SchemaResult<unknown> | Promise<SchemaResult<unknown>> {
    const run = this.run(options.context);
    const located = this.applyRules(value, run);
    const checks = located ? this.checks() : [];
    if (checks.length === 0) return toResult(value, run.issues);
    const context = run.sources.info.context;

    const signal = options.signal || neverAborted();
    if (signal.aborted) return Promise.reject(signal.reason);

    const ruleIssues = run.issues.slice();
    // Each check's issues keep their place, whatever order answers arrive in.
    const slots: SchemaIssue[][] = [];
    const pending: Promise<void>[] = [];

    for (const { refinement, steps, reads } of checks) {
      for (const target of expand(value, steps)) {
        const blocked =
          ruleIssues.some((issue) => isAtOrInside(issue.path, target.path)) ||
          reads.some((read) => ruleIssues.some((issue) => matchesSteps(issue.path, read)));
        if (blocked) continue;

        const slot: SchemaIssue[] = [];
        slots.push(slot);
        const fail = (code: "refine" | "refineError") =>
          this.reportCheck(run, located!, slot, code, refinement, target.path);
        const check = this.wrapCheck
          ? this.wrapCheck(refinement, refinement.check)
          : refinement.check;

        let outcome: unknown;
        try {
          outcome = check(target.value, { input: value, context, signal });
        } catch {
          fail("refineError");
          continue;
        }
        if (isPromise(outcome)) {
          pending.push(
            outcome.then(
              (passed) => {
                if (passed !== true) fail("refine");
              },
              () => fail("refineError"),
            ),
          );
        } else if (outcome !== true) {
          fail("refine");
        }
      }
    }

    const finish = () => toResult<unknown>(value, ruleIssues.concat(...slots));
    if (pending.length === 0) return finish();

    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.all(pending).then(() => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(finish());
      });
    });
  }

  private reportCheck(
    run: Run,
    located: MessageLookup,
    slot: SchemaIssue[],
    code: "refine" | "refineError",
    refinement: Refinement,
    path: PathKey[],
  ): void {
    const field = locate(this.context.store.resolve, this.node(), stepsOf(path), {
      mpath: [...located.mpath],
      scopes: [...located.scopes] as MessageScope[],
    });
    const lookup: MessageLookup = field
      ? { mpath: field.mpath, scopes: field.scopes }
      : { mpath: [...located.mpath, ...path.map(String)], scopes: located.scopes };
    const own = code === "refine" ? refinement.message : undefined;
    const before = run.issues.length;
    report(run, { path, ...lookup }, code, { refine: refinement.key }, path, lookup, own);
    slot.push(...run.issues.splice(before));
  }

  isValid(value: unknown, options?: ValidateOptions): boolean | Promise<boolean> {
    const result = this.validate(value, options);
    return isPromise(result) ? result.then((settled) => !settled.issues) : !result.issues;
  }

  at(path: string): SchemaHandleImpl {
    let field = this.fields.get(path);
    if (!field) {
      field = new SchemaHandleImpl(
        this.context,
        this.key,
        this.getOptions,
        [...this.steps, ...parsePath(path)],
        this.wrapCheck,
      );
      this.fields.set(path, field);
    }
    return field;
  }

  get constraints() {
    const { store } = this.context;
    const derived = store.derive(this.key, `constraints${this.path}`, () =>
      getConstraints(this.node(), store.resolve),
    );
    return derived || {};
  }

  get options() {
    const { store } = this.context;
    const derived = store.derive(this.key, `options${this.path}`, () =>
      getOptions(this.node(), store.resolve),
    );
    return derived || (this.steps.length === 0 ? {} : []);
  }

  fromFormData(data: FormData | URLSearchParams): unknown {
    return readFormData(this.node(), data, this.context.store.resolve);
  }
}
