---
title: Vue.js SDK
nextjs:
  metadata:
    title: Vue.js SDK
    description: Learn how to use Featurevisor SDK with Vue.js for evaluating feature flags
    openGraph:
      title: Vue.js SDK
      description: Learn how to use Featurevisor SDK with Vue.js for evaluating feature flags
      images:
        - url: /img/og/docs-vue.png
---

Featurevisor comes with an additional package for Vue.js, for ease of integration in your Vue.js application for evaluating feature flags. {% .lead %}

## Installation

Install with npm:

```
$ npm install --save @featurevisor/vue
```

## Setting up the application

Use `setupApp` function to set up the SDK instance in your Vue application:

```js
import { createApp } from 'vue'
import { createFeaturevisor } from '@featurevisor/sdk'
import { setupApp } from '@featurevisor/vue'

const datafileUrl = 'https://cdn.yoursite.com/datafile.json'
const datafile = await fetch(datafileUrl).then((res) => res.json())

const f = createFeaturevisor({
  datafile,
})

const app = createApp({
  /* root component options */
})

setupApp(app, f)
```

This will set up the SDK instance in your Vue application, and make it available in all components later.

## Functions

The package comes with several functions to use in your components:

### useFlag

Check if feature is enabled or not:

```html
<script setup>
  import { useFlag } from '@featurevisor/vue'

  const featureKey = 'myFeatureKey'
  const context = { userId: '123' }

  const isEnabled = useFlag(featureKey, context)
</script>

<template>
  <div v-if="isEnabled">Feature is enabled</div>
  <div v-else>Feature is disabled</div>
</template>
```

### useVariation

Get a feature's evaluated variation:

```html
<script setup>
  import { useVariation } from '@featurevisor/vue'

  const featureKey = 'myFeatureKey'
  const context = { userId: '123' }

  const variation = useVariation(featureKey, context)
</script>

<template>
  <div v-if="variation === 'b'">B variation</div>
  <div v-else-if="variation === 'c'">C variation</div>
  <div v-else>Default experience</div>
</template>
```

### useVariable

Get a feature's evaluated variable value:

```html
<script setup>
  import { useVariable } from '@featurevisor/vue'

  const featureKey = 'myFeatureKey'
  const variableKey = 'color'
  const context = { userId: '123' }

  const color = useVariable(featureKey, variableKey, context)
</script>

<template>
  <div>Color: {{ color }}</div>
</template>
```

### useSdk

Get the SDK instance:

```html
<script setup>
  import { useSdk } from '@featurevisor/vue'

  const f = useSdk()
</script>

<template>
  <div>...</div>
</template>
```

## Tracking

To track when a feature is exposed to a user, register a [module](/docs/sdks/javascript/#modules) on the SDK instance and react to evaluations in its `after` callback. See the [Google Analytics tracking](/docs/tracking/google-analytics/) guide for an example.

## Optimization

Given the nature of components in Vue.js, they can re-render many times.

You are advised to minimize the number of calls to Featurevisor SDK in your components by using memoization techniques.

## Example repository

You can find a fully functional example of a Vue.js application using Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-vue](https://github.com/featurevisor/featurevisor-example-vue).

{% callout type="note" title="Help wanted with tests" %}
We are looking for help with writing tests for this package. If you are interested, please take a look [here](https://github.com/featurevisor/featurevisor/tree/main/packages/vue).
{% /callout %}
