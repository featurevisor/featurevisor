# Testing reference

Full docs: <https://featurevisor.com/docs/testing>

Featurevisor ships an in-process test runner. Specs live in `tests/features/<key>.spec.yml` and `tests/segments/<key>.spec.yml` by default. File names are conventional, not load-bearing.

Run:

```bash
npx featurevisor test
npx featurevisor test --keyPattern="myFeature"
npx featurevisor test --keyPattern="myFeature" --assertionPattern="in NL"
npx featurevisor test --verbose                  # SDK trace per assertion
npx featurevisor test --onlyFailures
```

## Feature spec

```yaml
feature: foo
assertions:
  - description: Control in NL at 40th percentile
    environment: production       # omit if project has environments: false
    at: 40                        # bucketed percentile (0–100) the assertion runs at
    context:
      userId: '123'
      country: nl
    expectedToBeEnabled: true
    expectedVariation: control
    expectedVariables:
      bgColor: red
```

Available expectations on a feature assertion:

| Field                     | Type     | Notes                                                 |
| ------------------------- | -------- | ----------------------------------------------------- |
| `expectedToBeEnabled`     | boolean  | Flag check                                            |
| `expectedVariation`       | string   | Expected variation value                              |
| `expectedVariables`       | object   | Map of variable key → expected value                  |
| `expectedEvaluations`     | object   | Lower-level evaluation result checks (advanced)       |

## Segment spec

```yaml
segment: netherlands
assertions:
  - description: NL context matches
    context:
      country: nl
    expectedToMatch: true

  - description: DE context does not match
    context:
      country: de
    expectedToMatch: false
```

## Matrix expansion

Run the same assertion across combinations of values:

```yaml
feature: foo
assertions:
  - matrix:
      at: [40, 60]
      environment: [production]
      country: [nl, de, us]
      plan: [free, premium]
    description: At ${{ at }}% in ${{ country }}/${{ plan }}
    environment: ${{ environment }}
    at: ${{ at }}
    context:
      country: ${{ country }}
      plan: ${{ plan }}
    expectedToBeEnabled: true
```

Use `${{ name }}` to interpolate any matrix key. Mixing static and matrix-driven fields is fine — only interpolate where it changes.

## Testing against tagged or scoped datafiles

By default the runner builds a single in-memory datafile containing everything. To imitate a real consumer that loads a tag-/scope-specific datafile:

```yaml
assertions:
  - environment: production
    at: 90
    context: { country: nl }
    tag: web                       # or:   scope: browsers
    expectedToBeEnabled: true
```

Then run:

```bash
npx featurevisor test --withTags
# or
npx featurevisor test --withScopes
```

## When you create a feature or segment

Offer (don't force): "I can add a `tests/.../spec.yml` for this — want me to?" If yes, use [templates/test-feature.spec.yml](../templates/test-feature.spec.yml) / [templates/test-segment.spec.yml](../templates/test-segment.spec.yml).

Cover at minimum:
- The catch-all rule at a high `at` (e.g. 99) in each environment that should be enabled.
- One assertion **inside** any targeted segment (e.g. country = nl) and one outside it.
- If variations exist, one assertion per variation by picking `at` values in their weight bands.
- If variables override per rule/variation, assert the overridden values directly.

After authoring, run:

```bash
npx featurevisor test --keyPattern="<key>"
```
