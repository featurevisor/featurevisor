# Testing

Full docs: <https://featurevisor.com/docs/testing/>

Specs are declarative YAML files that check what definitions evaluate to for given contexts. The CLI builds datafiles in memory and evaluates every assertion through the SDK, so a passing spec means the definitions behave as written. Add or update specs in the same change as the definitions they cover.

Examples use the default scaffold. When the project configures environments, add `environment` to every feature and global variable assertion and to scenario roots that evaluate a feature or variable.

## Where specs live

Every `.spec.yml` file under `tests/` (or `sets/<set>/tests/`) is discovered. The root field decides the kind:

| Root field              | Kind                 | Convention                        |
| ----------------------- | -------------------- | --------------------------------- |
| `feature`               | Feature spec         | `tests/features/<key>.spec.yml`   |
| `segment`               | Segment spec         | `tests/segments/<key>.spec.yml`   |
| `variable`              | Global variable spec | `tests/variables/<key>.spec.yml`  |
| `checks`, with no owner | Scenario             | `tests/scenarios/<name>.spec.yml` |

Starting points: [templates/test-feature.spec.yml](../templates/test-feature.spec.yml), [templates/test-segment.spec.yml](../templates/test-segment.spec.yml), [templates/test-variable.spec.yml](../templates/test-variable.spec.yml) and [templates/scenario.spec.yml](../templates/scenario.spec.yml).

A spec cannot test or check an archived definition, or set a sticky value for one. Lint reports `archived_reference`, so delete the specs of whatever you archive.

Give every assertion a stable `key`. Keys label failures, become permalinks in the Catalog (matrix cases as `<key>.1`, `<key>.2`), and are required for promotion protection in Sets.

Write each `description` as the promise in plain words, such as "Dutch users are always in". A spec then reads as a record of who gets what, which a product manager reviewing the pull request can follow, and a failure says which promise broke.

## Run

```bash
npx featurevisor test
npx featurevisor test --key-pattern="checkout"
npx featurevisor test --key-pattern="checkout" --assertion-pattern="Netherlands"
npx featurevisor test --entity-type=scenario
npx featurevisor test --only-failures
npx featurevisor test --verbose
npx featurevisor test --json --pretty
npx featurevisor test --uncovered
npx featurevisor test --coverage
```

`--key-pattern` is a regular expression over the key of the feature, segment or variable a spec tests, or a scenario's key, not the spec's file name. It is case sensitive, as in `lint`, and not anchored, so `checkout` also matches `checkoutPromoBanner` but not `newCheckout`. Use `^checkout$` for one definition. `--assertion-pattern` matches assertion descriptions.

`test` does not run lint. Run `npx featurevisor lint` first: it validates specs against the project and warns with `context_value_mismatch` about contexts that do not fit attribute types.

### When a test fails

Each failure prints what differed and an exact rerun command:

```text
✘ Assertion #3: Outside the Netherlands, buckets above 10 are out
  => expectedToBeEnabled: expected false, received true
  Rerun (POSIX shell): npx featurevisor test --case='[null,"feature","features.checkout",2,null]'
```

1. Run `npx featurevisor test --json` for structured results. Each failing case in `results[].cases[]` has `errors` with `path` (into the spec), `expected` and `actual`, plus `rerun.args`.
2. Decide whether the spec or the definition is wrong. `npx featurevisor evaluate --feature=<key> --context='{…}' --explain` shows the deciding rule and the bucket for that context. Use the assertion's `at` to reason about percentages.
3. Rerun only that case with the printed `--case` value until it passes, then run the whole suite.

The process exits nonzero when anything fails. `--json` writes exactly one report to stdout. When the command fails before tests start, for example on an invalid option, there is no report: check the exit code and stderr.

### Coverage gaps

- `--uncovered` lists features and global variables that no spec references, including references from checks and scenarios. It is about authoring, not runtime coverage.
- `--coverage` lists the rule keys and override paths the specs actually selected. A rule or override missing from that list was never exercised. It is not branch coverage.

## Feature specs

