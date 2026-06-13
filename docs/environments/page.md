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
│   ├── featurevisor-tag-web.json
│   └── featurevisor-tag-mobile.json
├── production/
│   ├── featurevisor-tag-web.json
│   └── featurevisor-tag-mobile.json
```

## Environment lanes with sets

Featurevisor no longer supports separate `environments/<environment>/<feature>.yml` files. Keep environment-specific `rules`, `force`, and `expose` maps inside the feature file.

If you want development, staging, and production to behave like independent release lanes with promotion between them, model those lanes as project sets instead. See the environment example projects for that workflow.

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
├── featurevisor-tag-web.json
├── featurevisor-tag-mobile.json
```
