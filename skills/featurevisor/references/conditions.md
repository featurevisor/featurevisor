# Conditions

Full docs: <https://featurevisor.com/docs/conditions/>

`conditions` is the one grammar for every place a definition selects or gates: segments, feature rules, force entries, root gates, and feature and global variable overrides. Operators are listed in [operators.md](operators.md).

## Leaves

There are four kinds of leaf. Mix them freely in one expression.

```yaml
conditions:
  # Attribute: compares a context value
  - attribute: country
    operator: equals
    value: nl

  # Segment: a bare string is always a segment key
  - payingAccounts

  # Feature: requires another feature's result
  - feature: liveChat

  # Variable: compares a global variable's value
  - variable: maintenanceMode
    operator: equals
    value: false

  # Variable: compares a feature variable's value
  - feature: buyButton
    variable: label
    operator: equals
    value: Buy now
```

| Leaf      | Fields                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Attribute | `attribute`, `operator`, `value` (omitted for unary operators), optional `regexFlags`                              |
| Segment   | a bare string naming the segment                                                                                   |
| Feature   | `feature`, optional `enabled` (default `true`), optional `variation`                                               |
| Variable  | `variable`, optional `feature` for a feature variable, optional `path`, `operator`, `value`, optional `regexFlags` |

A bare string is never a feature key. Lint catches the mistake: `Unknown segment "checkout". "checkout" is a feature: use { feature: checkout }.`

Nested object attributes use dotted paths, such as `attribute: account.seats`. Each leaf object must be exactly one kind: an attribute leaf cannot carry `feature`, a feature leaf has no `operator`, and a variable leaf cannot carry `enabled` or `variation`.

### Feature leaves

```yaml
conditions:
  - feature: checkout # checkout is enabled
  - feature: pricing
    variation: treatment # pricing's variation is treatment
  - feature: legacyCheckout
    enabled: false # legacyCheckout is disabled
```

`enabled` compares the flag and `variation` compares the variation getter. When both are given, both must match. A feature missing from the datafile is disabled, so it satisfies `enabled: false`. For a variation, write `variation: <value>`, never `operator: equals`.

### Variable leaves

A variable leaf compares what the ordinary getter returns, including disabled fallbacks. Omit `feature` for a global variable.

```yaml
conditions:
  - variable: checkoutSettings
    path: paymentMethods
    operator: includesAny
    value: [ideal, card]
```

- `path` reads inside an object or array. A dotted string such as `limits.minimumOrder`, or an array of parts such as `["limits.v2", 0, quota]` for keys containing dots. Integer parts index arrays only.
- A missing getter result is `null`. A missing nested path is absent, which is different from `null`. `isNull` matches only an explicit null. `notNull` requires a present, nonnull value. `exists` and `notExists` test presence.
- Compare booleans with `equals` or `notEquals`, not `in` or `notIn`.
- Operands must suit the value's type, but need not satisfy its enum, minimum or pattern. A threshold can sit outside the variable's allowed range.
- Conditions cannot read `json` variables, directly, through an alias or through a composed path, since their contents have no declared types. Give the variable a declared shape, such as `type: object` with `properties`, to compare what it holds.

## Lists and groups

```yaml
conditions:
  - and:
      - iphoneUsers
      - adults
  - or:
      - netherlands
      - germany
  - not:
      - newsletterSubscribers
```

- A list means AND.
- `and`, `or` and `not` take a nonempty list and nest to any depth. Every leaf kind works inside them.
- `not` negates the AND of its children. `not: [a, b]` means "not both a and b". For "neither", write `not: [{ or: [a, b] }]`.
- `'*'` matches everyone, but only as the entire expression: `conditions: '*'`. Inside a list or group it is a lint error.
- Empty lists and groups are lint errors.

A single condition does not need a list. `conditions: netherlands` and `conditions: { feature: liveChat }` are both valid.

## Where conditions go

| Location                                        | Required | Purpose                                             |
| ----------------------------------------------- | -------- | --------------------------------------------------- |
| Segment                                         | yes      | Membership                                          |
| Feature root                                    | no       | Gate for the whole feature                          |
| Feature rule                                    | yes      | Rule selection                                      |
| Force entry                                     | yes      | Forced result                                       |
| Feature variable override (`variableOverrides`) | yes      | Override selection within a rule or variation       |
| Global variable root                            | no       | Gate for the whole variable, including compositions |
| Global variable override                        | yes      | Override selection, including nested children       |

Use `conditions: '*'` where a selector is required but should always match.

