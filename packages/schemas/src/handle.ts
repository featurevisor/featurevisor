import type { Context } from "@featurevisor/types";

import {
  EMPTY,
  EMPTY_LIST,
  fieldKeys,
  getAnnotations,
  getConstraints,
  getKind,
  getOptions,
} from "./derived.js";
import {
  compileNode,
  isPlainObject,
  report,
  sameJson,
  titleOf,
  type Position,
  type Run,
  type Validate,
} from "./engine.js";
import { valueOf } from "./errors.js";
import { readFormData } from "./formData.js";
import type { MessageLookup, MessageScope } from "./messages.js";
import {
  assignOwn,
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
  FieldKind,
  HandleOptions,
  PathKey,
  Refinement,
  SchemaIssue,
  SchemaOption,
  SchemaResult,
  SchemasOptions,
  ValidateOptions,
  ViewOptions,
} from "./types.js";
import { adjuster, place, readsOf, resolveTree } from "./view.js";

/** A check in code, with its path read once, relative to the handle that runs it. */
interface Check {
  readonly refinement: Refinement;
  readonly steps: PathStep[];
  readonly reads: PathStep[][];
}

/** A view's values and context, and the depth of the handle `for` was called on, where the values sit. */
interface View {
  readonly values: unknown;
  readonly context?: Context;
  readonly from: number;
}

