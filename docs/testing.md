---
title: Testing
description: Learn how to test your features and segments in Featurevisor with declarative specs
ogImage: /img/og/docs-testing.png
---

Features and segments can grow into complex configuration very fast, and it's important that you have the confidence they are working as expected. {% .lead %}

We can write test specs in the same expressive way as we defined our features to test them in great detail.

## Testing features

Assuming we already have a `foo` feature in `features/foo.yml`:

```yml
# features/foo.yml
description: Foo feature
tags:
  - all

bucketBy: userId

variablesSchema:
  - key: someKey
    type: string
    defaultValue: someValue

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50

environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

We can create a new test spec for it in `tests` directory:

```yml
# tests/foo.feature.yml
feature: foo # your feature key
assertions:

  # asserting evaluated variation
  # against bucketed value and context
  - description: Testing variation at 40% in NL
    environment: production
    at: 40
    context:
      country: nl
    expectedToBeEnabled: true

    # if testing variations
    expectedVariation: control

  # asserting evaluated variables
  - description: Testing variables at 90% in NL
    environment: production
    at: 90
    context:
      country: nl
    expectedToBeEnabled: true

    # if testing variables
    expectedVariables:
      someKey: someValue
```

The `at` property is the bucketed value (in percentage form ranging from 0 to 100) that assertions will be run against. Read more in [Bucketing](/docs/bucketing).

File names of test specs are not important, but we recommend using the same name as the feature key.

## Testing segments

Similar to features, we can write test specs to test our segments as well.

Assuming we already have a `netherlands` segment:

```yml
# segments/netherlands.yml
description: The Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```

We can create a new test spec in `tests` directory:

```yml
# tests/netherlands.segment.yml
segment: netherlands # your segment key
assertions:
  - description: Testing segment in NL
    context:
      country: nl
    expectedToMatch: true

  - description: Testing segment in DE
    context:
      country: de
    expectedToMatch: false
```

## Matrix

To make things more convenient when testing against a lof of different combinations of values, you can optionally make use of `matrix` property in your assertions.

For example, in a feature test spec:

```yml
# tests/foo.feature.yml
feature: foo
assertions:
  - matrix:
      at: [40, 60]
      environment: [production]
      country: [nl, de, us]
      plan: [free, premium]
    description: At ${{ at }}%, in ${{ country }} against ${{ plan }}
    environment: ${{ environment }}
    at: ${{ at }}
    context:
      country: ${{ country }}
      plan: ${{ plan }}
    expectedToBeEnabled: true
```

This will then run the assertion against all combinations of the values in the matrix.

{% callout type="note" title="Note about variables" %}
The example above uses variables in the format `${{ variableName }}`, and there quite a few of them.

Just because a lot of variables are used in above example, it doesn't mean you have to do the same. You can mix static values for some properties and use variables for others as it fits your requirements.
{% /callout %}

You can do the same for segment test specs as well:

```yml
# tests/netherlands.segment.yml
segment: netherlands # your segment key
assertions:
  - matrix:
      country: [nl]
      city: [amsterdam, rotterdam]
    description: Testing in ${{ city }}, ${{ country }}
    context:
      country: ${{ country }}
      city: ${{ city }}
    expectedToMatch: true
```

This helps us cover more scenarios by having to write less code in our specs.

## Running tests

Use the Featurevisor CLI to run your tests:

```
$ npx featurevisor test
```

If any of your assertions fail in any test specs, it will terminate with a non-zero exit code.

## CLI options

### `keyPattern`

You can also filter tests by feature or segment keys using regex patterns:

```
$ npx featurevisor test --keyPattern="myKeyHere"
```

### `assertionPattern`

If you are writing assertion descriptions, then you can filter them further using regex patterns:

```
$ npx featurevisor test --keyPattern="myKeyHere" --assertionPattern="text..."
```

### `verbose`

For debugging purposes, you can enable verbose mode to see more details of your assertion evaluations

```
$ npx featurevisor test --verbose
```

### `showDatafile`

For more advanced debugging, you can print the datafile content used by test runner:

```
$ npx featurevisor test --showDatafile
```

Printing datafile content for each and every tested feature can be very verbose, so we recommend using this option with `--keyPattern` to filter tests.

### `onlyFailures`

If you are interested to see only the test specs that fail:

```
$ npx featurevisor test --onlyFailures
```

### `fast`

This option has been deprecated, because test runner is now fast by default.

## NPM scripts

If you are using npm scripts for testing your Featurevisor project like this:

```js
// package.json

{
  "scripts": {
    "test": "featurevisor test"
  }
}
```

You can then pass your options in CLI after `--`:

```
$ npm test -- --keyPattern="myKeyHere"
```
