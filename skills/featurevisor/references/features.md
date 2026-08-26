# Features reference

Full docs: <https://featurevisor.com/docs/features>

A feature in Featurevisor produces three evaluable outputs:

- **flag** — boolean enabled/disabled
- **variation** — string (for A/B tests)
- **variables** — typed key/value pairs (for remote config)

Features live in `features/<key>.yml` by default. The filename usually matches the feature key.

Choose keys deliberately — they become permanent identifiers in application code and analytics (docs convention: camelCase, e.g. `showWishlist`, `checkoutRedesign`). Renaming a shipped feature key breaks every consumer.

## Minimal feature

```yaml
description: Sidebar
tags:
  - all

bucketBy: userId

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

## Top-level properties

| Property                 | Required                                 | Notes                                                                             |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------- |
| `description`            | yes                                      | Human-readable                                                                    |
| `tags`                   | no                                       | When present, must be subset of `tags` in `featurevisor.config.js`                |
| `bucketBy`               | yes (unless `defaultBucketBy` covers it) | string, array, or `{or: [...]}` — see Bucketing                                   |
| `rules`                  | yes                                      | Map of env → ordered rule list when environments are enabled                      |
| `variations`             | no                                       | A/B test variations                                                               |
| `variablesSchema`        | no                                       | Variables this feature exposes (see [variables-schemas.md](variables-schemas.md)) |
| `requiredFeatures`       | no                                       | Feature enabled and variation requirements                                        |
| `force`                  | no                                       | Per-env force rules (override percentage logic)                                   |
| `expose`                 | no                                       | Per-env / per-tag inclusion control                                               |
| `disabledVariationValue` | no                                       | Variation value when feature is disabled (defaults to `null`)                     |
| `deprecated`             | no                                       | `true` → still evaluable, logs warning                                            |
| `archived`               | no                                       | `true` → excluded from datafiles entirely                                         |
| `promotable`             | no                                       | `false` protects an existing destination during set [promotions](https://featurevisor.com/docs/promotions); rule entries use omit or preserve behavior |

## Bucketing (`bucketBy`)

Determines what attribute the consistent-hash uses to assign the same user to the same percentage band each time.

```yaml
bucketBy: userId                       # single
bucketBy: [organizationId, userId]     # concatenated
bucketBy:                              # first attribute available in context wins
  or:
    - userId
    - deviceId
```

Guidance:

- Signed-in user surface → use `userId` (or whatever the project calls it; check `attributes/`).
- Anonymous surface → use `deviceId` or similar.
- **Don't change `bucketBy` on an existing feature** — it re-buckets every user.

## Rules

Rule entries may use `promotable: false` in a sets project. A source rule with it is omitted from promotion. An existing destination rule with it is preserved when the source contains a rule with the same key. This protection applies only to rules, not to force entries, variable overrides, variations, or variables.

```yaml
rules:
  staging:
    - key: everyone
      segments: '*'
      percentage: 100

  production:
    - key: nl
      description: Netherlands first
      segments: netherlands
      percentage: 50

    - key: everyone
      segments: '*'
      percentage: 100
```

- Rules are evaluated **top to bottom**, first match wins.
- `key` must be unique within the env's rule list and **must stay stable** as percentages change — renaming re-buckets users.
- `segments` can be a single name, the wildcard `'*'`, or a logical combo (see below).
- `percentage` is 0–100 with up to 2 decimal places.
- Optional `description` for documentation.

### Segments in rules

```yaml
# single
segments: netherlands

# everyone
segments: '*'

# and
segments:
  and:
    - germany
    - iphoneUsers

# or
segments:
  or:
    - netherlands
    - germany

# not
segments:
  not:
    - germany

# "not" negates the implicit AND of its direct children:
# this matches users who are not both mobileUsers and netherlands
segments:
  not:
    - mobileUsers
    - netherlands

# for "none of these segments match", wrap the children in `or`
segments:
  not:
    - or:
        - mobileUsers
        - desktopUsers

