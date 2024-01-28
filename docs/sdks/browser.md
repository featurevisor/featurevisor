---
title: Browser SDK
description: Learn how to use Featurevisor SDK in browser environments
ogImage: /img/og/docs-sdks-browser.png
---

You can use the same Featurevisor [JavaScript SDK](/docs/sdks/javascript) in browser environments as well. {% .lead %}

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

If you need to support older browsers, you can use [`whatwg-fetch`](https://www.npmjs.com/package/whatwg-fetch).

You can install it with npm:

```
$ npm install --save whatwg-fetch
```

And then import or `require()` it in your code:

```js
import "whatwg-fetch";
```

### TextEncoder

Featurevisor SDK uses `TextEncoder` API for encoding strings.

if you need to support very old browsers, you can consider using [`fastestsmallesttextencoderdecoder`](https://www.npmjs.com/package/fastestsmallesttextencoderdecoder).

You can install it with npm:

```
$ npm install --save fastestsmallesttextencoderdecoder
```

And then import or `require()` it in your code:

```js
import "fastestsmallesttextencoderdecoder";
```
