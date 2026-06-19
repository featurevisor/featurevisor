---
title: Migrating from v2 to v3
showInlineTOC: true
nextjs:
  metadata:
    title: Migrating from v2 to v3
    description: Guide for migrating from Featurevisor v2 to v3
    openGraph:
      title: Migrating from v2 to v3
      description: Guide for migrating from Featurevisor v2 to v3
      images:
        - url: /img/og/docs.png
---

Detailed guide for migrating existing Featurevisor projects (using Featurevisor CLI) and applications (using Featurevisor SDKs) to latest v3.0.

---

## Project configuration

### Environments are off by default {% label="Breaking" labelType="error" %}

In v2, every project had `staging` and `production` environments by default. In v3, projects have no environments unless you declare them.

If your project uses environments, declare them explicitly in your configuration:

{% row %}
{% column %}

```js {% title="Before" path="featurevisor.config.js" %}
module.exports = {
  // staging and production
  // were assumed by default
  tags: ['all'],
}
```

{% /column %}
{% column %}

```js {% title="After" path="featurevisor.config.js" highlight="2-5" %}
module.exports = {
  environments: [
    'staging',
    'production',
  ],
  tags: ['all'],
}
```

{% /column %}
{% /row %}

If your project does not need environments, you can leave `environments` out, and author your `rules`, `force`, and `expose` directly without an environment key.

Learn more in [Environments](/docs/environments/) page.

### Scopes replaced by targets {% label="Breaking" labelType="error" %}

The `scopes` configuration key has been removed. Datafiles are now built from [targets](/docs/targets/), which live as files in the `targets` directory.

{% row %}
{% column %}

```js {% title="Before" path="featurevisor.config.js" %}
module.exports = {
  scopes: [
    {
      name: 'browsers',
      tag: 'web',
      context: { platform: 'web' },
    },
  ],
}
```

{% /column %}
{% column %}

```yml {% title="After" path="targets/browsers.yml" %}
description: Web browsers
tag: web
context:
  platform: web
```

{% /column %}
{% /row %}

A target's `tag`, `tags`, and `context` work exactly like a scope did, including the `or` and `and` selectors. If `scopes` is still present in your configuration, Featurevisor throws an error asking you to define targets instead.

Learn more in [Targets](/docs/targets/) and [Scopes](/docs/scopes/) pages.

### Namespace separator {% label="Breaking" labelType="error" %}

[Namespaced](/docs/namespaces/) feature and segment keys now use a dot (`.`) as their separator by default, instead of a slash (`/`).

This means `features/checkout/feature1.yml` is now referred to as `checkout.feature1` instead of `checkout/feature1`, both in your application and in your test specs.

To keep the old slash-separated keys, set `namespaceCharacter` in your configuration:

```js {% path="featurevisor.config.js" %}
module.exports = {
  namespaceCharacter: '/',
}
```

Learn more in [Namespaces](/docs/namespaces/) page.

### Sets {% label="New" labelType="success" %}

You can now split a project into independent trees called [sets](/docs/sets/), each owning its own attributes, segments, features, targets, and tests.

```js {% path="featurevisor.config.js" %}
module.exports = {
  sets: true,
  tags: ['all'],
}
```

This is useful for modeling release lanes like `dev`, `staging`, and `production`, or distinct surfaces like `storefront` and `admin`, from a single repository.

Learn more in [Sets](/docs/sets/) page.

### Promotions {% label="New" labelType="success" %}

In a project with sets, you can copy definitions from one set to another using [promotions](/docs/promotions/). You can optionally constrain which promotions are allowed with `promotionFlows`:

```js {% path="featurevisor.config.js" highlight="4-7" %}
module.exports = {
  sets: true,
  tags: ['all'],
  promotionFlows: [
    { from: 'dev', to: 'staging' },
    { from: 'staging', to: 'production' },
  ],
}
```

Learn more in [Promotions](/docs/promotions/) page.

---

## Defining features

### Tags are now optional {% label="New" labelType="success" %}

The `tags` property on a feature is now optional. A feature without tags is still included in [targets](/docs/targets/) that do not narrow down by tag.

