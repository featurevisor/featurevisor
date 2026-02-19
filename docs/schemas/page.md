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

## Linting schemas

Because of strict linting that's supported out of the box in Featurevisor, we can find issues early if we mistakenly provided any wrong value for the variables anywhere in our feature definitions:

```{% title="Command" %}
$ npx featurevisor lint
```

Learn more in [Linting](/docs/linting) page.

## Code generation

Even with the usage of reusable schemas, [code generation](/docs/code-generation) takes care of generating types for the features and its variables out of the box for optionally added safety and improved developer experience.
