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

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** One level less, so field paths of a recursive type end. */
type Shallower = [never, 0, 1, 2, 3, 4, 5, 6];

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/** The object or array `at` steps into, or never for a leaf, or for a nullable value or a `oneOf`, where `at` stops. */
type Steppable<T> = [T] extends [Primitive]
  ? never
  : true extends IsUnion<T>
    ? never
    : T extends object
      ? T
      : never;

/** An object's own keys, without its index signature. */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: unknown;
} &
  string;

type Join<Prefix extends string, Step extends string> = Prefix extends ""
  ? Step
  : Step extends `[${string}`
    ? `${Prefix}${Step}`
    : `${Prefix}.${Step}`;

interface FieldEntry<P extends string, V> {
  path: P;
  value: V;
}

/** Every field path below a value, each with the type of the value there. */
type FieldEntries<T, P extends string, D extends number> =
  | (P extends "" ? never : FieldEntry<P, T>)
  | ([D] extends [never] ? never : StepEntries<Steppable<T>, P, Shallower[D]>);

type StepEntries<C, P extends string, D extends number> = [C] extends [never]
  ? never
  : C extends readonly (infer Item)[]
    ?
        | FieldEntries<Exclude<Item, undefined>, Join<P, `${number}`>, D>
        | FieldEntries<Exclude<Item, undefined>, Join<P, `[${number}]`>, D>
        | FieldEntries<Exclude<Item, undefined>, Join<P, "[]">, D>
    :
        | {
            [K in KnownKeys<C>]-?: FieldEntries<
              Exclude<K extends keyof C ? C[K] : never, undefined>,
              Join<P, K>,
              D
            >;
          }[KnownKeys<C>]
        | (string extends keyof C
            ? unknown extends C[string]
              ? never
              :
                  | FieldEntries<Exclude<C[string], undefined>, Join<P, "*">, D>
                  | FieldEntries<Exclude<C[string], undefined>, Join<P, string>, D>
            : never);

/**
 * The field paths `at` takes for a value of type `T`, such as `address.city`,
 * `items.0.name`, `items[0].name`, `items[].name` or `labels.*`, typed like
 * React Hook Form's field names. Any string when `T` is unknown.
 */
export type FieldPath<T> = unknown extends T ? string : FieldEntries<T, "", 6>["path"];

/** The type of the value at a field path of `T`. */
export type FieldValue<T, P extends string> = unknown extends T
  ? unknown
  : FieldEntries<T, "", 6> extends infer E
    ? E extends FieldEntry<infer EP, infer V>
      ? P extends EP
        ? V
        : never
      : never
    : never;

interface RefinementBase<TInput> {
  /** Names the check in its issue's params, `{ refine: key }`. */
  key: string;
  /** Other fields whose issues hold the check back too, such as `items` for a total. */
  reads?: ReadonlyArray<FieldPath<TInput>>;
  /** Its own message, which wins over every other. */
  message?: string;
}

/** A check of the whole value. */
type RootRefinement<TInput, TResult> = RefinementBase<TInput> & {
  path?: "";
  /** Returns true when the value passes, or a promise of it. */
  check: (value: TInput, info: CheckInfo<TInput>) => TResult;
};

/** A check of one field, whose value is typed by its path. */
type FieldRefinement<TInput, P, TResult> = P extends string
  ? RefinementBase<TInput> & {
      /**
       * The field it checks, as `at` takes it, such as `username` or
       * `contacts[].email`, which checks every item.
       */
      path: P;
      /** Returns true when the value passes, or a promise of it. */
      check: (value: FieldValue<TInput, P>, info: CheckInfo<TInput>) => TResult;
    }
  : never;

/** A check whose value's type is not known. */
interface UntypedRefinement<TInput, TResult> {
  /** Names the check in its issue's params, `{ refine: key }`. */
  key: string;
  /**
   * The field it checks, as `at` takes it, such as `username` or `contacts[].email`,
   * which checks every item. Without one, the check gets the whole value.
   */
  path?: string;
  /** Other fields whose issues hold the check back too, such as `items` for a total. */
  reads?: ReadonlyArray<string>;
  /** Returns true when the value passes, or a promise of it. */
  check: (value: any, info: CheckInfo<TInput>) => TResult;
  /** Its own message, which wins over every other. */
  message?: string;
}

/**
 * A check only the application can make, such as whether a username is free.
 * With a typed schema, `path` and `reads` are its field paths, and the value a
 * check gets is typed by its path.
 */
export type Refinement<
  TInput = unknown,
  TResult extends boolean | Promise<boolean> = boolean | Promise<boolean>,