v4 authors only `conditions`. The v3 fields `segments`, `requiredFeatures` and feature `required` are lint errors with a precise replacement, for example `removed_condition_field: Replace segments with conditions. Segment keys stay as strings.` Fix every lint error before building: build does not run full lint. A rule that still uses `segments` builds without it and then matches nobody, switching the feature off for that audience with no error.

### Allowed condition kinds

A project can limit which kinds of leaf each location accepts with `allowedConditions` in `featurevisor.config.js`. Read it before writing a condition:

```js
module.exports = {
  allowedConditions: {
    rules: ['segment'],
    segments: ['attribute'],
  },
}
```

- **Locations:** `segments`, `features` (feature root), `rules`, `force`, `featureVariableOverrides`, `variables` (global variable root, compositions included) and `variableOverrides` (nested ones included).
- **Kinds:** `attribute`, `segment`, `feature` (including `{ feature, variable }`) and `variable` (a global variable).
- **Defaults:** a location the config leaves out accepts every kind. `'*'` is always allowed.
- **Lint:** reports anything else with `disallowed_condition` and suggests a fix. With `rules: ['segment']`, put attribute logic in a segment and reference it from the rule. Archived definitions are not checked.
- **Segments are not followed:** each location is checked on its own, so a rule may name a segment that reads a feature unless `segments` excludes `feature`.

## Root gates

A feature's root `conditions` gate it before bucketing:

```yaml
description: File upload inside chat

bucketBy: userId

conditions:
  - feature: liveChat

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

`chatFileUpload` is disabled whenever `liveChat` is, with reason `conditions_unmet`. Force entries run before the root gate, so a forced QA user still gets the feature.

A global variable's root `conditions` gate its value. When unmet, it returns `disabledValue`, its `defaultValue` with `useDefaultWhenDisabled: true`, or `null`, with reason `conditions_unmet`. A composition returns its optional `disabledValue` or `null` without reading its sources.

## Evaluation order and dependency reads

Feature stages: sticky values, force, root conditions, bucketing, the first matching rule and its percentage (a miss does not fall through), then variable overrides. Global variable stages: sticky value, root conditions, composition sources, overrides.

Leaves run in authored order and stop as soon as the result is known. Put cheap attribute leaves before feature and variable leaves. Feature and variable leaves call the ordinary SDK getters, with their sticky values, modules and fallbacks. Equivalent reads are evaluated once within one top level call.

Analytics modules see these reads with `dependencyPurpose: 'condition'` and should skip them when recording exposure ([tracking.md](tracking.md)).

## Cycles and depth

Lint rejects direct, indirect and mixed cycles across segments, features and variables with `circular_dependency`, even through branches skipped at runtime. A feature that reads its own flag or variable in a rule is a cycle. Lint warns with `dependency_depth` when a chain is deeper than 32 evaluations, and lint and build reject chains deeper than 256 with `dependency_depth_exceeded`. At runtime, cycles and overly deep chains fail the whole evaluation with reason `error`, and `not` cannot turn that into a match.

## Datafiles and targets

A target's datafile includes every definition its selected features and variables reference, including through segments and skipped branches, even when tags or exclusions would leave them out. `expose: false` still removes a feature, so keep prerequisites exposed.

## Test and explain

```bash
npx featurevisor evaluate \
  --feature=chatFileUpload \
  --context='{"userId":"8f2a"}' \
  --explain
```

The explanation prints each leaf with its value and pass or fail, keeping the `and`, `or` and `not` structure. It is a set of probes beside the SDK result, not a full execution trace.

To test a definition whose conditions depend on another feature or variable, fix the inputs instead of hunting for user IDs:

- `at` fixes the bucket for every feature evaluation in the chain.
- `stickyFeatures` and `stickyVariables` supply upstream results directly. Every spec kind takes both, so a feature gated on a kill switch is tested in its own spec with `stickyVariables: { maintenanceMode: true }`.
- A scenario checks several definitions together, for example that turning a kill switch on disables a feature and its banner. See [testing.md](testing.md#scenarios).

## Runtime behaviour worth knowing

- A missing or invalid date in context makes `before` and `after` false. `not` can turn that false into a match, so do not use `not` as the opposite of a date comparison.
- In the JavaScript SDK, malformed stringified selector JSON reports `conditions_parse_error` and the whole selector returns false, even under `not`. Other entities keep working. See [sdk-javascript.md](sdk-javascript.md#diagnostics).
- SDK getters never throw. Evaluation errors return `false` or `null` and report a diagnostic.
