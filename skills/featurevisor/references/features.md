# Features

Full docs: <https://featurevisor.com/docs/features/>

A feature produces three kinds of result:

- **flag**: enabled or disabled
- **variation**: a string, for A/B tests
- **variables**: typed values, for remote configuration

Features live in `features/<key>.yml`. A subdirectory adds a namespace to the key ([namespaces.md](namespaces.md)). Keys become permanent identifiers in application code and analytics, so choose them deliberately. The docs use camelCase, such as `checkout` or `showCookieBanner`.

## Minimal feature

```yaml
description: Checkout redesign

bucketBy: userId

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

## Properties

Examples use the default scaffold without environments.

| Property                 | Required | Notes                                                                          |
| ------------------------ | -------- | ------------------------------------------------------------------------------ |
| `description`            | yes      |                                                                                |
| `bucketBy`               | yes      | attribute, list of attributes, or `{ or: [...] }`                              |
| `rules`                  | yes      | ordered list, or a map of environment to list when environments are configured |
| `conditions`             | no       | root gate ([conditions.md](conditions.md#root-gates))                          |
| `force`                  | no       | ordered list, or an environment map                                            |
| `variations`             | no       | A/B test values with weights                                                   |
| `variablesSchema`        | no       | feature variables ([variables-schemas.md](variables-schemas.md))               |
| `disabledVariationValue` | no       | variation returned while disabled, instead of `null`                           |
| `tags`                   | no       | must be declared in the project configuration                                  |
| `expose`                 | no       | boolean or tag list, or an environment map                                     |
| `deprecated`             | no       | still evaluated, SDKs log a warning                                            |
| `archived`               | no       | left out of every datafile                                                     |
| `promotable`             | no       | `false` protects the destination during Set promotions                         |

## Bucketing

```yaml
bucketBy: userId # one attribute
```

```yaml
bucketBy: [organizationId, userId] # combined
```

```yaml
bucketBy:
  or: [userId, deviceId] # the first one present
```

Never change `bucketBy` on a live feature: every user gets a new bucket. See [bucketing.md](bucketing.md).

## Rules

```yaml
rules:
  - key: nl
    description: The Netherlands first
    conditions: netherlands
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 25
```

- Rules run top to bottom. The first rule whose `conditions` match decides.
- `percentage` (0 to 100, up to three decimals, since buckets are counted out of 100,000) is then checked against the user's bucket. A miss disables the feature and does **not** fall through to later rules.
- `key` is unique within the list and stays stable while the percentage changes. Raising a percentage keeps everyone already in. Renaming or reweighting reallocates variations.
- `conditions` is required. Use `'*'` for everyone ([conditions.md](conditions.md)).
- A rule has no `enabled` field. Lint rejects one and suggests `percentage: 0` instead. To switch an audience off, set its `percentage` to `0`, or use [force](#force). CLI 4.0.0 accepted the field, but builds ignored it.

Rules can also fix a variation, change weights, and set variables for their audience:

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100
    variation: treatment # everyone in this rule gets treatment
    variables:
      colour: orange

  - key: de
    conditions: germany
    percentage: 100
    variationWeights: # this rule's own split
      control: 70
      treatment: 30

  - key: everyone
    conditions: '*'
    percentage: 100
```

### With environments

When the project declares `environments`, key each list by environment:

```yaml
rules:
  staging:
    - key: everyone
      conditions: '*'
      percentage: 100
  production:
    - key: everyone
      conditions: '*'
      percentage: 25
```

An environment without a list has no rules, so the feature is disabled there unless a force entry applies. An explicit empty list such as `staging: []` fails lint, so omit the key instead.

## Variations

```yaml
variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    variables:
      colour: blue
```

- Weights sum to 100, with up to three decimals each, such as `33.333`, `33.333` and `33.334`. Lint reports a shortfall with its actual sum, such as `Variation weights must sum to 100, but they sum to 90.` A rule's `variationWeights` must sum to 100 too. CLI 4.0.0 did not check feature weights: a short split built once, then every later build failed with `Invalid saved variation allocation`.
- Values are unique strings. `control` and `treatment` are conventions only. Analytics keys off these values, so do not rename them once tracked.
- A variation can only set variables declared in `variablesSchema`.
- `disabledVariationValue: control` returns `control` instead of `null` while the feature is disabled. It needs no `variations` list, and when one exists it must name one of its values.

## Feature variable overrides

Rules and variations can narrow a variable further with `variableOverrides`. The first matching entry wins, and the rule's or variation's `variables` value applies otherwise.

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100
    variables:
      colour: orange
    variableOverrides:
      colour:
        - key: amsterdam
          conditions:
            - attribute: city
              operator: equals
              value: amsterdam
          value: red
        - key: checkout-users
          conditions:
            - feature: checkout
          value: blue