> = unknown extends TInput
  ? UntypedRefinement<TInput, TResult>
  : RootRefinement<TInput, TResult> | FieldRefinement<TInput, FieldPath<TInput>, TResult>;

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
 * An object's constraints are by field path, and any other value's are its own,
 * a nullable object's too. Untyped handles allow both, since only the datafile
 * knows the schema's type.
 */
export type ConstraintsOf<T> = unknown extends T
  ? any
  : [T] extends [readonly unknown[]]
    ? FieldConstraints
    : [T] extends [object]
      ? { readonly [K in keyof T & string]?: FieldConstraints } & Readonly<
          Record<string, FieldConstraints>
        >
      : FieldConstraints;

/**
 * What a schema's vocabularies declare, as generated code writes them for each
 * schema: what its `annotationsSchema` lets annotations hold, and what its
 * `optionsSchema` lets each choice carry, with `{}` for one it lacks.
 */
export interface Vocabulary {
  readonly annotations?: object;
  readonly options?: object;
}

/**
 * The annotations Featurevisor uses itself, which every schema can carry
 * without a vocabulary. A type rather than an interface, so a typed handle's
 * annotations still fit where an untyped handle's are asked for.
 */
export type BuiltInAnnotations = {
  /** A field's or a form's name for people, which issues carry in their params. */
  readonly title?: string;
  /** Values the field could hold, each checked by lint against its own rules. */
  readonly examples?: ReadonlyArray<unknown>;
  /** The order of an object's fields, which `fields` follows. */
  readonly order?: ReadonlyArray<string>;
  /** Beside an `enum`, what each choice carries, keyed by its value. `options` on a handle reads it. */
  readonly options?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

/**
 * A handle's annotations: the built in ones, and what its schema's vocabulary
 * declares, or any name for an untyped handle, since only the datafile knows.
 */
export type AnnotationsOf<V = unknown> = unknown extends V
  ? BuiltInAnnotations & Readonly<Record<string, unknown>>
  : BuiltInAnnotations & (V extends { annotations?: infer A } ? Readonly<Partial<A>> : unknown);

/** What a choice carries besides its value and title: its vocabulary's fields, or any for an untyped handle. */
export type OptionFieldsOf<V = unknown> = unknown extends V
  ? Readonly<Record<string, unknown>>
  : V extends { options?: infer O }
    ? Readonly<Partial<O>>
    : unknown;

/**
 * One value an `enum`, a `const` or a `oneOf` of consts allows, with what the
 * schema says about it: its `title` and the fields its `optionsSchema` declares.
 */
export type SchemaOption<T = unknown, V = unknown> = {
  readonly value: T;
  readonly title?: string;
} & OptionFieldsOf<V>;

/** The value one choice of a field holds: an item's for an array, or none for an object. */
export type ChoiceOf<T> = unknown extends T
  ? unknown
  : T extends readonly (infer Item)[]
    ? Item
    : T extends object
      ? never
      : T;

/** An object's options are by field path, and any other value's are its own list, of every choice its union holds. */
export type OptionsOf<T, V = unknown> = unknown extends T
  ? any
  : [T] extends [readonly unknown[]]
    ? ReadonlyArray<SchemaOption<ChoiceOf<T>, V>>
    : [T] extends [object]
      ? {
          readonly [K in keyof T & string]?: ReadonlyArray<
            SchemaOption<ChoiceOf<Exclude<T[K], undefined>>, V>
          >;
        } & Readonly<Record<string, ReadonlyArray<SchemaOption<unknown, V>>>>
      : ReadonlyArray<SchemaOption<T, V>>;

/**
 * What a field's rules make it, for a renderer to choose an input by. A
 * nullable field has its other branch's kind, and any other `oneOf` has none.
 */
export type FieldKind =
  | "text"
  | "date-time"
  | "version"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "object"
  | "list";

/** What every handle has, synchronous or not. `V` is its schema's vocabularies, from generated code. */
export interface SchemaHandleBase<
  T = unknown,
  TAsync extends boolean = false,
  V = unknown,
> extends StandardSchemaV1<T, T> {
  /** The schema's key, such as `signUp`. */
  readonly key: string;
  /** Where a field's handle sits, such as `address.city`, or an empty string for the schema itself. */
  readonly path: string;
  /** Its own key in the object it sits in, such as `city`, or an empty string for the schema itself. */
  readonly name: string;
  /**
   * What the schema says beside the field's rules, such as `title`, `order` or
   * a vocabulary's `placeholder`, over those of a schema the field references.
   * Validation never reads them.
   */
  readonly annotations: AnnotationsOf<V>;
  /** An object's fields' handles, in its `order`, then the fields it leaves out as written. None for any other value. */
  readonly fields: ReadonlyArray<SchemaHandle<unknown, TAsync, V>>;
  /** The value itself on success, or the issues found. Never coerces. */
  validate(value: unknown, options?: ValidateOptions): Awaitable<TAsync, SchemaResult<T>>;
  /**
   * The handle for one field, such as `at("displayName")`, `at("items.0")` or
   * `at("items[].name")`, typed by the field with a typed schema.
   */
  at<P extends FieldPath<T>>(path: P): SchemaHandle<FieldValue<T, P>, TAsync, V>;
  /** The HTML validation attributes its rules imply: by field path for an object, or for the value itself. */
  readonly constraints: ConstraintsOf<T>;
  /**
   * The choices its `enum`, `const` or `oneOf` of consts allows, in order, as
   * `{ value, title, ...fields }`: by field path for an object, or for the
   * value itself.
   */
  readonly options: OptionsOf<T, V>;
  /** One of its choices by value, or undefined when it allows no such choice. */
  option(value: ChoiceOf<T>): SchemaOption<ChoiceOf<T>, V> | undefined;
  /** What its rules make the field, such as `text` or `select`. A project's own annotation can say otherwise. */
  readonly kind: FieldKind | undefined;
  /** A value read from `FormData` or `URLSearchParams` by the schema's types, for `validate` to check. */
  fromFormData(data: FormData | URLSearchParams): unknown;
  /** The value, unchanged and typed, or a thrown `SchemaError` with the issues. Never coerces. */
  parse(value: unknown, options?: ValidateOptions): Awaitable<TAsync, T>;
  /**
   * Calls back when a new datafile changes the schema, through a schema it
   * references too. Returns a function that stops it.
   */
  subscribe(listener: () => void): () => void;
}

/** A handle whose checks, if any, answer at once. */
export interface SyncSchemaHandle<T = unknown, V = unknown> extends SchemaHandleBase<T, false, V> {
  isValid(value: unknown, options?: ValidateOptions): value is T;
}

/** A handle with a check in code that can return a promise, so validation may need awaiting. */
export interface AsyncSchemaHandle<T = unknown, V = unknown> extends SchemaHandleBase<T, true, V> {
  isValid(value: unknown, options?: ValidateOptions): boolean | Promise<boolean>;
}

/**
 * A schema as a Standard Schema, and what forms need from it. It reads the
 * current datafile whenever it is used, so one handle kept for the life of an
 * application picks up every new datafile.
 */
export type SchemaHandle<
  T = unknown,
  TAsync extends boolean = false,
  V = unknown,
> = TAsync extends true ? AsyncSchemaHandle<T, V> : SyncSchemaHandle<T, V>;

/** A schema's vocabularies by its key, or unknown when generated code does not say. */
export type VocabularyOf<TVocabularies, K> = K extends keyof TVocabularies
  ? TVocabularies[K]
  : unknown;

/** Whether a check's result can be a promise, which makes its handle's validation need awaiting. */
export type IsAsync<TResult> = [TResult] extends [never]
  ? false
  : [Extract<TResult, Promise<unknown>>] extends [never]
    ? false
    : true;

/**
 * The instance `createSchemas(f)` returns, by convention called `s`. Generated
 * code gives it the schemas' types, and their vocabularies by key.
 */
export interface Schemas<
  TSchemas extends object = Record<string, unknown>,
  TVocabularies extends object = Record<string, unknown>,
> {
  get<K extends keyof TSchemas & string>(
    key: K,
  ): SchemaHandle<TSchemas[K], false, VocabularyOf<TVocabularies, K>>;
  get<K extends keyof TSchemas & string, TResult extends boolean | Promise<boolean> = boolean>(
    key: K,
    options: HandleOptions<TSchemas[K], TResult>,
  ): SchemaHandle<TSchemas[K], IsAsync<TResult>, VocabularyOf<TVocabularies, K>>;
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
  /** The value, unchanged and typed, or a thrown `SchemaError` with the issues. */
  parse<K extends keyof TSchemas & string>(key: K, value: unknown, context?: Context): TSchemas[K];
  /** The keys of the schemas the current datafile has. */
  keys(): string[];
  /** Whether the current datafile has a schema. */
  has(key: string): key is keyof TSchemas & string;
  /** Stops listening to the SDK instance. */
  close(): void;
}

/** The type a handle validates, such as `InferSchema<typeof signUp>`. */
export type InferSchema<THandle> =
  THandle extends SchemaHandleBase<infer T, boolean, any> ? T : never;

/** The keys an instance knows, such as `SchemaKey<typeof s>`. */
export type SchemaKey<TSchemas> = TSchemas extends Schemas<infer T, any> ? keyof T & string : never;
