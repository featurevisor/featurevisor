---
title: Promotions
nextjs:
  metadata:
    title: Promotions
    description: Copy feature definitions from one Featurevisor set to another with the promote command.
    openGraph:
      title: Promotions
      description: Copy feature definitions from one Featurevisor set to another with the promote command.
      images:
        - url: /img/og/docs.png
---

Promotions copy definitions from one [set](/docs/sets/) to another, so you can move work along release lanes like `dev`, `staging`, and `production`. {% .lead %}

## Pre-requisites

Promotions only apply to projects that use [sets](/docs/sets/). Each lane is modeled as its own set, for example `dev`, `staging`, and `production`, each owning its own attributes, segments, features, targets, and tests.

```js {% path="featurevisor.config.js" %}
module.exports = {
  sets: true,
  tags: ['all'],
}
```

## Previewing a promotion

The `promote` command previews what would be copied from one set to another. Nothing is written to disk until you ask for it:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging
```

This shows the definitions that would be created or updated in the destination set. When you promote a feature, Featurevisor also brings along its dependencies, like the segments and attributes it references.

To include unchanged entries in the preview:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --showUnchanged
```

## Applying a promotion

Pass `--apply` to write the destination files:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --apply
```

## Filtering features

You can promote only the features you want by passing glob patterns:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --includeFeatures="checkout*"
```

To exclude some features instead:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --excludeFeatures="experimental*"
```

If a filter matches no features, the command fails so the mistake is visible early. Pass `--allowEmpty` if an empty result is acceptable.

## Conflicts

When a definition already exists in the destination set with different values, that is a conflict. The `--conflicts` option controls how conflicts are resolved:

- `source`: the source set wins and overwrites the destination (default)
- `destination`: the destination keeps its existing values
- `fail`: stop with an error instead of overwriting

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --conflicts=fail
```

## Excluding definitions from promotion

By default, every definition is promotable. To keep a definition from ever being promoted, set `promotable: false` on it.

This works on whole definitions, like a feature:

```yml {% path="sets/dev/features/checkoutFlow.yml" highlight="2" %}
description: Checkout flow
promotable: false
tags:
  - all

rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

It also works on individual [rules](/docs/features/#rules), so a feature can be promoted while a specific rule stays behind in the source set:

```yml {% path="sets/dev/features/checkoutFlow.yml" highlight="5" %}
description: Checkout flow

rules:
  - key: internal-testing
    promotable: false
    segments: internal
    percentage: 100

  - key: everyone
    segments: '*'
    percentage: 50
```

The same `promotable: false` field is supported on attributes, segments, groups, schemas, targets, and test specs.

## Allowed promotion flows

By default, any set can be promoted to any other set. To restrict which promotions are allowed, define `promotionFlows` in your [configuration](/docs/configuration/):

```js {% path="featurevisor.config.js" highlight="4-7" %}
module.exports = {
  sets: true,
  tags: ['all'],
  promotionFlows: [
    { from: 'dev', to: 'staging' },
    { from: 'staging', to: 'production' },
  ],
}
```

With the configuration above, `promote --from=dev --to=production` fails because that flow is not listed. Promoting from `dev` to `staging`, or from `staging` to `production`, is allowed.

## Audit files

Pass `--audit` to write a record of a promotion. This is useful alongside `--apply` to keep a trail of what changed:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --apply --audit=markdown
```

Audit files are written under `.featurevisor/promotions/`. Use `--audit=json` for machine-readable output, or `--audit=markdown` for a human-readable summary.

## Learn more

- [Sets](/docs/sets/): split a project into independent trees
- [Environments](/docs/environments/): different rules per feature within a single tree
- [State files](/docs/state-files/): where Featurevisor keeps generated state