```

Each override needs `conditions` and exactly one of `value` or `mutate` ([variables-schemas.md](variables-schemas.md#mutations)). A stable `key` is recommended: it appears in evaluation details and is required for promotion protection. Feature variable overrides are flat. Nesting and `continue` are only for global variables.

## Root conditions

Root `conditions` gate the whole feature before bucketing. Use a feature leaf when one feature only makes sense with another, or a variable leaf for a kill switch:

```yaml
description: File upload inside chat

bucketBy: userId

conditions:
  - feature: liveChat
  - variable: maintenanceMode
    operator: equals
    value: false

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

An unmet gate disables the feature with reason `conditions_unmet`. Force entries run before the gate. Lint rejects cycles. See [conditions.md](conditions.md) for every leaf kind and [mutual-exclusion.md](mutual-exclusion.md) for `enabled: false` priority exclusion.

## Force

Force sets a result for matching contexts, typically QA or one user, ahead of the root gate and rules:

```yaml
force:
  - conditions: qa
    enabled: true
    variation: treatment

  - conditions:
      - attribute: userId
        operator: equals
        value: '9b30'
    enabled: true
    variables:
      colour: purple
```

Force entries need `conditions`, have no `key` or `percentage`, and the first match wins. Prefer a reviewed `force` entry over SDK sticky values for QA access.

## Expose

`expose: false` leaves the feature out of generated datafiles. A tag list such as `expose: [web]` restricts which tag selected targets include it, and has no effect on targets without tag selectors. With environments configured, key it by environment: `expose: { production: false }`.

Use `expose` only for temporary needs such as migrating from another tool. Never hide a feature that others depend on: an unexposed prerequisite is missing from the datafile, which satisfies `enabled: false` and fails `enabled: true` checks. Lint does not warn about this.

## Deprecating and archiving

```yaml
deprecated: true # still in datafiles, SDKs log a warning on every evaluation
```

```yaml
archived: true # left out of every datafile, SDKs evaluate it as disabled
```

Lint rejects a reference to an archived feature, in `conditions`, as a composition source or in a spec, from anything that is not archived itself (`archived_reference`). Targets cannot name it by exact key either. Run `npx featurevisor find-usage --feature=<key>` first, remove each reference or archive its owner too, and delete the feature's specs. Lint checks an archived feature for its shape only. Keep the archived file: a new feature reusing the key would bucket every user exactly as the old one did.

A reference to a deprecated feature, or to a deprecated variable in its `variablesSchema`, is a `deprecated_reference` lint warning in active definitions that are not deprecated themselves. Feature variables can be deprecated individually inside `variablesSchema`.

## Evaluation flow

The first step that gives an answer wins. `npx featurevisor evaluate --explain` shows which one did.

### Flag

1. A sticky `enabled` value.
2. A feature missing from the datafile is disabled (`feature_not_found`).
3. The first matching force entry that sets `enabled` (`forced`).
4. Unmet root conditions disable it (`conditions_unmet`).
5. Compute the bucket.
6. The first rule whose conditions match, then its percentage. Inside it, the feature is enabled (`rule`). A rule at 0% disables it with `rule` and its `ruleKey`.
7. A bucket above the matched rule's percentage disables it without falling through to later rules. This reports `no_match` without a `ruleKey`, the same as when no rule matches at all. Compare `bucketValue` with the rule's percentage to tell them apart.

### Variation

1. The flag is evaluated first. When disabled, the result is `disabledVariationValue` if set, otherwise `null`.
2. A sticky variation.
3. A feature without variations returns `null`.
4. The first matching force entry's `variation`.
5. The matched rule's `variation`.
6. The variation whose weight range contains the bucket (`allocated`).

### Variable

1. The flag is evaluated first. When disabled, the result is the variable's `disabledValue` if set, its `defaultValue` with `useDefaultWhenDisabled: true`, or `null`.
2. A sticky variable value.
3. A variable missing from `variablesSchema` returns `null`.
4. The first matching force entry's `variables` value.
5. The matched rule's first matching `variableOverrides` entry, then its `variables` value.
6. The selected variation's first matching `variableOverrides` entry, then its `variables` value.
7. The variable's `defaultValue`.

## Testing a feature

Feature specs fix the bucket with `at`, so rollouts are tested without searching for user IDs:

```yaml
feature: checkout

assertions:
  - key: nl
    description: Dutch users are always in
    at: 90
    context:
      country: nl
    expectedToBeEnabled: true

  - key: outside-rollout
    description: Others are out above 25
    at: 90
    context:
      country: de
    expectedToBeEnabled: false
```

See [testing.md](testing.md#feature-specs).
