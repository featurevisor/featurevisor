---
title: Features
description: Learn how to create feature flags in Featurevisor
ogImage: /img/og/docs-features.png
---

Features are the building blocks of creating traditional boolean feature flags and more advanced multivariate experiments. {% .lead %}

The goal of creating a feature is to be able to evaluate its values in your application with the provided [SDKs](/docs/sdks). The evaluated values can be either its:

- **flag**: its own on/off status
- **variation**: a string value if you have a/b tests running
- **variables**: a set of key/value pairs

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

This is the smallest possible definition of a feature in Featurevisor.

Quite a few are happening there. We will go through each of the properties from the snippet above and more in the following sections.

## Description

This is for describing what the feature is about, and meant to be used by the team members who are working on the feature.

```yml
# features/sidebar.yml
description: Some human readable description of this particular feature
```

## Tags

Tags are used to group features together. This helps your application load only the features that are relevant to the application itself.

Very useful when you have multiple applications targeting different platforms (like Web, iOS, Android) in your organization.

Array of tags are defined in the `tags` property:

```yml
# ...
tags:
  - all
  - web
  - ios
```

Read more about how tags are relevant in [building datafiles](/docs/building-datafiles) per tag.

## Bucketing

The `bucketBy` property is used to determine how the feature will be bucketed. Meaning, how the variation of a feature is assigned to a user.

```yml
# ...
bucketBy: userId
```

Given we used `userId` attribute as the `bucketBy` value, it means no matter which application or device the user is using, as long as the `userId` attribute's value is the same, the same value(s) of the feature will be consistently assigned to that particular user.

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

You can read more about bucketing concept [here](/docs/bucketing).

## Variations

A feature can have multiple variations if you wish to run A/B tests. Each variation must have a different string value.

```yml
# ...
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

You can read more about experimentation [here](/docs/use-cases/experiments).

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
        segments: netherlands
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
        segments: netherlands
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
        segments: germany
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
  bgColor:
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
      bgColor: blue
```

If users are bucketed in the `treatment` variation, they will get the `bgColor` variable value of `blue`. Otherwise they will fall back to the default value of `red` as defined in the variables schema.

Like variations, variables can also have a `description` property for documentation purposes.

You can read more about using Featurevisor for remote configuration needs [here](/docs/use-cases/remote-configuration).

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
        segments: netherlands
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
    variableOverrides:
      bgColor:
        - segments: netherlands
          value: orange
    variables:
      bgColor: blue
```

If you want to embed overriding conditions directly within variations:

```yml
# ...
variations:
  # ...

  - value: treatment
    weight: 100
    variableOverrides:
      bgColor:
        - conditions:
          - attribute: country
            operator: equals
            value: nl
          value: orange
    variables:
      bgColor: blue
```

## Variable types

Examples of each type of variable:

### `string`

```yml
# ...
variablesSchema:
  bgColor:
    type: string
    defaultValue: red

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      bgColor: blue
```

### `boolean`

```yml
# ...
variablesSchema:
  showSidebar:
    type: boolean
    defaultValue: false

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      showSidebar: true
```

### `integer`

```yml
# ...
variablesSchema:
  position:
    type: integer
    defaultValue: 1

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      position: 2
```

### `double`

```yml
# ...
variablesSchema:
  amount:
    type: double
    defaultValue: 9.99

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      amount: 4.99
```

### `array`

```yml
# ...
variablesSchema:
  acceptedCards:
    type: array
    defaultValue:
      - visa
      - mastercard

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      acceptedCards:
        - visa
        - amex
```

### `object`

```yml
# ...
variablesSchema:
  hero:
    type: object
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      hero:
        title: Welcome to our website
        subtitle: We are glad you are here
```

### `json`

```yml
# ...
variablesSchema:
  hero:
    type: json
    defaultValue: '{"title": "Welcome", "subtitle": "Welcome to our website"}'

variations:
  # ...
  - value: treatment
    weight: 100
    variables:
      hero: '{"title": "Welcome to our website", "subtitle": "We are glad you are here"}'
```

## Required

A feature can be dependent on one or more other features. This is useful when you want to make sure that a feature is only allowed to continue its evaluation if the other required features are also evaluated as enabled first.

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

This will make sure that `checkoutPromo` feature can continue its evaluation by the SDKs if `checkoutRedesign` feature is enabled against the same context first.

It is possible to have multiple features defined as required for a feature. Furthermore, you can also require the feature(s) to be evaluated as a specific variation:

```yml
# features/checkoutPromo.yml
description: Checkout promo
tags:
  - all

bucketBy: userId

required:
  # checking only if checkoutRedesign is enabled
  - checkoutRedesign

  # require the feature to be evaluated as a specific variation
  - key: someOtherFeature
    variation: treatment

# ...
```

If both the required features are evaluated as desired, the dependent feature `checkoutPromo` will then continue with its own evaluation.

You can read more about managing feature dependencies [here](/docs/use-cases/dependencies).

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

You can see our use case covering this functionality in [testing in production](/docs/use-cases/testing-in-production) guide.

## Deprecating

You can deprecate a feature by setting `deprecated: true`:

```yml
deprecated: true

# ...
```

Deprecating a feature will still include the feature in generated datafiles and SDKs will still be able to evaluate the feature, but evaluation will lead to showing a warning in the logs.

Similarly, variables can also be deprecated:

```yml
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    deprecated: true # mark as deprecated
```

This is done to help notify the developers to stop using the affected feature or its variable without breaking the application.

## Archiving

You can archive a feature by setting `archived: true`:

```yml
archived: true

# ...
```

Doing so will exclude the feature from generated datafiles and SDKs will not be able to evaluate the feature.

## Expose

In some cases, you may not want to expose a certain feature's configuration only in specific environments when generating the [datafiles](/docs/building-datafiles).

Exposure here means the inclusion of the feature's configuration in the generated datafile, irrespective of whether the feature is later evaluated as enabled or disabled.

This is different than:

- **Archiving**: because you only want to control the exposure of the feature's configuration in a specific environment, not all environments
- **Deprecating**: because deprecating a feature will still expose the configuration in all environments
- **0% rollout**: because this will evaluate the feature
as disabled as intended, but still expose the configuration in the datafiles which we do not want

To achieve that, we can use the `expose` property when defining an environment's rules:

```yml
# ...

environments:
  production:
    # this optional property tells Featurevisor
    # to not include this feature config
    # when generating datafiles
    # for this specific environment
    expose: false

    # even though we have rules defined here,
    # the feature won't end up in production datafiles
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

This technique is useful if you wish to test things out in a specific environment (like staging) without affecting rest of the environments (like production).

You can take things a bit further if you wish to expose the feature only for certain tags in an environment:

```yml
# ...

# imagine you already had these tags
tags:
  - web
  - ios
  - android

environments:
  production:
    # this optional property tells Featurevisor
    # to include this feature config
    # when generating datafiles
    # for only these specific tags
    expose:
      - web
      - ios
      # skipping `android` here

    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

Ideally we never wish to keep `expose` property in our definitions, and it is only meant to serve our short term needs.
