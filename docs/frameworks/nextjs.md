---
title: Next.js
description: Learn how to integrate Featurevisor in Next.js applications
ogImage: /img/og/docs-frameworks-nextjs.png
---

Set up Featurevisor SDK in a Next.js application for static site generation (SSG) and server-side rendering (SSR). {% .lead %}

## Rendering strategies

This guide is focused on static site generation (SSG) and server-side rendering (SSR) using Pages Router of [Next.js](https://nextjs.org/docs).

If you are looking for a client-side rendering (CSR) strategy, please refer to the [React.js](/docs/react) guide which comes with its own separate package for convenience.

## Creating a new Next.js app

Let's create a new Next.js app using the `create-next-app` CLI tool:

```
$ npx create-next-app@latest
```

## Installing SDK

Install the Featurevisor SDK using npm:

```
$ npm install --save @featurevisor/sdk
```

It is recommended to be familiar with the SDK API before reading this guide further. You can find full API documentation [here](/docs/sdks).

## Setting up Featurevisor SDK

We would like to be able to set up the Featurevisor SDK instance once and reuse the same instance everywhere.

To achieve this, we will create new module `featurevisor.js` in the root of the project:

```ts
// src/featurevisor.js
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

For further SDK usage documentation, please refer to the [JavaScript SDK](/docs/sdks) guide.

Now that we have the SDK instance in place, we can use it anywhere in our application.

## Static site generation (SSG)

If you are pre-rendering your pages at build time, you can use the `getStaticProps` function to gain access to the Featurevisor SDK instance and pass your evaluations to the page component.

```js
// src/pages/index.js
import { getInstance } from "../featurevisor";

export async function getStaticProps() {
  const featureKey = "my_feature";
  const context = { userId: "123" };

  // get access to the Featurevisor SDK instance
  const f = await getInstance();

  // evaluate your feature flag, variation, or their variables
  const isEnabled = f.isEnabled(featureKey, context);

  // pass your evaluation as regular props
  return {
    props: {
      isEnabled: isEnabled,
    },
  };
}

export default function Home(props) {
  return (
    <div>
      <h1>My page</h1>

      <p>Feature is {props.isEnabled ? "enabled" : "disabled"}!</p>
    </div>
  );
}
```

## Server-side rendering (SSR)

If you are rendering your pages on each request, you can use the `getServerSideProps` in a very similar way:

```js
// src/pages/index.js
import { getInstance } from "../featurevisor";

export async function getServerSideProps() {
  const featureKey = "my_feature";
  const context = { userId: "123" };

  // get access to the Featurevisor SDK instance
  const f = await getInstance();

  // evaluate your feature flag, variation, or their variables
  const isEnabled = f.isEnabled(featureKey, context);

  // pass your evaluation as regular props
  return {
    props: {
      isEnabled: isEnabled,
    },
  };
}

export default function Home(props) {
  return (
    <div>
      <h1>My page</h1>

      <p>Feature is {props.isEnabled ? "enabled" : "disabled"}!</p>
    </div>
  );
}
```

## Bucketing guidelines

If you are using Featurevisor for gradual rollouts or A/B testing, you should make sure that the bucketing is consistent across all rendering strategies.

Usually bucketing is done by passing the User's ID when the user is already known, or a randomly generated UUID for the device if the user is not known yet.

Since the `getStaticProps` and `getServerSideProps` functions are executed on the server, you should make sure that the User's ID is passed to the server as well. If that's not an option, you are recommended to use a single value consistently.

See documentation about `bucketBy` property in feature definitions for further explanation [here](/docs/features/#bucketing).

## App Router

We do not have documentation for Featurevisor SDK usage with Next.js App Router yet. If you are interested in contributing, please reach out to us on [GitHub](https://github.com/fahad19/featurevisor).

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-nextjs](https://github.com/featurevisor/featurevisor-example-nextjs).
