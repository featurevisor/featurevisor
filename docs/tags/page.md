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

Tagging your features helps build smaller datafiles, so that your applications get to load only the minimum required features in the runtime. {% .lead %}

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

When [building datafiles](/docs/building-datafiles), Featurevisor will create separate datafiles for each tag:

```
$ tree datafiles
.
├── staging
│   ├── featurevisor-tag-web.json
│   └── featurevisor-tag-mobile.json
└── production
    ├── featurevisor-tag-web.json
    └── featurevisor-tag-mobile.json
```

## Consuming datafile

Now from your application, you can choose which datafile to load:

```js {% path="your-app/index.js" highlight="3" %}
import { createInstance } from '@featurevisor/sdk'

const datafileUrl = 'https://cdn.yoursite.com/production/featurevisor-tag-web.json'
const datafileContent = await fetch(datafileUrl).then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

Learn more about [SDKs](/docs/sdks).
