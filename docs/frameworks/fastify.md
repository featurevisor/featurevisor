---
title: Fastify
description: Learn how to integrate Featurevisor in Fastify applications for evaluating feature flags
ogImage: /img/og/docs-frameworks-fastify.png
---

Set up Featurevisor SDK instance in a Fastify application using a custom decorator, including TypeScript integration for evaluating feature flags. {% .lead %}

## Hello World application

Before going into Featurevisor integration, let's create a simple Hello World [Fastify](https://www.fastify.io/) application.

We start by installing the package:

```
$ npm install --save fastify
```

```js
// index.js
const fastify = require("fastify")({ logger: true });

const PORT = 3000;

fastify.get("/", async (request, reply) => {
  return "Hello World!";
});

fastify.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
```

We can start the server with this command:

```
$ node index.js
Example app listening on port 3000
```

## Featurevisor integration

We install the Featurevisor SDK first:

```
$ npm install --save @featurevisor/sdk
```

We can now create an instance of the SDK and use it in our application:

```js
// Require the fastify framework and instantiate it
const fastify = require('fastify')({
    logger: true
})

// Featurevisor SDK
const { createInstance } = require("@featurevisor/sdk");
const DATAFILE_URL = "https://featurevisor-example-cloudflare.pages.dev/production/datafile-tag-all.json"; // replace with yoursite cdn
const REFRESH_INTERVAL = 60 * 5; // every 5 minutes

const f = createInstance({
    datafileUrl: DATAFILE_URL,

    // optionally refresh the datafile every 5 minutes,
    // without having to restart the server
    refreshInterval: REFRESH_INTERVAL,
});

// Declare a route
fastify.get('/', async (request, reply) => {
    const featureKey = "my_feature";
    const context = { userId: "123", country: "nl" };

    const isEnabled = f.isEnabled(featureKey, context);

    if (isEnabled) {
        reply.send("Hello World!");
    } else {
        reply.send("Not enabled yet!");
    }
})

// Run the server!
const start = async () => {
    fastify.listen({ port: 3000 }, function (err, address) {
        if (err) {
            fastify.log.error(err)
            process.exit(1)
        }
        fastify.log.info(`server listening on ${fastify.server.address().port}`)
    })
}
start()
```

## Decorator

If is very unlikely that we will have all our routes defined in the same index.js file, making it difficult for us to use the same Featurevisor SDK instance in all of them.

To solve this problem, we can create a custom decorator that will set the Featurevisor SDK instance to the request object, so that we can use the same instance in all our routes throughout the lifecycle of this application.

```js
// index.js

// ...

fastify.decorateRequest('f', f);

// ...
```

Now from anywhere in our application (either in index.js or some other module), we can access the Featurevisor SDK instance via request.f:

```js
fastify.get("/my-route", async (request, reply) => {
    const featureKey = "my_feature";
    const context = { userId: "123", country: "nl" };

    const isEnabled = f.isEnabled(featureKey, context);

  if (isEnabled) {
    return "Hello World!";
  } else {
    return "Not enabled yet!";
  }
});
```

## TypeScript usage

If you are using TypeScript, you can extend the `Request` interface to add the `f` property for Featurevisor SDK's instance.

Create a new `custom.d.ts` file and make sure to add it in `tsconfig.json`'s `files` section:

```ts
import { FeaturevisorInstance } from "@featurevisor/sdk";
import { FastifyInstance } from "fastify";

declare module 'fastify' {
  interface FastifyInstance {
    f: FeaturevisorInstance;
  }
}
```

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-fastify](https://github.com/featurevisor/featurevisor-example-fastify).
