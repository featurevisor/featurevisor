# Attributes

Full docs: <https://featurevisor.com/docs/attributes/>

Attributes declare the keys an application passes in context, and their types. Lint checks every condition and `bucketBy` against them, and code generation turns them into a typed `Context`. Attributes are not in datafiles, so SDKs do not check context at runtime.

```yaml
description: Country, as a lowercase ISO 3166-1 alpha-2 code

type: string

pattern: '^[a-z]{2}$'
```

`description` is required. Define either `type` or `oneOf`, not both.

## Where they live

Attribute files sit directly in `attributes/` (or each Set's `attributes/`). They are never namespaced: `attributes/geo/country.yml` and `attributes/geo.country.yml` both fail with `invalid_attribute_namespace`, whatever `namespaceCharacter` is. For nested context, declare an object attribute such as `attributes/geo.yml` with a `country` property, and refer to `geo.country` in conditions.

Before creating one, check what exists:

```bash
npx featurevisor list --attributes --json --pretty
```

Projects name identities differently (`userId`, `accountId`, `deviceId`, `visitorId`). When the user's wording does not match a declared attribute, ask which to use rather than inventing one.

## Types

The types follow JSON Schema.

| Type      | Holds                                                         |
| --------- | ------------------------------------------------------------- |
| `boolean` | `true` or `false`                                             |
| `string`  | text, optionally with `format: date-time` or `format: semver` |
| `integer` | whole numbers                                                 |
| `number`  | whole numbers and decimals                                    |
| `array`   | strings only, optionally constrained with `items`             |
| `object`  | a flat object: properties cannot be objects                   |

```yaml
description: Signup time

type: string

format: date-time
```

```yaml
description: Version of the mobile app

type: string

format: semver
```

```yaml
description: Permissions

type: array

items:
  type: string
  enum: [read, write, admin]
```

```yaml
description: Account

type: object

properties:
  plan:
    type: string
    enum: [free, paid, enterprise]
  seats:
    type: integer

required: [plan]
```

Refer to object properties with dotted paths in conditions: `attribute: account.plan`. Comparing a whole object is a lint error. Use a property path, or `exists` and `notExists`.

`oneOf` replaces `type` when a value can match one of several schemas, with at least two branches:

```yaml
description: External identifier, as text or an integer

oneOf:
  - type: string
  - type: integer
```

### Removed types

`double`, `date` and `semver` are no longer types. Lint reports `removed_schema_type` with the replacement:

| Before         | Now                                     |
| -------------- | --------------------------------------- |
| `type: double` | `type: number`                          |
| `type: date`   | `type: string` with `format: date-time` |
| `type: semver` | `type: string` with `format: semver`    |

## Formats

Only `date-time` and `semver` exist. Any other format is a lint error.

- **`date-time`**: conditions may use only `before`, `after`, `exists`, `notExists`, `isNull` and `notNull`. `enum` and `const` values must be valid timestamps. Generated TypeScript allows `Date | string`. To compare a timestamp as text too, for example with `equals`, declare a plain `string` without a format. Do not combine both in `oneOf`: a valid timestamp matches both branches, and `oneOf` needs exactly one.
- **`semver`**: lint checks `enum`, `const` and every `semver*` condition value, and rejects versions the operators could never compare. Quote versions in YAML so `5.5` stays a string.

## Constraints

| Properties                                       | Applies to          | Purpose                                |
| ------------------------------------------------ | ------------------- | -------------------------------------- |
| `enum`, `const`                                  | any type            | allow listed values, or a single value |
| `minLength`, `maxLength`, `pattern`              | `string`            | length and regular expression          |
| `minimum`, `maximum`                             | `integer`, `number` | numeric range                          |
| `items`, `minItems`, `maxItems`, `uniqueItems`   | `array`             | item schema and count                  |
| `properties`, `required`, `additionalProperties` | `object`            | keys and which must be present         |

Lint checks condition values against all of them, so a misspelled enum value fails lint instead of never matching. `required` can only list keys from `properties`. Lengths and counts are whole numbers of zero or more.

## Context warnings

Lint warns with `context_value_mismatch` when a test context does not match the declared type or constraints, and `npx featurevisor evaluate` warns about the context you pass. Neither changes the result, and tests may supply invalid context on purpose.

## Archiving

```yaml
description: Country

archived: true

type: string
```

An archived attribute is left out of generated code. Lint rejects a segment or feature that is not archived and still uses it, in `conditions` or `bucketBy`, with `archived_reference`. Run `npx featurevisor find-usage --attribute=<key>` and remove its references in the same change. Archived definitions that use it do not count. Keep the archived file rather than deleting it. `npx featurevisor find-usage --unused-attributes` lists active attributes nothing active references.
