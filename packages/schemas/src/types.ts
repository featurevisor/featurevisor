import type { Context } from "@featurevisor/types";

import type { StandardSchemaV1 } from "./standard.js";

/** The code of an issue: the name of the keyword that failed, so a message keys by the rule it explains. */
export type IssueCode =
  | "type"
  | "const"
  | "enum"
  | "minimum"
  | "maximum"
  | "minLength"
  | "maxLength"
  | "pattern"
  | "format"
  | "minItems"
  | "maxItems"
  | "uniqueItems"
  | "required"
  | "additionalProperties"
  | "oneOf"
  | "refine"
  | "refineError"
  | "schemaNotFound";

/** A path segment: an object key, or an array index. */
export type PathKey = string | number;

/** One problem with a value, as Standard Schema reports it, with what an application needs to word it. */
export interface SchemaIssue extends StandardSchemaV1.Issue {
  readonly message: string;
  readonly path: ReadonlyArray<PathKey>;
  /** The keyword that failed, such as `minLength`. */
  readonly code: IssueCode;
  /** The keyword's value under its own name, and what was found, such as `{ minLength: 2, length: 1 }`. */
  readonly params: Readonly<Record<string, unknown>>;
  /** The key of the schema validated, such as `signUp`. */
  readonly schema: string;
}

export interface SchemaSuccess<T> {
  readonly value: T;
  readonly issues?: undefined;
}

export interface SchemaFailure {
  readonly issues: ReadonlyArray<SchemaIssue>;
}

/** A Standard Schema result: the value itself, unchanged, or the issues found. */
export type SchemaResult<T> = SchemaSuccess<T> | SchemaFailure;

/** What a message function gets besides the issue's params. */
export interface MessageInfo {
  readonly context: Context;
}

/** A message template such as `Use at least {minLength} characters`, or a function of the params. */
export type Message =
  | string
  | ((params: Readonly<Record<string, unknown>>, info: MessageInfo) => string);

/** Messages for every schema, per issue code. */
export type CodeMessages = Partial<Record<IssueCode, Message>>;

/**
 * Messages for one form, in the shape a schema's `messages` take: a message per
 * code for a field, and a map per field, with `"[]"` for array items and `"*"`
 * for the values of an object that allows any key.
 */
export interface FieldMessages {
  [codeOrField: string]: Message | FieldMessages;
}

export interface SchemasOptions {
  /** A message per issue code, for every schema, used where neither a form nor a schema words the issue. */
  messages?: CodeMessages;
  /**
   * The last step for every issue, with the chosen message and the context, for
   * translating. Returning `undefined` keeps the chosen message.
   */
  message?: (issue: SchemaIssue, info: MessageInfo) => string | undefined;
}

/** What a check in code gets besides the value at its path. */
export interface CheckInfo<TInput> {
  /** The whole value being validated. */
  readonly input: TInput;
  /** The context validation uses: the instance's, with any given to `validate` merged over it. */
  readonly context: Context;
  /** Aborted when the validation is, so a check can hand it to `fetch`. */
  readonly signal: AbortSignal;
}

/** A check only the application can make, such as whether a username is free. */
export interface Refinement<
  TInput = unknown,
  TResult extends boolean | Promise<boolean> = boolean | Promise<boolean>,
> {
  /** Names the check in its issue's params, `{ refine: key }`. */
  key: string;
  /**
   * The field it checks, as `at` takes it, such as `username` or `contacts[].email`,
   * which checks every item. Without one, the check gets the whole value.
   */
  path?: string;
  /** Other fields whose issues hold the check back too, such as `items` for a total. */
  reads?: string[];
  /** Returns true when the value passes, or a promise of it. */
  check: (value: any, info: CheckInfo<TInput>) => TResult;
  /** Its own message, which wins over every other. */
  message?: string;
}

export interface HandleOptions<
  TInput = unknown,
  TResult extends boolean | Promise<boolean> = boolean | Promise<boolean>,
> {
  /** Messages for this form, which win over the schema's and the application's. */
  messages?: FieldMessages;
  /** Checks in code, run after the schema's rules. */
  refine?: ReadonlyArray<Refinement<TInput, TResult>>;
}

export interface ValidateOptions {
  /** Merged over the instance's context, for checks and messages. */
  context?: Context;
  /** Aborts the checks in code, and rejects the validation with its reason. */
  signal?: AbortSignal;
}

