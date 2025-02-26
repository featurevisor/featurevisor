---
title: Environments
description: Customize your Featurevisor project with multiple environments
ogImage: /img/og/environments.png
---

Featurevisor is highly configurable and allows you to have any number of custom environments (like development, staging, and production). You can also choose to have no environments at all. {% .lead %}

## Custom environments

It is recommended that you have at least `staging` and `production` environments in your project. You can add more environments as needed:

```js
// featurevisor.config.js
module.exports = {
  tags: [
    "web",
    "mobile"
  ],

  environments: [
    "staging",
    "production",

    // add more environments here...
  ],
};
```

Above configuration will help you define your features against each environment as follows:

```yml
# features/my_feature.yml
description: My feature
tags:
  - web

bucketBy: userId

# rules per each environment
environments:
 staging:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100

 production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 0
```

And the [datafiles](/docs/building-datafiles) will be built per each environment:

```
$ tree dist
.
├── staging
│   ├── datafile-tag-web.json
│   └── datafile-tag-mobile.json
├── production
│   ├── datafile-tag-web.json
│   └── datafile-tag-mobile.json
```

## No environments

You can also choose to have no environments at all:

```js
// featurevisor.config.js
module.exports = {
  tags: ["web", "mobile"],
  environments: false,
};
```

This will allow you to define your rollout rules directly without needing `environments` key:

```yml
# features/my_feature.yml
description: My feature
tags:
  - web

bucketBy: userId

# rules without needing environments key
rules:
  - key: "1"
    segments: "*"
    percentage: 100
```

The [datafiles](/docs/building-datafiles) will be built without any environment:

```
$ tree dist
.
├── datafile-tag-web.json
├── datafile-tag-mobile.json
```
