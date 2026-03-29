---
title: Attributes
nextjs:
  metadata:
    title: Attributes
    description: Learn how to create attributes in Featurevisor
    openGraph:
      title: Attributes
      description: Learn how to create attributes in Featurevisor
      images:
        - url: /img/og/docs-attributes.png
---

Attributes are the building blocks of creating conditions, which can later be used in reusable [segments](/docs/segments/). {% .lead %}

## Create an attribute

Let's create an attribute called `country`:

```yml {% path="attributes/country.yml" %}
description: Country
type: string
```

`description` is required.

At the top level, an attribute must define either:

- `type`
- `oneOf`

You cannot use both together at the top level.

## Types

These types are supported for attribute values:

- `boolean`
- `string`
- `integer`
- `double`
- `date`
- `array` (of strings)
- `object` (flat object)

### boolean

When an attribute is of type `boolean`, it can have two possible values: `true` or `false`.

For example, if you want to create an attribute for `isPremiumUser`, you can do it like this:

```yml {% path="attributes/isPremiumUser.yml" %}
description: Is Premium User
type: boolean
```

### string

When an attribute is of type `string`, it can have any string value.

For example, if you want to create an attribute for `country`, you can do it like this:

```yml {% path="attributes/country.yml" %}
description: Country
type: string
```

### integer

When an attribute is of type `integer`, it can have any integer value.

For example, if you want to create an attribute for `age`, you can do it like this:

```yml {% path="attributes/age.yml" %}
description: Age
type: integer
```

### double

When an attribute is of type `double`, it can have any floating point number value.

For example, if you want to create an attribute for `rating`, you can do it like this:

```yml {% path="attributes/rating.yml" %}
description: Rating
type: double
```

### date

When an attribute is of type `date`, it can have any date value in ISO 8601 format.

For example, if you want to create an attribute for `signupDate`, you can do it like this:

```yml {% path="attributes/signupDate.yml" %}
description: Signup Date
type: date
```

### array

When an attribute is of type `array`, it can have an array of string values.

If you want to keep it simple, you can define it like this:

```yml {% path="attributes/permissions.yml" %}
description: Permissions
type: array
```

If you want stricter validation, you can define `items` and other schema properties:

```yml {% path="attributes/permissions.yml" %}
description: User permissions
type: array

items:
  type: string
  enum:
    - read
    - write
    - admin
```

Array attributes only support arrays of strings.

### object

When an attribute is of type `object`, it is treated as a flat object.

If you want to keep it simple, you can define it like this:

```yml {% path="attributes/preferences.yml" %}
description: User preferences as a flat object
type: object
```

If you want stricter validation, you can define `properties`, `required`, and other schema properties:

```yml {% path="attributes/account.yml" %}
description: Account details

type: object

properties:
  plan:
    type: string
    enum:
      - free
      - pro
  locale:
    type: string

required:
  - plan
```

Object attributes must stay flat. In other words, if `type: object` is used, none of its properties can be another `object` type.

When writing conditions for [segments](/docs/segments/), you can use dot notation for object properties, such as `account.plan` or `account.locale`.

## oneOf

At the top level, you can use `oneOf` instead of `type` when an attribute can match exactly one of multiple schemas.

For example:

```yml {% path="attributes/version.yml" %}
description: Version number of the app
oneOf:
  - type: string
  - type: double
```

## Schema properties

Attributes support schema-style properties for authoring and linting, including:

- `enum`
- `const`
- `oneOf`
- `properties`
- `required`
- `additionalProperties`
- `items`
- `minimum`
- `maximum`
- `minLength`
- `maxLength`
- `pattern`
- `minItems`
- `maxItems`
- `uniqueItems`

These schema properties help with linting and code generation.

Attributes are not included in generated [datafiles](/docs/building-datafiles/), so they are here to help improve the authoring workflow without affecting datafile size.

You can learn more in [Schemas](/docs/schemas/#advanced-usage) page.

## Archiving

You can archive an attribute by setting `archived: true`:

```yml {% path="attributes/country.yml" %}
archived: true
type: string
description: Country
```

## Relationship with context

[SDKs](/docs/sdks/) evaluate values against the [context](/docs/sdks/javascript/#context) available at runtime. The context is an object where the keys are attribute names and the values are the attribute values.

For example, if you have an attribute called `country`, the context will look like this:

```js
{
  "country": "nl" // The Netherlands
}
```

If we combine all the above examples, the full context may look like this:

```js
{
  "country": "nl",
  "isPremiumUser": true,
  "age": 30,
  "rating": 4.5,
  "signupDate": "2025-01-01T00:00:00Z",
  "permissions": ["read", "write"],
  "preferences": {
    "theme": "dark",
    "language": "nl"
  },
  "account": {
    "plan": "pro",
    "locale": "nl-NL"
  },
  "version": "5.5.0"
}
```
