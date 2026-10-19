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
</script>

<template>
  <NewCheckout v-if="newCheckout" :label="label" />
  <Checkout v-else />
</template>
```

Each function takes an optional context as its last argument. **They return plain values at the moment they are called, not refs**, so they do not update when the datafile, context or sticky values change. A feature switched off stays visible in an open page until its component is created again. For components that must follow those changes, wrap a read in a `ref` and update it from the instance's `datafile_set`, `context_set` and `sticky_features_set` events, unsubscribing in `onUnmounted`. The docs show a complete `useLiveFlag`.

`useVariation` and `useVariable` return `null` when there is no value. `useSdk` throws when `setupApp` has not run: that error means missing wiring, not a missing feature.

## Guidance

- Record exposure with a [module](sdk-javascript.md#modules) on the instance ([tracking.md](tracking.md)), not in components.
- For server rendering with Nuxt, see the [Nuxt guide](https://featurevisor.com/docs/frameworks/nuxt/) and [SSR handoff](sdk-javascript.md#ssr-handoff).
- Example app: <https://github.com/featurevisor/featurevisor-example-vue>
