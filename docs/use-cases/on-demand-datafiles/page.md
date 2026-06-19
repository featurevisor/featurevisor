---
title: Loading datafiles on demand
nextjs:
  metadata:
    title: Loading datafiles on demand
    description: Combine targets and merge-by-default setDatafile to load smaller datafiles as your application needs them.
    openGraph:
      title: Loading datafiles on demand
      description: Combine targets and merge-by-default setDatafile to load smaller datafiles as your application needs them.
      images:
        - url: /img/og/docs.png
---

Instead of downloading every feature upfront, you can load smaller datafiles as your application needs them, by pairing [targets](/docs/targets/) with the merge behavior of [setDatafile](/docs/sdks/javascript/#setting-datafile). {% .lead %}

## The problem with loading everything

A large application can have hundreds of features. If every page loads one big datafile containing all of them, the user pays for features they may never reach. The cost shows up as:

- a larger download on the first page load
- more memory held in the runtime
- more work parsing and keeping the datafile around

Most of the time, any given page only needs a small slice of the features.

## Two building blocks

This use case combines two parts of Featurevisor.

### Targets produce smaller datafiles

A [target](/docs/targets/) defines a datafile that Featurevisor builds. By [tagging](/docs/tags/) features per part of your application, and defining a target per part, you get one smaller datafile per part instead of one large datafile for everything.

```yml {% path="targets/products.yml" %}
description: Products area
tag: products
```

```yml {% path="targets/checkout.yml" %}
description: Checkout area
tag: checkout
```

When you [build](/docs/building-datafiles/), each target produces its own datafile:

```{% title="Output" %}
datafiles/production/featurevisor-products.json
datafiles/production/featurevisor-checkout.json
```

### setDatafile merges by default

When you call [setDatafile](/docs/sdks/javascript/#setting-datafile), the SDK merges the incoming datafile with what it already has:

- incoming features and segments override matching keys
- existing features and segments that are missing from the incoming datafile are kept

This means a single SDK instance can load more than one datafile over time, and accumulate their features together.

## Putting it together

Create one shared SDK instance for the whole application, without any datafile at first:

```js {% path="your-app/featurevisor.js" %}
import { createFeaturevisor } from '@featurevisor/sdk'

export const f = createFeaturevisor({})

const loadedTargets = new Set()

export async function loadTarget(target) {
  // avoid fetching the same datafile twice
  if (loadedTargets.has(target)) {
    return
  }

  const url = `https://cdn.yoursite.com/production/featurevisor-${target}.json`
  const datafile = await fetch(url).then((res) => res.json())

  f.setDatafile(datafile) // merges into whatever was loaded before
  loadedTargets.add(target)
}
```

Load only what the current page needs:

```js {% path="your-app/index.js" %}
import { f, loadTarget } from './featurevisor'

// on the products page
await loadTarget('products')

const showBanner = f.isEnabled('showMarketingBanner', { deviceId: '...' })
```

Later, as the user navigates to another part of the application, load its datafile too. The features loaded earlier stay available:

```js {% path="your-app/checkout.js" %}
import { f, loadTarget } from './featurevisor'

// when the user reaches checkout
await loadTarget('checkout')

// both products and checkout features are now available on the same instance
const useNewCheckout = f.isEnabled('newCheckout', { userId: '...' })
```

## Reacting to newly loaded features

Each `setDatafile` call emits a [`datafile_set`](/docs/sdks/javascript/#datafile-set) event that includes the list of affected features. You can use it to re-evaluate and re-render the relevant part of your UI once a new datafile has been merged:

```js
f.on('datafile_set', function ({ features }) {
  // `features` lists the keys that were added, updated, or removed
  // re-render the parts of the UI that depend on them
})
```

## Things to keep in mind

- Each target datafile is self-contained: it carries the features it needs along with the [segments](/docs/segments/) those features reference. Merging accumulates both.
- If a feature is tagged for more than one target, it appears in each of those datafiles. Merging the same feature again is harmless, as the incoming copy simply overrides the matching key.
- After a merge, the instance's revision reflects the revision of the most recently loaded datafile, not a combined value.

## Where this helps

- [Microfrontends](/docs/use-cases/microfrontends/): each microfrontend loads its own datafile as the user navigates to it
- Large single-page applications split by route or section
- Any application where the features needed are only known once the user reaches a particular area
