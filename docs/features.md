---
title: Features
description: Learn how to create features in Featurevisor
---

Features are the building blocks of creating traditional boolean feature flags and more advanced multivariate experiments. {% .lead %}

## Create a Feature

Let's say we have built a new sidebar in our application's UI, and we wish to roll out gradually to our users.

We can do that by creating a new feature called `sidebar`:

```yml
# features/sidebar.yml
description: Sidebar
tags:
  - all

bucketBy: userId

defaultVariation: false

variations:
  - type: boolean
    value: false
    weight: 50

  - type: boolean
    value: true
    weight: 50

environments:
  staging:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100

  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

Quite a lot of things are happening there. We will go through each of them in the following sections.

## Tags

Tags are used to group features together. This helps your application load only the features that are relevant to the application itself.

Very useful when you have multiple applications in your organization.

Array of tags are defined in the `tags` property:

```yml
# ...
tags:
  - all
  - web
  - ios
```

Read more in [Building datafiles](/docs/building-datafiles).

## Bucketing

The `bucketBy` property is used to determine how the feature will be bucketed. Meaning, how the variation of a feature is assigned to a user.

```yml
# ...
bucketBy: userId
```

Given we used `userId` attribute as the `bucketBy` value, it means no matter which application or device the user is using, as long as the `userId` value is the same, the same variation of the feature will be consistently assigned to that particular user.

If you want to bucket users against multiple attributes together, you can do as follows:

```yml
# ...
bucketBy:
  - organizationId
  - userId
```

## Default variation

If no rollout rules are matched for the user, Featurevisor SDKs will fall back to the default variation as set in `defaultVariation`.

```yml
# ...
defaultVariation: false
```

## Variations

A feature can have multiple variations. Each variation must have a different value.

Here, we have used simple boolean values for the variations with an equal 50-50 weight distribution:

```yml
# ...
variations:
  - type: boolean
    value: false
    weight: 50

  - type: boolean
    value: true
    weight: 50
```

But we could have also used multivate experiments with different values as strings for each variation:

```yml
defaultVariation: control

variations:
  - type: string
    value: control
    weight: 50

  - type: string
    value: b
    weight: 25

  - type: string
    value: c
    weight: 25
```

The sum of all variations' weights must be 100.

{% callout type="note" title="Control variation" %}
In the world of multivariate experiments, the default variation is usually called the `control` variation.
{% /callout %}

## Environments

This is where we define the rollout rules for each environment.

```yml
# ...
environments:
  staging:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100

  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

## Rules

Each environment can have multiple rollout rules.

Each rule must have a unique `key` value among sibling rules, and this is needed to maintain consistent bucketing as we increase our rollout percentage for the feature over time.

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments: netherlands
        percentage: 50

      - key: "2"
        segments: "*"
        percentage: 100
```

The first rule matched always wins when features are evaluated by the SDKs.

Read more in [Bucketing](/docs/bucketing).

## Segments

Targeting your audience is one of the most important things when rolling out features. You can do that with segments.

### Everyone

If we wish to roll out a feature to all users, we can use the `*` wildcard for the `segments` property:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

### Specific

If we wish to roll out a feature to a specific segment:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments: germany
        percentage: 100
```

### Complex

You can combine `and`, `or`, and `not` operators to create complex segments:

With `and` operator:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        # targeting: iphone users in germany
        segments:
          and:
            - germany
            - iphoneUsers
        percentage: 100
```

With `or` operator:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        # targeting: users from either The Netherlands or Germany
        segments:
          or:
            - netherlands
            - germany
        percentage: 100
```

With `not` operator:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        # targeting: users from everywhere except The Netherlands or Germany
        segments:
          not:
            - netherlands
            - germany
        percentage: 100
```

Combining `and`, `or`, and `not` operators:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        # targeting:
        #   - adult users with iPhone, and
        #   - from either The Netherlands or Germany, and
        #   - not newsletterSubscribers
        segments:
          - and:
            - iphoneUsers
            - adultUsers
          - or:
            - netherlands
            - germany
          - not:
            - newsletterSubscribers
        percentage: 100
```

You can also nest `and`, `or`, and `not` operators:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments:
          - and:
            - iphoneUsers
            - adultUsers
            - or:
              - netherlands
              - germany
        percentage: 100
```

## Variables

Variables are really powerful and should be used with caution as they can grow very fast.

Before assigning variable values, we must define the schema for our variables in the feature:

```yml
# ...
variablesSchema:
  - key: bgColor
    type: string
    defaultValue: "red"
```

Then, we can assign values to the variables inside variations:

```yml
# ...
variations:
  - type: boolean
    value: false
    weight: 50

  - type: boolean
    value: true
    weight: 50
    variables:
      - key: bgColor
        value: blue
```

If users are bucketed in the `true` variation, they will get the `bgColor` variable value of `blue`. Otherwise they will fall back to the default value of `red`.

### Types

These types of variables are allowed:

- `string`
- `boolean`
- `double`
- `integer`
- `array` (of strings)

### Overrides

You can override variable values for specific segments:

```yml
# ...
variations:
  # ...

  - type: boolean
    value: true
    weight: 50
    variables:
      - key: bgColor
        value: blue
        overrides:
          - segments: netherlands
            value: orange
```

If you want to embed conditions directly:


```yml
# ...
variations:
  # ...

  - type: boolean
    value: true
    weight: 50
    variables:
      - key: bgColor
        value: blue
        overrides:
          - conditions:
              - attribute: country
                operator: equals
                value: nl
            value: orange
```

## Force

You can force a feature to be enabled or disabled (or any another variation) for a specific user.

This is very useful when you wish to test something out just for yourself in a specific environment without affecting any other users.

```yml
# ...
environments:
  production:
    rules:
      # ...
    force:
      - conditions:
          - attribute: userId
            operator: equals
            value: "123"

        # forced variation
        variation: true

        # variables can also be forced
        variables:
          bgColor: purple
```

Instead of `conditions` above, you can also use `segments` for forcing variations and variables.

## Archiving

You can archive a feature by setting `archived: true`:

```yml
# ...
archived: true
```
