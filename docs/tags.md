---
title: Tagging features
description: Tag your features to load them in your application via smaller datafiles
ogImage: /img/og/docs-tags.png
---

Tagging your features helps build smaller datafiles, so that your applications get to load only the minimum required features in the runtime. {% .lead %}

## Configuration

Every Featurevisor project needs to define a set of tags in the [configuration](/docs/configuration) file:

```js
// featurevisor.config.js
module.exports = {
  tags: [
    "web",
    "mobile",

    // add more tags here...
  ],

  environments: [
    "staging",
    "production",
  ],
};
```

## Defining features

Above configuration enables you to define your features against one or more tags as follows:

```yml
# features/my_feature.yml
description: My feature
tags:
  - web

# ...
```

Learn more about [defining features](/docs/features).

## Building datafiles

When [building datafiles](/docs/building-datafiles), Featurevisor will create separate datafiles for each tag:

```
$ tree dist
.
├── staging
│   ├── datafile-tag-web.json
│   └── datafile-tag-mobile.json
└── production
    ├── datafile-tag-web.json
    └── datafile-tag-mobile.json
```

## Consuming datafile

Now from your application, you can choose which datafile to load:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-web.json"
const datafileContent = await fetch(datafileUrl).then(res => res.json());

const f = createInstance({
  datafile: datafileContent,
});
```

Learn more about [SDKs](/docs/sdks).