```yml {% path="features/myFeature.yml" %}
description: My feature

bucketBy: userId

rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

Learn more in [Features](/docs/features/#tags) section.

### Promotable definitions {% label="New" labelType="success" %}

In a project with [sets](/docs/sets/), you can keep a definition from being copied during [promotions](/docs/promotions/) by setting `promotable: false`. This is supported on features, rules, segments, attributes, groups, schemas, targets, and test specs.

```yml {% path="features/myFeature.yml" highlight="2" %}
description: My feature
promotable: false

# ...
```

Learn more in [Promotions](/docs/promotions/) page.

---

## Testing features

### Targeting datafiles in assertions {% label="Breaking" labelType="error" %}

The `scope` and `tag` properties in test assertions have been replaced by a single `target` property.

{% row %}
{% column %}

```yml {% title="Before" path="tests/features/myFeature.spec.yml" highlight="4" %}
feature: myFeature
assertions:
  - environment: production
    scope: browsers
    at: 50
    context: {}
    expectedToBeEnabled: true
```

{% /column %}
{% column %}

```yml {% title="After" path="tests/features/myFeature.spec.yml" highlight="4" %}
feature: myFeature
assertions:
  - environment: production
    target: browsers
    at: 50
    context: {}
    expectedToBeEnabled: true
```

{% /column %}
{% /row %}

The `--with-scopes` CLI flag is no longer needed. The test runner builds target datafiles in memory automatically.

Learn more in [Testing](/docs/testing/) page.

### Testing sets {% label="New" labelType="success" %}

In a project with [sets](/docs/sets/), tests run for every set by default. You can run tests for a single set with `--set`:

```{% title="Command" %}
$ npx featurevisor test --set=storefront
```

---

## CLI usage

### Upgrade to latest CLI {% label="New" labelType="success" %}

In your Featurevisor project repository:

```text {% title="Command" %}
$ npm install --save @featurevisor/cli@3
```

### Building datafiles from targets {% label="Breaking" labelType="error" %}

Datafiles are no longer built per tag automatically. You now need at least one [target](/docs/targets/) for the build to produce anything.

The smallest possible target includes all of your non-archived features:

```yml {% path="targets/all.yml" %}
description: All features
```

Then build as usual:

```{% title="Command" %}
$ npx featurevisor build
```

### Datafile naming {% label="Breaking" labelType="error" %}

Because datafiles are built from targets now, the `tag-` prefix in datafile names is gone. A datafile is named after the target that produced it.

{% row %}
{% column %}

```{% title="Before" highlight="4,6" %}
$ tree datafiles
.
├── production
│   └── featurevisor-tag-web.json
└── staging
    └── featurevisor-tag-web.json
```

{% /column %}
{% column %}

```{% title="After" highlight="4,6" %}
$ tree datafiles
.
├── production
│   └── featurevisor-web.json
└── staging
    └── featurevisor-web.json
```

{% /column %}
{% /row %}

Define a target named `web` (with `tag: web`) to produce `featurevisor-web.json`.

To maintain backwards compatibility, you can create new targets named `tag-web` and `tag-mobile` to produce `featurevisor-tag-web.json` and `featurevisor-tag-mobile.json` respectively.

Learn more in [Building datafiles](/docs/building-datafiles/) page.

### Catalog instead of site {% label="Breaking" labelType="error" %}

The `site` command has been renamed to `catalog`.

{% row %}
{% column %}

```{% title="Before" %}
$ npx featurevisor site export
$ npx featurevisor site serve
```

{% /column %}
{% column %}

```{% title="After" %}
$ npx featurevisor catalog export
$ npx featurevisor catalog serve
```

{% /column %}
{% /row %}

Learn more in [Catalog](/docs/site/) page.

### Promote command {% label="New" labelType="success" %}

In a project with [sets](/docs/sets/), you can preview and apply [promotions](/docs/promotions/) between sets:

```{% title="Command" %}
$ npx featurevisor promote --from=dev --to=staging
$ npx featurevisor promote --from=dev --to=staging --apply
```

Learn more in [Promotions](/docs/promotions/) page.

### Working with a single set {% label="New" labelType="success" %}

Most commands accept a `--set` flag to scope them to one set:

```{% title="Command" %}
$ npx featurevisor build --set=storefront
$ npx featurevisor test --set=storefront
```

---

## JavaScript SDK usage

### Upgrade to latest SDK {% label="New" labelType="success" %}

In your application repository:

```text {% title="Command" %}
$ npm install --save @featurevisor/sdk@3
```

### Creating an instance {% label="Breaking" labelType="error" %}

`createInstance` has been renamed to `createFeaturevisor`, and the `FeaturevisorInstance` type to `Featurevisor`.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="1,3" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  datafile: datafileContent,
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="1,3" %}
import { createFeaturevisor } from '@featurevisor/sdk'

const f = createFeaturevisor({
  datafile: datafileContent,
})
```