# combined (implicit and across siblings)
segments:
  - and:
      - iphoneUsers
      - adultUsers
  - or:
      - netherlands
      - germany
  - not:
      - newsletterSubscribers

# nested
segments:
  - and:
      - iphoneUsers
      - or:
          - netherlands
          - germany
```

### Per-rule variable / variation overrides

```yaml
rules:
  production:
    - key: nl
      segments: netherlands
      percentage: 100
      variation: control            # pin variation for this rule
      variables:
        bgColor: orange
      variationWeights:             # or override weights for this rule
        control: 70
        treatment: 30
      variableOverrides:            # further conditional overrides
        bgColor:
          - key: amsterdam
            segments: amsterdam
            value: red
          - key: rotterdam
            conditions:
              - attribute: city
                operator: equals
                value: rotterdam
            requiredFeatures: checkout
            value: blue
```

## Variations

```yaml
variations:
  - value: control
    description: Default
    weight: 50

  - value: treatment
    weight: 50
    variables:                       # variables override when this variation is bucketed
      bgColor: blue
    variableOverrides:               # conditional overrides per variation
      bgColor:
        - key: netherlands
          segments: netherlands
          value: orange
```

Feature variable overrides are checked in order. Each entry needs at least one selector from `conditions`, `segments`, or `requiredFeatures`, and exactly one of `value` or `mutate`. Conditions and segments are mutually exclusive. Requirements may be used alone or with either selector, using AND semantics. Stable keys are recommended and are required when `promotable` is set. Existing unkeyed entries and legacy mutation maps under `value` remain supported. Prefer explicit `mutate` for new partial updates.

- Weights must sum to **100** (up to 2 decimals each).
- `control`/`treatment` is convention only; any unique string is fine.
- `disabledVariationValue: control` at the feature level controls what is returned when the feature is disabled.

## Required features

```yaml
requiredFeatures:
  - checkoutRedesign                 # must be enabled

  - feature: someFeature             # must be enabled and in this variation
    variation: treatment

  - feature: legacyFeature           # must be disabled with this returned variation
    enabled: false
    variation: control
```

For one enabled dependency, `requiredFeatures: checkoutRedesign` is equivalent to a one item array. `enabled` defaults to `true` and compares with `isEnabled()`. `variation` compares with `getVariation()`. All supplied checks and all entries use AND semantics. The older `required` property remains supported but is deprecated. Never declare both.

## Force

Force overrides rules for matching context. Used for QA/testing-in-production.

```yaml
force:
  production:
    - conditions:
        - attribute: userId
          operator: equals
          value: '123'
      enabled: true
      variation: treatment
      variables:
        bgColor: purple

    - segments: QATeam
      enabled: true
      variation: treatment
```

No `key` or `percentage` for force entries. First matching force entry wins, evaluated before rules.

## Expose

Limit which environments / tags include this feature in their datafiles. Treat as short-term migration tool only.

```yaml
expose:
  production: false                  # exclude from production datafiles entirely

# or per-tag
expose:
  production:
    - web
    - ios
    # android excluded
```

## Deprecate / archive

```yaml
deprecated: true   # still works, SDK logs warning
archived: true     # excluded from datafiles entirely
```

## Evaluation flow

For each evaluation type (flag / variation / variable), the SDK runs through this chain. The same logic powers `npx featurevisor evaluate`.

### Flag

1. SDK sticky override (if present)
2. Feature not in datafile → disabled
3. First matching `force` entry's `enabled`
4. `requiredFeatures` dependencies fail → disabled
5. First matching rule's `percentage` + bucketing
6. No match → disabled

### Variation

1. SDK sticky override
2. If flag is false → `null` or `disabledVariationValue`
3. If flag is true → first matching `force` → first matching rule's `variation` → bucketed variation per weights

### Variable

1. SDK sticky override
2. If flag is false → `null`, or `defaultValue` if `useDefaultWhenDisabled`, or `disabledValue`
3. If flag is true → matching `force.variables` → matching rule's `variables` / `variableOverrides` → bucketed variation's `variables`/`variableOverrides` → `defaultValue`
