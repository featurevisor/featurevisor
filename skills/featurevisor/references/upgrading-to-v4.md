# Upgrading from v3 to v4

Full guide: <https://featurevisor.com/docs/migrations/v4/>. Read it before starting. This file is the runbook for doing the upgrade with an agent, and for working safely in a project that is still on v3.

## Working in a v3 project

When `npx featurevisor --version` reports 3.x, write v3 syntax only:

- Rules, force entries and overrides select with `segments`, not `conditions`.
- Feature prerequisites use `requiredFeatures`: `requiredFeatures: checkout`, or a flat list such as `requiredFeatures: [checkout, { feature: allocation, variation: control }]`, with optional `enabled` on list objects. Check the installed v3 minor version before relying on these forms.
- Not available in v3: unified `conditions`, grouped `requiredFeatures` expressions (`and`, `or`, `not`), `requiredVariables`, global override `continue: true`, `compose`, the `isNull`, `notNull`, `empty`, `notEmpty`, `includesAny` and `notIncludesAny` operators, test `checks` and scenario specs.
- Types are v3 types: `double`, `date` and `semver` still exist there.

Offer this upgrade when the request needs v4.

## Order of work

The project and its applications upgrade in a fixed order, because v3 SDKs cannot read v4 datafiles correctly and v4 SDKs ignore legacy v3 fields:

