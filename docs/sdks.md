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

const datafileUrl =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const datafileContent = await fetch(datafileUrl).then((res) => res.json());

const sdk = createInstance({
  datafile: datafileContent
});
```

### Asynchronous

If you want to delegate the responsibility of fetching the datafile to the SDK:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileUrl =
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

## Stickiness

Featurevisor relies on consistent bucketing making sure the same user always sees the same variation in a deterministic way. You can learn more about it in [Bucketing](/docs/bucketing) section.

But there are times when your targeting conditions (segments) can change and this may lead to some users being re-bucketed into a different variation. This is where stickiness becomes important.

If you have already identified your user in your application, and know what features should be exposed to them, you can initialize the SDK with a set of sticky features:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: "...",

  stickyFeatures: {
    myFeatureKey: {
      variation: true,

      // optional variables
      variables: {
        myVariableKey: "myVariableValue",
      }
    },
    anotherFeatureKey: {
      variation: false,
    }
  },
});
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

You can also set sticky features after the SDK is initialized:

```js
sdk.setStickyFeatures({
  myFeatureKey: {
    variation: true,
    variables: {},
  },
  anotherFeatureKey: {
    variation: false,
  }
});
```

This will be handy when you want to:

- update sticky features in the SDK without re-initializing it (or restarting the app), and
- handle evaluation of features for multiple users from the same instance of the SDK (e.g. in a server dealing with incoming requests from multiple users)

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

You can also set log levels from instance afterwards:

```js
sdk.setLogLevels(["error", "warn"]);
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

## Refreshing datafile

Refreshing the datafile is useful when you want to update the datafile in runtime, for example when you want to update the feature variations and variables without having to restart your application.

It is only possible to refresh datafile in Featurevisor if you are using the `datafileUrl` option when creating your SDK instance.

### Manual refresh

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: datafileUrl,
});

sdk.refresh();
```

### Refresh by interval

If you want to refresh your datafile every X number of seconds, you can pass the `refreshInterval` option when creating your SDK instance:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: datafileUrl,
  refreshInterval: 30, // 30 seconds
});
```

You can stop the interval by calling:

```js
sdk.stopRefreshing();
```

If you want to resume refreshing:

```js
sdk.startRefreshing();
```

### Listening for updates

Every successful refresh will trigger the `onRefresh()` option:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: datafileUrl,
  onRefresh: function () {
    // datafile has been refreshed successfully
  }
});
```

Not every refresh is going to be of a new datafile version. If you want to know if datafile content has changed in any particular refresh, you can listen to `onUpdate` option:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: datafileUrl,
  onUpdate: function () {
    // datafile has been refreshed, and
    // new datafile content is different from the previous one
  }
});
```

## Events

Featurevisor SDK implements a simple event emitter that allows you can use to listen to events that happen in the runtime.

### Listening to events

You can listen to these events that can occur at various stages in your application:

#### `ready`

When the SDK is ready to be used if used in an asynchronous way involving `datafileUrl` option:

```js
sdk.on("ready", function () {
  // sdk is ready to be used
});
```

The `ready` event is fired maximum once.

You can also synchronously check if the SDK is ready:

```js
if (sdk.isReady()) {
  // sdk is ready to be used
}
```

#### `activation`

When a feature is activated:

```js
sdk.on("activation", function (
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
});
```

#### `refresh`

When the datafile is refreshed:

```js
sdk.on("refresh", function () {
  // datafile has been refreshed successfully
});
```

This will only occur if you are using `refreshInterval` option.

#### `update`

When the datafile is refreshed, and new datafile content is different from the previous one:

```js
sdk.on("update", function () {
  // datafile has been refreshed, and
  // new datafile content is different from the previous one
});
```

This will only occur if you are using `refreshInterval` option.

### Stop listening

You can stop listening to specific events by calling `off()` or `removeListener()`:

```js
const onReadyHandler = function () {
  // ...
};

sdk.on("ready", onReadyHandler);

sdk.removeListener("ready", onReadyHandler);
```

### Remove all listeners

If you wish to remove all listeners of any specific event type:

```js
sdk.removeAllListeners("ready");
sdk.removeAllListeners("activation");
```

If you wish to remove all active listeners of all event types in one go:

```js
sdk.removeAllListeners();
```
