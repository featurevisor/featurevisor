---
title: Environments
nextjs:
  metadata:
    title: Environments
    description: Customize your Featurevisor project with multiple environments
    openGraph:
      title: Environments
      description: Customize your Featurevisor project with multiple environments
      images:
        - url: /img/og/docs-environments.png
---

Featurevisor is highly configurable and allows us to have any number of custom environments (like development, staging, and production). By default, projects have no environments at all. {% .lead %}

There are 2 ways to configure environments in Featurevisor:

- environment specific data in individual self-contained [feature](/docs/features/) definitions
- no environments at all

## Custom environments

If your project needs environments, it is recommended that we have at least `staging` and `production` environments in our [project](/docs/projects/).

### Adding environments

We can add more environments as needed:

```js {% path="featurevisor.config.js" highlight="7-12" %}
module.exports = {
  tags: [
    'web',
    'mobile'
  ],

  environments: [
    'staging',
    'production',

    // add more environments here...
  ],
}
```

Above configuration will help us define our features and their rules against each environment as follows:

### Environment specific rules

```yml {% path="features/my_feature.yml" highlight="9,14" %}
description: My feature
tags:
  - web

bucketBy: userId

# rules per each environment
rules:
  staging:
    - key: everyone
      segments: '*'
      percentage: 100

  production:
    - key: everyone
      segments: '*'
      percentage: 0
```

See also [force](/docs/features/#force) and [expose](/docs/features/#expose) for more information.

### Generated datafiles

And the [datafiles](/docs/building-datafiles) will be built per each environment in `datafiles` directory:

```{% title="Command" highlight="3,6" %}
$ tree datafiles
.
├── staging/
│   ├── featurevisor-web.json
│   └── featurevisor-mobile.json
├── production/
│   ├── featurevisor-web.json
│   └── featurevisor-mobile.json
```

## Environment lanes with sets

With the `environments` config above, environment specific `rules`, `force`, and `expose` maps live inside the same feature file.

There is another way to model environments that some teams prefer: treat `dev`, `staging`, and `production` as independent release lanes using [sets](/docs/sets/), and move changes from one lane to the next using [promotions](/docs/promotions/).

This approach is useful when you want each lane to be fully separate, so the same feature can have a very different definition in `dev` than in `production`, and changes flow forward only when you promote them.

You can scaffold a ready-made project for this with:

```{% title="Command" %}
$ npx featurevisor init --example=environments
```

### Configuration

With this approach you do **not** define `environments`. You enable [sets](/docs/sets/) instead, and add [`promotionFlows`](/docs/configuration/#promotionflows) to keep promotions moving in one direction:

```js {% path="featurevisor.config.js" %}
module.exports = {
  sets: true,
  tags: ['all'],

  // only allow promotions to move forward, one lane at a time
  promotionFlows: [
    { from: 'dev', to: 'staging' },
    { from: 'staging', to: 'production' },
  ],
}
```

### One set per lane

Each lane is a set with its own definitions under `sets/<lane>/`:

```
sets/
├── dev/
│   ├── attributes/
│   ├── segments/
│   ├── features/
│   ├── targets/
│   └── tests/
├── staging/
│   └── ...
└── production/
    └── ...
```

The same feature key can live in every lane with different rules. Because there are no `environments`, rules are authored directly without an environment key:

```yml {% path="sets/dev/features/checkoutFlow.yml" %}
description: New checkout flow in dev
tags:
  - all

bucketBy: userId

# fully rolled out in dev
rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

```yml {% path="sets/production/features/checkoutFlow.yml" %}
description: New checkout flow in production
tags:
  - all

bucketBy: userId

# still off in production
rules:
  - key: everyone
    segments: '*'
    percentage: 0
```

### Building datafiles

[Building](/docs/building-datafiles/) writes datafiles under a directory per lane:

```{% title="Output" %}
datafiles/dev/featurevisor-all.json
datafiles/staging/featurevisor-all.json
datafiles/production/featurevisor-all.json
```

### Promoting between lanes

When a feature is ready to move to the next lane, [promote](/docs/promotions/) it:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging --apply
```

The `promotionFlows` configuration above makes sure promotions only move forward, so promoting straight from `dev` to `production` is rejected.

Read more in [Sets](/docs/sets/) and [Promotions](/docs/promotions/).

## No environments

Projects have no environments by default. You can omit `environments` from your configuration:

```js {% path="featurevisor.config.js" %}
module.exports = {
  tags: [
    'web',
    'mobile'
  ],
}
```

This will allow us to define our rollout rules directly without needing any environment specific keys:

```yml {% path="features/my_feature.yml" %}
description: My feature
tags:
  - web

bucketBy: userId

# rules without needing environment specific keys
rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

The [datafiles](/docs/building-datafiles) will be built without any environment:

```
$ tree datafiles
.
├── featurevisor-web.json
├── featurevisor-mobile.json
```