{% /column %}
{% /row %}

```ts {% title="Type" %}
// Before
import type { FeaturevisorInstance } from '@featurevisor/sdk'

// After
import type { Featurevisor } from '@featurevisor/sdk'
```

Learn more in [JavaScript SDK](/docs/sdks/javascript/) page.

### setDatafile merges by default {% label="Soft breaking" labelType="warning" %}

In v2, calling `setDatafile` replaced the instance's datafile. In v3, it merges with the existing datafile by default.

Incoming `features` and `segments` override matching keys, while existing ones that are missing from the incoming datafile are kept. To get the old replacing behavior, pass `true` as the second argument.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" %}
// always replaced
f.setDatafile(datafileContent)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="5" %}
// merges by default
f.setDatafile(datafileContent)

// pass true to replace entirely
f.setDatafile(datafileContent, true)
```

{% /column %}
{% /row %}

Merging makes it possible to load smaller datafiles on demand. Learn more in [Loading datafiles on demand](/docs/use-cases/on-demand-datafiles/).

### Diagnostics instead of logger {% label="Breaking" labelType="error" %}

The `logger` option and the `createLogger` function have been removed. The SDK now reports diagnostics, which you control with `logLevel` and an optional `onDiagnostic` handler.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="1-4,7-9" %}
import {
  createInstance,
  createLogger,
} from '@featurevisor/sdk'

const f = createInstance({
  logger: createLogger({
    level: 'debug',
  }),
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="1,4" %}
import { createFeaturevisor } from '@featurevisor/sdk'

const f = createFeaturevisor({
  logLevel: 'debug',
})
```

{% /column %}
{% /row %}

You can pass your own handler if you do not want diagnostics printed to the console:

```js {% path="your-app/index.js" highlight="3-5" %}
const f = createFeaturevisor({
  logLevel: 'info',
  onDiagnostic: function (diagnostic) {
    // send to your observability system
  },
})
```

The `setLogLevel` method still works for changing the level at runtime.

Learn more in [Diagnostics](/docs/sdks/javascript/#diagnostics) section.

### Modules instead of hooks {% label="Breaking" labelType="error" %}

The `hooks` API has been replaced by the [modules](/docs/sdks/javascript/#modules) API. The `Hook` type is now `FeaturevisorModule`, `hooks` is now `modules`, and `addHook` is now `addModule`.

Your existing `before`, `after`, `bucketKey`, and `bucketValue` callbacks carry over unchanged. Modules also add an optional `setup` lifecycle and a `close` callback.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="1,4" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  hooks: [myCustomHook],
})

const removeHook = f.addHook(myCustomHook)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="1,4" %}
import { createFeaturevisor } from '@featurevisor/sdk'

const f = createFeaturevisor({
  modules: [myCustomModule],
})

const removeModule = f.addModule(myCustomModule)
f.removeModule('my-custom-module')
```

{% /column %}
{% /row %}

The old `interceptContext`, `configureBucketKey`, and `configureBucketValue` options, which were already replaced by hooks in v2, are now expressed as modules.

Learn more in [Modules](/docs/sdks/javascript/#modules) section.

---

## React and Vue SDK usage

The React and Vue packages now expect the renamed `createFeaturevisor` function and `Featurevisor` type, and you fetch the datafile yourself before creating the instance.

The Vue package no longer ships `useStatus` or `activateFeature`. To track exposure, register a [module](/docs/sdks/javascript/#modules) that reacts to evaluations in its `after` callback.

Learn more in [React SDK](/docs/react/) and [Vue.js SDK](/docs/vue/) pages.
