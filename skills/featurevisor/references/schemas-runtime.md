# Validating application data

Full docs: the package's README, <https://github.com/featurevisor/featurevisor/tree/main/packages/schemas>

`@featurevisor/schemas` validates data in an application against schemas the project delivers in its datafiles, so rules such as how long a display name may be, or which countries checkout accepts, change on the product's schedule without a deploy. Each schema is a [Standard Schema](https://standardschema.dev), so it plugs into tRPC, Hono, React Hook Form, TanStack Form and other libraries that accept one. Handles also give forms titles, fields in order, choices with labels and HTML attributes.

The package is experimental: its API may change in a minor release. Say so when proposing it.

## When to use it

| Need                                                                | Use                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A value that configures the product, read with a getter             | a feature or global variable ([variables-schemas.md](variables-schemas.md)) |
| Rules for data a user or a client sends, checked in the application | a delivered schema and this package                                         |
| A shape both share                                                  | one schema file, which variables reference as long as it never varies       |

Start from [templates/schema-form.yml](../templates/schema-form.yml).

## Deliver a schema

Nothing is delivered unless a target opts in. Give the schema tags from the configuration's `tags`, or name it in a target:

```yaml
# targets/web.yml
description: Web app

tag: web

includeSchemas:
  - couponCode

excludeSchemas:
  - legacyAddress
```

- A target selecting by `tag` or `tags` delivers every schema whose tags match. `includeSchemas` adds schemas whatever their tags, and `excludeSchemas` leaves them out, winning over both. Patterns take `*`.
- A target with no selectors, or with only feature or variable selectors, delivers no schemas.
- A delivered schema brings every schema it references with `schema`, at any depth.
- `includeAnnotations: false` leaves annotations out, for a backend that renders nothing.
- A target with `schemaVersion: "2"` cannot deliver schemas. Lint says so.
- Every `pattern` in a delivered schema must be a portable regular expression with no risk of exponential backtracking, which lint checks.

## Validate

```ts
import { createFeaturevisor } from '@featurevisor/sdk'
import { createSchemas } from '@featurevisor/schemas'

const f = createFeaturevisor({ datafile })
const s = createSchemas(f)

const result = s.validate('signUp', input)

if (result.issues) {
  // show result.issues beside the fields
}
```

- Name the instance `s`, as the SDK instance is `f`.
- `validate` returns `{ value }`, the input unchanged, or `{ issues }`. It never coerces, fills defaults or strips keys. `isValid` returns a boolean. `parse` returns the value or throws a `SchemaError`, whose `flattened` holds the issues by field.
- Each takes a context as a third argument, merged over the instance's, for conditions, checks in code and messages.
- Every call reads the datafile the SDK has now, so a new datafile takes effect at the next validation.
- A key the datafile lacks fails closed with one `schemaNotFound` issue, so a target that forgot a schema is noticed.
- An issue has `message`, `path`, `code` (the keyword that failed, such as `minLength`), `params` and `schema`. `flattenIssues(issues)` groups messages by field.

## Handles

`s.get(key)` gives a stable handle that reads the current datafile whenever it is used, so hand it to a library once. Its members:

- `validate`, `isValid`, `parse`, and `["~standard"]` for libraries
- `at(path)` for one field, such as `at('address.city')` or `at('items[].name')`
- `fields`, an object's fields in its `order`, each with `name` and `path`
- `annotations`, `constraints` (HTML attributes such as `required` and `maxLength`), `options` and `option(value)` for choices, and `kind`, such as `text`, `select` or `multiselect`
- `fromFormData(data)`, which reads `FormData` or `URLSearchParams` by the schema's types
- `subscribe(listener)`, called when a new datafile changes the schema

## Annotations and choices

Annotations carry what a form needs beside the rules. Validation never reads them.

```yaml
annotationsSchema:
  schema: formAnnotations

optionSchema:
  schema: countryOption

properties:
  country:
    type: string
    enum: [GB, NL]
    annotations:
      title: Country
      input: select
      options:
        GB: { title: United Kingdom, flag: gb }
        NL: { title: Netherlands, flag: nl }

annotations:
  title: Create your account
  order: [email, country]
```

