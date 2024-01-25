---
title: Astro
description: Learn how to integrate Featurevisor in Astro applications for evaluating feature flags
ogImage: /img/og/docs-frameworks-astro.png
---

Set up Featurevisor SDK in Astro applications for evaluating feature flags in your pages and components. {% .lead %}

## What is Astro?

[Astro](https://astro.build/) is a website build tool with a server-first API design for the modern web. It's UI library agnostic, allowing you to choose React, Preact, Svelte, Vue, or just plain HTML (with JSX flavour) as your rendering layer.

## Creating an Astro project

Use `npm` to scaffold a new project:

```
$ npm create astro@latest
```

## Installing Featurevisor SDK

Install the Featurevisor SDK using npm:

```
$ npm install --save @featurevisor/sdk
```

It is recommended to be familiar with the SDK API before reading this guide further. You can find full API documentation [here](/docs/sdks).

## Setting up Featurevisor SDK

We would like to be able to set up the Featurevisor SDK instance once and reuse the same instance everywhere.

To achieve this, we will create new module:

```js
// src/featurevisor.mjs
import { createInstance } from "@featurevisor/sdk";

const DATAFILE_URL = "https://cdn.yoursite.com/datafile.json";

let instance;

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

Now that we have the SDK instance in place, we can use it anywhere in our application.

{% callout type="note" title="Featurevisor's build & deployment" %}
To understand how the datafiles are generated and deployed, please refer to these guides:

- [Building datafiles](/docs/building-datafiles)
- [Deployment](/docs/deployment)
{% /callout %}

We created a very simple instance of the SDK, but we can also configure it further for fetching latest datafile without restarting our server:

- periodically (see [refreshing datafile](/docs/sdks/javascript/#refreshing-datafile))
- as soon as they happen (see [websockets guide](/docs/integrations/partykit))

## Accessing SDK in components

From any component file, we can import the `getInstance` function and use it to access the SDK instance:

```js
// src/pages/index.astro

---
import { getInstance } from '../featurevisor.mjs';

const f = await getInstance();

const featureKey = "my_feature";
const context = { userId: "123", country: "nl" };

const isEnabled = f.isEnabled(featureKey, context);
---

<p>
  Feature {featureKey} is
  {isEnabled
    ? 'enabled'
    : 'disabled'
  }.
</p>
```

With just a few lines of code, we can now evaluate feature flags in our Astro components.

## Regular client-side usage

If your use case is not server-side rendering or at build time, you can use the SDK instance directly in your client-side code:

- [JavaScript SDK](/docs/sdks)
- [React SDK](/docs/react)
- [Vue.js SDK](/docs/vue)

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

If the evaluation of features are done in the server, you should make sure that the User's ID is passed to the server as well. If that's not an option, you are recommended to use a single value consistently.

See documentation about `bucketBy` property in feature definitions for further explanation [here](/docs/features/#bucketing).

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-astro](https://github.com/featurevisor/featurevisor-example-astro).
