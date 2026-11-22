// React server components cannot create a context or use hooks, so this runs on the client.
"use client";

import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import { useSdk } from "@featurevisor/react";

import type { CheckWrapper, SchemaHandleImpl } from "./handle.js";
import { createSchemas, getInternals } from "./instance.js";
import type {
  CodeMessages,
  HandleOptions,
  IsAsync,
  SchemaHandle,
  SchemaResult,
  Schemas,
  SchemasOptions,
  ValidateOptions,
} from "./types.js";

const SchemasContext = React.createContext<Schemas<any> | undefined>(undefined);

/** One instance per SDK instance, for hooks under a FeaturevisorProvider without a SchemasProvider. */
const fallbacks = new WeakMap<Featurevisor, Schemas<any>>();

function fallbackFor(f: Featurevisor): Schemas<any> {
  let schemas = fallbacks.get(f);
  if (!schemas) {
    schemas = createSchemas(f);
    fallbacks.set(f, schemas);
  }
  return schemas;
}

export interface SchemasProviderProps {
  /** Messages per issue code, for the instance this provider creates. The latest are used. */
  messages?: CodeMessages;
  /** The translating function, for the instance this provider creates. The latest is used. */
  message?: SchemasOptions["message"];
  /** An instance created elsewhere, which needs no FeaturevisorProvider above. */
  schemas?: Schemas<any>;
  children: React.ReactNode;
}

/**
 * Configures the schemas instance for the hooks below. An application with a
 * FeaturevisorProvider and nothing to configure needs none.
 */
export function SchemasProvider(props: SchemasProviderProps): React.ReactElement {
  const sdk = useSdk();
  const latest = React.useRef(props);
  latest.current = props;

  const schemas = React.useMemo(() => {
    if (props.schemas) return props.schemas;
    if (!sdk) return undefined;
    // Read on every validation, so a language switch takes effect at the next one.
    return createSchemas(sdk, {
      get messages() {
        return latest.current.messages;
      },
      get message() {
        return latest.current.message;
      },
    });
  }, [props.schemas, sdk]);

  return <SchemasContext.Provider value={schemas}>{props.children}</SchemasContext.Provider>;
}

/**
 * The schemas instance for the nearest SchemasProvider, or else for the nearest
 * FeaturevisorProvider's SDK instance. Reads through it do not render the
 * component again.
 */
export function useSchemas<TSchemas extends object = Record<string, unknown>>(): Schemas<TSchemas> {
  const provided = React.useContext(SchemasContext);
  const sdk = useSdk();
  if (provided) return provided as Schemas<TSchemas>;
  if (sdk) return fallbackFor(sdk) as Schemas<TSchemas>;
  throw new Error(
    "@featurevisor/schemas/react needs a SchemasProvider or a FeaturevisorProvider above it.",
  );
}

const { useSyncExternalStore } = React as Partial<typeof React>;

/** What the datafile holds for a key, read again when a datafile is set. */
function useSchemaVersion(schemas: Schemas<any>, key: string): unknown {
  const internals = getInternals(schemas);
  const read = () => internals.version(key);
  const subscribe = React.useCallback(
    (changed: () => void) => internals.subscribe(changed),
    [internals],
  );

  if (useSyncExternalStore) return useSyncExternalStore(subscribe, read, read);

  // React 16.8 and 17 read while rendering and listen in an effect.
  const [, refresh] = React.useReducer((count: number) => count + 1, 0);
  const version = read();
  React.useEffect(() => {
    const stop = subscribe(refresh);
    if (read() !== version) refresh();
    return stop;
  }, [subscribe]);
  return version;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function valueKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
}

interface Call {
  answer?: boolean;
  promise?: Promise<boolean>;
  controller?: AbortController;
  waiting: number;
}

/**
 * Keeps each check's answer per value for the component's life, and shares one
 * call between validations waiting on the same value. A call nobody waits for
 * any more is aborted, and a call that failed is asked again next time.
 */
function createAnswerKeeper(): CheckWrapper {
  const calls = new Map<string, Call>();
  return (refinement, check) => (value, info) => {
    const id = `${refinement.key}\u0000${valueKey(value)}`;
    const kept = calls.get(id);
    if (kept && kept.answer !== undefined) return kept.answer;

    let call = kept;
    if (!call) {
      const controller = new AbortController();
      const outcome = check(value, { ...info, signal: controller.signal });
      if (!isPromise(outcome)) {
        if (typeof outcome === "boolean") calls.set(id, { answer: outcome, waiting: 0 });
        return outcome;
      }
      call = { controller, waiting: 0 };
      const current = call;
      call.promise = outcome.then(
        (answer) => {
          current.answer = answer === true;
          current.promise = undefined;
          return answer;
        },
        (error) => {
          calls.delete(id);
          throw error;
        },
      );
      calls.set(id, call);
    }

    const shared = call;
    shared.waiting++;
    info.signal.addEventListener(
      "abort",
      () => {
        shared.waiting--;
        if (shared.waiting === 0 && shared.promise) {
          calls.delete(id);
          shared.controller?.abort(info.signal.reason);
        }
      },
      { once: true },
    );
    return shared.promise as Promise<boolean>;
  };
}

const SUPERSEDED = Symbol("superseded by a newer validation");

/**
 * A component's handle: the instance's, with the latest validation winning. A
 * newer validation aborts the older one's checks, and the older one settles
 * with the newer one's result, so a slow answer never lands after a newer one.
 */
class HookHandle {
  private current?: {
    controller: AbortController;
    settleWith: (result: SchemaResult<unknown> | Promise<SchemaResult<unknown>>) => void;
  };
  private readonly fields = new Map<string, HookHandle>();
  readonly "~standard": SchemaHandleImpl["~standard"];

