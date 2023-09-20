---
title: Nuxt
description: Learn how to integrate Featurevisor in Nuxt applications
ogImage: /img/og/docs-frameworks-nuxt.png
---

Set up Featurevisor SDK in Nuxt applications for evaluating feature flags in Vue.js components. {% .lead %}

## Creating a Nuxt application

If you don't have a [Nuxt](https://nuxt.com/) application yet, you can create one using the following command:

```
$ npx nuxi@latest init my-app
```

## Installing SDK

Install the Featurevisor SDK using npm:

```
$ npm install --save @featurevisor/sdk
```

It is recommended to be familiar with the SDK API before reading this guide further. You can find full API documentation [here](/docs/sdks).

## Setting up Featurevisor SDK

We would like to be able to set up the Featurevisor SDK instance once and reuse the same instance everywhere.

To achieve this, we will create new module `featurevisor.ts` in the root of the project:

```ts
// ./featurevisor.ts
import { createInstance, FeaturevisorInstance } from "@featurevisor/sdk";

const DATAFILE_URL = "https://cdn.yoursite.com/datafile.json";

let instance: FeaturevisorInstance;

export async function getInstance() {
  if (instance) {
    return instance;
  }

  const f = createInstance({
    datafileUrl: DATAFILE_URL,
  });

  instance = await f.onReady();

  return instance;
}
```

To understand how the datafiles are generated and deployed, please refer to these guides:

- [Building datafiles](/docs/building-datafiles)
- [Deployment](/docs/deployment)

Now that we have the SDK instance in place, we can use it anywhere in our application.

## Accessing SDK in Vue.js components

From any Vue.js component file, we can import the `getInstance` function and use it to access the SDK instance:

```html
<!-- ./app.vue-->

<script setup lang="ts">
import { getInstance } from "./featurevisor";

const f = await getInstance();

const featureKey = "my_feature";
const context = {};

const isEnabled = f.isEnabled(featureKey, context);
</script>

<template>
  <div>
    <p v-if="isEnabled">Feature is enabled!</p>
    <p v-else>Feature is disabled :(</p>
  </div>
</template>
```

With just a few lines of code, we can now evaluate feature flags in our Vue.js components.

## Regular client-side usage

If you are using Vue.js components in a regular client-side rendered application, you can refer to our separate [Vue.js SDK](/docs/vue) for Featurevisor.

## Bucketing guidelines

If you are using Featurevisor for gradual rollouts or A/B testing, you should make sure that the [bucketing](/docs/bucketing) is consistent when rendering your components.

Usually bucketing is done by passing the User's ID when the user is already known, or a randomly generated UUID for the device if the user has not logged in yet.

When evaluating using the SDK instance, we would be passing these values as `context` object:

```ts
const context = {
  userId: "123",
  deviceId: "<UUID-here>",
};

const isEnabled = f.isEnabled(featureKey, context);
```

Since the evaluation of features are done in the server, you should make sure that the User's ID is passed to the server as well. If that's not an option, you are recommended to use a single value consistently.

See documentation about `bucketBy` property in feature definitions for further explanation [here](/docs/features/#bucketing).

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-nuxt](https://github.com/featurevisor/featurevisor-example-nuxt).