```yaml
feature: checkout

assertions:
  - key: nl
    description: Dutch users are in at any bucket
    at: 90
    context:
      userId: test-user-nl
      country: nl
    expectedToBeEnabled: true
    expectedVariables:
      paymentMethods: [paypal, ideal]

  - key: treatment
    description: Buckets above 50 get the treatment
    at: 75
    context:
      country: nl
    expectedToBeEnabled: true
    expectedVariation: treatment

  - key: outside-rollout
    description: Others are out above 25
    at: 90
    context:
      country: de
    expectedToBeEnabled: false
```

- `at` is **required**: the bucket position from 0 to 100. It replaces searching for user IDs that land in a range. With a 25% rule, `at: 10` is inside and `at: 90` outside. With 50/50 variations, `at` below 50 gets the first variation.
- `expectedToBeEnabled`, `expectedVariation` and `expectedVariables` check the three results. `expectedVariation` needs a feature with variations or a `disabledVariationValue`. Every key in `expectedVariables` must be declared in `variablesSchema`.
- `expectedEvaluations` checks evaluation details: `{ flag: { reason: rule, ruleKey: nl }, variation: {…}, variables: { colour: {…} } }`.
- `stickyFeatures` supplies sticky feature results, as `f.setStickyFeatures()` would. `stickyVariables` supplies global variable values, as `f.setStickyVariables()` would, for features gated on a variable. Every kind of spec uses these two names. The v3 name `sticky` fails lint with `removed_test_field`.
- `defaultVariationValue` and `defaultVariableValues` supply per call fallbacks.
- `children` evaluate through `f.spawn()`, each with its own `context`, `stickyFeatures`, `stickyVariables`, expectations and an optional `description`. A child does not inherit its parent's sticky values.
- `target` evaluates against a target's datafile. `matrix` repeats the assertion.

A feature gated on a kill switch is tested in its own spec:

```yaml
feature: checkout

assertions:
  - key: maintenance
    description: The kill switch disables checkout
    at: 5
    stickyVariables:
      maintenanceMode: true
    expectedToBeEnabled: false
```

## Segment specs

```yaml
segment: netherlands

assertions:
  - key: nl
    context:
      country: nl
    expectedToMatch: true

  - key: missing-country
    context: {}
    expectedToMatch: false
```

Attribute only segments need nothing else. A segment that depends on a feature or variable accepts `at`, `stickyFeatures` and `stickyVariables`, and needs `environment` when environments are configured.

## Global variable specs

```yaml
variable: supportEmail

assertions:
  - key: nl
    description: Dutch users reach the local desk
    context:
      country: nl
    expectedValue: support-nl@example.com
    expectedEvaluation:
      reason: variable_override_rule
      variableOverrideKey: netherlands

  - key: maintenance
    description: The kill switch wins over every audience
    context:
      country: nl
    stickyVariables:
      maintenanceMode: true
    expectedValue: status@example.com
```

