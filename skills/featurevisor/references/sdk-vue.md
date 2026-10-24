# Vue

Full docs: <https://featurevisor.com/docs/vue/>

`@featurevisor/vue` wraps the [JavaScript SDK](sdk-javascript.md) for Vue 3. Instance creation, context, datafile refresh and events work as described there.

```bash
npm install --save @featurevisor/sdk @featurevisor/vue
```

## Set up

```js
import { createApp } from 'vue'
import { createFeaturevisor } from '@featurevisor/sdk'
import { setupApp } from '@featurevisor/vue'
import App from './App.vue'

const response = await fetch('https://cdn.example.com/featurevisor-all.json')
if (!response.ok) throw new Error(`HTTP ${response.status}`)

const f = createFeaturevisor({
  datafile: await response.json(),
  context: {
    userId: '8f2a',
    country: 'nl',
  },
})

const app = createApp(App)
setupApp(app, f)
app.mount('#app')
```

## Read values

```html
<script setup>
  import { useFlag, useVariation, useVariable, useSdk } from '@featurevisor/vue'

  const newCheckout = useFlag('checkout')
  const variation = useVariation('pricing')
  const label = useVariable('buyButton', 'label')
  const supportEmail = useVariable('supportEmail') // global variable

  const f = useSdk() // the instance, for setContext and events

  if (newCheckout.value) {
    // script code reads .value
  }
</script>

<template>
  <NewCheckout v-if="newCheckout" :label="label" />
  <Checkout v-else />
</template>
```

Several features at once, and the datafile revision:

```html
<script setup>
  import {
    useFlags,
    useEveryFlag,
    useSomeFlag,
    useRevision,
  } from '@featurevisor/vue'

  const [checkout, liveChat] = useFlags(['checkout', 'liveChat'])
  const savedForCheckout = useEveryFlag(['checkout', 'wishlist'])
  const showHelp = useSomeFlag(['liveChat', 'wishlist'])
  const revision = useRevision()
</script>
```

These behave like their React counterparts in [sdk-react.md](sdk-react.md#several-features-at-once): a value per key in order, a repeated key evaluated once, and aggregates that stop early so modules do not see the rest. `useFlags` returns one ref per key, so it destructures, and reads its keys once. For a snapshot of several features, call `getFeatureEvaluations` on `useSdk()`, as [sdk-react.md](sdk-react.md#revision) describes.

**Every composable returns a readonly ref.** Templates use it directly, because Vue unwraps refs there, but script code must read `.value`: `if (newCheckout)` is always true. Call composables in `setup`, never inside a computed or a render function. A ref updates, like a React hook re-renders, when a datafile changes its key or anything its conditions depend on, when the instance context or sticky values change, and when a ref or prop its context reads changes. An unrelated datafile update causes no work. `useRevision` updates only on a new revision.

Every composable that reads a feature or variable takes an optional context as its last argument: an object, a ref, or a getter such as `() => ({ plan: props.plan })` to follow props. Refs evaluate when first read and again only after a change, subscribe when the component mounts and unsubscribe when it unmounts. Server rendering evaluates without subscribing, so a shared server instance does not collect listeners.

Context for part of the tree comes from a scope, as a component or a function in `setup`:

```html
<FeaturevisorScope :context="{ plan: account.plan }">
  <AccountRow :account="account" />
</FeaturevisorScope>
```

```js
// in setup: applies to descendants, not to this component's own composables
provideFeaturevisorScope(() => ({ plan: props.plan }))
```

Each read merges, lowest first: the instance context, each enclosing scope from the outermost, and the composable's own context argument. The merge is shallow and scopes nest, whether made by the component or the function: an inner scope keeps the keys it sets when the outer one changes them and follows it for the rest, and sibling scopes stay apart. The `context` prop, refs and getters are followed. Instance context changes and sticky values still apply inside a scope. As in React, keep `userId` out of a scope unless that part is about another user, and expect tracking modules to see previews of other plans. `FeaturevisorScope` and `provideFeaturevisorScope` need a `@featurevisor/vue` release that exports them.

`useVariation` and `useVariable` hold `null` when there is no value. `useSdk` throws when `setupApp` has not run: that error means missing wiring, not a missing feature.

## Guidance

- Record exposure with a [module](sdk-javascript.md#modules) on the instance ([tracking.md](tracking.md)), not in components.
- For server rendering with Nuxt, see the [Nuxt guide](https://featurevisor.com/docs/frameworks/nuxt/) and [SSR handoff](sdk-javascript.md#ssr-handoff).
- Check the installed `@featurevisor/vue` before writing code. If its type definitions show `useFlag` returning `boolean` rather than a ref, it predates reactive composables: values are plain and do not update, there is no `.value`, and `useFlags`, `useEveryFlag`, `useSomeFlag` and `useRevision` may be missing. Write for that version, or propose upgrading, which means adding `.value` wherever script code reads a composable and removing any hand written live wrappers.
- Example app: <https://github.com/featurevisor/featurevisor-example-vue>
