---
title: Attributes
description: Learn how to create attributes in Featurevisor
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

## Capturing attributes

This is useful for tracking purposes when we deal with feature activations using Featurevisor [SDKs](/docs/sdks#activation).

Let's create a new attribute called `userId`:

```yml
# attributes/userId.yml
type: string
description: User ID
capture: true
```

If an attribute is marked as `capture: true`, then it will be captured by the SDKs when features are activated.

## Archiving

You can archive an attribute by setting `archived: true`:

```yml
# attributes/country.yml
archived: true
type: string
description: Country
```
