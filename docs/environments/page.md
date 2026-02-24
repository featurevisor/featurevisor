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

Featurevisor is highly configurable and allows you to have any number of custom environments (like development, staging, and production). You can also choose to have no environments at all. {% .lead %}

## Custom environments

It is recommended that you have at least `staging` and `production` environments in your project. You can add more environments as needed:

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

Above configuration will help you define your features against each environment as follows:

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

And the [datafiles](/docs/building-datafiles) will be built per each environment:

```{% highlight="3,6" %}
$ tree datafiles
.
├── staging/
│   ├── featurevisor-tag-web.json
│   └── featurevisor-tag-mobile.json
├── production/
│   ├── featurevisor-tag-web.json
│   └── featurevisor-tag-mobile.json
```

## Splitting feature files by environment

If you prefer to keep environment specific rollout settings in separate files, enable `splitByEnvironment`:

```js {% path="featurevisor.config.js" %}
module.exports = {
  environments: ['staging', 'production'],
  splitByEnvironment: true,
}
```

Then your base feature keeps shared metadata only:

```yml {% path="features/my_feature.yml" %}
description: My feature
tags:
  - web
bucketBy: userId
```

And each environment file defines `rules`, `force`, and/or `expose` directly:

```yml {% path="environments/staging/my_feature.yml" %}
rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

```yml {% path="environments/production/my_feature.yml" %}
rules:
  - key: everyone
    segments: '*'
    percentage: 0
```

## No environments

You can also choose to have no environments at all:

```js {% path="featurevisor.config.js" highlight="6" %}
module.exports = {
  tags: [
    'web',
    'mobile'
  ],
  environments: false,
}
```

This will allow you to define your rollout rules directly:

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
