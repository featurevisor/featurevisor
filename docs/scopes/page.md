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

Scopes allow you to create more targeted and smaller datafiles. {% .lead %}

## Why create scopes?

Featurevisor already supports [tagging features](/docs/tags/) to created [datafiles](/docs/building-datafiles) for each tag, allowing your application to fetch only the features they need.

But that still means your application will fetch all the [rules](/docs/features/#rules) belonging to those tagged features, even if some of those rules are not relevant to the known user.

Scopes help you create more targeted datafiles that do not contain any redundant rules involving [context](/docs/sdks/javascript/#context) that are already known beforehand.

## Example scenario

Imagine you have three [segments](/docs/segments/) with each targeting a different device type like:

- web
- ios
- android

They each have a condition against the `platform` attribute, like:

```yml {% path="segments/web.yml" %}
description: Target web devices
conditions:
  - attribute: platform
    operator: equals
    value: web
```

And you happen to have a single [feature](/docs/features/) that targets all three device types, like:

```yml {% path="features/showBanner.yml" %}
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

When you [build](/docs/building-datafiles) the datafiles, you will find them in the `datafiles` directory like this:

```
datafiles/
├── production/
│   └── featurevisor-tag-web.json
│   └── featurevisor-tag-ios.json
│   └── featurevisor-tag-android.json
```

Even though the datafiles are created per each [tag](/docs/tags/), the features inside them still contain all three rules for all three segments.

But our iOS application already knows that the user is on an iOS device, so it can safely ignore the rules for the `web` and `android` segments.

This is where scopes come in handy.

## Creating a scope

To create a new scope, we will be updating our [`featurevisor.config.js`](/docs/configuration/) file to include the new scope:

```js {% path="featurevisor.config.js" %}
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
    // by picking features tagged with `ios`
    // and removing redundant rules that do not matter
    // after applying the partially known context `{ platform: "ios" }`
    {
      name: "ios",
      tag: "ios",
      context: { platform: "ios" },
    },
  ],
}
```

What's happening above is, we are letting Featurevisor know to:

- create a new scoped datafile
- by picking features tagged with `ios`
- and removing redundant rules that do not apply
- after applying the partially known context `{ platform: "ios" }`

## Complex scenarios

While above scenario is quite simple, scopes can be created for more complex scenarios as well with larger contexts.

Imagine creating a scope for:

- iOS users
- in the Netherlands
- who are on a premium subscription plan

In that case, the scope configuration would look like this:

```js {% path="featurevisor.config.js" %}
module.exports = {
  // ...

  scopes: [
    {
      name: "ios-nl-premium",
      tag: "ios",
      context: {
        platform: "ios",
        country: "nl",
        subscription: "premium"
      },
    },
  ],
}
```

## Build scoped datafiles

Run the same `build` command as usual:

```{% title="Command" %}
$ npx featurevisor build
```

You will now find the new scoped datafile in the `datafiles` directory:

```
datafiles/
├── production/
│   └── featurevisor-scope-ios.json
│   └── featurevisor-tag-web.json
│   └── featurevisor-tag-ios.json
│   └── featurevisor-tag-android.json
```

Notice the new scoped datafile `featurevisor-scope-ios.json`.

Unlike the tagged datafile `featurevisor-tag-ios.json`, the scoped datafile does not contain the rules for the `web` and `android` segments anymore.

This is because the scoped datafile is created after applying the partially known context `{ platform: "ios" }` to the features.

## Consuming scoped datafiles

From your application perspective, nothing changes. Consume this datafile just like how you would a tagged one:

```js {% path="your-app/index.js" %}
import { createInstance } from '@featurevisor/sdk'

const datafileUrl = 'https://cdn.yoursite.com/production/featurevisor-scope-ios.json'
const datafileContent = await fetch(datafileUrl).then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

## Testing scopes

Because scopes produce separate [datafiles](/docs/building-datafiles), it is important that we have the ability to [test](/docs/testing/) our feature assertions against the scoped datafiles.

When defining your test specs for features, you can optionally opt to test with scopes by passing the `scope` property to the assertion:

```yml {% path="tests/features/showBanner.spec.yml" %}
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

If we do not pass this option, the tests will still run and succeed, but the scope's context will be fed to the evaluation context to imitate the behavior of testing with scopes, without actually building the scoped datafiles in memory.

## Benefits

If you have a complex product with feature configuration targeting:

- Several countries
- Several device types
- Several subscription plans
- ...many more

Then scopes can help generate more targeted datafiles that are significantly smaller in size, reducing the amount of data that needs to be downloaded and parsed by your application in the runtime.
