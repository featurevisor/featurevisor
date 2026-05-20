# Attributes reference

Full docs: <https://featurevisor.com/docs/attributes>

Attributes describe the keys agents/users will provide in context at evaluation time. Files live in `attributes/<key>.yml`.

Attributes are **not** included in datafiles — they exist purely to enable linting and code generation.

## Minimum

```yaml
description: Country
type: string
```

`description` is required. At the top level, define either `type` **or** `oneOf` — not both.

## Types

- `boolean`
- `string`
- `integer`
- `double`
- `date` (ISO 8601 string)
- `array` (always array of strings)
- `object` (must be flat — no nested `object` properties)

## Examples

```yaml
# attributes/isPremiumUser.yml
description: Is premium user
type: boolean
```

```yaml
# attributes/age.yml
description: Age
type: integer
```

```yaml
# attributes/rating.yml
description: Star rating
type: double
```

```yaml
# attributes/signupDate.yml
description: Signup date
type: date
```

### Array

Simple:

```yaml
description: Permissions
type: array
```

With validation:

```yaml
description: User permissions
type: array
items:
  type: string
  enum:
    - read
    - write
    - admin
```

### Object

Simple:

```yaml
description: User preferences
type: object
```

With validation (must stay flat — no nested objects):

```yaml
description: Account
type: object
properties:
  plan:
    type: string
    enum: [free, pro]
  locale:
    type: string
required:
  - plan
```

When referencing nested object properties in conditions, use dot-paths: `attribute: account.plan`.

### oneOf

```yaml
description: App version
oneOf:
  - type: string
  - type: double
```

## Supported schema-style properties (lint + code-gen)

- `enum`
- `const`
- `oneOf`
- `properties`, `required`, `additionalProperties`
- `items`
- `minimum`, `maximum`
- `minLength`, `maxLength`
- `pattern`
- `minItems`, `maxItems`, `uniqueItems`

## Archiving

```yaml
archived: true
type: string
description: Country
```

Lint will flag any condition that references an archived attribute.

## Common project conventions

Before creating new attributes, run:

```bash
npx featurevisor list --attributes --json --pretty
```

Common names you may already find:

- `userId`, `deviceId`, `sessionId` — identifiers
- `country`, `locale`, `language` — geo / i18n
- `device`, `browser`, `os`, `appVersion`, `platform` — client info
- `plan`, `tier`, `accountType` — account / billing
- `signupDate`, `lastSeenAt` — temporal

If the user asks for "user id" or "device id" attribute usage and the project uses a different name, **ask which to use** rather than assuming.
