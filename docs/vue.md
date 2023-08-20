---
title: Vue.js SDK
description: Learn how to use Featurevisor SDK with Vue.js
ogImage: /img/og/docs-vue.png
---

Featurevisor comes with an additional package for Vue.js, for ease of integration in your Vue.js application. {% .lead %}

## Installation

Install with npm:

```
$ npm install --save @featurevisor/vue
```

## Setting up the application

Use `setupApp` function to set up the SDK instance in your Vue application:

```js
import { createApp } from "vue";
import { createInstance } from "@featurevisor/sdk";
import { setupApp } from "@featurevisor/vue";

const f = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json"
});

const app = createApp({
  /* root component options */
});

setupApp(app, f);
```

This will set up the SDK instance in your Vue application, and make it available in all components later.

## Functions

The package comes with several functions to use in your components:

### useStatus

Know if the SDK is ready to be used:

```html
<script setup>
import { useStatus } from "@featurevisor/vue";

const status = useStatus();
</script>

<template>
  <div v-if="status.isReady">
    SDK is ready
  </div>
  <div v-else>
    Loading...
  </div>
</template>
```

### useFlag

Check if feature is enabled or not:

```html
<script setup>
import { useFlag } from "@featurevisor/vue";

const featureKey = "myFeatureKey";
const context = { userId: "123" };

const isEnabled = useFlag(featureKey, context);
</script>

<template>
  <div v-if="isEnabled">
    Feature is enabled
  </div>
  <div v-else>
    Feature is disabled
  </div>
</template>
```

### useVariation

Get a feature's evaluated variation:

```html
<script setup>
import { useVariation } from "@featurevisor/vue";

const featureKey = "myFeatureKey";
const context = { userId: "123" };

const variation = useVariation(featureKey, context);
</script>

<template>
  <div v-if="variation === 'b'">
    B variation
  </div>
  <div v-else-if="variation === 'c'">
    C variation
  </div>
  <div v-else>
    Default experience
  </div>
</template>
```

### useVariable

Get a feature's evaluated variable value:

```html
<script setup>
import { useVariable } from "@featurevisor/vue";

const featureKey = "myFeatureKey";
const variableKey = "color";
const context = { userId: "123" };

const color = useVariable(featureKey, variableKey, context);
</script>

<template>
  <div>
    Color: {{ color }}
  </div>
</template>
```

### activateFeature

Same as `useVariation`, but it will also bubble an activation event up to the SDK for tracking purposes.

This should ideally be only called once per feature, and only when we know the feature has been exposed to the user.

### useSdk

Get the SDK instance:

```html
<script setup>
import { useSdk } from "@featurevisor/vue";

const f = useSdk();
</script>

<template>
  <div>...</div>
</template>
```

## Optimization

Given the nature of components in Vue.js, they can re-render many times.

You are advised to minimize the number of calls to Featurevisor SDK in your components by using memoization techniques.

## Example repository

You can find a fully functional example of a Vue.js application using Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-vue](https://github.com/featurevisor/featurevisor-example-vue).

{% callout type="note" title="Help wanted with tests" %}
We are looking for help with writing tests for this package. If you are interested, please take a look [here](https://github.com/fahad19/featurevisor/tree/main/packages/vue).
{% /callout %}
