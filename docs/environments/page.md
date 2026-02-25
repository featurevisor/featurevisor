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

Featurevisor is highly configurable and allows us to have any number of custom environments (like development, staging, and production). We can also choose to have no environments at all. {% .lead %}

There are 3 ways to to configure environments in Featurevisor:

- environment specific data in individual self-contained [feature](/docs/features/) definitions
- feature definitions + separate environment specific files for [`rules`](/docs/features/#rules), [`force`](/docs/features/#force), and/or [`expose`](/docs/features/#expose)
- no environments at all

## Custom environments

It is recommended that we have at least `staging` and `production` environments in our [project](/docs/projects/).

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

## Split by environment

If we prefer to keep environment specific rollout settings in separate files, enable `splitByEnvironment` in `featurevisor.config.js`:

```js {% path="featurevisor.config.js" highlight="3" %}
module.exports = {
  environments: ['staging', 'production'],
  splitByEnvironment: true,
}
```

### Directory structure

```{% title="Directory structure" highlight="2,5,7" %}
features/
  └── my_feature.yml        # base feature definition
environments/
  ├── staging/
  │   └── my_feature.yml    # environment specific files
  └── production/
      └── my_feature.yml
```

### Base feature definition

Then our base feature keeps common feature-level data only:

```yml {% path="features/my_feature.yml" %}
description: My feature
tags:
  - web

bucketBy: userId

# variablesSchema: ...
# variations: ...
```

We can also define [variables](/docs/features/#variables) and [variations](/docs/features/#variations) in the base feature definition here.

### Environment specific files

And each environment file defines [`rules`](/docs/features/#rules), [`force`](/docs/features/#force), and/or [`expose`](/docs/features/#expose) data directly:

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

This kind of splitting is useful when we have a lot of environment specific data and we want to:

- keep the base feature definition clean and simple
- maintain different levels of access control and ownership for different environments (like via `CODEOWNERS` file for example)

## No environments

We can also choose to have no environments at all:

```js {% path="featurevisor.config.js" highlight="6" %}
module.exports = {
  tags: [
    'web',
    'mobile'
  ],
  environments: false,
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
