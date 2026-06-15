---
title: Tagging features
nextjs:
  metadata:
    title: Tagging features
    description: Tag your features to load them in your application via smaller datafiles
    openGraph:
      title: Tagging features
      description: Tag your features to load them in your application via smaller datafiles
      images:
        - url: /img/og/docs-tags.png
---

Tagging your features lets [targets](/docs/targets/) select smaller groups of features for generated datafiles. {% .lead %}

## Configuration

Every Featurevisor project needs to define a set of tags in the [configuration](/docs/configuration) file:

```js {% path="featurevisor.config.js" highlight="2-7" %}
module.exports = {
  tags: [
    'web',
    'mobile',

    // add more tags here...
  ],

  environments: [
    'staging',
    'production',
  ],
}
```

## Defining features

Above configuration enables you to define your features against one or more tags as follows:

```yml {% path="features/my_feature.yml" highlight="2-3" %}
description: My feature
tags:
  - web

# ...
```

Learn more about [defining features](/docs/features).

## Building datafiles

Tags do not create datafiles on their own. Define targets that select the tags you need:

```yml {% path="targets/web.yml" %}
description: Web app
tag: web
```

When [building datafiles](/docs/building-datafiles), Featurevisor creates datafiles for targets.

## Consuming datafile

Now from your application, you can choose which datafile to load:

```js {% path="your-app/index.js" highlight="3" %}
import { createFeaturevisor } from '@featurevisor/sdk'

const datafileUrl = 'https://cdn.yoursite.com/production/featurevisor-web.json'
const datafileContent = await fetch(datafileUrl).then((res) => res.json())

const f = createFeaturevisor({
  datafile: datafileContent,
})
```

Learn more about [SDKs](/docs/sdks).

## Testing features against targets

When writing a feature's test spec, use the `target` property:

```yml {% path="tests/features/my_feature.spec.yml" highlight="8" %}
feature: my_feature

assertions:
  - environment: production
    at: 90
    context:
      country: nl
    target: web
    expectedToBeEnabled: true
```

The test runner builds target datafiles in memory automatically:

```
$ npx featurevisor test
```
