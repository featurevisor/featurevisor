---
title: Express.js
nextjs:
  metadata:
    title: Express.js
    description: Learn how to integrate Featurevisor in Express.js applications for evaluating feature flags
    openGraph:
      title: Express.js
      description: Learn how to integrate Featurevisor in Express.js applications for evaluating feature flags
      images:
        - url: /img/og/docs-frameworks-express.png
---

Set up Featurevisor SDK instance in an Express.js application using a custom middleware, including TypeScript integration for evaluating feature flags. {% .lead %}

## Hello World application

Before going into Featurevisor integration, let's create a simple Hello World [Express.js](https://expressjs.com/) application.

We start by installing the package:

```
$ npm install --save express
```

Then we create a file `index.js` with the following content:

```js
// index.js
const express = require('express')

const PORT = 3000

const app = express()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`)
})
```

We can start the server with this command:

```
$ node index.js
Example app listening on port 3000
```

## Featurevisor integration

We install the Featurevisor SDK now:

```
$ npm install --save @featurevisor/sdk
```

We can now create an instance of the SDK and use it in our application:

```js
// index.js
const express = require('express')
const { createInstance } = require('@featurevisor/sdk')

const PORT = 3000
const DATAFILE_URL = 'https://cdn.yoursite.com/datafile.json'

const app = express()

const f = createInstance({})

app.get('/', (req, res) => {
  const featureKey = 'myFeature'
  const context = { userId: 'user-123' }

  const isEnabled = f.isEnabled(featureKey, context)

  if (isEnabled) {
    res.send('Hello World!')
  } else {
    res.send('Not enabled yet!')
  }
})

fetch(DATAFILE_URL)
  .then((response) => response.json())
  .then((datafile) => {
    f.setDatafile(datafile)

    // we start the server only after the datafile is loaded
    app.listen(PORT, () => {
      console.log(`Example app listening on port ${PORT}`)
    })
  })
```

## Middleware

If is very unlikely that we will have all our routes defined in the same `index.js` file, making it difficult for us to use the same Featurevisor SDK instance in all of them.

To solve this problem, we can create a custom middleware that will set the Featurevisor SDK instance to the `req` object, so that we can use the same instance in all our routes throughout the lifecycle of this application.

```js
// index.js

// ...

const f = createInstance({})

app.use((req, res, next) => {
  req.f = f

  next()
})

// ...
```

Now from anywhere in our application (either in `index.js` or some other module), we can access the Featurevisor SDK instance via `req.f`:

```js
app.get('/my-route', (req, res) => {
  const { f } = req

  const featureKey = 'myFeature'
  const context = { userId: 'user-123' }

  const isEnabled = f.isEnabled(featureKey, context)

  if (isEnabled) {
    res.send('Hello World!')
  } else {
    res.send('Not enabled yet!')
  }
})
```

## TypeScript usage

If you are using TypeScript, you can extend the `Request` interface to add the `f` property for Featurevisor SDK's instance.

Create a new `custom.d.ts` file and make sure to add it in `tsconfig.json`'s `files` section:

```ts
import { FeaturevisorInstance } from '@featurevisor/sdk'

declare namespace Express {
  export interface Request {
    f: FeaturevisorInstance
  }
}
```

## Refreshing datafile

Because a server instance is meant to run for a long time, we might want to refresh the datafile periodically so that latest datafile is always used without needing to restart the server.

See more documentation in [JavaScript SDK page](/docs/sdks/javascript/#interval-based-update).

## Child instances

If you are in need of request specific context isolation, you may want to look into spawning child instances from the primary Featurevisor SDK [here](/docs/sdks/javascript/#child-instance).

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-expressjs](https://github.com/featurevisor/featurevisor-example-expressjs).