/** What a handle needs from the instance that made it, read each time it validates. */
export interface HandleContext {
  readonly store: Store;
  readonly instanceOptions: () => SchemasOptions;
  /** Calls back on every datafile the SDK instance accepts, until the instance closes or the returned function is called. */
  readonly listen: (callback: () => void) => () => void;
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
export function expand(
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
  private readonly handles = new Map<string, SchemaHandleImpl>();
  private readonly compiled = new WeakMap<object, Validate>();
  private listed?: { keys: ReadonlyArray<string>; fields: SchemaHandleImpl[] };
  /** The node, in a view resolved, and what members derived from it, until the datafile changes. */
  private memo?: {
    entry: unknown;
    revision: string;
    described?: { node: unknown; required?: boolean };
    made: Map<string, unknown>;
  };

  constructor(
    private readonly context: HandleContext,
    key: string,
    private readonly getOptions: () => HandleOptions<any, any> | undefined,
    steps: PathStep[] = [],
    private readonly wrapCheck?: CheckWrapper,
    private readonly view?: View,
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

  /**
   * Where this handle's field sits in its schema, or undefined when the datafile
   * lacks it. In a view, the fields around it read the view's values, with the
   * value being validated in the field's place.
   */
  private locate(
    value: unknown,
    run: Run,
  ): ({ validate: Validate; node: unknown } & MessageLookup) | undefined {
    const { store } = this.context;
    const root = store.resolve(this.key);
    if (!root) return undefined;
    const view = this.view;
    const field = locate(
      store.resolve,
      root.node,
      this.steps,
      undefined,
      view && {
        value: place(view.values, this.steps.slice(view.from), value),
        from: view.from,
        adjust: adjuster(store.resolve, run.sources.info.context, this.key),
      },
    );
    if (!field) return undefined;
    const node = field.node;
    // Kept per node, and a view's nodes are the same object for the same mutations.
    let validate = this.compiled.get(node as object);
    if (!validate) {
      validate = compileNode(node, store.resolve);
      if (isPlainObject(node)) this.compiled.set(node, validate);
    }
    return { validate, node, mpath: field.mpath, scopes: field.scopes };
  }

  /**
   * The node this handle describes, in a view with the matching mutations
   * applied at every depth, and whether the object it sits in requires it.
   */
  private describe(view?: View): { node: unknown; required?: boolean } | undefined {
    const { store } = this.context;
    const root = store.resolve(this.key);
    if (!root) return undefined;
    const adjust = view && adjuster(store.resolve, store.f.getContext(view.context), this.key);
    const field = locate(
      store.resolve,
      root.node,
      this.steps,
      undefined,
      adjust && { value: view!.values, from: view!.from, adjust },
    );
    return adjust && field
      ? {
          node: resolveTree(field.node, field.value, adjust, store.resolve),
          required: field.required,
        }
      : field;
  }

  /**
   * What a member derives from the node, kept until the datafile changes, since
   * a field's can come from a referenced schema.
   */
  private derive<T>(kind: string, make: (node: unknown, required?: boolean) => T): T | undefined {
    const { store } = this.context;
    const entry = store.entry(this.key);
    if (!entry) return undefined;
    const revision = store.api.getRevision();
    let memo = this.memo;
    if (!memo || memo.entry !== entry || memo.revision !== revision)
      memo = this.memo = { entry, revision, described: this.describe(this.view), made: new Map() };
    const { made, described } = memo;
    if (!made.has(kind))
      made.set(kind, make(described && described.node, described && described.required));
    return made.get(kind) as T;
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
      // A check's `[]` and `*` reach every item and value, so one at an index or a key too.
      const inside = this.steps.every((own, index) => {
        const step = steps[index];
        if (own.kind === "key")
          return step.kind === "values" || (step.kind === "key" && step.key === own.key);
        if (own.kind === "values") return step.kind === "values";
        if (step.kind === "items") return true;
        return own.kind === "index" && step.kind === "index" && step.index === own.index;
      });
      if (inside) checks.push({ refinement, steps: steps.slice(this.steps.length), reads });
    }
    return checks;
  }

  private run(given: Context | undefined): Run {
    // A view's context, with one given to the call merged over it.
    const own = this.view && this.view.context;
    if (own) given = given ? assignOwn({}, own, given) : own;
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
  ): ({ validate: Validate; node: unknown } & MessageLookup) | undefined {
    const located = this.locate(value, run);
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
    // Checks that answered at once have nothing left to abort.
    if (pending.length === 0) return finish();
    if (signal.aborted) return Promise.reject(signal.reason);

    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      // Wording an issue can throw too, such as in a translator, which rejects the validation.
      Promise.all(pending).then(() => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(finish());
      }, reject);
    });
  }

  private reportCheck(
    run: Run,
    located: { node: unknown } & MessageLookup,
    slot: SchemaIssue[],
    code: "refine" | "refineError",
    refinement: Refinement,
    path: PathKey[],
  ): void {
    const field = locate(this.context.store.resolve, located.node, stepsOf(path), {
      mpath: [...located.mpath],
      scopes: [...located.scopes] as MessageScope[],
    });
    const lookup: MessageLookup = field
      ? {
          mpath: field.mpath,
          scopes: field.scopes,
          title: titleOf(field.node, this.context.store.resolve),
        }
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

  parse(value: unknown, options?: ValidateOptions): unknown {
    return parseResult(this.key, this.validate(value, options));
  }

  subscribe(listener: () => void): () => void {
    const { store } = this.context;
    let version = store.version(this.key);
    return this.context.listen(() => {
      const next = store.version(this.key);
      if (next === version) return;
      version = next;
      listener();
    });
  }

  at(path: string): SchemaHandleImpl {
    return this.handle(path, () => parsePath(path));
  }

  /**
   * The handle for one of an object's fields by its key, the same handle `at`
   * gives when the key reads as itself, and its own for a key such as `a.b`,
   * `*` or `2024`, which a path would read otherwise.
   */
  child(key: string): SchemaHandleImpl {
    return /^[^.[\]*\d][^.[\]]*$/.test(key)
      ? this.at(key)
      : this.handle(`\u0000${key}`, () => [{ kind: "key", key }]);
  }

  private handle(id: string, steps: () => PathStep[]): SchemaHandleImpl {
    let field = this.handles.get(id);
    if (!field) {
      field = new SchemaHandleImpl(
        this.context,
        this.key,
        this.getOptions,
        [...this.steps, ...steps()],
        this.wrapCheck,
        this.view,
      );
      this.handles.set(id, field);
    }
    return field;
  }

  /** Its own key in the object it sits in, such as `city`, or an empty string for the schema itself. */
  get name(): string {
    const step = this.steps[this.steps.length - 1];
    if (!step) return "";
    return step.kind === "key"
      ? step.key
      : step.kind === "index"
        ? String(step.index)
        : step.kind === "items"
          ? "[]"
          : "*";
  }

  /**
   * The same handle for the values typed so far, such as a form's: its members
   * describe the rules with every mutation whose conditions match those values,
   * and the context, applied at every depth.
   */
  for(values: unknown, options: ViewOptions = {}): SchemaHandleImpl {
    return new SchemaHandleImpl(
      this.context,
      this.key,
      this.getOptions,
      this.steps,
      this.wrapCheck,
      {
        values,
        context: options.context,
        from: this.steps.length,
      },
    );
  }

  /** The fields, relative to this handle, that its mutations' and issues' conditions read. */
  get reads(): ReadonlyArray<string> {
    const { resolve } = this.context.store;
    return (
      this.derive("reads", () => {
        const base = this.describe();
        return Object.freeze(readsOf(base && base.node, resolve));
      }) || EMPTY_LIST
    );
  }

  /** Its annotations, over those of a schema its field references. */
  get annotations(): Readonly<Record<string, unknown>> {
    const { store } = this.context;
    return this.derive("annotations", (node) => getAnnotations(node, store.resolve)) || EMPTY;
  }

  /** The keys of an object's fields, in its `order`. */
  fieldKeys(): ReadonlyArray<string> {
    const { store } = this.context;
    return (
      this.derive("fields", (node) => Object.freeze(fieldKeys(node, store.resolve))) || EMPTY_LIST
    );
  }

  /** An object's fields' handles, in its `order`, or none for any other value. */
  get fields(): ReadonlyArray<SchemaHandleImpl> {
    const keys = this.fieldKeys();
    if (!this.listed || this.listed.keys !== keys) {
      this.listed = { keys, fields: keys.map((key) => this.child(key)) };
    }
    return this.listed.fields;
  }

  get constraints() {
    const { store } = this.context;
    return (
      this.derive("constraints", (node, required) =>
        getConstraints(node, store.resolve, required),
      ) || EMPTY
    );
  }

  get options() {
    const { store } = this.context;
    // An empty list for a missing schema suits both shapes: `options.map` works, and `options.country` is undefined.
    return this.derive("options", (node) => getOptions(node, store.resolve)) || EMPTY_LIST;
  }

  option(value: unknown): SchemaOption | undefined {
    const options = this.options;
    return Array.isArray(options)
      ? (options as SchemaOption[]).find((option) => sameJson(option.value, value))
      : undefined;
  }

  get kind(): FieldKind | undefined {
    const { store } = this.context;
    return this.derive("kind", (node) => getKind(node, store.resolve));
  }

  fromFormData(data: FormData | URLSearchParams): unknown {
    const node = this.derive("node", (described) => described);
    return readFormData(node, data, this.context.store.resolve);
  }
}

/** A validation's value, or a thrown `SchemaError`, waiting for a promise when there is one. */
export function parseResult(
  schema: string,
  result: SchemaResult<unknown> | Promise<SchemaResult<unknown>>,
): unknown {
  return isPromise(result)
    ? result.then((settled) => valueOf(schema, settled))
    : valueOf(schema, result);
}
