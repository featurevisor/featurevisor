# Variables and reusable schemas

Full docs:
- Variables: <https://featurevisor.com/docs/features#variables>
- Reusable schemas: <https://featurevisor.com/docs/schemas>
- Mutations: <https://featurevisor.com/docs/mutations>

Variables turn a feature into a typed remote-config bundle. They are declared once in the feature's `variablesSchema`, given default values, and then optionally overridden per rule and per variation.

## variablesSchema

```yaml
variablesSchema:
  bgColor:
    type: string
    description: Sidebar background
    defaultValue: red
```

Each variable entry must have a `type` (or a `schema` reference — see [reusable schemas](#reusable-schemas)) and a `defaultValue` of the matching type.

### Behaviour when feature is disabled

```yaml
variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    useDefaultWhenDisabled: true   # return defaultValue when disabled (else null)
    disabledValue: purple          # return this specific value when disabled
    deprecated: true               # logs warning when read
```

Without these, a disabled feature returns `null` for variables.

## Supported types

| Type      | Notes                                            |
| --------- | ------------------------------------------------ |
| `string`  |                                                  |
| `boolean` |                                                  |
| `integer` |                                                  |
| `double`  | floating point                                   |
| `array`   | items typed; default is array-of-strings         |
| `object`  | flat OR nested with `properties`                 |
| `json`    | stringified arbitrary JSON                       |

### array

```yaml
acceptedCards:
  type: array
  defaultValue: [visa, mastercard]
```

With validated items:

```yaml
acceptedCards:
  type: array
  items:
    type: string
  defaultValue: [visa, mastercard]
```

Array of objects:

```yaml
navLinks:
  type: array
  items:
    type: object
    properties:
      title: { type: string }
      url: { type: string }
  defaultValue:
    - { title: Home, url: / }
    - { title: Contact, url: /contact }
```

### object

Flat:

```yaml
hero:
  type: object
  defaultValue:
    title: Welcome
    subtitle: Welcome to our site
```

Validated:

```yaml
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

Nested objects are allowed for **variable** schemas (unlike attributes, which must stay flat):

```yaml
hero:
  type: object
  properties:
    background:
      type: object
      properties:
        image: { type: string }
        color: { type: string }
    cta:
      type: object
      properties:
        title: { type: string }
        url: { type: string }
  defaultValue:
    background: { image: /img/hero.png, color: red }
    cta: { title: Get started, url: /start }
```

### json

```yaml
hero:
  type: json
  defaultValue: '{"title":"Welcome"}'
```

## Overriding variables

### From a rule

```yaml
rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 100
      variables:
        bgColor: orange
```

### Conditionally inside a rule

```yaml
rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 100
      variables:
        bgColor: orange
      variableOverrides:
        bgColor:
          - segments: amsterdam
            value: red
          - conditions:
              - attribute: city
                operator: equals
                value: rotterdam
            value: blue
```

### From a variation

```yaml
variations:
  - value: control
    weight: 50
  - value: treatment
    weight: 50
    variables:
      bgColor: blue
    variableOverrides:
      bgColor:
        - segments: netherlands
          value: orange
        - conditions:
            - attribute: country
              operator: equals
              value: de
          value: yellow
```

## Reusable schemas

When the same variable shape repeats across features, extract it to `schemas/<name>.yml`.

```yaml
# schemas/link.yml
description: Individual link
type: object
properties:
  title: { type: string }
  url: { type: string }
required: [title, url]
```

```yaml
# schemas/hero.yml
description: Hero
type: object
properties:
  title: { type: string }
  subtitle: { type: string }
  cta:
    schema: link    # schemas can reference other schemas
```

Reference by name from a feature:

```yaml
variablesSchema:
  hero:
    schema: hero
    defaultValue:
      title: Welcome
      subtitle: Welcome
      cta: { title: Start, url: /start }

  navLinks:
    type: array
    items:
      schema: link            # reference at item level
    defaultValue:
      - { title: Home, url: / }
```

Or extract the array shape too:

```yaml
# schemas/links.yml
description: List of links
type: array
items:
  schema: link
```

```yaml
variablesSchema:
  navLinks:
    schema: links
    defaultValue: [...]
```

## Mutations

When overriding a complex `object` or `array` variable from a rule/variation, repeating the entire structure to change one field is noisy and error-prone. **Mutations** let you target individual paths.

Without mutations:

```yaml
variables:
  hero:
    title: Welcome              # unchanged
    subtitle: Welcome to NL     # the only real change
```

With mutations:

```yaml
variables:
  "hero.subtitle": Welcome to NL
```

### YAML quoting (important)

Mutation keys contain characters (`.`, `[`, `]`, `:`) that YAML interprets specially. **Always quote mutation keys.** Plain-style keys without these characters work unquoted, but quoting unconditionally is the safe default:

```yaml
variables:
  "hero.subtitle": Welcome to NL          # dot path
  "items[2]:remove": null                 # index + verb
  "items[id=2]:before": { id: "2a" }      # selector + verb
  "tags:append": "first"                  # array verb
  "list:prepend": "nl"
```

`null` is a common value for `:remove` since the operation doesn't need data; the key itself encodes the action.

### Mutation syntax

| Syntax                                | Variable type | Effect                                                       |
| ------------------------------------- | ------------- | ------------------------------------------------------------ |
| `"key.property"`                      | object        | Set property (nested ok: `"a.b.c"`)                          |
| `"key.property:remove"`               | object        | Remove property (forbidden if `required`)                    |
| `"key[index]"`                        | array         | Replace item at index                                        |
| `"key[index].property"`               | array         | Set property of item at index                                |
| `"key[index]:before"`                 | array         | Insert before that index                                     |
| `"key[index]:after"`                  | array         | Insert after that index                                      |
| `"key[index]:remove"`                 | array         | Remove that index                                            |
| `"key[prop=value].property"`          | array         | Set property of item matching selector                       |
| `"key[prop=value]:before"`            | array         | Insert before matching item                                  |
| `"key[prop=value]:after"`             | array         | Insert after matching item                                   |
| `"key[prop=value]:remove"`            | array         | Remove matching item                                         |
| `"key:prepend"`                       | array         | Prepend a new item                                           |
| `"key:append"`                        | array         | Append a new item                                            |

Example combining several mutations on the same rule (verbatim shape used in the monorepo's `example-1/features/withMutations.yml`):

```yaml
variables:
  "tags:prepend": "first"
  "tags:append": "extra"
  "items[id=2]:before": { id: "2a", name: "Before Second", meta: { score: 0.15 } }
  "items[id=2]:after": { id: "2b", name: "After Second", meta: { score: 0.25 } }
  "payload.rows:append": { id: 3, label: "C" }
  "items[2]:remove": null
  "hero.cta.url": /signup-nl
  "acceptedCards[id=amex]:remove": null
```

Mutations are validated by `npx featurevisor lint` against the variable's schema — wrong paths, invalid types, or removing required properties will fail lint.