/** `ready` once the current datafile has the schema, or the field for a field's handle, and `missing` until then. */
export type SchemaStatus = "ready" | "missing";

/** The HTML validation attributes a field's rules imply. */
export interface FieldConstraints {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  multiple?: boolean;
}

type Awaitable<TAsync extends boolean, T> = TAsync extends true ? T | Promise<T> : T;

/**
 * An object's constraints are by field path, and any other value's are its own.
 * Untyped handles allow both, since only the datafile knows the schema's type.
 */
export type ConstraintsOf<T> = unknown extends T
  ? any
  : T extends readonly unknown[]
    ? FieldConstraints
    : T extends object
      ? { readonly [K in keyof T & string]?: FieldConstraints } & Readonly<
          Record<string, FieldConstraints>
        >
      : FieldConstraints;

/** An object's options are by field path, and any other value's are its own list. */
export type OptionsOf<T> = unknown extends T
  ? any
  : T extends readonly (infer Item)[]
    ? ReadonlyArray<Item>
    : T extends object
      ? { readonly [K in keyof T & string]?: ReadonlyArray<OptionValue<T[K]>> } & Readonly<
          Record<string, ReadonlyArray<unknown>>
        >
      : ReadonlyArray<T>;

type OptionValue<T> = T extends readonly (infer Item)[] ? Item : T;

/** What every handle has, synchronous or not. */
export interface SchemaHandleBase<
  T = unknown,
  TAsync extends boolean = false,
> extends StandardSchemaV1<T, T> {
  /** The schema's key, such as `signUp`. */
  readonly key: string;
  /** Where a field's handle sits, such as `address.city`, or an empty string for the schema itself. */
  readonly path: string;
  readonly status: SchemaStatus;
  /** The value itself on success, or the issues found. Never coerces. */
  validate(value: unknown, options?: ValidateOptions): Awaitable<TAsync, SchemaResult<T>>;
  /** The handle for one field, such as `at("displayName")`, `at("items.0")` or `at("items[].name")`. */
  at(path: string): SchemaHandle<unknown, TAsync>;
  /** The HTML validation attributes its rules imply: by field path for an object, or for the value itself. */
  readonly constraints: ConstraintsOf<T>;
  /** The values its `enum` or `const` allows: by field path for an object, or for the value itself. */
  readonly options: OptionsOf<T>;
  /** A value read from `FormData` or `URLSearchParams` by the schema's types, for `validate` to check. */
  fromFormData(data: FormData | URLSearchParams): unknown;
}

/** A handle whose checks, if any, answer at once. */
export interface SyncSchemaHandle<T = unknown> extends SchemaHandleBase<T, false> {
  isValid(value: unknown, options?: ValidateOptions): value is T;
}

/** A handle with a check in code that can return a promise, so validation may need awaiting. */
export interface AsyncSchemaHandle<T = unknown> extends SchemaHandleBase<T, true> {
  isValid(value: unknown, options?: ValidateOptions): boolean | Promise<boolean>;
}

/**
 * A schema as a Standard Schema, and what forms need from it. It reads the
 * current datafile whenever it is used, so one handle kept for the life of an
 * application picks up every new datafile.
 */
export type SchemaHandle<T = unknown, TAsync extends boolean = false> = TAsync extends true
  ? AsyncSchemaHandle<T>
  : SyncSchemaHandle<T>;

/** Whether a check's result can be a promise, which makes its handle's validation need awaiting. */
export type IsAsync<TResult> = [TResult] extends [never]
  ? false
  : [Extract<TResult, Promise<unknown>>] extends [never]
    ? false
    : true;

/** The instance `createSchemas(f)` returns, by convention called `s`. */
export interface Schemas<TSchemas extends object = Record<string, unknown>> {
  get<K extends keyof TSchemas & string>(key: K): SchemaHandle<TSchemas[K], false>;
  get<K extends keyof TSchemas & string, TResult extends boolean | Promise<boolean> = boolean>(
    key: K,
    options: HandleOptions<TSchemas[K], TResult>,
  ): SchemaHandle<TSchemas[K], IsAsync<TResult>>;
  validate<K extends keyof TSchemas & string>(
    key: K,
    value: unknown,
    context?: Context,
  ): SchemaResult<TSchemas[K]>;
  isValid<K extends keyof TSchemas & string>(
    key: K,
    value: unknown,
    context?: Context,
  ): value is TSchemas[K];
  /** Stops listening to the SDK instance. */
  close(): void;
}
