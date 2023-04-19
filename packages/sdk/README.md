# @featurevisor/sdk

Universal JavaScript SDK for both Node.js and the browser.

Visit [https://featurevisor.com/docs/sdks/](https://featurevisor.com/docs/sdks/) for more information.

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

| Key                   | Type       | Description                                            |
|-----------------------|------------|--------------------------------------------------------|
| `datafile`            | `object`   | Parsed datafile object                                 |
| `datafileUrl`         | `string`   | URL to fetch the datafile from                         |
| `onReady`             | `function` | Callback to be called when the SDK is ready to be used |
| `onActivation`        | `function` | Callback to be called when a feature is activated      |
| `onRefresh`           | `function` | Callback to be called when the datafile is refreshed   |
| `onUpdate`            | `function` | Callback to be called when the datafile is updated     |
| `refreshInterval`     | `number`   | Interval in seconds to refresh the datafile            |
| `handleDatafileFetch` | `function` | Callback to be called when the datafile is fetched     |
| `interceptAttributes` | `function` | Callback to be called before attributes are used       |
| `logger`              | `Logger`   | Logger object to be used by the SDK                    |

## API

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

## License

MIT © [Fahad Heylaal](https://fahad19.com)
