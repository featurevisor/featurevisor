---
title: Segments
description: Learn how to create segments in Featurevisor
---

Segments are made up of conditions against various attributes. They are the groups of users that you can target. {% .lead %}

## Create a segment

Let's assume we already have two attributes:

- `country`: accepting country codes like `us` for United States, and
- `device`: accepting device name like `iPhone` or `iPad`

Now, let's say we want to create a segment for targeting all iPhone users in the United States in our application.

We can do that by creating a segment:

```yml
# segments/iPhoneUS.yml
description: iPhone users in the United States
conditions:
  - attribute: country
    operator: equals
    value: us
  - attribute: device
    operator: equals
    value: iPhone
```

## Operators

These operators are supported for conditions:

| Operator                    | Type of attribute   | Description                   |
|-----------------------------|---------------------|-------------------------------|
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
| `semverEquals`              | `string`            | Semver equals to              |
| `semverNotEquals`           | `string`            | Semver not equals to          |
| `semverGreaterThan`         | `string`            | Semver greater than           |
| `semverGreaterThanOrEquals` | `string`            | Semver greater than or equals |
| `semverLessThan`            | `string`            | Semver less than              |
| `semverLessThanOrEquals`    | `string`            | Semver less than or equals    |

Examples of each operator below:

### `equals`

```yml
# ...
conditions:
  - attribute: country
    operator: equals
    value: us
```

### `notEquals`

```yml
# ...
conditions:
  - attribute: country
    operator: notEquals
    value: us
```

### `greaterThan`

```yml
# ...
conditions:
  - attribute: age
    operator: greaterThan
    value: 21
```

### `greaterThanOrEquals`

```yml
# ...
conditions:
  - attribute: age
    operator: greaterThanOrEquals
    value: 18
```

### `lessThan`

```yml
# ...
conditions:
  - attribute: age
    operator: lessThan
    value: 65
```

### `lessThanOrEquals`

```yml
# ...
conditions:
  - attribute: age
    operator: lessThanOrEquals
    value: 64
```

### `contains`

```yml
# ...
conditions:
  - attribute: name
    operator: contains
    value: John
```

### `notContains`

```yml
# ...
conditions:
  - attribute: name
    operator: notContains
    value: Smith
```

### `startsWith`

```yml
# ...
conditions:
  - attribute: name
    operator: startsWith
    value: John
```

### `endsWith`

```yml
# ...
conditions:
  - attribute: name
    operator: endsWith
    value: Smith
```

### `in`

```yml
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

```yml
# ...
conditions:
  - attribute: country
    operator: in
    value:
      - fr
      - gb
      - de
```

### `before`

```yml
# ...
conditions:
  - attribute: date
    operator: before
    value: 2023-12-25T00:00:00Z
```

### `after`

```yml
# ...
conditions:
  - attribute: date
    operator: after
    value: 2023-12-25T00:00:00Z
```

### `semverEquals`

```yml
# ...
conditions:
  - attribute: version
    operator: semverEquals
    value: 1.0.0
```

### `semverNotEquals`

```yml
# ...
conditions:
  - attribute: version
    operator: semverNotEquals
    value: 1.0.0
```

### `semverGreaterThan`

```yml
# ...
conditions:
  - attribute: version
    operator: semverGreaterThan
    value: 1.0.0
```

### `semverGreaterThanOrEquals`

```yml
# ...
conditions:
  - attribute: version
    operator: semverGreaterThanOrEquals
    value: 1.0.0
```

### `semverLessThan`

```yml
# ...
conditions:
  - attribute: version
    operator: semverLessThan
    value: 1.0.0
```

### `semverLessThanOrEquals`

```yml
# ...
conditions:
  - attribute: version
    operator: semverLessThanOrEquals
    value: 1.0.0
```

## Conditions

Conditions can also be combined using `and`, `or`, and `not` operators.

### `and`

```yml
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

```yml
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

```yml
# ...
conditions:
  not:
    - attribute: country
      operator: equals
      value: us
```

### Complex

`and` and `or` can be combined to create complex conditions:

```yml
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

```yml
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

```yml
# segments/iPhoneUS.yml
archived: true
description: iPhone users in the United States
conditions:
  - attribute: country
    operator: equals
    value: us
  - attribute: device
    operator: equals
    value: iPhone
```
