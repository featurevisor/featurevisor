# Vue SDK

Full docs: <https://featurevisor.com/docs/vue>

`@featurevisor/vue` wraps the [JavaScript SDK](sdk-javascript.md) for Vue 3. Read sdk-javascript.md first for instance creation, context, datafile refresh, and events — this package only adds the Vue layer.

```bash
npm install --save @featurevisor/vue
```

## App setup

```js
import { createApp } from 'vue'
import { createFeaturevisor } from '@featurevisor/sdk'
import { setupApp } from '@featurevisor/vue'

const datafile = await fetch(datafileUrl).then((res) => res.json())
const f = createFeaturevisor({ datafile })

const app = createApp(App)
setupApp(app, f) // provides the instance to all components
app.mount('#app')
```

## Composables

```html
<script setup>
  import { useFlag, useVariation, useVariable, useSdk } from '@featurevisor/vue'

  const isEnabled = useFlag('checkout', { userId: '123' })
  const variation = useVariation('checkout', { userId: '123' })
  const methods = useVariable('checkout', 'paymentMethods', { userId: '123' })

  const f = useSdk() // full SDK instance for setContext, setSticky, events, …
</script>

<template>
  <NewCheckout v-if="isEnabled && variation === 'treatment'" :methods="methods" />
  <OldCheckout v-else />
</template>
```

The context argument is optional — omit it to evaluate against the instance-level context.

## Guidance

- For activation tracking, register a [module](sdk-javascript.md#modules) on the SDK instance ([tracking.md](tracking.md)) rather than tracking in components.
- Minimize SDK calls in hot render paths; memoize derived values.
- Example app: <https://github.com/featurevisor/featurevisor-example-vue>
