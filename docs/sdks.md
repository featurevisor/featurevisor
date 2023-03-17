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

Fetch your datafile and initialize the SDK:

```js
import { FeaturevisorSDK } from "@featurevisor/sdk";

const datafileURL =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const datafileContent = await fetch(datafileURL).then((res) => res.json());

const sdk = new FeaturevisorSDK({
  datafile: datafileContent
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
const sdk = new FeaturevisorSDK({
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