1. **Update applications to the latest v3 SDKs.**
2. **Prepare the project on the latest v3 CLI.** Rename feature `required` to `requiredFeatures` and object `key` to `feature`. Convert every Group (below). Lint, test, build and deploy every datafile, including cached and bundled copies.
3. **Upgrade applications to v4 SDKs** and replace removed APIs ([Applications](#applications)), while still serving the prepared v3 datafiles.
4. **Upgrade the project CLI to v4** and migrate to `conditions` and the new types ([Project](#project)).
5. **Publish v4 datafiles** only after every consumer runs a v4 SDK, including applications that bundle, cache or persist datafiles.

Keep the prepared v3 datafiles as the rollback point. After v4 datafiles are published, rolling an SDK back also requires restoring compatible v3 datafiles everywhere it reads them.

Ask the user which applications consume each datafile and which SDK versions they run. Do not publish v4 datafiles on the strength of a passing lint.

## Groups

v4 removes Groups. Convert them in step 2, on the v3 CLI:

- **One feature gives way to another**: require the higher priority feature with `enabled: false`.
- **Exclusive experiment cohorts**: a shared allocation feature at 100% with one variation per cohort plus a holdout, and each experiment requiring its cohort's variation.

Give every formerly grouped feature's rules fresh keys, such as `everyone` to `allocated`, so saved slot allocations do not linger. Delete the Group files and `groupsDirectoryPath`. See [mutual-exclusion.md](mutual-exclusion.md) and the guide's [Groups removed](https://featurevisor.com/docs/migrations/v4/#groups-removed) section.

## Project

```bash
npm install --save-dev @featurevisor/cli@4
npx featurevisor lint --json --pretty
```

The CLI needs Node.js 24 or later. If the project has a custom parser, add its `stringify` function first, or no command will load ([custom-parsers.md](custom-parsers.md)).

**The lint output is the worklist.** Fix errors by code, rerun, and repeat until clean:

| Lint code or message                                                                       | Fix                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `removed_condition_field` on `segments`                                                    | rename to `conditions`. Segment keys stay as strings                                                          |
| `removed_condition_field` on `requiredFeatures`                                            | move into root `conditions`, writing each key as `{ feature: <key> }`                                         |
| Feature `required` has been removed                                                        | as above, renaming each `{ key: … }` to `{ feature: … }`                                                      |
| `removed_schema_type`                                                                      | `double` to `number`, `date` to `string` with `format: date-time`, `semver` to `string` with `format: semver` |
| date-time attribute with `equals` or another text operator                                 | use `before` or `after`, or declare a plain `string`                                                          |
| `in` or `notIn` on a non string attribute                                                  | an `or` group of `equals` leaves, wrapped in `not` for `notIn`                                                |
| `invalid_attribute_namespace`                                                              | move attribute files out of subdirectories, or model nested context as an object attribute                    |
| `expectedVariation` on a feature without variations, or an unknown `expectedVariables` key | fix the spec                                                                                                  |
| `invalid_saved_allocation` (build)                                                         | restore state from the deployed revision, or rename the rule after reviewing who switches                     |
| `removed_test_field` on `sticky`                                                           | rename to `stickyFeatures` in feature assertions and their children                                           |
| `archived_reference`                                                                       | remove the reference, archive the definition that makes it, or unarchive the target                           |
| `archived_reference` on a spec's `feature`, `segment` or `variable`                        | delete the spec of the archived definition                                                                    |

Before and after, for a feature:

```yaml
# v3
requiredFeatures: checkout

rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

```yaml
# v4
conditions:
  - feature: checkout

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

Combine several old selectors into one `conditions` list, which means AND. Every override needs `conditions`, including nested ones.

**Build does not run full lint.** A rule that still uses `segments` builds without it and then matches nobody, switching the feature off for that audience with no error. A leftover feature `required` fails the build instead. Lint must pass before building, locally and in CI.

Then:

```bash
npx featurevisor lint --v3-mutation-order
npx featurevisor test
npx featurevisor build --no-state-files
```

- `--v3-mutation-order` lists values that change because v4 applies mutation maps in authored order instead of shortest path first. Review and test each.
- Rename `allowFeatureAndGlobalVariableKeyCollisions` to `allowFeatureAndVariableKeyCollisions` if configured.
- Regenerate TypeScript code with `generate-code` and compile the applications. Generated feature variable helpers are `FeatureVariableKey` and `FeatureVariableType`.
- Update test expectations and analytics that compared the reason `required`: unmet prerequisites now report `conditions_unmet`.
- Compare important results before and after with `npx featurevisor evaluate` on the same contexts.

## Applications

### JavaScript SDK

```bash
npm install @featurevisor/sdk@4
```

Upgrade `@featurevisor/react` or `@featurevisor/vue` and any OpenFeature provider in the same change.

| Removed in v4                                          | Use instead                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `getVariableDouble()`                                  | `getVariableNumber()`                                                                    |
| module `before` and `after`                            | `beforeEvaluation` and `afterEvaluation`                                                 |
| `sticky` option, `setSticky()`                         | `stickyFeatures` and `stickyVariables`, `setStickyFeatures()` and `setStickyVariables()` |
| `sticky_set` event                                     | `sticky_features_set` and `sticky_variables_set`                                         |
| `getAllEvaluations()`                                  | `getFeatureEvaluations()`                                                                |
| `evaluation.sticky`                                    | `evaluation.reason === 'sticky'`                                                         |
| reason `required`                                      | `conditions_unmet`                                                                       |
| `variable_deprecated` diagnostic for a global variable | `deprecated_variable`, as for feature variables                                          |
| `Required` and `RequiredWithVariation` types           | `FeatureCondition`, `Condition` or `Conditions`                                          |
| `getVariableArray<T = string>`                         | `getVariableArray<T = unknown>`                                                          |

The removed `sticky` option and `before` and `after` callbacks are silently ignored, not rejected. Test that the replacements run and that sticky values apply on parent and child instances. `setDatafile` now returns a boolean, which existing callers can ignore.

### Other languages

Python, Ruby, PHP and Elixir also rename their number getter to `get_variable_number` or `getVariableNumber`. Java, Kotlin, Swift, Go and Rust keep `getVariableDouble`. Native version numbers differ: check the [SDK compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) for each language's first v4 compatible release, and its changelog for removed APIs. Every v4 SDK still reads v3 datafiles.

Date inputs are stricter: Ruby rejects plain `Date`, Java rejects `LocalDate` and `LocalDateTime`, and Go's zero `time.Time{}` is a real instant. See [operators.md](operators.md#dates).

## After the upgrade

Once every consumer runs a v4 SDK, the new capabilities are available:

| Capability                                                                | Reference                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Feature and variable leaves anywhere in conditions                        | [conditions.md](conditions.md)                                    |
| `isNull`, `notNull`, `empty`, `notEmpty`, `includesAny`, `notIncludesAny` | [operators.md](operators.md)                                      |
| Nested and accumulating global overrides                                  | [global-variables.md](global-variables.md#accumulating-overrides) |
| `compose` aliases and objects                                             | [global-variables.md](global-variables.md#compose-values)         |
| Ordered mutation lists, `appendUnique`, `removeValue`                     | [variables-schemas.md](variables-schemas.md#mutations)            |
| Test checks and scenarios                                                 | [testing.md](testing.md#checks)                                   |
| `diff`, `evaluate --explain`, test reports and reruns                     | [cli.md](cli.md)                                                  |

Some capabilities need SDK releases newer than the first v4 release in some languages. Until every consumer supports one, keep it out of shared datafiles. For operators, `disallowOperators` enforces this:

```js
module.exports = {
  disallowOperators: ['includesAny', 'notIncludesAny'],
}
```

Older SDKs treat an unknown operator as false, which a `not` group turns into a match. Never rely on unknown syntax failing safely.

v4 also accepts every kind of condition in every location. If the team prefers v3's shape, where rules only name segments, offer `allowedConditions` with what v3 allowed in each location. A project converted as above passes it unchanged, and lint reports anything else with `disallowed_condition` ([conditions.md](conditions.md#allowed-condition-kinds)):

```js
module.exports = {
  allowedConditions: {
    segments: ['attribute'],
    features: ['feature'],
    rules: ['segment'],
    force: ['attribute', 'segment'],
    featureVariableOverrides: ['attribute', 'segment', 'feature'],
    variables: ['feature'],
    variableOverrides: ['attribute', 'segment', 'feature'],
  },
}
```

Relax one location at a time as the team adopts what v4 adds.

## Mixed versions

If some applications cannot upgrade, keep a separately maintained v3 project and CLI output at a different URL for them, and publish v4 datafiles only to upgraded applications. Targets select definitions, they do not translate syntax for older SDKs. There is no v3 compatible output from the v4 CLI.
