---
title: SDKs
description: Learn how to use Featurevisor SDKs
---

At the moment, we have an SDK for JavaScript only covering Node.js and browser environments. More languages are planned for the future as Featurevisor nears a stable release. {% .lead %}

SDKs are meant to be used in your own applications, where you want to evaluate features.

## Installation

Install with npm:

```
$ npm install --save @featurevisor/sdk
```

## Initialization

The SDK can be initialized in two different ways depending on your needs.

### Synchronous

If you already have the content of your datafile available:

```js
import { createInstance } from "@featurevisor/sdk";

const datafileURL =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const datafileContent = await fetch(datafileURL).then((res) => res.json());

const sdk = createInstance({
  datafile: datafileContent
});
```

### Asynchronous

If you want to delegate the responsibility of fetching the datafile to the SDK:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileURL =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const sdk = createInstance({
  datafileUrl: datafileUrl,
  onReady: function () {
    // datafile has been fetched successfully,
    // and you can start using the SDK
  }
});
```

If you need to take further control on how the datafile is fetched, you can pass a custom `handleDatafileFetch` function:

```js
const sdk = createInstance({
  datafileUrl: datafileUrl,
  onReady: function () {
    console.log("sdk is ready");
  },
  handleDatafileFetch: function (url) {
    // you can pass custom headers here, etc
    // or even use XMLHttpRequest instead of fetch,
    // as long as it returns a promise with datafile content
    return fetch(url).then((res) => res.json());
  },
});
```

## Getting variations

Once the SDK is initialized, you can get variations of your features as follows:

```js
const featureKey = "my_feature";

const attributes = {
  userId: "123",
  country: "nl",
};

const variation = sdk.getVariation(featureKey, attributes);
```

## Getting variables

```js
const variableKey = "bgColor";

const bgColorValue = sdk.getVariable(featureKey, variableKey, attributes);
```

## Activation

Activation is useful when you want to track what features and their variations are exposed to your users.

It works the same as `sdk.getVariation()` method, but it will also bubble an event up that you can listen to.

```js
const sdk = createInstance({
  datafile: datafileContent,

  // handler for activations
  onActivation: function (
    featureKey,
    variationValue,
    allAttributes,
    capturedAttributes
  ) {
    // allAttributes (object):
    //   - all the attributes used for evaluating

    // capturedAttributes (object):
    //   - attributes that you want to capture,
    //   - marked as `capture: true` in Attribute YAMLs
  }
});

const variation = sdk.activate(featureKey, attributes)
```

From the `onActivation` handler, you can send the activation event to your analytics service.

## Type specific methods

Next to generic `getVariation()`, `activate`, and `getVariable()` methods, there are also type specific methods for each of them:

### `boolean`

```js
sdk.getVariationBoolean(featureKey, attributes);
sdk.activateBoolean(featureKey, attributes);
sdk.getVariableBoolean(featureKey, variableKey, attributes);
```

### `string`

```js
sdk.getVariationString(featureKey, attributes);
sdk.activateString(featureKey, attributes);
sdk.getVariableString(featureKey, variableKey, attributes);
```

### `integer`

```js
sdk.getVariationInteger(featureKey, attributes);
sdk.activateInteger(featureKey, attributes);
sdk.getVariableInteger(featureKey, variableKey, attributes);
```

### `double`

```js
sdk.getVariationDouble(featureKey, attributes);
sdk.activateDouble(featureKey, attributes);
sdk.getVariableDouble(featureKey, variableKey, attributes);
```

### `array`

```js
sdk.getVariableArray(featureKey, variableKey, attributes);
```

### `object`

```ts
sdk.getVariableObject<T>(featureKey, variableKey, attributes);
```

### `json`

```ts
sdk.getVariableJSON<T>(featureKey, variableKey, attributes);
```

## Logging

By default, Featurevisor SDKs will print out logs to the console for `warn` and `error` levels.

### Levels

You can customize it further:

```js
import { createInstance, createLogger } from "@featurevisor/sdk";

const sdk = createInstance({
  // ...
  logger: createLogger({
    levels: [
      "error",
      "warn",
      "info",
      "debug"
    ]
  })
});
```

### Handler

You can also pass your own log handler, if you do not wish to print the logs to the console:

```js
const sdk = createInstance({
  // ...
  logger: createLogger({
    levels: ["error", "warn", "info", "debug"],
    handler: function (level, message, details) {
      // do something with the log
    }
  })
});
```

Further log levels like `info` and `debug` will help you understand how the feature variations and variables are evaluated in the runtime against given attributes.

## Intercepting attributes

You can intercept attributes before they are used for evaluation:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  // ...
  interceptAttributes: function (attributes) {
    // return updated attributes
    return attributes;
  }
});
```

This is useful when you wish to add a default set of attributes for all your evaluations, giving you the convenience of not having to pass them in every time.
