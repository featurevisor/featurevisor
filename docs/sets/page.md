---
title: Sets
nextjs:
  metadata:
    title: Sets
    description: Split a Featurevisor project into independent sets that each own their own features, segments, attributes, and tests.
    openGraph:
      title: Sets
      description: Split a Featurevisor project into independent sets that each own their own features, segments, attributes, and tests.
      images:
        - url: /img/og/docs.png
---

Sets let you split a single Featurevisor project into independent trees that each own their own attributes, segments, features, targets, and tests. {% .lead %}

## When to use sets

A regular project keeps all definitions in one tree, where every feature carries its own environment specific [rules](/docs/features/#rules) inside the same file.

Sets are useful when you want fully separated trees instead, for example:

- modeling `dev`, `staging`, and `production` as independent release lanes, where the same feature key can have very different rules in each lane
- managing distinct surfaces like `storefront` and `admin` from one repository, where each surface has its own attributes and segments

The same feature key can exist in more than one set, with different rollout behavior in each.

## Enabling sets

Set `sets` to `true` in your [configuration](/docs/configuration/):

```js {% path="featurevisor.config.js" highlight="2" %}
module.exports = {
  sets: true,
  tags: ['all'],
}
```

By default `sets` is `false`.

## Directory structure

Each set lives under the `sets` directory, in its own subdirectory. Inside it, a set has the same layout as a regular project:

```
sets/
├── storefront/
│   ├── attributes/
│   ├── segments/
│   ├── features/
│   ├── targets/
│   └── tests/
└── admin/
    ├── attributes/
    ├── segments/
    ├── features/
    ├── targets/
    └── tests/
```

The set name is the directory name, like `storefront` and `admin` above.

Each set needs at least one [target](/docs/targets/) of its own, just like a regular project.

## Building datafiles

Run the usual [build](/docs/building-datafiles/) command:

```{% title="Command" %}
$ npx featurevisor build
```

Featurevisor builds every set and writes its datafiles under a directory named after the set:

```{% title="Output" %}
datafiles/storefront/production/featurevisor-all.json
datafiles/admin/production/featurevisor-all.json
```

If your project also defines [environments](/docs/environments/), the environment directory sits inside the set directory:

```{% title="Output" %}
datafiles/storefront/staging/featurevisor-all.json
datafiles/storefront/production/featurevisor-all.json
```

[State files](/docs/state-files/) are kept per set under `.featurevisor/sets/<set>/`.

## Working with a single set

Pass `--set=<set>` to limit a command to one set:

```{% title="Command" %}
$ npx featurevisor build --set=storefront
$ npx featurevisor test --set=admin
```

When you print a datafile as JSON in a project with sets enabled, you have to pick a set:

```{% title="Command" %}
$ npx featurevisor build --set=storefront --environment=production --json --pretty
```

## Testing

Tests run for every set by default:

```{% title="Command" %}
$ npx featurevisor test
```

Test specs live inside each set's own `tests` directory, next to the features and segments they cover. To run tests for a single set, pass `--set`:

```{% title="Command" %}
$ npx featurevisor test --set=storefront
```

## Promotion between sets

When sets model release lanes, you can copy definitions from one set to another using [promotions](/docs/promotions/). For example, you can promote a feature's definition from `dev` to `staging`, and later from `staging` to `production`.

Read more in the [Promotions](/docs/promotions/) page.

## Comparison

Sets sit alongside the other ways Featurevisor helps you organize a project:

- [Environments](/docs/environments/): different sets of rules per feature, defined inside the same feature file
- [Tags](/docs/tags/): group features so [targets](/docs/targets/) can select them
- [Namespaces](/docs/namespaces/): organize features and segments hierarchically within a single tree
- [Sets](/docs/sets/): split the project into independent trees that each own their own definitions