- `expectedValue` compares the whole value, objects and arrays included. `expectedEvaluation` checks detail fields such as `reason`, `variableOverrideKey` and `variableOverridePath`.
- Global variables are not bucketed. `at` fixes the bucket only for features reached through conditions or a composition.
- `stickyFeatures` fixes upstream feature results (`enabled`, `variation`, `variables`) and wins over `at`. `stickyVariables` fixes global variable values, including this one.
- `checks` adds further expectations ([Checks](#checks)). Inside a variable spec, a check without `variable` refers to the spec's own variable.
- `children` inherit the parent context and `at`, but not its sticky maps. Repeat `stickyFeatures` or `stickyVariables` in a child that needs them.

## Checks

Checks are expectations on global variable assertions and scenarios. The top level list means AND, and `and`, `or` and `not` groups nest.

```yaml
checks:
  # a variable value, by operator
  - key: positive-minimum
    variable: checkoutPolicy
    path: limits.minimumOrder
    operator: greaterThan
    value: 0

  # compared with another value instead of a literal
  - variable: checkoutPolicy
    path: currency
    operator: equals
    compareTo:
      feature: checkout
      variable: currency

  # a feature's flag and variation
  - feature: checkout
    enabled: true
    variation: treatment

  # segment membership
  - segment: netherlands
    matches: true
```

- A variable check has a left reference (`variable`, or `feature` plus `variable` for a feature variable, optional `path`), an `operator`, and exactly one of `value` or `compareTo`. Unary operators such as `notNull` take neither.
- A feature check takes `enabled`, `variation` or both. `variation` alone does not imply `enabled: true`. `variation: null` expects the getter to return `null`.
- A segment check needs both `segment` and `matches`.
- `key` and `description` label any check or group in failure output. Keys must be unique among siblings.
- Paths and missing values work as in [conditions](conditions.md#variable-leaves), with one difference: when a path is missing, every operator except the presence and emptiness ones is `false`, `notEquals` included.
- A check that reaches a value of the wrong type for its operator, or an invalid date or version, is a test error, which `not` cannot invert.

## Scenarios

A scenario checks several definitions together when no single owner fits, for example "the kill switch turns off checkout and everything built on it".

```yaml
description: Maintenance mode switches off checkout and its promo

stickyVariables:
  maintenanceMode: true

at: 5

context:
  userId: test-user-nl
  country: nl

checks:
  - key: checkout-off
    feature: checkout
    enabled: false

  - key: no-promo
    variable: checkoutPromoBanner
    operator: equals
    value: ''

children:
  - description: QA keeps access, because force entries run before the root gate
    context:
      userId: u_qa_1
    stickyVariables:
      maintenanceMode: true
    checks:
      - feature: checkout
        enabled: true
```

- The root needs nonempty `checks` and no `feature`, `segment` or `variable` owner. It also accepts `description`, `environment`, `target`, `matrix`, `context`, `at`, `stickyFeatures`, `stickyVariables`, `children` and `promotable`.
- Do not add `key`, `name`, `type`, `assertions`, `expectedValue` or `expectedEvaluation`. The key comes from the file path: `tests/scenarios/maintenance.spec.yml` is `scenarios.maintenance`.
- Every variable check names its `variable` explicitly.
- Children need their own `checks`, inherit the root `context` and `at`, and do not inherit sticky maps. A child may have a `description` for readers.
- Run only scenarios with `npx featurevisor test --entity-type=scenario`.

## Matrix

Repeat an assertion across combinations:

```yaml
feature: checkout

assertions:
  - key: in-rollout
    matrix:
      at: [5, 20]
      country: [de, us]
    description: At ${{ at }} in ${{ country }}
    at: ${{ at }}
    context:
      country: ${{ country }}
    expectedToBeEnabled: true
```

`${{ name }}` substitutes anywhere in the assertion, including nested values and children. A placeholder that is the whole value keeps its type, so `at: ${{ at }}` stays a number. Every placeholder must name a matrix key, and every axis must be nonempty. Scenarios take a root `matrix`.

## Targets and environments

`target: web` evaluates against that target's datafile, as an application loading it would. A definition the target leaves out evaluates as missing, which is how to test that a target excludes it. Use `matrix: { target: [web, mobile] }` with `target: ${{ target }}` to repeat across targets. `npx featurevisor test --target=web` runs untargeted assertions plus those for `web`.

With environments configured, every feature and global variable assertion needs `environment: <name>`. Without environments, `environment` is a lint error.

## What to cover

When creating or changing a feature, cover at least:

- one context inside each targeted audience and one outside
- the catch-all rule at a bucket inside and outside its percentage
- each variation, using `at` inside its weight range
- variables a rule, variation or override changes, with the changed value
- force entries, with a context that matches them
- root conditions, met and unmet, with `stickyVariables` when the gate reads a variable

For global variables, cover each override, the default, and the gate. For compositions, assert the whole `expectedValue` for one context per interesting combination.

## Promotion protection in Sets

In a Sets project, `promotable: false` on a spec root, on a scenario root or on an individual keyed assertion keeps the destination's version during promotion. See [sets-promotions.md](sets-promotions.md).

## Running specs through other SDKs

Each non JavaScript SDK ships a CLI that runs these same specs through its own evaluation engine, proving the definitions behave the same in the language the application uses:

```bash
python -m featurevisor test --project-directory-path=/path/to/featurevisor-project
bundle exec featurevisor test --project-directory-path=/path/to/featurevisor-project
```

The Node.js CLI still discovers specs and builds datafiles, so `npx featurevisor` must work in the project. Check the runner's version against the [SDK compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) before relying on checks and scenarios there. Every language: [sdk-other-languages.md](sdk-other-languages.md#run-the-projects-specs-through-another-sdk).
