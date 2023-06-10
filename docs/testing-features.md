---
title: Testing features
description: Learn how to test your features in Featurevisor with YAML specs
---

Features can grow into complex configuration very fast, and it's important that you have the confidence that your features are working as expected. {% .lead %}

## Test specs

You can write test specs in YAML to test your features in great detail.

Create a new test spec in `tests` directory:

```yml
# tests/foo.spec.yml
tests:
  - tag: all
    environment: production
    features:
      - key: foo
        assertions:

          # asserting evaluated variation
          # against bucketed value and attributes
          - at: 40
            attributes:
              country: nl
            expectedVariation: false

          # asserting evaluated variables
          - at: 90
            attributes:
              country: nl
            expectedVariables:
              someKey: someValue
```

The `at` property is the bucketed value (in percentage form ranging from 0 to 100) that assertions will be run against.

Read more in [Bucketing](/docs/bucketing).

## Running tests

After [building datafiles](/docs/building-datafiles), use the Featurevisor CLI to run your tests:

```
$ featurevisor test
```

If any of your assertions fail in any test specs, it will terminate with a non-zero exit code.
