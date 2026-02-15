---
title: Features
nextjs:
  metadata:
    title: Features
    description: Learn how to create feature flags in Featurevisor
    openGraph:
      title: Features
      description: Learn how to create feature flags in Featurevisor
      images:
        - url: /img/og/docs-features.png
---

Features are the building blocks of creating traditional boolean feature flags and more advanced multivariate experiments, along with variables. {% .lead %}

## Evaluations

The goal of creating a feature is to be able to evaluate its values in your application with the provided [SDKs](/docs/sdks).

The evaluated values can be either its:

- **[Flags](/docs/flags/)** (`boolean`): its own on/off status
- **[Variations](/docs/variations/)** (`string`): a string value if you have a/b tests running
- **[Variables](/docs/variables/)**: a set of key/value pairs (if any)

You can learn more about how the evaluation logic works for each [here](#evaluation-flow).

## Create a Feature

Let's say we have built a new sidebar in our application's UI, and we wish to roll it out gradually to our users.

We can do that by creating a new feature called `sidebar`:

```yml {% path="features/sidebar.yml" %}
description: Sidebar
tags:
  - all

bucketBy: userId

rules:
  production:
    - key: everyone
      segments: '*'    # `*` means everyone
      percentage: 100  # rolled out 100%
```

This is the smallest possible definition of a feature in Featurevisor.

Quite a few are happening there. We will go through each of the properties from the snippet above and more in the following sections.

## Description

This is for describing what the feature is about, and meant to be used by the team members who are working on the feature.

```yml {% path="features/sidebar.yml" %}
description: Some human readable description of this particular feature

# ...
```

## Tags

Tags are used to group features together. This helps your application load only the features that are relevant to the application itself.

Very useful when you have multiple applications targeting different platforms (like Web, iOS, Android) in your organization and you are managing all the features from the same Featurevisor project.

Array of tags are defined in the `tags` property:

```yml {% path="features/sidebar.yml" %}
# ...

tags:
  - all
  - web
  - ios
```

Read more about how tags are relevant in [building datafiles](/docs/building-datafiles) per [tag](/docs/tags/).

## Bucketing

The `bucketBy` property is used to determine how the feature will be bucketed. Meaning, how the values of a feature are assigned to a user as they get rolled out gradually.

### Single attribute

If the user's ID is always known when the particular feature is evaluated, it makes sense to use that as the `bucketBy` value.

```yml {% path="features/sidebar.yml" %}
# ...

bucketBy: userId
```

Given we used `userId` attribute as the `bucketBy` value, it means no matter which application or device the user is using, as long as the `userId` attribute's value is the same in [context](/docs/sdks/javascript/#context), the same value(s) of the feature will be consistently evaluated for that particular user.

### Anonymous users

If the user is anonymous, you can consider using `deviceId` or any other unique identifier that is available in the context instead.

```yml {% path="features/sidebar.yml" %}
# ...

bucketBy: deviceId
```

### Combining attributes

If you want to bucket users against multiple attributes together, you can do as follows:

```yml {% path="features/sidebar.yml" %}
# ...

bucketBy:
  - organizationId
  - userId
```

### Alternative attribute

If you want to bucket users against first available attribute only, you can do as follows:

```yml {% path="features/sidebar.yml" %}
# ...

bucketBy:
  or:
    - userId
    - deviceId
```

You can read more about bucketing concept [here](/docs/bucketing).

## Rules

A feature can have multiple rollout rules for each environment.

### By environment

The environment keys are based on your project configuration. Read more in [Configuration](/docs/configuration) and [Environments](/docs/environments/).

```yml {% path="features/sidebar.yml" highlight="4,9" %}
# ...

rules:
  staging:
    - key: everyone
      segments: '*'
      percentage: 100

  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

### Rule key

Each rule must have a unique `key` value among sibling rules within that environment.

This is needed to maintain [consistent bucketing](/docs/bucketing/) as we increase our rollout percentage over time, ensuring the same user gets the same feature value every time they are evaluated against the same context.

```yml {% path="features/sidebar.yml" highlight="5,9" %}
# ...

rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 50

    - key: everyone
      segments: '*' # everyone
      percentage: 100
```

The first rule matched always wins when features are evaluated by the [SDKs](/docs/sdks/) against provided [context](/docs/sdks/javascript/#context).

### Segments

Targeting your audience is one of the most important things when rolling out features. You can do that with reusable [segments](/docs/segments/).

#### Targeting everyone

If we wish to roll out a feature to everyone, we can use the `*` asterisk in `segments` property inside a rule:

```yml {% path="features/sidebar.yml" highlight="6" %}
# ...

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

#### Specific segment

If we wish to roll out a feature to a specific segment:

```yml {% path="features/sidebar.yml" highlight="6" %}
# ...

rules:
  production:
    - key: de
      segments: germany # referencing segments/germany.yml
      percentage: 100   # any value between 0 and 100 (inclusive)
```

#### Complex

We can combine `and`, `or`, and `not` operators to create complex segments:

##### With `and` operator:

```yml {% path="features/sidebar.yml" highlight="7-10" %}
# ...

rules:
  production:
    - key: de+iphone # any unique string is fine here
      # targeting: iphone users in germany
      segments:
        and:
          - germany
          - iphoneUsers
      percentage: 100
```

##### With `or` operator:

```yml {% path="features/sidebar.yml" highlight="7-10" %}
# ...

rules:
  production:
    - key: nl-or-de
      # targeting: users from either The Netherlands or Germany
      segments:
        or:
          - netherlands
          - germany
      percentage: 100
```

##### With `not` operator:

```yml {% path="features/sidebar.yml" highlight="7-9" %}
# ...

rules:
  production:
    - key: not-de
      # targeting: users from everywhere except Germany
      segments:
        not:
          - germany
      percentage: 100
```

##### Combining multiple operators

Combining `and`, `or`, and `not` operators:

```yml {% path="features/sidebar.yml" highlight="10-18" %}
# ...

rules:
  production:
    - key: '1'
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

##### Nested operators

You can also nest `and`, `or`, and `not` operators:

```yml {% path="features/sidebar.yml" highlight="6-12" %}
# ...

rules:
  production:
    - key: '1'
      segments:
        - and:
            - iphoneUsers
            - adultUsers
            - or:
                - netherlands
                - germany
      percentage: 100
```

### Percentage

The `percentage` property is used to determine what percentage of users matching the segments of the particular rule will see this feature as enabled:

```yml {% path="features/sidebar.yml" highlight="7" %}
# ...

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

You can choose a number between `0` and `100` (inclusive), with up to 2 decimal places.

### Rule description

You can also describe each rule with an optional `description` property. This is useful for documentation purposes:

```yml {% path="features/sidebar.yml" highlight="6" %}
# ...

rules:
  production:
    - key: everyone
      description: Rollout to everyone in production
      segments: '*'
      percentage: 100
```

## Variations

A feature can have multiple variations if you wish to run A/B test [experiments](/docs/use-cases/experiments/).

### Weights

Each variation must have a unique string value with their own weights (out of 100):

```yml {% path="features/sidebar.yml" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
```

The sum of all variations' weights must be 100.

You can have up to 2 decimal places for each weight.

{% callout type="note" title="Control variation" %}
In the world of experimentation, the default variation is usually called the `control` variation, and the second variation is called `treatment`.

But you are free to name them however you want, and create as many variations as you want.
{% /callout %}

You can read more about experimentation [here](/docs/use-cases/experiments).

### Disabled variation value

If the feature is evaluated as disabled, then its variation will evaluate as `null` by default.

You can change this behaviour by setting `disabledVariationValue` property in the feature:

```yml {% path="features/sidebar.yml" highlight="3" %}
# ...

disabledVariationValue: control

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
```

### Overriding variation value

You can also override the variation of a feature for a specific rule:

```yml {% path="features/sidebar.yml" highlight="8" %}
# ...

rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 100
      variation: control
```

This is useful when you know the desired variation you want to stick to in a specific rule's segments, while continuing testing other variations in other rules.

### Overriding variation weights

The weights of variations as defined in `variations` is honoured by all rules by default.

There might be cases where you want to override the weights of variations just for a specific rule. You can do that by defining `variationWeights` property in the rule:

```yml {% path="features/sidebar.yml" highlight="8-10" %}
# ...

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
      variationWeights:
        control: 70
        treatment: 30
```

### Variation description

You can also describe each variation with an optional `description` property for documentation purposes:

```yml {% path="features/sidebar.yml" highlight="5,9" %}
# ...

variations:
  - value: control
    description: Default experiment for all users
    weight: 50

  - value: treatment
    description: The new sidebar design that we are testing
    weight: 50
```

## Variables

Variables are really powerful, and they allow you to use Featurevisor as your application's runtime configuration management tool.

### Schema

Before assigning variable values, we must define the schema of our variables in the feature:

```yml {% path="features/sidebar.yml" %}
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
```

Like variations, variables can also have a `description` property for documentation purposes.

You can read more about using Featurevisor for remote configuration needs [here](/docs/use-cases/remote-configuration).

### Default when disabled

If the feature itself is evaluated as disabled, its variables will evaluate as `null` by default.

If you want to serve the variable's default value when the feature is disabled, you can set `useDefaultWhenDisabled: true`:

```yml {% path="features/sidebar.yml" highlight="7" %}
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    useDefaultWhenDisabled: true
```

### Disabled variable value

If you want a specific variable value to be served instead of the default one when the feature itself is disabled, you can set `disabledValue` property:

```yml {% path="features/sidebar.yml" highlight="7" %}
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    disabledValue: purple
```

### Variable description

You can also describe each variable with an optional `description` property for documentation purposes:

```yml {% path="features/sidebar.yml" highlight="6" %}
# ...

variablesSchema:
  bgColor:
    type: string
    description: Background colour of the sidebar
    defaultValue: red
```

### Supported types

These types of variables are allowed:

- `string`
- `boolean`
- `integer`
- `double`
- `array`
- `object`
- `json` (any valid JSON in stringified form)

#### `string`

```yml
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
```

#### `boolean`

```yml
# ...

variablesSchema:
  showSidebar:
    type: boolean
    defaultValue: false
```

#### `integer`

```yml
# ...

variablesSchema:
  position:
    type: integer
    defaultValue: 1
```

#### `double`

```yml
# ...

variablesSchema:
  amount:
    type: double
    defaultValue: 9.99
```

#### `array`

By default, arrays are treated as arrays of strings:

```yml
# ...

variablesSchema:
  acceptedCards:
    type: array
    defaultValue:
      - visa
      - mastercard
```

Similar to JSON Schema, you can also define the schema for the items in the array explicitly:

```yml
# ...

variablesSchema:
  acceptedCards:
    type: array
    items:
      type: string
    defaultValue:
      - visa
      - mastercard
```

Here is an example of an array of objects:

```yml
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

      - title: Contact
        url: /contact
```

#### `object`

If no additional `properties` are defined similar to JSON Schema format, then the object is treated as a flat object (primitive values only):

```yml
# ...

variablesSchema:
  hero:
    type: object
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website
```

Alternatively, you can define the object with `properties` and `required` properties for more strict linting:

```yml
# ...

variablesSchema:
  hero:
    type: object
    properties:
      title:
        type: string
      subtitle:
        type: string
    required:
      - title
      - subtitle
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website
```

Nested objects can also be defined with their own `properties` and `required` properties (similar to JSON Schema format):

```yml
# ...

variablesSchema:
  hero:
    type: object
    properties:
      background:
        type: object
        properties:
          image:
            type: string
          color:
            type: string
      cta:
        type: object
        properties:
          title:
            type: string
          url:
            type: string
    defaultValue:
      background:
        image: /img/hero-background.png
        color: red
      cta:
        title: Get started
        url: /get-started
```

#### `json`

```yml
# ...

variablesSchema:
  hero:
    type: json
    defaultValue: '{"title": "Welcome", "subtitle": "Welcome to our website"}'
```

### Overriding variables

#### From rules

You can override variable values for specific rules:

```yml {% path="features/sidebar.yml" highlight="8-9" %}
# ...

rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 100
      variables:
        bgColor: orange
```

#### From variations

We can assign values to the variables inside variations:

```yml {% path="features/sidebar.yml" highlight="9-10" %}
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

#### Further overriding from variation

```yml {% path="features/sidebar.yml" highlight="9-13" %}
# ...

variations:
  # ...

  - value: treatment
    weight: 100

    variableOverrides:
      # bgColor should be orange if `netherlands` segment is matched
      bgColor:
        - segments: netherlands
          value: orange

    # for everyone else in `treatment` variation, it should be blue
    variables:
      bgColor: blue
```

If you want to embed overriding conditions directly within variations:

```yml {% path="features/sidebar.yml" highlight="10-13" %}
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

## Required

A feature can be dependent on one or more other features. This is useful when you want to make sure that a feature is only allowed to continue its evaluation if the other required features are also evaluated as enabled first.

For example, let's say we have a new feature under development for redesigning the checkout flow of an e-commerce application. We can call it `checkoutRedesign`.

And we have another feature called `checkoutPromo` which is responsible for showing a promo code input field in the new redesigned checkout flow. We can call it `checkoutPromo`.

### Required as enabled

Given the `checkoutPromo` feature is dependent on the `checkoutRedesign` feature, we can express that in YAML as follows:

```yml {% path="features/checkoutPromo.yml" highlight="7-8" %}
description: Checkout promo
tags:
  - all

bucketBy: userId

required:
  - checkoutRedesign

# ...
```

This will make sure that `checkoutPromo` feature can continue its evaluation by the SDKs if `checkoutRedesign` feature is enabled against the same context first.

### Required with variation

It is possible to have multiple features defined as required for a feature. Furthermore, you can also require the feature(s) to be evaluated as a specific variation:

```yml {% path="features/checkoutPromo.yml" highlight="7-13" %}
description: Checkout promo
tags:
  - all

bucketBy: userId

required:
  # checking only if checkoutRedesign is enabled
  - checkoutRedesign

  # require the feature to be evaluated with a specific variation
  - key: someOtherFeature
    variation: treatment

# ...
```

If both the required features are evaluated as desired, the dependent feature `checkoutPromo` will then continue with its own evaluation.

You can read more about managing feature dependencies [here](/docs/use-cases/dependencies).

## Force

You can force a feature to be enabled or disabled against custom conditions.

This is very useful when you wish to test something out quickly just for yourself in a specific environment without affecting any other users.

### With conditions

```yml {% path="features/sidebar.yml" highlight="" %}
# ...

force:
  production:
    - conditions:
        - attribute: userId
          operator: equals
          value: '123'

      # enable or disable it
      enabled: true

      # forced variation
      variation: treatment

      # variables can also be forced
      variables:
        bgColor: purple
```

### With segments

Instead of `conditions` above, you can also use `segments` for forcing variations and variables.

```yml {% path="features/sidebar.yml" highlight="5" %}
# ...

force:
  production:
    - segments: QATeam

      # enable or disable it
      enabled: true

      # forced variation
      variation: treatment

      # variables can also be forced
      variables:
        bgColor: purple
```

You can see our use case covering this functionality in [testing in production](/docs/use-cases/testing-in-production) guide.

Unlike rules, forcing evaluations do not require `key` and `percentage` properties.

## Deprecating

You can deprecate a feature by setting `deprecated: true`:

```yml {% path="features/sidebar.yml" %}
deprecated: true

# ...
```

Deprecating a feature will still include the feature in generated [datafiles](/docs/building-datafiles/) and [SDKs](/docs/sdks/) will still be able to evaluate the feature, but evaluation will lead to showing a warning in the logs.

Similarly, variables can also be deprecated:

```yml {% path="features/sidebar.yml" highlight="7" %}
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

To achieve that, we can use the `expose` property:

```yml {% path="features/sidebar.yml" highlight="8" %}
# ...

# this optional property tells Featurevisor
# to not include this feature config
# when generating datafiles
# for this specific environment
expose:
  production: false
```

This technique is useful if you wish to test things out in a specific environment (like staging) without affecting rest of the environments (like production).

You can take things a bit further if you wish to expose the feature only for certain tags in an environment:

```yml {% path="features/sidebar.yml" highlight="13-17" %}
# ...

# imagine you already had these tags
tags:
  - web
  - ios
  - android

# this optional property tells Featurevisor
# to include this feature config
# when generating datafiles
# for only these specific tags
expose:
  production:
    - web
    - ios
    # skipping `android` here
```

Ideally we never wish to keep `expose` property in our definitions, and it is only meant to serve our short term needs especially when we might be migrating from another feature management tool to Featurevisor.

## Evaluation flow

Understand how each type of evaluation works in Featurevisor:

### Flag

Flag here means the boolean value of the feature itself, meaning whether it is enabled or disabled.

These are the sequential steps to evaluate a feature's flag value via its [SDKs](/docs/sdks/):

1. If [sticky](/docs/sdks/javascript/#sticky) feature is available in SDK, use the boolean value from there
1. If feature key does not exist in [datafile](/docs/building-datafiles/), the feature is evaluated as disabled
1. If there are any [`required`](#required) (dependency) features, and they do not satisfy the conditions, the feature is evaluated as disabled
1. If there are any [forced rules](#force), use the first one that matches the [context](/docs/sdks/javascript/#context) and use its `enabled` value
1. Find the first [rule](#rules) that matches against the [context](/docs/sdks/javascript/#context) and use its `enabled` value, otherwise use [bucketing](/docs/bucketing/) logic to determine if the feature is enabled or not
1. If no rules matched, the feature is evaluated as disabled

### Variation

1. If [sticky](/docs/sdks/javascript/#sticky) variation value is available in SDK, use the value from there

1. If the feature's flag value is `false`:

   1. The variation is evaluated as `null` by default
   1. If [`disabledVariationValue`](#disabled-variation-value) is set, the variation is evaluated as that value

1. If the feature's flag value is `true`:

   1. If there are any [forced rules](#force), use the first one that matches the [context](/docs/sdks/javascript/#context), and use its `variation` value
   1. If there are any [rules](#rules) that match against the [context](/docs/sdks/javascript/#context), use the rule's `variation` value, otherwise use [bucketing](/docs/bucketing/) logic to determine the variation value

### Variable

1. If [sticky](/docs/sdks/javascript/#sticky) variable value is available in SDK, use the value from there

1. If the feature's flag value is `false`:

   1. The variable is evaluated as `null` by default
   1. If [`useDefaultWhenDisabled`](#default-when-disabled) is set, the variable is evaluated as its [`defaultValue`](#schema)
   1. If [`disabledValue`](#disabled-variable-value) is set, the variable is evaluated as that specific value

1. If the feature's flag value is `true`:

   1. If there are any [forced rules](#force), use the first one that matches the [context](/docs/sdks/javascript/#context), and use its `variables` value (if any)
   1. If there are any [rules](#rules) that match against the [context](/docs/sdks/javascript/#context), use the rule's `variables` value (if any)
   1. If feature has [variations](#variations):

      1. Evaluate the variation value first
      1. If that specific variation has any variable overrides, use that value

   1. Fall back to variable's [`defaultValue`](#schema)
