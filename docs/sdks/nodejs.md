---
title: Node.js SDK
description: Learn how to use Featurevisor SDK in Node.js
ogImage: /img/og/docs-sdks-nodejs.png
---

You can use the same Featurevisor [JavaScript SDK](/docs/sdks/javascript) in Node.js as well. {% .lead %}

## Installation

Install with npm:

```
$ npm install --save @featurevisor/sdk
```

## API

Please find the full API docs in [JavaScript SDK](/docs/sdks/javascript) page.

## Polyfills

### fetch

Featurevisor JavaScript SDK relies on `fetch` API for fetching datafiles.

If your Node.js version does not support `fetch` globally, you can use [`isomorphic-fetch`](https://www.npmjs.com/package/isomorphic-fetch).

You can install it with npm:

```
$ npm install --save isomorphic-fetch
```

And then `require()` it in your code:

```js
require("isomorphic-fetch");
```

## Consuming the SDK

### Require

If you aren't using latest Node.js version or not dealing with ES Modules, you can use `require()`:

```js
const { createInstance } from "@featurevisor/sdk";
```

### Import

If you are using latest Node.js and either using `.mjs` files or have set `type: "module"` in your application's `package.json`, you can import the SDK directly:

```js
import FeaturevisorSDK from "@featurevisor/sdk";

const { createInstance } = FeaturevisorSDK;
```

## Example repository

You can refer to this repository that shows a fully working Node.js application using Featurevisor SDK: [https://github.com/featurevisor/featurevisor-example-nodejs](https://github.com/featurevisor/featurevisor-example-nodejs),
