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

## Running tests

Use the Featurevisor CLI to run your tests:

```
$ featurevisor test
```

If any of your assertions fail in any test specs, it will terminate with a non-zero exit code.

## CLI options

### `keyPattern`

You can also filter tests by feature or segment keys using regex patterns:

```
$ featurevisor test --keyPattern="myKeyHere"
```

### `assertionPattern`

If you are writing assertion descriptions, then you can filter them further using regex patterns:

```
$ featurevisor test --keyPattern="myKeyHere" --assertionPattern="text..."
```

### `verbose`

For debugging purposes, you can enable verbose mode to see more details of your assertion evaluations

```
$ featurevisor test --verbose
```

### `showDatafile`

For more advanced debugging, you can print the datafile content used by test runner:

```
$ featurevisor test --showDatafile
```

Printing datafile content for each and every tested feature can be very verbose, so we recommend using this option with `--keyPattern` to filter tests.

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
