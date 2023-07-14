---
title: Testing
description: Learn how to test your features and segments in Featurevisor with YAML specs
---

Features and segments can grow into complex configuration very fast, and it's important that you have the confidence they are working as expected. {% .lead %}

## Testing features

You can write test specs in YAML to test your features in great detail.

Create a new test spec in `tests` directory:

```yml
# tests/foo.spec.yml
tests:
  - tag: all
    environment: production
    features:
      - key: foo # your feature key
        assertions:

          # asserting evaluated variation
          # against bucketed value and context
          - description: Testing variation at 40% in NL
            at: 40
            context:
              country: nl
            expectedVariation: false

          # asserting evaluated variables
          - description: Testing variables at 90% in NL
            at: 90
            context:
              country: nl
            expectedVariables:
              someKey: someValue
```

The `at` property is the bucketed value (in percentage form ranging from 0 to 100) that assertions will be run against.

Read more in [Bucketing](/docs/bucketing).

## Testing segments

Similar to features, you can write test specs in YAML to test your segments in great detail.

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
# tests/netherlands.spec.yml
tests:
  - segments:
      - key: netherlands # your segment key
        assertions:
          - description: Testing segment in NL
            context:
              country: nl
            expected: true

          - description: Testing segment in DE
            context:
              country: de
            expected: false
```

## Running tests

After [building datafiles](/docs/building-datafiles), use the Featurevisor CLI to run your tests:

```
$ featurevisor test
```

If any of your assertions fail in any test specs, it will terminate with a non-zero exit code.
