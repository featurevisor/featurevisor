# Mutually exclusive experiments

Full guide: <https://featurevisor.com/docs/use-cases/mutually-exclusive-experiments/>

Two patterns keep users out of overlapping experiments. Both use feature leaves in root `conditions` ([conditions.md](conditions.md#feature-leaves)).

## Shared allocation: fixed cohorts

An allocation feature at 100% divides users into cohorts, and each experiment requires its cohort:

```yaml
# features/experimentAllocation.yml
description: Shared experiment allocation

bucketBy: userId

variations:
  - value: first
    weight: 40
  - value: second
    weight: 40
  - value: holdout
    weight: 20

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

```yaml
# features/firstExperiment.yml
description: First experiment

bucketBy: userId

conditions:
  - feature: experimentAllocation
    variation: first

variations:
  - value: control
    weight: 50
  - value: treatment
    weight: 50

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

Create `secondExperiment` the same way, requiring `second`. Holdout users get neither, and comparing them with everyone else measures the combined effect of all the experiments, which no single test reports. An experiment's own percentage applies within its cohort, so a 25% rollout in a 40% cohort reaches about 10% of users.

- Keep the allocation at 100% and its weights stable. Changing them moves users between cohorts. Reserve cohorts before launch rather than reweighting later.
- Use the same `bucketBy` in the allocation and the experiments.
- Reusing a cohort for a later experiment carries the earlier exposure with it.

## Priority exclusion: one feature gives way

```yaml
# features/secondFeature.yml
description: Lower priority feature

bucketBy: userId

conditions:
  - feature: firstFeature
    enabled: false

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

Users with `firstFeature` never get `secondFeature`. With `firstFeature` at 50% and `secondFeature` at 100%, about half get each, with no overlap. Never make two features each require the other to be disabled: lint rejects the cycle.

## Operational rules

- **Keep prerequisites exposed.** `expose: false` removes the allocation or priority feature from datafiles, without a lint warning. A missing feature satisfies `enabled: false` and fails a `variation` requirement.
- Targets automatically include referenced features. With environments, give the allocation feature rules in every environment.
- Put QA force entries and sticky values on the **allocation** feature. Forcing an experiment directly bypasses its root conditions and defeats exclusion.
- Record exposure for the experiments, not for the allocation reads. Modules see allocation reads with `dependencyPurpose: 'condition'` ([tracking.md](tracking.md)).

## Testing

Fix the cohort with `stickyFeatures` in feature specs, and let `at` choose within it:

```yaml
feature: firstExperiment

assertions:
  - key: in-cohort
    at: 10
    stickyFeatures:
      experimentAllocation:
        enabled: true
        variation: first
    expectedToBeEnabled: true
    expectedVariation: control

  - key: other-cohort
    at: 10
    stickyFeatures:
      experimentAllocation:
        enabled: true
        variation: second
    expectedToBeEnabled: false
```

A scenario can check both experiments for one context, for example that no cohort enables both. Check real splits with `npx featurevisor assess-distribution --feature=firstExperiment --populate-uuid=userId --n=10000`.

v3 Groups are removed in v4. Convert them with these patterns, following [upgrading-to-v4.md](upgrading-to-v4.md#groups).
