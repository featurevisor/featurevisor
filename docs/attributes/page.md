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

`type` and `description` are the minimum required properties for an attribute.

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

For example, if you want to create an attribute for `permissions`, you can do it like this:

```yml {% path="attributes/permissions.yml" %}
description: Permissions
type: array
```

### object

When an attribute is of type `object`, it can have nested properties.

For example, if you want to create an attribute for `user` with some nested properties, you can do it like this:

```yml {% path="attributes/user.yml" %}
description: User

type: object

properties:
  id:
    type: string
    description: User ID
  country:
    type: string
    description: User country
```

When writing conditions for [segments](/docs/segments/), you can use the dot notation to access nested properties. For example, `user.id` or `user.country`.

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
  "user": {
    "id": "12345",
    "country": "nl"
  }
}
```