- **Four are built in**, with or without a vocabulary: `title` (also in every issue's `params.title`), `examples` (each must pass the field's rules), `order` (an object's own field names, each once) and `options` (beside an `enum`, keyed by its values).
- **`annotationsSchema`** at the root names the project's own annotations, such as `placeholder` or `help`. **`optionSchema`** names what each choice carries, such as `flag`. Each is one object schema, inline or by key, closed unless it says `additionalProperties: true`, and never in a datafile. Neither may declare a built in name, and `optionSchema` may not declare `value`.
- **`required`** in a vocabulary makes lint demand the name on every node a handle reaches, or on every choice. Nothing is required unless the vocabulary says so.
- **Choices** can also be a `oneOf` of `const` branches, each with its own `annotations`. A list whose choices carry fields of their own, such as countries with flags, makes a schema of its own that forms reference.
- **`description`** is for maintainers and never reaches a datafile. Help text for users is an annotation.
- **Lint** checks every name and value, and warns with `option_without_title` when only some of a field's choices have a title.

## Messages

- In the schema, `messages` beside an object's `properties` words its fields, keyed by field and then by issue code, and `messages` beside any node words its own issues. Templates fill params, such as `Use at least {minLength} characters` or `{title} is required`.
- In the application, `createSchemas(f, { messages, message })` words every schema, and `message` translates each issue. `s.get(key, { messages })` words one form.
- A check in code's own message wins, then the form's, then the schema's, then the application's, then the English default.

## Rules between fields

A rule two fields must agree on, such as a password typed twice, goes in `issues` on the object that holds both. Each entry reports its issue when its conditions match, so conditions say when a value fails:

```yaml
issues:
  - key: passwordsDiffer
    conditions: input('confirmPassword') != input('password')
    path: confirmPassword
    message: The passwords do not match

  - key: dutchShippingCountry
    conditions: country == 'nl' and input('shippingCountry') != input('billingCountry')
    path: shippingCountry
    message: We ship Dutch orders to the billing country only
```

- **Some users only:** join their condition and the check with `and`, as `dutchShippingCountry` does. A user it does not match never gets the issue.
- **Write the failure:** `!=` for `==`, `>` for `<=`, `not (...)` for a rule without an opposite, such as `not (input('end') after input('start'))`.
- **When entries run:** after the node's rules, and only when nothing inside it has an issue of shape, such as a missing required field or a wrong type. A short password and a differing confirmation report both.
- **The issue** has `code: "refine"` and `params.refine`, the entry's key, so `messages` word it as `confirmPassword: { refine: ... }`. Without `path`, it belongs to the object.
- **Lint** checks each entry's key, conditions, which must read at least one `input`, paths and message. `issues` goes on object nodes only, and a variable cannot use a schema with them.

## Checks in code

Rules only the application can answer, such as whether a username is free, go in `refine` on a handle. A check returns `true` when the value passes, where an entry in `issues` says when it fails:

```ts
const signUp = s.get('signUp', {
  refine: [
    {
      key: 'usernameAvailable',
      path: 'username',
      check: async (username, { signal }) => isFree(username, signal),
      message: 'That username is taken',
    },
  ],
})
```

A check gets the value at its path and `{ input, context, signal }`, runs once the rules at its path pass, and can return a promise, which makes the handle asynchronous. With [generated types](#typed-code), `input` and the value are typed by the schema.

## Rules per environment

```yaml
environments:
  dev:
    mutate:
      properties.displayName.maxLength: 60
      properties.country.enum:append: DE
  staging:
    mutate:
      properties.displayName.maxLength: 60
```

- `mutate` takes the notation of variable mutations ([variables-schemas.md](variables-schemas.md#mutations)). Each environment's datafile holds the schema as that environment resolves it, so applications validate against the same key everywhere.
- Entries inherit as rules do, with `inheritEnvironments`. `dev: {}` uses the base.
- Lint checks each key is a configured environment, every path reaches into the base, since a mutation creates no objects on the way, and each resolved schema is valid. Set a whole object to add one, such as `properties.taxId.messages: { pattern: ... }`.
- A variable cannot use a schema that varies, by environment or under conditions.
- Generated types come from the environment whose name starts with `prod`, or `generate-code --environment`.

## Rules under conditions

Any node can carry `mutations`. Every one whose conditions match applies, in order, when a value is validated:

```yaml
mutations:
  - key: business
    conditions:
      input: accountType
      operator: equals
      value: business
    mutate:
      required:appendUnique: taxId

  - key: shipsAbroad
    conditions:
      input: shippingCountry
      operator: notEquals
      valueFrom:
        input: billingCountry
    mutate:
      required:appendUnique: customsDescription

  - key: payingAccounts
    conditions: payingAccounts
    mutate:
      properties.displayName.maxLength: 80
```

- Conditions take every leaf features take, so segments, flags and global variables mean the same in a schema. A feature leaf rolls a stricter rule out by percentage.
- **`input`** reads the value being validated, at a path relative to the node the mutation sits on, with dots into objects ([conditions.md](conditions.md#input-leaves)).
- **`valueFrom: { input: billingCountry }`** takes the other side of a comparison from another field. `value` is always a value, and a leaf takes one of the two. `matches` and `notMatches` never take their pattern from `valueFrom`.
- In a project with `conditionExpressions: true`, write `input('accountType') == 'business'`, or `input('shippingCountry') != input('billingCountry')` for two fields ([expressions.md](expressions.md)).
- `input` goes only in a schema's mutations and issues. `allowedConditions.schemas` limits the kinds there, `input` included ([conditions.md](conditions.md#allowed-condition-kinds)).
- Keys are unique within a node, and no mutation changes a `type`.
- An environment's entry can add a mutation with `mutations:append`, with its conditions as a tree. Lint checks it as it checks the file's own, under the entry.
- The segments, flags and global variables a schema's conditions read come along into the datafile, as a feature's dependencies do.
- Lint checks each operator and value against the field it compares, as it does for attributes, so `input('age') startsWith 'x'` on an integer fails.
- An issue a mutation set the rule of names it in `issue.mutation`, such as `business` for a missing `taxId`.
- `constraints`, `options`, `kind`, `annotations` and `fields` describe the base rules, so a form keeps its attributes while it is filled in.

## Forms, servers and React

- `formAction(handle, fn, { context, omit })` turns a handle into a server action that reads form data, validates it and answers with the issues by field, or runs `fn` with the value. `initialFormState` is the state before the first submit, and `omit` keeps fields such as a password out of what a failed submit sends back.
- `@featurevisor/schemas/react` has `useSchema(key, options)`, which renders again when a new datafile changes the schema, `useValidation(keyOrHandle, value, options)`, and an optional `SchemasProvider`. Under a `FeaturevisorProvider` they need nothing more, and inside a `FeaturevisorScope` they validate with the scope's context ([sdk-react.md](sdk-react.md)).

## Typed code

```bash
npx featurevisor generate-code --language typescript --out-dir src/featurevisor --target web --schemas --react
```

`--schemas` adds a typed `createSchemas`, so a wrong key, field path, annotation or choice is a type error, and `--react` adds typed hooks ([code-generation.md](code-generation.md)).

## Testing

Schema specs in `tests/schemas/<key>.spec.yml` validate values against the schema as each environment builds it, under a `context`, and name the issues they expect, down to the `mutation` that set a rule ([testing.md](testing.md#schema-specs)). Write them in the same change as the schema, a case where each mutation and issue entry applies and one where it does not.

## Changing a delivered schema

A delivered schema is a contract with every application that loads it, and it changes without them being deployed. Narrowing it, such as a lower `maxLength` or a new required key, only rejects more values. Widening it lets through values that code compiled against its old types may not expect. `npx featurevisor diff` warns when a change widens a delivered schema and names the targets. Regenerate and release the applications' types before such a change. Changing annotations or choices widens nothing.

After changing a schema, run `npx featurevisor fmt` and `npx featurevisor lint`, and validate a representative value against the built datafile when the change matters to users.