  constructor(readonly inner: SchemaHandleImpl) {
    this["~standard"] = {
      ...inner["~standard"],
      validate: (value, options) => {
        const libraryOptions = (options && options.libraryOptions) || {};
        return this.validate(value, {
          signal: libraryOptions.signal as AbortSignal | undefined,
          context: libraryOptions.context as ValidateOptions["context"],
        }) as ReturnType<SchemaHandleImpl["~standard"]["validate"]>;
      },
    };
  }

  get key() {
    return this.inner.key;
  }
  get path() {
    return this.inner.path;
  }
  get status() {
    return this.inner.status;
  }
  get constraints() {
    return this.inner.constraints;
  }
  get options() {
    return this.inner.options;
  }
  fromFormData(data: FormData | URLSearchParams) {
    return this.inner.fromFormData(data);
  }
  validateRules(value: unknown, options?: ValidateOptions) {
    return this.inner.validateRules(value, options);
  }
  hasChecks() {
    return this.inner.hasChecks();
  }

  at(path: string): HookHandle {
    let field = this.fields.get(path);
    if (!field) {
      field = new HookHandle(this.inner.at(path));
      this.fields.set(path, field);
    }
    return field;
  }

  validate(value: unknown, options: ValidateOptions = {}) {
    const controller = new AbortController();
    const outer = options.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }

    const previous = this.current;
    this.current = undefined;
    const result = this.inner.validate(value, {
      context: options.context,
      signal: controller.signal,
    });
    if (previous) {
      previous.controller.abort(SUPERSEDED);
      previous.settleWith(result);
    }
    if (!isPromise(result)) return result;

    let settleWith!: (next: SchemaResult<unknown> | Promise<SchemaResult<unknown>>) => void;
    const settled = new Promise<SchemaResult<unknown>>((resolve, reject) => {
      settleWith = (next) => Promise.resolve(next).then(resolve, reject);
      result.then(
        (answer) => {
          if (this.current && this.current.controller === controller) this.current = undefined;
          resolve(answer);
        },
        (error) => {
          // A newer validation settles this one through settleWith.
          if (error !== SUPERSEDED) reject(error);
        },
      );
    });
    this.current = { controller, settleWith };
    return settled;
  }

  isValid(value: unknown, options?: ValidateOptions) {
    const result = this.validate(value, options);
    return isPromise(result) ? result.then((settled) => !settled.issues) : !result.issues;
  }
}

/**
 * The handle for a schema, which renders the component again when the
 * datafile changes the schema. Options can be written inline: the hook keeps
 * one handle per key for the component and reads the latest options when it
 * validates. Checks in code keep their answers per value, share calls and let
 * the latest validation win.
 */
export function useSchema<T = unknown, TResult extends boolean | Promise<boolean> = boolean>(
  key: string,
  options?: HandleOptions<T, TResult>,
): SchemaHandle<T, IsAsync<TResult>> {
  const schemas = useSchemas();
  const latest = React.useRef(options);
  latest.current = options;

  const handle = React.useMemo(() => {
    const internals = getInternals(schemas);
    const inner = internals.createHandle(key, () => latest.current, createAnswerKeeper());
    return new HookHandle(inner);
  }, [schemas, key]);

  useSchemaVersion(schemas, key);
  return handle as unknown as SchemaHandle<T, IsAsync<TResult>>;
}

export interface ValidationOptions {
  /** Milliseconds to wait after the value changes before running checks in code. Rules never wait. */
  debounce?: number;
}

/** A result, and whether a check in code is still running, which it is only once the rules pass. */
export type ValidationResult<T> = SchemaResult<T> & { readonly validating: boolean };

interface RulesHandle {
  readonly key: string;
  validateRules(value: unknown): SchemaResult<unknown>;
  hasChecks(): boolean;
  validate(value: unknown): SchemaResult<unknown> | Promise<SchemaResult<unknown>>;
}

/**
 * Validates a value while rendering, for a field checked as the user types. The
 * first argument is a schema's key or a handle, such as `signUp.at("username")`.
 * Checks in code wait for `debounce`, and the result says when they run.
 */
export function useValidation<T = unknown>(
  keyOrHandle: string | SchemaHandle<T, boolean>,
  value: unknown,
  options: ValidationOptions = {},
): ValidationResult<T> {
  const schemas = useSchemas();
  const handle = React.useMemo(
    () => (typeof keyOrHandle === "string" ? schemas.get(keyOrHandle) : keyOrHandle),
    [schemas, keyOrHandle],
  ) as unknown as RulesHandle;
  const version = useSchemaVersion(schemas, handle.key);
  const key = valueKey(value);

  const rules = React.useMemo(() => handle.validateRules(value), [handle, key, version]);
  const needsChecks = !rules.issues && handle.hasChecks();

  const [checked, setChecked] = React.useState<
    { for: string; result: SchemaResult<unknown> } | undefined
  >();
  const latestValue = React.useRef(value);
  latestValue.current = value;
  const forKey = `${key}\u0000${String(version)}`;

  React.useEffect(() => {
    if (!needsChecks) return;
    let active = true;
    const timer = setTimeout(() => {
      const outcome = handle.validate(latestValue.current);
      Promise.resolve(outcome).then(
        (result) => {
          if (active) setChecked({ for: forKey, result });
        },
        () => {
          // A newer validation, or an aborted one, settles elsewhere.
        },
      );
    }, options.debounce || 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handle, forKey, needsChecks, options.debounce]);

  if (!needsChecks) return { ...rules, validating: false } as ValidationResult<T>;
  if (checked && checked.for === forKey)
    return { ...checked.result, validating: false } as ValidationResult<T>;
  return { value, validating: true } as ValidationResult<T>;
}
