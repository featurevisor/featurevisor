---
title: Segments
nextjs:
  metadata:
    title: Segments
    description: Learn how to create segments in Featurevisor
    openGraph:
      title: Segments
      description: Learn how to create segments in Featurevisor
      images:
        - url: /img/og/docs-segments.png
---

Segments are made up of conditions against various [attributes](/docs/attributes/). They are the groups of users that you can target in your [features](/docs/features/) via rules. {% .lead %}

## Create a segment

Let's assume we already have a `country` attribute.

Now we with to create a segment that targets users from The Netherlands. We can do that by creating a segment:

```yml {% path="segments/netherlands.yml" highlight="5" %}
description: Users from The Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```

The segment will match when the [context](/docs/sdks/javascript/#context) in SDK contains an attribute `country` with value `nl`.

## Conditions

### Targeting everyone

You can target everyone via a segment by using asterisk `*` as the value in `conditions`:

```yml {% path="segments/everyone.yml" highlight="2" %}
description: Everyone
conditions: '*'
```

### Attribute

The `attribute` is the name of the [attribute](/docs/attributes/) you want to check against in the [context](/docs/sdks/javascript/#context).

#### Nested path

If you are using an attribute that is of type `object`, you can make use of dot separated paths to access nester properties, like `myAttribute.nestedProperty`.

### Operator

There are numerous operators that can be used to compare the attribute value against given `value`. Find all supported [operators](#operators) in below section.

### Value

The `value` property is the value you want to operator to compare against. The type of the value depends on the attribute being used.

## Operators

These operators are supported as conditions:

| Operator                    | Type of attribute   | Description                   |
| --------------------------- | ------------------- | ----------------------------- |
| `exists`                    |                     | Attribute exists in context   |
| `notExists`                 |                     | Attribute does not exist      |
| `equals`                    | any                 | Equals to                     |
| `notEquals`                 | any                 | Not equals to                 |
| `greaterThan`               | `integer`, `double` | Greater than                  |
| `greaterThanOrEquals`       | `integer`, `double` | Greater than or equal to      |
| `lessThan`                  | `integer`, `double` | Less than                     |
| `lessThanOrEquals`          | `integer`, `double` | Less than or equal to         |
| `contains`                  | `string`            | Contains string               |
| `notContains`               | `string`            | Does not contain string       |
| `startsWith`                | `string`            | Starts with string            |
| `endsWith`                  | `string`            | Ends with string              |
| `in`                        | `string`            | In array of strings           |
| `notIn`                     | `string`            | Not in array of strings       |
| `before`                    | `string`, `date`    | Date comparison               |
| `after`                     | `string`, `date`    | Date comparison               |
| `matches`                   | `string`            | Matches regex pattern         |
| `notMatches`                | `string`            | Does not match regex pattern  |
| `semverEquals`              | `string`            | Semver equals to              |
| `semverNotEquals`           | `string`            | Semver not equals to          |
| `semverGreaterThan`         | `string`            | Semver greater than           |
| `semverGreaterThanOrEquals` | `string`            | Semver greater than or equals |
| `semverLessThan`            | `string`            | Semver less than              |
| `semverLessThanOrEquals`    | `string`            | Semver less than or equals    |
| `includes`                  | `array`             | Array includes value          |
| `notIncludes`               | `array`             | Array does not include value  |

Examples of each operator below:

### `equals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: equals
    value: us
```

### `notEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: notEquals
    value: us
```

### `greaterThan`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: age
    operator: greaterThan
    value: 21
```

### `greaterThanOrEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: age
    operator: greaterThanOrEquals
    value: 18
```

### `lessThan`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: age
    operator: lessThan
    value: 65
```

### `lessThanOrEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: age
    operator: lessThanOrEquals
    value: 64
```

### `contains`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: name
    operator: contains
    value: John
```

### `notContains`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: name
    operator: notContains
    value: Smith
```

### `startsWith`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: name
    operator: startsWith
    value: John
```

### `endsWith`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: name
    operator: endsWith
    value: Smith
```

### `in`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: in
    value:
      - be
      - nl
      - lu
```

### `notIn`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: notIn
    value:
      - fr
      - gb
      - de
```

### `before`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: date
    operator: before
    value: 2023-12-25T00:00:00Z
```

### `after`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: date
    operator: after
    value: 2023-12-25T00:00:00Z
```

### `semverEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverEquals
    value: 1.0.0
```

### `semverNotEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverNotEquals
    value: 1.0.0
```

### `semverGreaterThan`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverGreaterThan
    value: 1.0.0
```

### `semverGreaterThanOrEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverGreaterThanOrEquals
    value: 1.0.0
```

### `semverLessThan`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverLessThan
    value: 1.0.0
```

### `semverLessThanOrEquals`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: version
    operator: semverLessThanOrEquals
    value: 1.0.0
```

### `exists`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: exists
```

### `notExists`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: country
    operator: notExists
```

### `includes`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: permissions
    operator: includes
    value: write
```

### `notIncludes`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: permissions
    operator: notIncludes
    value: write
```

### `matches`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: email
    operator: matches
    value: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$

    # optional regex flags
    regexFlags: i # case-insensitive
```

### `notMatches`

```yml {% highlight="4" %}
# ...
conditions:
  - attribute: email
    operator: notMatches
    value: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$

    # optional regex flags
    regexFlags: i # case-insensitive
```

## Advanced conditions

Conditions can also be combined using `and`, `or`, and `not` operators.

### `and`

```yml {% highlight="3" %}
# ...
conditions:
  and:
    - attribute: country
      operator: equals
      value: us

    - attribute: device
      operator: equals
      value: iPhone
```

### `or`

```yml {% highlight="3" %}
# ...
conditions:
  or:
    - attribute: country
      operator: equals
      value: us

    - attribute: country
      operator: equals
      value: ca
```

### `not`

```yml {% highlight="3" %}
# ...
conditions:
  not:
    - attribute: country
      operator: equals
      value: us
```

### Complex

`and` and `or` can be combined to create complex conditions:

```yml {% highlight="3,8" %}
# ...
conditions:
  - and:
      - attribute: device
        operator: equals
        value: iPhone

  - or:
      - attribute: country
        operator: equals
        value: us

      - attribute: country
        operator: equals
        value: ca
```

You can also nest `and`, `or`, and `not` operators:

```yml {% highlight="3,4" %}
# ...
conditions:
  - not:
      - or:
          - attribute: country
            operator: equals
            value: us

          - attribute: country
            operator: equals
            value: ca
```

## Archiving

You can archive a segment by setting `archived: true`:

```yml {% path="segments/netherlands.yml" highlight="1" %}
archived: true
description: Users from The Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```
