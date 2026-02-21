---
title: Reusable schemas for variables
nextjs:
  metadata:
    title: Reusable schemas for variables
    description: Define schemas once and reuse them when defining multiple variables spanning across multiple features
    openGraph:
      title: Reusable schemas for variables
      description: Define schemas once and reuse them when defining multiple variables spanning across multiple features
      images:
        - url: /img/og/docs-schemas.png
---

Define schemas once and reuse them when defining multiple [variables](/docs/features/#variables) spanning across multiple [features](/docs/features). {% .lead %}

## Understanding variable schemas

Each feature in Featurevisor can optionally define its variables using the `variablesSchema` property, which is a dictionary of variable names to their individual variable schemas.

A simple `string` variable schema would look like this inside a feature:

```yml {% path="features/my_feature.yml" highlight="5" %}
# ...

variablesSchema:
  my_variable:
    type: string
    defaultValue: red
```

Several other types of variables supported include:

- `boolean`: either `true` or `false`
- `integer`: any integer value
- `double`: any floating point number value
- `array`
- `object`
- `json`: free-form stringified JSON

Read further in the [variables](/docs/features/#variables) section for more documentation.

## Complex variable schemas

When `object` or `array` types are used, we can define the schema directly inline.

This follows a flavour of [JSON Schema](https://json-schema.org) format, but in a highly simplified form.

### Object variable

Objects can be defined as flat or nested depending on the requirements:

```yml {% path="features/my_feature.yml" highlight="5-17" %}
# ...

variablesSchema:
  hero:
    type: object
    properties:
      title:
        type: string
      subtitle:
        type: string
      cta:
        type: object
        properties:
          text:
            type: string
          url:
            type: string
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website
      cta:
        text: Get started
        url: /get-started
```

### Array variable

Arrays can be defined as simple arrays of strings, numeric values, or even objects:

```yml {% path="features/my_feature.yml" highlight="5-12" %}
# ...

variablesSchema:
  navLinks:
    type: array
    items:
      type: object
      properties:
        title:
          type: string
        url:
          type: string
    defaultValue:
      - title: Home
        url: /
      - title: About
        url: /about
      - title: Contact
        url: /contact
```

## Defining reusable schemas

Instead of having to inline the schema in each feature, we can extract them to a separate file and reference them by name.

We can first create a reusable schema for `link`s:

```yml {% path="schemas/link.yml" %}
description: Individual link schema
type: object

properties:
  title:
    type: string
  url:
    type: string

required:
  - title
  - url
```

Now we can create another schema for `hero`:

```yml {% path="schemas/hero.yml" %}
description: Hero schema
type: object

properties:
  title:
    type: string
  subtitle:
    type: string
  cta:
    schema: link # schemas can reference other schemas
```

## Referencing schemas

Now from inside our feature, we can reference the reusable schemas by name when defining the variables:

```yml {% path="features/my_feature.yml" highlight="5,15" %}
# ...

variablesSchema:
  hero:
    schema: hero # reference by schema name
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website
      cta:
        title: Get started

  navLinks:
    type: array
    items:
      schema: link # we can reference at item level too in arrays
    defaultValue:
      - title: Home
        url: /
      - title: About
        url: /about
      - title: Contact
        url: /contact
```

Alternatively, we could also define `links` as a reusable schema for an array of `link`s:

```yml {% path="schemas/links.yml" %}
description: List of links schema
type: array

items:
  schema: link # plural "links" referencing singular "link"
```

And then reference it directly in our feature:

```yml {% path="features/my_feature.yml" highlight="5" %}
# ...

variablesSchema:
  navLinks:
    schema: links
    defaultValue:
      - title: Home
        url: /
      - title: About
        url: /about
      - title: Contact
        url: /contact
```

## Advanced usage

### required

The `required` property is used to define the properties that are required in the schema:

```yml {% path="schemas/mySchema.yml" highlight="8-9" %}
description: Schema description...
type: object

properties:
  name:
    type: string

required:
  - name
```

### const

We can use the `const` property to define a constant value for a particular property in the schema:

```yml {% path="schemas/mySchema.yml" highlight="3" %}
description: Schema description...
type: string

const: "constant value here"
```

### enum

We can use the `enum` property to define a list of allowed values for a particular property in the schema:

```yml {% path="schemas/mySchema.yml" highlight="4-7" %}
description: Schema description...
type: string

enum:
  - value1
  - value2
  - value3
```

### minimum

For numeric types (`integer` or `double`), we can use the `minimum` property to define the minimum value for the schema:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: integer

minimum: 0
```

### maximum

For numeric types (`integer` or `double`), we can use the `maximum` property to define the maximum value for the schema:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: integer

maximum: 100
```

Both `minimum` and `maximum` properties can be used together to define a range of allowed values:

```yml {% path="schemas/mySchema.yml" highlight="3-4" %}
description: Schema description...
type: integer

minimum: 0
maximum: 100
```

### minLength

For type `string`, we can use `minLength` to require a minimum character length:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: string

minLength: 1
```

### maxLength

For type `string`, we can use `maxLength` to allow a maximum character length:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: string

maxLength: 100
```

Both `minLength` and `maxLength` can be used together:

```yml {% path="schemas/mySchema.yml" highlight="3-4" %}
description: Schema description...
type: string

minLength: 1
maxLength: 100
```

### pattern

For type `string`, we can use `pattern` to require the value to match an ECMA-262 regular expression:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: string

pattern: "^[a-z0-9-]+$"
```

We can also combine `pattern` with `minLength` and `maxLength`:

```yml {% path="schemas/mySchema.yml" highlight="3-5" %}
description: Schema description...
type: string

minLength: 3
maxLength: 20
pattern: "^[a-zA-Z0-9_]+$"
```

### minItems

For type `array`, we can use `minItems` to require a minimum number of elements:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: array

minItems: 1
items:
  type: string
```

### maxItems

For type `array`, we can use `maxItems` to allow a maximum number of elements:

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: array

maxItems: 10
items:
  type: string
```

Both `minItems` and `maxItems` can be used together:

```yml {% path="schemas/mySchema.yml" highlight="3-4" %}
description: Schema description...
type: array

minItems: 1
maxItems: 10
items:
  type: string
```

### uniqueItems

For type `array`, we can use `uniqueItems` to require that all elements are unique (no duplicates).

```yml {% path="schemas/mySchema.yml" highlight="4" %}
description: Schema description...
type: array

uniqueItems: true
items:
  type: string
```

### oneOf

We can use the `oneOf` property to allow a value to match **exactly one** of several schemas.

One of the primitive types:

```yml {% path="schemas/stringOrNumber.yml" %}
description: Value is either a string or an integer
oneOf:
  - type: string
  - type: integer
```

Mixing with other schemas:

```yml {% path="schemas/idOrLink.yml" %}
description: Either a string id or a full link object
oneOf:
  - type: string
  - schema: link # reference another schema by name
```

For array items, we can use `items` property to reference the `oneOf` schema:

```yml {% path="schemas/mixedList.yml" %}
description: Mixed list of strings and integers
type: array

# by referencing schema that already uses `oneOf` internally
items:
  schema: stringOrNumber

# or by defining `oneOf` directly:
items:
  oneOf:
    - type: string
    - type: integer
    - schema: link # reference another schema by name
    - schema: someOtherSchema
```

## Linting based on schemas

Because of strict linting that's supported out of the box in Featurevisor, we can find issues early if we mistakenly provided any wrong value for the variables anywhere in our feature definitions:

```{% title="Command" %}
$ npx featurevisor lint
```

Learn more in [Linting](/docs/linting) page.

## Code generation

Even with the usage of reusable schemas, [code generation](/docs/code-generation) takes care of generating types for the features and its variables out of the box for optionally added safety and improved developer experience.
