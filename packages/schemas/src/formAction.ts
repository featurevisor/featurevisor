import type { Context } from "@featurevisor/types";

import { isPlainObject } from "./engine.js";
import type { FlattenedIssues } from "./flatten.js";
import { flattenIssues } from "./flatten.js";
import { expand } from "./handle.js";
import { parsePath } from "./paths.js";
import type { FieldPath, PathKey, SchemaHandle, SchemaSuccess } from "./types.js";

/** What a form action answers, and what `useActionState` holds between submits. */
export type FormActionState<TResult extends object = object> = {
  /** Whether the last submit passed validation and the action ran. */
  readonly ok: boolean;
  /** The last submit's issues by field, empty when it passed. */
  readonly errors: FlattenedIssues;
  /** What the last failed submit held, without files, so a form can show it again. */
  readonly values?: Readonly<Record<string, unknown>>;
} & Partial<TResult>;

/** The state a form starts from, before its first submit. Frozen, since every form shares it. */
export const initialFormState: FormActionState = Object.freeze({
  ok: false,
  errors: Object.freeze({
    formErrors: Object.freeze([]) as unknown as string[],
    fieldErrors: Object.freeze({}),
  }),
});

type ResultOf<TResult> = TResult extends object ? TResult : object;

export interface FormActionOptions<T> {
  /**
   * The context to validate with, merged over the instance's, such as the
   * request's language for messages. A function gets the form data and can
   * return a promise, for reading the request's headers.
   */
  readonly context?:
    | Context
    | ((formData: FormData | URLSearchParams) => Context | Promise<Context>);
  /** Fields a failed submit never sends back in `values`, such as a password. */
  readonly omit?: ReadonlyArray<FieldPath<T>>;
}

/** Removes a field from a copy of the values, at every item and value its `[]` and `*` reach. */
function omitField(values: Record<string, unknown>, path: string): void {
  for (const { path: at } of expand(values, parsePath(path))) {
    const key = at.pop()!;
    let holder = values as Record<PathKey, unknown>;
    for (const step of at) holder = holder[step] as Record<PathKey, unknown>;
    delete holder[key];
  }
}

/** What the action gets besides the value, which has passed validation. */
export interface FormActionInfo<TState> {
  readonly formData: FormData | URLSearchParams;
  readonly previousState: TState;
}

/**
 * A copy without files, which a server action cannot return. JSON drops them,
 * and its parsing defines keys, so `__proto__` stays a key.
 */
function withoutFiles(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof Blob === "function" && item instanceof Blob ? undefined : item,
    ),
  );
}

/**
 * A server action, or a router action, from a handle: it reads the form data
 * by the schema's types, validates it, and answers with the issues by field,
 * or runs `action` with the value and answers with what it returns merged in.
 *
 * ```ts
 * const signUp = formAction(s.get("signUp"), (value) => createAccount(value), {
 *   omit: ["password"],
 * })
 * const [state, action] = useActionState(signUp, initialFormState)
 * ```
 */
export function formAction<T, TResult extends object | void = void>(
  handle: SchemaHandle<T, boolean>,
  action: (value: T, info: FormActionInfo<FormActionState>) => TResult | Promise<TResult>,
  options: FormActionOptions<T> = {},
): (
  previousState: FormActionState<ResultOf<TResult>>,
  formData: FormData | URLSearchParams,
) => Promise<FormActionState<ResultOf<TResult>>> {
  return async (previousState, formData) => {
    const given = options.context;
    const context = typeof given === "function" ? await given(formData) : given;
    const read = handle.fromFormData(formData);
    const result = await handle.validate(read, { context });
    if (result.issues) {
      const values = withoutFiles(read);
      if (isPlainObject(values)) for (const path of options.omit || []) omitField(values, path);
      return {
        ok: false,
        errors: flattenIssues(result.issues),
        ...(isPlainObject(values) ? { values } : {}),
      } as unknown as FormActionState<ResultOf<TResult>>;
    }
    const answer = await action((result as SchemaSuccess<T>).value, { formData, previousState });
    return {
      ...(answer && typeof answer === "object" ? answer : {}),
      ok: true,
      errors: { formErrors: [], fieldErrors: {} },
    } as unknown as FormActionState<ResultOf<TResult>>;
  };
}
