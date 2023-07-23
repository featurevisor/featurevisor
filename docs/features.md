---
title: Features
description: Learn how to create features in Featurevisor
---

Features are the building blocks of creating traditional boolean feature flags and more advanced multivariate experiments. {% .lead %}

## Create a Feature

Let's say we have built a new sidebar in our application's UI, and we wish to roll it out gradually to our users.

We can do that by creating a new feature called `sidebar`:

```yml
# features/sidebar.yml
description: Sidebar
tags:
  - all

bucketBy: userId

environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

This is the smallest possible definition of a feature.

Quite a few are happening there. We will go through each of the properties from the snippet above and more in the following sections.

## Description

This is for describing what the feature is about, and meant to be used by the team members who are working on the feature.

```yml
# features/sidebar.yml
description: Some human readable description of this particular feature
```

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

Read more about how tags are relevant in [Building datafiles](/docs/building-datafiles).

## Bucketing

The `bucketBy` property is used to determine how the feature will be bucketed. Meaning, how the variation of a feature is assigned to a user.

```yml
# ...
bucketBy: userId
```

Given we used `userId` attribute as the `bucketBy` value, it means no matter which application or device the user is using, as long as the `userId` attribute's value is the same, the same variation of the feature will be consistently assigned to that particular user.

If you want to bucket users against multiple attributes together, you can do as follows:

```yml
# ...
bucketBy:
  - organizationId
  - userId
```

If you want to bucket users against first available attribute only, you can do as follows:

```yml
# ...
bucketBy:
  or:
    - userId
    - deviceId
```

## Variations

A feature can have multiple variations if you wish to run A/B tests. Each variation must have a different string value.

```yml
variations:
  - value: control
    weight: 50

  - value: firstTreatment
    weight: 25

  - value: secondTreatment
    weight: 25
```

The sum of all variations' weights must be 100.

You can have upto 2 decimal places for each weight.

{% callout type="note" title="Control variation" %}
In the world of experimentation, the default variation is usually called the `control` variation, and the second variation is called `treatment`.

But you are free to name them however you want, and create as many variations as you want.
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

Each environment is keyed by its name, as seen above with `staging` and `production` environments.

The environment keys are based on your project configuration. Read more in [Configuration](/docs/configuration).

## Rules

Each environment can have multiple rollout rules.

Each rule must have a unique `key` value among sibling rules within that environment, and this is needed to maintain consistent bucketing as we increase our rollout percentage for the feature over time.

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments:
          - netherlands
        percentage: 50

      - key: "2"
        segments: "*" # everyone
        percentage: 100
```

The first rule matched always wins when features are evaluated by the SDKs.

Read more in [Bucketing](/docs/bucketing).

### Overriding variation

You can also override the variation of a feature for a specific rule:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments:
          - netherlands
        percentage: 100
        variation: b
```

This is useful when you know the desired variation you want to stick to in a specific rule's segments, while continuing testing other variations in other rules.

## Segments

Targeting your audience is one of the most important things when rolling out features. You can do that with segments.

### Everyone

If we wish to roll out a feature to everyone, we can use the `*` wildcard in `segments` property:

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
        segments:
          - germany
        percentage: 100
```

### Complex

We can combine `and`, `or`, and `not` operators to create complex segments:

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
        # targeting: users from everywhere except Germany
        segments:
          not:
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

Variables are really powerful, and they allow you to use Featurevisor as your application's runtime configuration management tool.

Before assigning variable values, we must define the schema of our variables in the feature:

```yml
# ...
variablesSchema:
  - key: bgColor
    type: string
    defaultValue: red
```

We can assign values to the variables inside variations:

```yml
# ...
variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    variables:
      - key: bgColor
        value: blue
```

If users are bucketed in the `treatment` variation, they will get the `bgColor` variable value of `blue`. Otherwise they will fall back to the default value of `red` as defined in the variables schema.

### Supported types

These types of variables are allowed:

- `string`
- `boolean`
- `double`
- `integer`
- `array` (of strings)
- `object` (flat objects only)
- `json` (any valid JSON in stringified form)

### Overriding variables

You can override variable values for specific rules:

```yml
# ...
environments:
  production:
    rules:
      - key: "1"
        segments:
          - netherlands
        percentage: 100
        variables:
          bgColor: orange
```

Or, you can override within variations:

```yml
# ...
variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: bgColor
        value: blue
        overrides:
          - segments:
              - netherlands
            value: orange
```

If you want to embed overriding conditions directly within variations:

```yml
# ...
variations:
  # ...

  - value: treatment
    weight: 100
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

## Variable types

Examples of each type of variable:

### `string`

```yml
# ...
variablesSchema:
  - key: bgColor
    type: string
    defaultValue: red

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: bgColor
        value: blue
```

### `boolean`

```yml
# ...
variablesSchema:
  - key: showSidebar
    type: boolean
    defaultValue: false

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: showSidebar
        value: true
```

### `integer`

```yml
# ...
variablesSchema:
  - key: position
    type: integer
    defaultValue: 1

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: position
        value: 2
```

### `double`

```yml
# ...
variablesSchema:
  - key: amount
    type: double
    defaultValue: 9.99

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: amount
        value: 4.99
```

### `array`

```yml
# ...
variablesSchema:
  - key: acceptedCards
    type: array
    defaultValue:
      - visa
      - mastercard

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: acceptedCards
        value:
          - visa
          - amex
```

### `object`

```yml
# ...
variablesSchema:
  - key: hero
    type: object
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: hero
        value:
          title: Welcome to our website
          subtitle: We are glad you are here
```

### `json`

```yml
# ...
variablesSchema:
  - key: hero
    type: json
    defaultValue: '{"title": "Welcome", "subtitle": "Welcome to our website"}'

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      - key: hero
        value: '{"title": "Welcome to our website", "subtitle": "We are glad you are here"}'
```

## Required

A feature can be dependent on one or more other features. This is useful when you want to make sure that a feature is only allowed to be evaluated as enabled if the other required features are also evaluated as enabled first.

For example, let's say we have a new feature under development for redesigning the checkout flow of an e-commerce application. We can call it `checkoutRedesign`.

And we have another feature called `checkoutPromo` which is responsible for showing a promo code input field in the new redesigned checkout flow. We can call it `checkoutPromo`.

Given the `checkoutPromo` feature is dependent on the `checkoutRedesign` feature, we can express that in YAML as follows:

```yml
# features/checkoutPromo.yml
description: Checkout promo
tags:
  - all

bucketBy: userId

required:
  - checkoutRedesign

# ...
```

This will make sure that `checkoutPromo` feature can be allowed to be evaluated as enabled by the SDKs if `checkoutRedesign` feature is also enabled against the same context.

It is possible to have multiple features defined as required for a feature. Furthermore, you can also require the feature(s) to be evaluated as a specific variation:

```yml
# features/checkoutPromo.yml
description: Checkout promo
tags:
  - all

bucketBy: userId

required:
  # simple, checking only if checkoutRedesign is enabled
  - checkoutRedesign

  # require the feature to be evaluated as a specific variation
  - key: someOtherFeature
    variation: treatment

# ...
```

If both the required features are evaluated as desired, the dependent feature `checkoutPromo` will be evaluated as enabled.

## Force

You can force a feature to be enabled or disabled against custom conditions.

This is very useful when you wish to test something out quickly just for yourself in a specific environment without affecting any other users.

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

        # enable or disable it
        enabled: true

        # forced variation
        variation: treatment

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
