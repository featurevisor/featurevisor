---
title: Scopes
nextjs:
  metadata:
    title: Scopes
    description: Scopes allow you to create more targeted and smaller datafiles.
    openGraph:
      title: Scopes
      description: Scopes allow you to create more targeted and smaller datafiles.
      images:
        - url: /img/og/docs-scopes.png
---

Scopes are a way to generate smaller and more optimized [datafiles](/docs/building-datafiles/) for your applications to achieve **quicker downloads**, with a **reduced memory footprint**, and **faster local evaluations**. {% .lead %}

![Scopes](/img/og/docs-scopes.png)

## Challenges

Featurevisor always supported:

- [Tagging features](/docs/tags/)
- Allowing creation of [datafiles](/docs/building-datafiles) per each tag
- Enabling individual application(s) to load only the features they [need](/docs/sdks/javascript)

But that still meant the application(s) had to fetch all the [rules](/docs/features/#rules) belonging to those tagged [features](/docs/features), even if some of those rules (and their corresponding [segments](/docs/segments)) were not relevant for intended application and its users.

## Example scenario

### Understanding segments

Imagine we have three [segments](/docs/segments/) with each targeting a different device type like:

- web
- ios
- android

They each have a condition against the `platform` attribute, like:

```yml {% path="segments/web.yml" highlight="3" %}
description: Target web devices
conditions:
  - attribute: platform
    operator: equals
    value: web
```

### Usage of segments in rules

And we happen to have a single [feature](/docs/features/) that targets all three device types but with different rollout percentage, like:

```yml {% path="features/showBanner.yml" highlight="3,4,5,10,14,18" %}
description: Show banner feature
tags:
  - web
  - ios
  - android

rules:
  production:
    - key: browsers-only
      segments: web
      percentage: 50

    - key: ios-only
      segments: ios
      percentage: 80

    - key: android-only
      segments: android
      percentage: 100
```

### Building tagged datafiles

When we [build](/docs/building-datafiles) the datafiles, we will find them in the `datafiles` directory like this:

```{% title="Directory structure" %}
datafiles/
├── production/
│   └── featurevisor-tag-web.json
│   └── featurevisor-tag-ios.json
│   └── featurevisor-tag-android.json
```

### Redundant rules

Even though the datafiles are created per each [tag](/docs/tags/), the features inside them still contain all three original rules targeting three different segments.

But our web application already knows that the user is in a web browser, so it didn't have to load the rules for `ios` and `android` segments targeting the `platform` attribute.

This is where scopes come in handy.

## Defining scopes

Scopes help you create more targeted datafiles that do not contain any redundant rules involving [context](/docs/sdks/javascript/#context) that are already partially known beforehand.

To create a new scope, we will be updating our [`featurevisor.config.js`](/docs/configuration/) file to include the new scope:

```js {% path="featurevisor.config.js" highlight="12,18-22" %}
module.exports = {
  environments: [
    "production",
  ],

  tags: [
    "web",
    "ios",
    "android",
  ],

  scopes: [
    // we are letting Featurevisor know to
    // create a new scoped datafile
    // by picking features tagged with `web`
    // and removing redundant rules that do not matter
    // after applying the partially known context `{ platform: "web" }`
    {
      name: "browsers",
      tag: "web",
      context: { platform: "web" },
    },
  ],
}
```

What's happening above is, we are letting Featurevisor know to:

- create a new scoped datafile (next to existing tagged ones)
- by picking features tagged with `web`
- and removing redundant rules and segments from them
- after applying the partially known context `{ platform: "web" }`

## Complex scenarios

While above scenario is quite simple, scopes can also be created for more complex scenarios with larger contexts targeting multiple attributes.

Imagine creating a scope for:

- web users
- in the Netherlands
- who are on a premium subscription plan

The partially known context could be expressed like this below:

```js
const context = {
  platform: "web",
  country: "nl",
  subscription: "premium",
}
```

We can then make use of this partially known context early at the scope configuration level like this:

```js {% path="featurevisor.config.js" highlight="8-12" %}
module.exports = {
  // ...

  scopes: [
    {
      name: "browsers-nl-premium",
      tag: "web",
      context: {
        platform: "web",
        country: "nl",
        subscription: "premium"
      },
    },
  ],
}
```

## Build scoped datafiles

Run the same [build](/docs/building-datafiles/) command as usual:

```{% title="Command" %}
$ npx featurevisor build
```

You will now find the new scoped datafile in the `datafiles` directory:

```{% title="Directory structure" highlight="3" %}
datafiles/
├── production/
│   └── featurevisor-scope-browsers.json
│   └── featurevisor-tag-web.json
│   └── featurevisor-tag-ios.json
│   └── featurevisor-tag-android.json
```

Notice the new scoped datafile `featurevisor-scope-browsers.json`.

Unlike the tagged datafile `featurevisor-tag-web.json`, the scoped datafile does not contain the rules for the `ios` and `android` segments anymore.

This is because the scoped datafile is created after applying the partially known context to all the relevant features and segments, and removes anything that are not needed any more.

## Consuming scoped datafiles

From your application perspective, nothing changes.

Consume the new scoped datafile just like how you would a tagged one:

```js {% path="your-app/index.js" highlight="3" %}
import { createInstance } from '@featurevisor/sdk'

const datafileUrl = 'https://cdn.yoursite.com/production/featurevisor-scope-browsers.json'
const datafileContent = await fetch(datafileUrl).then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

## Testing scopes

Because scopes produce separate [datafiles](/docs/building-datafiles), it is important that we have the ability to [test](/docs/testing/) our feature assertions against the scoped datafiles for improved confidence level.

When defining our test specs for features, we can optionally opt to test with scopes by passing the `scope` property to individual assertions:

```yml {% path="tests/features/showBanner.spec.yml" highlight="15" %}
feature: showBanner
assertions:
  ##
  # Testing without scopes
  #
  - at: 10
    environment: production
    context:
      platform: web
    expectedToBeEnabled: true

  ##
  # Testing with scopes
  #
  - scope: browsers # the name of the scope to test against
    at: 10
    context: {} # no additional context is needed to be passed
    expectedToBeEnabled: true
```

## Running tests with scopes

Because scoped datafiles are separate from [tagged datafiles](/docs/tags/) and require additional build step, we need to pass the `--with-scopes` option when testing:

```{% title="Command" %}
$ npx featurevisor test --with-scopes
```

If we do not pass the option `--with-scopes`, the tests will still run and succeed.

But the scope's context will be fed to the evaluation context to imitate the behavior of testing with scopes, without actually building the scoped datafiles in memory.

It is opt-in only for improved confidence level.

## Advanced scopes

Picking features in scopes can go beyond specifying a single tag alone.

### Single tag

To include features of a single tag:

```js {% path="featurevisor.config.js" highlight="7" %}
module.exports = {
  // ...

  scopes: [
    {
      name: 'browsers',
      tag: 'web',
      context: { platform: 'web' },
    },
  ],
}
```

### Multiple tags

To include features belonging to multiple tags together (like an AND condition):

```js {% path="featurevisor.config.js" highlight="7-10" %}
module.exports = {
  // ...

  scopes: [
    {
      name: 'mobile',
      tags: [
        'ios',
        'android',
      ],
      context: {},
    },
  ],
}
```

It is alright for scopes to have an empty `context`, if we don't want any further optimizations.

### Conditional tags

To include features that matches any of the tags (like an OR condition):

```js {% path="featurevisor.config.js" highlight="7-12" %}
module.exports = {
  // ...

  scopes: [
    {
      name: 'paid-users',
      tags: {
        or: [
          'ios',
          'android',
        ],
      },
      context: {},
    },
  ],
}
```

Similar to `or`, `and` can be used for picking features in a scope having multiple tags together.

### All features

If we wish to include all the features from our Featurevisor [project](/docs/projects), we can skip mentioning the `tag` or `tags` property altogether:

```js {% path="featurevisor.config.js" %}
module.exports = {
  // ...

  scopes: [
    {
      name: 'ios',
      context: { platform: 'ios' },
    },
  ],
}
```

## Comparison

To avoid confusing scopes with some other terms used in Featurevisor, it's recommended to learn more about them in depth:

- [Environments](/docs/environments/): different sets of rules per feature, like against staging or production
- [Tags](/docs/tags): allows tagging individual features, which end up in tagged [datafiles](/docs/building-datafiles/)
- [Namespaces](/docs/namespaces): purely for hierarchical organization of features, which acts as prefixes of feature keys.

Scopes are used to create smaller datafiles out of bigger (tagged) datafiles.

## Benefits

Scopes are perfect for:

- Multi-platform products (Web, iOS, Android, etc)
- Global products with country-specific features
- SaaS products with tiered subscriptions
- Enterprise products with role-based access
- Any product where context is partially known early (device type, user tier, region, etc)

They help generate more targeted and optimized [datafiles](/docs/building-datafiles/) that are significantly smaller in size, reducing the amount of data that needs to be:

- **Downloaded**: saving bandwidth costs
- **Kept in memory**: improving memory footprint, and
- **Processed**: avoiding unnecessary computation when evaluating features

All of it resulting in a much faster performance in your applications affecting your users positively.
