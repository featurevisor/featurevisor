# Feature variables, schemas and mutations

Full docs:

- Feature variables: <https://featurevisor.com/docs/variables/#feature-variables>
- Schemas: <https://featurevisor.com/docs/schemas/>
- Mutations: <https://featurevisor.com/docs/mutations/>

Feature variables turn a feature into typed remote configuration. They are declared in the feature's `variablesSchema`, with defaults, and changed per rule, variation and override. For values that stand on their own, use [global variables](global-variables.md) instead. The type, schema and mutation rules here apply to both.

## Declare

```yaml
variablesSchema:
  bgColor:
    type: string
    description: Sidebar background
    defaultValue: red

  hero:
    type: object
    properties:
      title: { type: string }
      subtitle: { type: string }
    required: [title, subtitle]
    defaultValue:
      title: Welcome
      subtitle: Welcome to our site
```

Each variable needs a `type` (or `oneOf`, or a `schema` reference) and a `defaultValue` that fits it.

### While the feature is disabled

Without either of these, a disabled feature returns `null` for its variables:

```yaml
variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    disabledValue: grey # returned while disabled
    # or: useDefaultWhenDisabled: true, to return defaultValue
    deprecated: true # SDKs log a warning when read
```

## Types

| Type      | Notes                                                            |
| --------- | ---------------------------------------------------------------- |
| `string`  | optionally `format: date-time` or `format: semver`               |
| `boolean` |                                                                  |
| `integer` |                                                                  |
| `number`  | whole numbers and decimals                                       |
| `array`   | strings unless `items` declares another item type                |
| `object`  | `properties` may nest, unlike attributes                         |
| `json`    | a JSON document stored as a string, decoded by `getVariableJSON` |

Constraints follow JSON Schema: `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `items`, `minItems`, `maxItems`, `uniqueItems`, `properties`, `required`, `additionalProperties` and `oneOf`. An object without `properties` has no required keys. `double`, `date` and `semver` are no longer types ([attributes.md](attributes.md#removed-types)).

`format: date-time` validates stored timestamps during lint. Date-time variables compare only with `before`, `after` and the presence operators in conditions. Plain strings can also use `before` and `after`.

Applications read `number` variables with `getVariableNumber` in JavaScript, Python, Ruby, PHP and Elixir, and with `getVariableDouble` in Java, Swift, Go, Rust, Dart and .NET.

```yaml
acceptedCards:
  type: array
  items:
    type: string
    enum: [visa, mastercard, amex]
  defaultValue: [visa, mastercard]

navLinks:
  type: array
  items:
    type: object
    properties:
      id: { type: string }
      url: { type: string }
  defaultValue:
    - { id: home, url: / }
    - { id: help, url: /help }
```

## Change values

### In a rule

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100
    variables:
      bgColor: orange
```

### In a variation

```yaml
variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    variables:
      bgColor: blue
```

A variation can only set variables declared in `variablesSchema`.

### Narrow with overrides

`variableOverrides` in a rule or variation narrows a value further. The first matching entry wins, and the rule's or variation's `variables` value applies otherwise:

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100
    variables:
      bgColor: orange
    variableOverrides:
      bgColor:
        - key: amsterdam
          conditions:
            - attribute: city
              operator: equals
              value: amsterdam
          value: red
```

Each entry needs `conditions` and exactly one of `value` or `mutate`. Conditions take every leaf kind. A stable `key` is recommended. Feature variable overrides are flat: nesting and `continue` exist only for global variables.

Precedence for a variable: force entry, then the matched rule's overrides and `variables`, then the selected variation's overrides and `variables`, then `defaultValue`.

## Reusable schemas

When a shape repeats, define it once in `schemas/<key>.yml`:

```yaml
# schemas/link.yml
description: A link

type: object

properties:
  title: { type: string }
  url: { type: string }

required: [title, url]
```

Reference it from a variable, an item, or another schema:

```yaml
variablesSchema:
  cta:
    schema: link
    defaultValue: { title: Start, url: /start }

  navLinks:
    type: array
    items:
      schema: link
    defaultValue:
      - { title: Home, url: / }
```

`npx featurevisor list --schemas --json` lists existing schemas. Lint checks every value against the resolved schema.

## Mutations

Repeating a whole object or array to change one part is noisy. Mutations change paths and keep the rest.

### Where they go

| Where                                | Write        | Path starts at                                           |
| ------------------------------------ | ------------ | -------------------------------------------------------- |
| Global variable `overrides`          | `mutate`     | the variable                                             |
| Feature variable `variableOverrides` | `mutate`     | the variable                                             |
| A rule's or variation's `variables`  | a dotted key | the variables map, so it starts with the variable's name |

```yaml
# in a variation's variables: the key starts with the variable name
variables:
  hero.subtitle: Welcome to the new design
```

```yaml
# in an override's mutate: paths are relative to the variable
variableOverrides:
  navLinks:
    - key: nl
      conditions: netherlands
      mutate:
        '[id=help].url': /hulp
        ':append': { id: blog, url: /blog }
```

### Syntax

| Path                                     | Works on            | Effect                                             |
| ---------------------------------------- | ------------------- | -------------------------------------------------- |
| `a.b`                                    | object              | set a property, nested with dots                   |
| `a.b:remove`                             | object              | remove a property, not allowed for `required` ones |
| `list[2]`                                | array               | replace the item at an index                       |
| `list[2].title`                          | array of objects    | set a property of the item                         |
| `list[id=help]`                          | array of objects    | replace the first matching item                    |
| `list[id=help].url`                      | array of objects    | set a property of the matching item                |
| `list[id=help]:before`, `:after`         | array               | insert next to the matching item                   |
| `list[2]:before`, `:after`               | array               | insert next to the index                           |
| `list[id=help]:remove`, `list[2]:remove` | array               | remove the item                                    |
| `list:append`, `list:prepend`            | array               | add one item at the end or start                   |
| `list:appendUnique`                      | array of primitives | append a value only if absent                      |
| `list:removeValue`                       | array of primitives | remove every equal value                           |

For an array variable itself, the path before the operation is empty: `:append`, `[id=help].url`, `:appendUnique`. The value of `:remove` is ignored, so `null` or `true` both work.

**Quote mutation keys** in YAML when they start with `[` or `:`, or contain characters YAML treats specially. Quoting every mutation key is the safe default.

### Order

Entries apply in the order written, and each sees the changes before it:

```yaml
mutate:
  paymentMethods: [card]
  'paymentMethods:append': ideal
```

This gives `[card, ideal]`. When the order must survive tools that rewrite YAML, or a path repeats, write a list of single entry maps:

```yaml
mutate:
  - 'paymentMethods:append': ideal
  - 'paymentMethods:append': paypal
```

- Setting an object or array replaces it. It does not merge.
- A selector, property or index that matches nothing changes nothing, and no intermediate objects are created.
- `appendUnique` and `removeValue` take one string, number, boolean or `null`, and compare strictly, so `1` differs from `"1"`.

Lint checks every path, operand and resulting value against the schema, including selectors that match nothing today. Removing a required property or breaking an array's size limits fails lint. v4 applies mutation maps in written order. Projects upgrading from v3 can review affected values with `npx featurevisor lint --v3-mutation-order`.
