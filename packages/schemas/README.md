# @featurevisor/schemas

Validate data in your application against schemas defined in your Featurevisor project and delivered in its datafiles. Rules such as how long a display name may be, or which countries checkout accepts, then change on the product's schedule, reviewed in pull requests, without a deploy.

Each schema comes as a [Standard Schema](https://standardschema.dev), so it plugs into tRPC, Hono, React Hook Form, TanStack Form and every other library that accepts one. Handles also give forms what they need: HTML attributes, choices, reading form data, messages per kind of issue, and checks only your application can make.

This package is experimental: its API may change in a minor release.

## Contents

- [Installation](#installation)
- [Delivering schemas](#delivering-schemas)
- [Validating](#validating)
- [Issues](#issues)
- [Handles](#handles)
- [Messages](#messages)
- [Checks in code](#checks-in-code)
- [Reading form data](#reading-form-data)
- [React](#react)
- [Code generation](#code-generation)
- [How values are checked](#how-values-are-checked)
- [Changing a delivered schema](#changing-a-delivered-schema)
- [Not yet](#not-yet)

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/schemas
```

## Delivering schemas

Schemas live in your project's `schemas` directory, one file per key. To reach an application, a schema has to be in the datafile it loads, and nothing is delivered unless you opt in.

Give a schema tags, from the tags your configuration declares:

```yml
# schemas/signUp.yml
description: A sign up form

tags:
  - web

type: object

properties:
  email:
    type: string
    pattern: "^[^@\\s]+@[^@\\s]+$"
  displayName:
    type: string
    minLength: 2
    maxLength: 40
  country:
    type: string
    enum: [GB, NL]

required: [email, displayName]
```

A target that selects by `tag` or `tags` delivers every schema whose tags match, as it does features and global variables. Targets also take `includeSchemas`, which delivers schemas whatever their tags, and `excludeSchemas`, which leaves them out, winning over both:

```yml
# targets/web.yml
description: Web app

tag: web

includeSchemas:
  - couponCode

excludeSchemas:
  - legacyAddress
```

| Target                             | Schemas in its datafile             |
| ---------------------------------- | ----------------------------------- |
| No selectors                       | None                                |
| `tag: web`                         | Every schema tagged `web`           |
| `tag: web` with `includeSchemas`   | Those, and the listed ones          |
| `includeFeatures` only             | None                                |
| `includeSchemas` only              | The listed ones                     |
| Any of these with `excludeSchemas` | The same, without the excluded ones |

A delivered schema brings every schema it references with `schema`, at any depth, even an excluded one, so each can be validated on its own. Datafiles then gain a `schemas` section, with the rules and messages as written, and a `hash` for each schema that covers the schemas it references. A target that delivers no schema keeps its datafile exactly as it was.

Lint checks that the patterns in `includeSchemas` and `excludeSchemas` match a schema, and that a target with `schemaVersion: "2"` delivers none. Applications test untrusted input against delivered schemas, so every `pattern` in one must also be a regular expression every SDK reads alike, with no risk of exponential backtracking.

## Validating

Create the instance from your SDK instance. By convention it is called `s`, as the SDK instance is `f`:

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSchemas } from "@featurevisor/schemas";

const f = createFeaturevisor({ datafile });
const s = createSchemas(f);

const result = s.validate("signUp", input);

if (result.issues) {
  // show result.issues beside the form's fields
} else {
  // result.value is the input itself, unchanged
}
```

- The result is a Standard Schema result: `{ value }` with the input itself, never changed, or `{ issues }`. Validation never coerces, fills defaults or strips keys.
- `s.isValid(key, value)` returns a boolean.
- Both take a context as a third argument, merged over the instance's, for checks in code and messages.
- The instance holds no copy of the schemas. Every call reads the datafile the SDK has now, so a new datafile takes effect at the next validation.

A key the datafile does not have fails closed, with one `schemaNotFound` issue, and the SDK reports a `schema_not_found` diagnostic once per key. A target that forgot to deliver a schema is noticed, rather than letting anything through. Validate once the SDK has its datafile, as you would evaluate flags.

## Issues

Every issue has a `message`, a `path` of object keys and array indices, the `code` of the keyword that failed, its `params`, and the `schema` validated:

```json
{
  "message": "Value at \"displayName\" must be at least 2 characters long (got 1).",
  "path": ["displayName"],
  "code": "minLength",
  "params": { "minLength": 2, "length": 1 },
  "schema": "signUp"
}
```

Validation reports every issue it finds, so a form can mark every field at once.

| Code                     | Raised when                               | Params                               |
| ------------------------ | ----------------------------------------- | ------------------------------------ |
| `type`                   | The value has another type                | `type`, `received`                   |
| `const`                  | The value is not the constant             | `const`                              |
| `enum`                   | The value is not one of the listed values | `options`                            |
| `minimum`, `maximum`     | A number is out of range                  | `minimum` or `maximum`, `value`      |
| `minLength`, `maxLength` | A string is too short or too long         | `minLength` or `maxLength`, `length` |
| `pattern`                | A string does not match                   | `pattern`                            |
| `format`                 | A string is not a timestamp or a version  | `format`                             |
| `minItems`, `maxItems`   | An array has too few or too many items    | `minItems` or `maxItems`, `count`    |
| `uniqueItems`            | An array repeats an item                  | `index`, of the first repeat         |
| `required`               | A key is missing                          | `key`                                |
| `additionalProperties`   | An object has a key it does not allow     | `key`                                |
| `oneOf`                  | No branch matches, or more than one does  | `matches`                            |
| `refine`                 | A check in code returns false             | `refine`, the check's key            |
| `refineError`            | A check in code throws or rejects         | `refine`, the check's key            |
| `schemaNotFound`         | The datafile has no such schema or field  | `schema`, and `field` for a field    |

A `required` issue's path is the missing key's, such as `["address", "city"]`, and an `additionalProperties` issue's path is the extra key's, so a form shows both beside the field they are about.

`flattenIssues` groups messages by field, in the shape of Zod's `flattenError`, for showing them without a form library:

```ts
import { flattenIssues } from "@featurevisor/schemas";

flattenIssues(result.issues);
// {
//   formErrors: [],
//   fieldErrors: {
//     displayName: ['Value at "displayName" must be at least 2 characters long (got 1).'],
//   },
// }
```

## Handles

`s.get(key)` gives the schema's handle:

```ts
const signUp = s.get("signUp");

signUp["~standard"].validate(input); // the same result as s.validate("signUp", input)
```

A handle is stable, and reads the current datafile whenever it is used, so you can hand it to a library once, at start up, and still pick up every new datafile.

| Member               | What it is                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| `["~standard"]`      | The Standard Schema interface                                                 |
| `key`                | The schema's key, such as `signUp`                                            |
| `status`             | `"ready"` once the datafile has the schema, and `"missing"` until then        |
| `validate(value)`    | The same result as `s.validate`, with the handle's checks in code             |
| `isValid(value)`     | A boolean, and a type guard with generated types                              |
| `at(path)`           | The handle for one field, such as `at("displayName")` or `at("items[].name")` |
| `constraints`        | The HTML validation attributes its rules imply                                |
| `options`            | The values its `enum` or `const` allows                                       |
| `fromFormData(data)` | A value read from `FormData` or `URLSearchParams`                             |
| `path`               | Where a field's handle sits, such as `address.city`                           |

**Fields.** `at` takes a field name as form libraries write it: `address.city`, `items.0.name` or `items[0].name`. Since a schema describes every item of an array alike, `items[].name` means the same, and `labels.*` steps into the values of an object that allows any key. It follows references, and stops at `oneOf`. A field's handle reports issues with paths relative to the field, and a path the schema lacks gives a handle whose `status` is `missing`, which fails closed.

**Constraints**, named after HTML attributes, so they spread onto an input:

```ts
signUp.constraints;
// {
//   email: { required: true },
//   displayName: { required: true, minLength: 2, maxLength: 40 },
//   country: {},
// }
```

| Attribute                | From                                  |
| ------------------------ | ------------------------------------- |
| `required`               | The key is in its object's `required` |
| `minLength`, `maxLength` | The same keywords on a string         |
| `min`, `max`             | `minimum` and `maximum` on a number   |
| `step`                   | `1` for an `integer`                  |
| `multiple`               | An array, such as a multiple select   |

An object's constraints go by field path, through nested objects, such as `address.city`, and stop at arrays, whose rows have handles of their own, `at("items.0")`. Any other schema's constraints are its own. `pattern` is left out, since a browser anchors and compiles patterns its own way, and validation still checks it. Browsers count `maxlength` in UTF-16 code units, which stops typing at an emoji sooner than the schema would, never later.

**Options** come from an `enum`, a `const`, or `oneOf` branches that each list values, so a nullable choice lists `null` too. An array's options are its items', for a multiple select:

```ts
signUp.options.country; // ["GB", "NL"]
signUp.at("country").options; // ["GB", "NL"]
```

Until the handle is `ready`, `constraints` and `options` are empty, so code that renders before the datafile arrives writes `signUp.options.country ?? []`.

## Messages

Every issue carries a message, which a schema, your application and one form can each choose.

**Templates** fill placeholders in braces from the issue's params: `Use at least {minLength} characters`. Lists are joined with commas, and `{{` and `}}` write literal braces.

**In the schema**, `messages` beside an object's `properties` word its fields. A text value is a message for an issue code, and a map is a field. `"[]"` holds the messages of an array's items, and `"*"` those of the values an open object allows:

```yml
messages:
  additionalProperties: "{key} is not part of a sign up"
  email:
    required: Tell us your email address
    pattern: Enter an email like ada@example.com
  displayName:
    minLength: Use at least {minLength} characters
  address:
    city:
      required: Which city should we deliver to?
  items:
    "[]":
      quantity:
        minimum: Order at least {minimum}
```

A map can reach into a referenced schema, as `address.city` does, and that wording applies to this schema's use of it only. A node can also carry `messages` beside its own rules, keyed by code, which is how a reusable or standalone schema words its issues, and the one field that may sit beside a `schema` reference:

```yml
# schemas/couponCode.yml
description: A coupon code

type: string

pattern: "^[A-Z0-9]{8}$"

messages:
  pattern: Enter the 8 letters and digits printed on the coupon
```

Messages reach the datafile with the schema. Lint checks that each text key is an issue code, each map key a field, and each placeholder a param of its code. It warns about a message that can never show, such as `maxLength` for a number, and about a field and code worded both beside the rule and in an enclosing object's `messages`, where the outer one wins.

**In the application**, `messages` on `createSchemas` gives a message per code for every schema, as a template or a function of the params:

```ts
const s = createSchemas(f, {
  messages: {
    required: "This field is required",
    maxLength: ({ maxLength, length }) => `${length} of ${maxLength} characters`,
  },
});
```

**For one form**, a second argument to `s.get` takes messages in the shape a schema's take:

```ts
const leaderboardMessages = {
  messages: {
    displayName: {
      maxLength: "Names on the leaderboard fit {maxLength} characters",
    },
  },
};

const leaderboardSignUp = s.get("signUp", leaderboardMessages);
```

The same options object gives the same handle, so define it once, outside a component.

**Which message wins**, for each issue, is the first of these that words it:

1. A check in code's own `message`, then the form's message for the issue's field.
2. The schema's, looked for from the outside in, so the outermost object that words the field wins.
3. The application's, from `messages` on `createSchemas`.
4. The default, in English.

A message is for the field it names, never for the fields inside it. An extra key has no field of its own, so its message comes from the object that rejected it.

**Translating.** `message` on `createSchemas` gets each issue, with the chosen message, and the context, and returns the message the issue carries. Returning `undefined` keeps the chosen one:

```ts
const s = createSchemas(f, {
  message: (issue, { context }) => t(issue.message, { ...issue.params, lng: context.locale }),
});
```

A schema can hold translation keys instead of text, such as `maxLength: signUp.displayName.tooLong`, for this function to translate.

## Checks in code

Some checks need your application, such as whether a username is free. Give them to a handle with `refine`, each with a `key`, a `path`, a `check` and a `message`:

```ts
const signUp = s.get("signUp", {
  refine: [
    {
      key: "usernameAvailable",
      path: "username",
      check: async (username, { signal }) => {
        const response = await fetch(`/api/usernames/${encodeURIComponent(username)}`, { signal });
        const { available } = await response.json();

        return available;
      },
      message: "That username is taken",
    },
  ],
});

const result = await signUp.validate(input);
```

- **What `check` gets.** The value at its path, and `{ input, context, signal }`: the whole value being validated, the context, and an `AbortSignal`, always present, to hand to `fetch`. It returns `true` when the value passes, or a promise of it.
- **Its path.** Any path `at` takes, from the handle's root. With `[]` or `*` it runs for every item, such as `contacts[].email`, each issue at its item's path. Without a path, it checks the whole value.
- **When it runs.** After the schema's rules, and only when nothing at or inside its path has an issue already, so a username that is too short never reaches your API. `reads` names other fields whose issues hold it back too, such as `reads: ["items"]` for a total worked out from the items. The checks that run start together.
- **Its issue** has `code: "refine"` and `params: { refine: "usernameAvailable" }`, never the value checked. Its own `message` comes first, then the lookup goes on as for any issue, so a schema can word it with `username: { refine: "..." }`.
- **A check that fails to run**, by throwing or rejecting, gives a `refineError` issue, and validation fails closed. A check that should let a value through when it fails catches its own error and returns `true`.
- **Synchronous or not.** With synchronous checks, the handle stays synchronous. Once a check returns a promise, `validate` and `isValid` return one, typed as Standard Schema's own result or a promise of it. Aborting the `signal` given to `validate` rejects it with the signal's reason.
- **A field's handle** carries the checks at or inside its path that read nothing else, relative to the field.

What a handle checks is fixed when it is created, so `~standard.validate(value)` alone runs your checks too, and every Standard Schema library gets them. A library can pass a signal or a context through `libraryOptions`.

The instance keeps no answers and cancels nothing, since a server shares handles across requests. On the server, give the same check its own implementation under the same key, such as a database lookup, so its issue and message match the browser's. React's hooks keep answers, below.

## Reading form data

A form submitted to a server action or a route handler arrives as `FormData`, and search parameters as `URLSearchParams`. Their values are text, and validation never coerces, so read them by the schema's types first:

```ts
const value = signUp.fromFormData(formData);
const result = signUp.validate(value);
```

| Form data                                                       | Value                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| Names such as `address.city`, `items.0.name` or `items[0].name` | Nested objects and arrays                                    |
| A name given several times, or written `tags[]`                 | An array, for an array field                                 |
| An empty string                                                 | Absent, so `required` reports it                             |
| A field typed `integer` or `number`                             | The number its trimmed text spells, or the text itself       |
| A field typed `boolean`                                         | `true` for `on` or `true`, and `false` for `false` or absent |
| A name the schema does not describe                             | Left out                                                     |
| A file                                                          | Left as it is                                                |

Names the schema does not describe are left out, so a submit button's name or a CSRF token never fails a closed object.

## React

`@featurevisor/schemas/react` has an optional provider and three hooks. Under a `FeaturevisorProvider`, they need nothing more:

```tsx
import { useSchema } from "@featurevisor/schemas/react";

export function SignUpForm() {
  const signUp = useSchema("signUp");

  return (
    <form>
      <input name="displayName" {...signUp.constraints.displayName} />

      <select name="country" {...signUp.constraints.country}>
        {(signUp.options.country ?? []).map((country) => (
          <option key={country}>{country}</option>
        ))}
      </select>

      <button disabled={signUp.status !== "ready"}>Sign up</button>
    </form>
  );
}
```

**`useSchema(key, options)`** returns the handle, and renders the component again when a new datafile changes the schema. Context and flag changes never render it again. Options can be written inline: the hook keeps one handle per key for the component and reads the latest options when it validates. With checks in code, it also:

- keeps each check's answer per value for the component's life, so leaving a field and then submitting asks once, and asks again after a check failed to run,
- shares one call between validations waiting on the same value, and
- lets the latest validation win: a newer one aborts the older one's checks, and the older one settles with the newer one's result.

**`useValidation(keyOrHandle, value, { debounce })`** validates a value while rendering, for a field checked as the user types. Rules answer at once. Checks in code wait for `debounce` milliseconds, and the result's `validating` is true while they run:

```tsx
export function UsernameField({ value, onChange }) {
  const signUp = useSchema("signUp", { refine: [usernameAvailable] });
  const username = useValidation(signUp.at("username"), value, { debounce: 400 });

  return (
    <label>
      Username
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      {username.validating && <small>Checking…</small>}
      {username.issues && <small>{username.issues[0].message}</small>}
    </label>
  );
}
```

**`useSchemas()`** returns the instance, for event handlers and other code outside rendering.

**`SchemasProvider`** is for an application with something to configure: `messages` and `message` for the instance it creates, or `schemas` for an instance created elsewhere, which needs no `FeaturevisorProvider`. The latest `messages` and `message` are used, so a language switch takes effect at the next validation.

Every form library that takes a Standard Schema takes a handle:

```tsx
// React Hook Form, with @hookform/resolvers
const form = useForm({ resolver: standardSchemaResolver(signUp) });

// TanStack Form
const form = useForm({ defaultValues, validators: { onChange: signUp } });
```

With a form library, put `noValidate` on the form so its messages show instead of the browser's.

Server code has no hooks. It uses an instance created beside the server's SDK instance:

```ts
"use server";

import { flattenIssues } from "@featurevisor/schemas";
import { s } from "../featurevisor";

const signUp = s.get("signUp");

export async function signUpAction(previous, formData) {
  const result = signUp.validate(signUp.fromFormData(formData));

  if (result.issues) {
    return { errors: flattenIssues(result.issues).fieldErrors };
  }

  await createAccount(result.value);

  return { errors: {} };
}
```

## Code generation

`featurevisor generate-code` writes a type per schema in `schemas.ts`, and a `SchemaTypes` interface from key to type for the schemas the selected targets deliver. With `--schemas`, it adds a typed `createSchemas`, and with `--react` as well, typed hooks in `schemas-react.ts`:

```bash
npx featurevisor generate-code --language typescript --out-dir src/featurevisor --target web --schemas --react
```

```ts
import { createSchemas } from "./featurevisor";

const s = createSchemas(f);

const signUp = s.get("signUp"); // a handle for SignUpSchema

s.get("singUp"); // a type error

if (signUp.isValid(input)) {
  input.displayName; // string
}
```

Without generated code, `createSchemas<SchemaTypes>(f)` and `useSchema<SignUp>("signUp")` take types by hand.

## How values are checked

Validation applies exactly the rules lint applies to variable values, so a value valid in one is valid in the other:

- An object with `properties` rejects keys it does not list, unless `additionalProperties` allows them. `additionalProperties: true` allows any other key with any value.
- An object with neither `properties` nor `additionalProperties` holds strings, numbers, booleans and `null` only.
- An array without `items` holds strings only.
- There is no `null` type. A nullable field is a `oneOf` with `const: null` as one branch. When each branch of a `oneOf` takes a different type, the value's type selects a branch, and that branch's own issues are reported, so a nullable name that is too long reports `maxLength`.
- `minLength` and `maxLength` count characters as JSON Schema does, in code points, so an emoji counts one.
- `pattern` is a regular expression, tested unanchored.
- `format: date-time` takes the portable timestamps conditions compare, and `format: semver` the versions they compare.
- A number that is not finite fails, and a key whose value is `undefined` counts as absent.
- An object is a plain object, as JSON has, so a `Date`, a `File` or a class instance is not one, and an issue names what it got, such as `date`.

Compiled schemas are kept until the datafile changes them. Compiling builds functions without `new Function`, so the package works under a strict Content Security Policy.

## Changing a delivered schema

A schema that a target delivers is a contract with every application that loads it, and it changes without those applications being deployed again. Narrowing it, such as a lower `maxLength`, a new required key or a shorter `enum`, only rejects more values. Widening it lets values through that code compiled against its old types may not expect.

`featurevisor diff` warns when a change widens a schema that a target delivers, directly or through a reference, saying how and naming the targets. Regenerate the applications' types and release them before such a change.

## Not yet

Later releases of this package are planned to add schemas that differ by environment, rules that change under conditions, comparisons between fields, annotations for forms, and conversion to JSON Schema.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
