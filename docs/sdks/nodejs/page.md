---
title: Node.js SDK
nextjs:
  metadata:
    title: Node.js SDK
    description: Learn how to use Featurevisor SDK in Node.js
    openGraph:
      title: Node.js SDK
      description: Learn how to use Featurevisor SDK in Node.js
      images:
        - url: /img/og/docs-sdks-nodejs.png
---

You can use the same Featurevisor [JavaScript SDK](/docs/sdks/javascript) in Node.js as well. {% .lead %}

## Installation

Install with npm:

```
$ npm install --save @featurevisor/sdk
```

## API

Please find the full API docs in [JavaScript SDK](/docs/sdks/javascript) page.

## Consuming the SDK

### Require

If you are not dealing with ES Modules in Node.js, you can use `require()` as usual:

```js
const { createInstance } = require('@featurevisor/sdk')
```

### Import

If you want to take advantage of ES Modules, you can import the SDK directly:

```js
import { createInstance } from '@featurevisor/sdk'
```

## Example repository

You can refer to this repository that shows a fully working Node.js application using Featurevisor SDK: [https://github.com/featurevisor/featurevisor-example-nodejs](https://github.com/featurevisor/featurevisor-example-nodejs),
