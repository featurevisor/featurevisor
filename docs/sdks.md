---
title: SDKs
description: Learn how to use Featurevisor SDKs
---

SDKs are meant to be used in your own applications, where you want to evaluate features in the runtime. {% .lead %}

At the moment, we have an SDK for JavaScript only covering Node.js and browser environments. More languages are planned for the future as Featurevisor nears a stable release.

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

const f = createInstance({
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

const f = createInstance({
  datafileUrl: datafileUrl,

  onReady: function () {
    // datafile has been fetched successfully,
    // and you can start using the SDK
  }
});
```

If you need to take further control on how the datafile is fetched, you can pass a custom `handleDatafileFetch` function:

```js
const f = createInstance({
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

## Context

Contexts are a set of attribute values that we pass to SDK for evaluating features.

They are objects where keys are the attribute keys, and values are the attribute values.

```js
const context = {
  myAttributeKey: "myAttributeValue",
  anotherAttributeKey: "anotherAttributeValue",
};
```

## Checking if enabled

Once the SDK is initialized, you can check if a feature is enabled or not:

```js
const featureKey = "my_feature";
const context = {
  userId: "123",
  country: "nl",
};

const isEnabled = f.isEnabled(featureKey, context);
```

## Getting variations

If your feature has any variations defined, you can get evaluate them as follows:

```js
const featureKey = "my_feature";
const context = {
  userId: "123",
  country: "nl",
};

const variation = f.getVariation(featureKey, context);
```

## Getting variables

```js
const variableKey = "bgColor";

const bgColorValue = f.getVariable(featureKey, variableKey, context);
```

## Type specific methods

Next to generic `getVariable()` methods, there are also type specific methods available for convenience:

### `boolean`

```js
f.getVariableBoolean(featureKey, variableKey, context);
```

### `string`

```js
f.getVariableString(featureKey, variableKey, context);
```

### `integer`

```js
f.getVariableInteger(featureKey, variableKey, context);
```

### `double`

```js
f.getVariableDouble(featureKey, variableKey, context);
```

### `array`

```js
f.getVariableArray(featureKey, variableKey, context);
```

### `object`

```ts
f.getVariableObject<T>(featureKey, variableKey, context);
```

### `json`

```ts
f.getVariableJSON<T>(featureKey, variableKey, context);
```


## Activation

Activation is useful when you want to track what features and their variations are exposed to your users.

It works the same as `f.getVariation()` method, but it will also bubble an event up that you can listen to.

```js
const f = createInstance({
  datafile: datafileContent,

  // handler for activations
  onActivation: function (
    featureKey,
    variationValue,
    fullContext,
    captureContext
  ) {
    // fullContext (object):
    //   - all the attributes used for evaluating

    // captureContext (object):
    //   - attributes that you want to capture,
    //   - marked as `capture: true` in Attribute YAMLs
  }
});

const variation = f.activate(featureKey, context);
```

From the `onActivation` handler, you can send the activation event to your analytics service.

## Initial features

You may want to initialize your SDK with a set of features before SDK has successfully fetched the datafile (if using `datafileUrl` option).

This helps in cases when you fail to fetch the datafile, but you still wish your SDK instance to continue serving a set of sensible default values. And as soon as the datafile is fetched successfully, the SDK will start serving values from there.

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: "...",

  initialFeatures: {
    myFeatureKey: {
      enabled: true,

      // optional
      variation: "treatment",
      variables: {
        myVariableKey: "myVariableValue",
      }
    },
    anotherFeatureKey: {
      enabled: false,
    },
  },
});
```

## Stickiness

Featurevisor relies on consistent bucketing making sure the same user always sees the same variation in a deterministic way. You can learn more about it in [Bucketing](/docs/bucketing) section.

But there are times when your targeting conditions (segments) can change and this may lead to some users being re-bucketed into a different variation. This is where stickiness becomes important.

If you have already identified your user in your application, and know what features should be exposed to them in what variations, you can initialize the SDK with a set of sticky features:

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: "...",

  stickyFeatures: {
    myFeatureKey: {
      enabled: true,

      // optional
      variation: "treatment",
      variables: {
        myVariableKey: "myVariableValue",
      }
    },
    anotherFeatureKey: {
      enabled: false,
    }
  },
});
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

You can also set sticky features after the SDK is initialized:

```js
f.setStickyFeatures({
  myFeatureKey: {
    enabled: true,
    variation: "treatment",
    variables: {},
  },
  anotherFeatureKey: {
    enabled: false,
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

const f = createInstance({
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
f.setLogLevels(["error", "warn"]);
```

### Handler

You can also pass your own log handler, if you do not wish to print the logs to the console:

```js
const f = createInstance({
  // ...
  logger: createLogger({
    levels: ["error", "warn", "info", "debug"],
    handler: function (level, message, details) {
      // do something with the log
    }
  })
});
```

Further log levels like `info` and `debug` will help you understand how the feature variations and variables are evaluated in the runtime against given context.

## Intercepting context

You can intercept context before they are used for evaluation:

```js
import { createInstance } from "@featurevisor/sdk";

const defaultContext = {
  country: "nl",
};

const f = createInstance({
  // ...
  interceptContext: function (context) {
    // return updated context
    return {
      ...defaultContext,
      ...context,
    };
  }
});
```

This is useful when you wish to add a default set of attributes as context for all your evaluations, giving you the convenience of not having to pass them in every time.

## Refreshing datafile

Refreshing the datafile is convenient when you want to update the datafile in runtime, for example when you want to update the feature variations and variables config without having to restart your application.

It is only possible to refresh datafile in Featurevisor if you are using the `datafileUrl` option when creating your SDK instance.

### Manual refresh

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: datafileUrl,
});

f.refresh();
```

### Refresh by interval

If you want to refresh your datafile every X number of seconds, you can pass the `refreshInterval` option when creating your SDK instance:

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: datafileUrl,
  refreshInterval: 30, // 30 seconds
});
```

You can stop the interval by calling:

```js
f.stopRefreshing();
```

If you want to resume refreshing:

```js
f.startRefreshing();
```

### Listening for updates

Every successful refresh will trigger the `onRefresh()` option:

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: datafileUrl,
  onRefresh: function () {
    // datafile has been refreshed successfully
  }
});
```

Not every refresh is going to be of a new datafile version. If you want to know if datafile content has changed in any particular refresh, you can listen to `onUpdate` option:

```js
import { createInstance } from "@featurevisor/sdk";

const f = createInstance({
  datafileUrl: datafileUrl,
  onUpdate: function () {
    // datafile has been refreshed, and
    // new datafile content is different from the previous one
  }
});
```

## Events

Featurevisor SDK implements a simple event emitter that allows you to listen to events that happen in the runtime.

### Listening to events

You can listen to these events that can occur at various stages in your application:

#### `ready`

When the SDK is ready to be used if used in an asynchronous way involving `datafileUrl` option:

```js
f.on("ready", function () {
  // sdk is ready to be used
});
```

The `ready` event is fired maximum once.

You can also synchronously check if the SDK is ready:

```js
if (f.isReady()) {
  // sdk is ready to be used
}
```

#### `activation`

When a feature is activated:

```js
f.on("activation", function (
  featureKey,
  variationValue,
  fullContext,
  captureContext
) {
  // fullContext (object):
  //   - all the attributes used for evaluating

  // captureContext (object):
  //   - attributes that you want to capture,
  //   - marked as `capture: true` in Attribute YAMLs
});
```

#### `refresh`

When the datafile is refreshed:

```js
f.on("refresh", function () {
  // datafile has been refreshed successfully
});
```

This will only occur if you are using `refreshInterval` option.

#### `update`

When the datafile is refreshed, and new datafile content is different from the previous one:

```js
f.on("update", function () {
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

f.on("ready", onReadyHandler);

f.removeListener("ready", onReadyHandler);
```

### Remove all listeners

If you wish to remove all listeners of any specific event type:

```js
f.removeAllListeners("ready");
f.removeAllListeners("activation");
```

If you wish to remove all active listeners of all event types in one go:

```js
f.removeAllListeners();
```

## Evaluation details

Besides logging with debug level enabled, you can also get more details about how the feature variations and variables are evaluated in the runtime against given context:

```js
// flag
const evaluation = f.evaluateFlag(featureKey, context);

// variation
const evaluation = f.evaluateVariation(featureKey, context);

// variable
const evaluation = f.evaluateVariable(featureKey, variableKey, context);
```

The returned object will always contain the following properties:

- `featureKey`: the feature key
- `reason`: the reason how the value was evaluated

And optionally these properties depending on whether you are evaluating a feature variation or a variable:

- `bucketValue`: the bucket value between 0 and 100,000
- `ruleKey`: the rule key
- `error`: the error object
- `enabled`: if feature itself is enabled or not
- `variation`: the variation object
- `variationValue`: the variation value
- `variableKey`: the variable key
- `variableValue`: the variable value
- `variableSchema`: the variable schema
