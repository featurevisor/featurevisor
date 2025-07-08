---
title: Browser SDK
nextjs:
  metadata:
    title: Browser SDK
    description: Learn how to use Featurevisor SDK in browser environments
    openGraph:
      title: Browser SDK
      description: Learn how to use Featurevisor SDK in browser environments
      images:
        - url: /img/og/docs-sdks-browser.png
---

You can use the same Featurevisor [JavaScript SDK](/docs/sdks/javascript) in browser environments as well. {% .lead %}

## Installation

Install with npm:

```{% title="Command" %}
$ npm install --save @featurevisor/sdk
```

## API

Please find the full API docs in [JavaScript SDK](/docs/sdks/javascript) page.

## Polyfills

### TextEncoder

Featurevisor SDK uses `TextEncoder` API for encoding strings.

if you need to support very old browsers, you can consider using [`fastestsmallesttextencoderdecoder`](https://www.npmjs.com/package/fastestsmallesttextencoderdecoder).

You can install it with npm:

```{% title="Command" %}
$ npm install --save fastestsmallesttextencoderdecoder
```

And then import or `require()` it in your code:

```js {% path="your-app/index.js" %}
import 'fastestsmallesttextencoderdecoder'
```
