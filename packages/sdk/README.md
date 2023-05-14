# @featurevisor/sdk <!-- omit in toc -->

Universal JavaScript SDK for both Node.js and the browser.

Visit [https://featurevisor.com/docs/sdks/](https://featurevisor.com/docs/sdks/) for more information.

- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
  - [`bucketKeySeparator`](#bucketkeyseparator)
  - [`configureBucketValue`](#configurebucketvalue)
  - [`datafile`](#datafile)
  - [`datafileUrl`](#datafileurl)
  - [`handleDatafileFetch`](#handledatafilefetch)
  - [`initialFeatures`](#initialfeatures)
  - [`interceptAttributes`](#interceptattributes)
  - [`logger`](#logger)
  - [`onActivation`](#onactivation)
  - [`onReady`](#onready)
  - [`onRefresh`](#onrefresh)
  - [`onUpdate`](#onupdate)
  - [`refreshInterval`](#refreshinterval)
  - [`stickyFeatures`](#stickyfeatures)
- [API](#api)
  - [`getVariation`](#getvariation)
  - [`getVariable`](#getvariable)
  - [`activate`](#activate)
  - [`isReady`](#isready)
  - [`refresh`](#refresh)
  - [`setLogLevels`](#setloglevels)
  - [`on`](#on)
  - [`addListener`](#addlistener)
  - [`off`](#off)
  - [`removeListener`](#removelistener)
  - [`removeAllListeners`](#removealllisteners)

## Installation

```
$ npm install --save @featurevisor/sdk
```

## Usage

Initialize the SDK:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance(options);
```

## Options

Options you can pass when creating Featurevisor SDK instance:

### `bucketKeySeparator`

- Type: `string`
- Required: no
- Defaults to: `.`

### `configureBucketValue`

- Type: `function`
- Required: no

Use it to take over bucketing process.

```js
const sdk = createInstance({
  configureBucketValue: (feature, attributes, bucketValue) => {
    return bucketValue; // 0 to 100,000
  }
});
```

### `datafile`

- Type: `object`
- Required: either `datafile` or `datafileUrl` is required

Use it to pass the datafile object directly.

### `datafileUrl`

- Type: `string`
- Required: either `datafile` or `datafileUrl` is required

Use it to pass the URL to fetch the datafile from.

### `handleDatafileFetch`

- Type: `function`
- Required: no

Pass this function if you need to take over the datafile fetching and parsing process:

```js
const sdk = createInstance({
  handleDatafileFetch: async (datafileUrl) => {
    const response = await fetch(datafileUrl);
    const datafile = await response.json();

    return datafile;
  }
});
```

### `initialFeatures`

- Type: `object`
- Required: no

Pass set of initial features with their variation and (optional) variables that you want the SDK to return until the datafile is fetched and parsed:

```js
const sdk = createInstance({
  initialFeatures: {
    myFeatureKey: {
      variation: true,
      variables: {
        myVariableKey: "my-variable-value"
      }
    }
  }
});
```

### `interceptAttributes`

- Type: `function`
- Required: no

Intercept given attributes before they are used to bucket the user:

```js
const defaultAttributes = {
  platform: "web",
  locale: "en-US",
  country: "US",
  timezone: "America/New_York",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
};

const sdk = createInstance({
  interceptAttributes: (attributes) => {
    return {
      ...defaultAttributes,
      ...attributes,
    };
  }
});
```

### `logger`

- Type: `object`
- Required: no

Pass a custom logger with custom levels, otherwise it the SDK will print logs to the console for `error` and `warn` levels.

```js
import { createInstance, createLogger } from "@featurevisor/sdk";

const sdk = createInstance({
  logger: createLogger({
    levels: ["debug", "info", "warn", "error"],
    handler: (level, message, details) => {
      // do something with the log
    },
  }),
});
```

### `onActivation`

- Type: `function`
- Required: no

Capture activated features along with their evaluated variation:

```js
const sdk = createInstance({
  onActivation: (featureKey, variation, attributes, captureAttributes) => {
    // do something with the activated feature
  }
});
```

`captureAttributes` will only contain attributes that are marked as `capture: true` in the Attributes' YAML files.

### `onReady`

- Type: `function`
- Required: no

Triggered maximum once when the SDK is ready to be used.

```js
const sdk = createInstance({
  onReady: () => {
    // do something when the SDK is ready
  }
});
```

### `onRefresh`

- Type: `function`
- Required: no

Triggered every time the datafile is refreshed.

Works only when `datafileUrl` and `refreshInterval` are set.

```js
const sdk = createInstance({
  onRefresh: () => {
    // do something when the datafile is refreshed
  }
});
```

### `onUpdate`

- Type: `function`
- Required: no

Triggered every time the datafile is refreshed, and the newly fetched datafile is detected to have different content than last fetched one.

Works only when `datafileUrl` and `refreshInterval` are set.

```js
const sdk = createInstance({
  onUpdate: () => {
    // do something when the datafile is updated
  }
});
```

### `refreshInterval`

- Type: `number` (in seconds)
- Required: no

Set the interval to refresh the datafile.

```js
const sdk = createInstance({
  refreshInterval: 60 * 5, // every 5 minutes
});
```

### `stickyFeatures`

- Type: `object`
- Required: no

If set, the SDK will skip evaluating the datafile and return variation and variable results from this object instead.

If a feature key is not present in this object, the SDK will continue to evaluate the datafile.

```js
const sdk = createInstance({
  stickyFeatures: {
    myFeatureKey: {
      variation: true,
      variables: {
        myVariableKey: "my-variable-value"
      }
    }
  }
});
```

## API

These methods are available once the SDK instance is created:

### `getVariation`

> `getVariation(featureKey: string, attributes: Attributes): VariationValue`

Also supports additional type specific methods:

- `getVariationBoolean`
- `getVariationString`
- `getVariationInteger`
- `getVariationDouble`

### `getVariable`

> `getVariable(featureKey: string, variableKey: string, attributes: Attributes): VariableValue`

Also supports additional type specific methods:

- `getVariableBoolean`
- `getVariableString`
- `getVariableInteger`
- `getVariableDouble`
- `getVariableArray`
- `getVariableObject`
- `getVariableJSON`

### `activate`

> `activate(featureKey: string, attributes: Attributes): VariationValue`

Same as `getVariation`, but also calls the `onActivation` callback.

This is a convenience method meant to be called when you know the User has been exposed to your Feature, and you also want to track the activation.

Also supports additional type specific methods:

- `activateBoolean`
- `activateString`
- `activateInteger`
- `activateDouble`

### `isReady`

> `isReady(): boolean`

Synchonously check if the SDK is ready to be used.

### `refresh`

> `refresh(): void`

Manually refresh datafile.

### `setLogLevels`

> `setLogLevels(levels: LogLevel[]): void`

Accepted values for `levels`: `["debug", "info", "warn", "error"]`.

### `on`

> `on(event: string, callback: function): void`

Listen to SDK events, like:

- `ready`
- `activation`
- `refresh`
- `update`

### `addListener`

Alias for `on` method.

### `off`

> `off(event: string, callback: function): void`

### `removeListener`

Alias for `off` method.

### `removeAllListeners`

> `removeAllListeners(event?: string): void`

## License <!-- omit in toc -->

MIT © [Fahad Heylaal](https://fahad19.com)
