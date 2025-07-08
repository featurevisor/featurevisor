---
title: Attributes
description: Learn how to create attributes in Featurevisor
ogImage: /img/og/docs-attributes.png
---

Attributes are the building blocks of creating segments. They are the properties that you can use to target users. {% .lead %}

## Create an attribute

Let's create an attribute called `country`:

```yml
# attributes/country.yml
type: string
description: Country
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

### object

When an attribute is of type `object`, it can have nested properties.

For example, if you want to create an attribute for `user` with some nested properties, you can do it like this:

```yml
# attributes/user.yml
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

```yml
# attributes/country.yml
archived: true
type: string
description: Country
```
