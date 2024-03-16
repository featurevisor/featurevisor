---
title: Scopes
description: Tailored datafiles for your Featurevisor project
---

We can build more tailored and optimized datafiles (in smaller size) for our Featurevisor project if some of the context values are already known early. {% .lead %}

## Recommended reading

You are recommended to learn about these concepts before proceeding further:

- [Configuration](/docs/configuration)
- [Tags in features](/docs/features/#tags)
- [Building datafiles](/docs/building-datafiles)
- [Consuming datafiles with SDKs](/docs/sdk/javascript/#initialization)
- [Context](/docs/sdks/javascript/#context)

## Default behaviour

By default, Featurevisor will generate datafiles for our project against a combination of environment and tag as found in the project configuration.

Assuming we have [configuration](/docs/configuration) as below:

```js
// featurevisor.config.js
module.exports = {
  tags: ["web", "ios", "android"],
  environments: ["staging", "production"],
}
```

This will result into built datafiles in `dist` directory like this:

```
$ tree dist
.
├── production
│   ├── datafile-tag-web.json
│   ├── datafile-tag-ios.json
│   └── datafile-tag-android.json
└── staging
    ├── datafile-tag-web.json
    ├── datafile-tag-ios.json
    └── datafile-tag-android.json

2 directories, 6 files
```

## Example scenario

While tagging makes sure our datafiles remain small in size, and applications are always fetching datafile containing only the features they are interested in, it may still mean the rules in features contain redundant configuration that we can avoid.

If we avoid the redundant rules, our datafile sizes will become even smaller while also reducing processing time when Featurevisor SDKs are evaluting values in application runtime.

### Segments

Imagine we have these segments for targeting different platforms already:

Targeting Web:

```yml
# segments/web.yml
description: Target web browsers
conditions:
  - attribute: platform
    operator: equals
    value: web
```

Targeting iOS devices:

```yml
# segments/ios.yml
description: Target iOS devices
conditions:
  - attribute: platform
    operator: equals
    value: iOS
```

Targeting Android devices:

```yml
# segments/android.yml
description: Target Android devices
conditions:
  - attribute: platform
    operator: equals
    value: android
```

### Feature

Imagine we have a feature called `showBanner` that affects all tags, but with separate rules targeting each platform:

```yml
# features/showBanner.yml
description: Show banner feature
tags:
  - web
  - ios
  - android

bucketBy: userId

environments:
  staging:
    rules:
      - key: everyone
        segments: "*"
        percentage: 100

  production:
    rules:
      - key: web
        segments: web
        percentage: 100

      - key: ios
        segments: ios
        percentage: 50

      - key: android
        segments: android
        percentage: 25
```

## Challenges

We can see above that in `production` environment, we have a different rollout strategy targeting different platforms for the same `showBanner` feature:

- `web` is rolled out 100%
- `ios` is rolled out 50%
- `android` is rolled out 25%

This means, all these platforms' rollout rules will be present in all the generated datafiles per tag irrespective of who consumes them:

```js
// in web application
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  // this datafile will also contain rules for iOS and Android,
  // which are redundant from the perspective of this web app,
  // because those rules will never match.
  datafileUrl: "https://cdn.yoursite.com/datafile-tag-web.json",
  onReady: () => console.log("SDK is ready"),
});

const context = {
  platform: "web",
  userId: "..."
};
const showBanner = f.isEnabled("showBanner", context);
```

## Solution

Enter scopes. They allow us to generate even more tailored datafiles if we already know some of the context values early.

In our case, we know that in web applications the `platform` attribute in our context will always have the value `web`.

### Configure scopes

We can map this early known context values as scopes in our project configuration file:

```js
// featurevisor.config.js
module.exports = {
  environments: ["staging", "production"],
  tags: ["web", "ios", "android"],

  // scopes are optionally defined if we need them
  scopes: [
    {
      name: "browsers",
      context: { platform: "web" },
    },
  ]
};
```

### Generate datafiles

Once the configuration above is in place, we can build our datafiles:

```
$ npx featurevisor build
```

And we will notice the files created in this manner in `dist` directory:

```
$ tree dist
.
├── production
│   ├── datafile-tag-web.json
│   ├── datafile-tag-web-scope-browsers.json
│   ├── datafile-tag-ios.json
│   └── datafile-tag-android.json
└── staging
    ├── datafile-tag-web.json
    ├── datafile-tag-web-scope-browsers.json
    ├── datafile-tag-ios.json
    └── datafile-tag-android.json

2 directories, 8 files
```

Notice that we have a new `datafile-tag-web-scope-browser.json` file above.

This file is a more tailored and optimized version of `datafile-tag-web.json`, containing rules and conditions that are needed only for web alone.

### Consume scoped datafile

From our web application(s), we can now consume this new scoped datafile:

```js
// in web application
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  // this datafile will omit any rules/conditions
  // involving `platform` attribute having non-`web` values
  datafileUrl: "https://cdn.yoursite.com/datafile-tag-web-scope-browsers.json",
  onReady: () => console.log("SDK is ready"),
});
```

This means, we don't have to pass `platform` attribute any more in our context when evaluating using SDK. Because the datafile was already built targeting browsers:

```js
const context = {
  // platform attribute is no longer needed here
  // platform: "web",

  // other attributes
  userId: "...",
  country: "nl",
};
const showBanner = f.isEnabled("showBanner", context);
```

## Testing

[Test specs](/docs/testing) for features are run against generated datafiles for the environment:

```yml
# tests/showBanner.spec.yml
feature: showBanner
assertions:
  - description: Should be enabled for Web in NL
    at: 60
    environment: production
    context:
      platform: web
      country: nl
    expectedToBeEnabled: true
```

If we wish to also have assertions against our pre-defined scopes, we can pass `scope` name in our assertions:

```yml
# tests/showBanner.spec.yml
feature: showBanner
assertions:
  - description: Should be enabled for Web in the Netherlands
    at: 60
    environment: production
    scope: browsers # pass scope name
    context:
      # platform: web (not needed any more here)
      country: nl
    expectedToBeEnabled: true
```

Afterwards, run your tests as usual:

```
$ npx featurevisor test
```
