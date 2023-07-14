# @featurevisor/vue <!-- omit in toc -->

Vue.js functions for Featurevisor.

Visit [https://featurevisor.com/docs/vue](https://featurevisor.com/docs/vue) for more information.

- [Installation](#installation)
- [API](#api)
  - [`setupApp`](#setupapp)
  - [`activateFeature`](#activatefeature)
  - [`useSdk`](#usesdk)
  - [`useStatus`](#usestatus)
  - [`useVariation`](#usevariation)
  - [`useVariable`](#usevariable)

## Installation

```
$ npm install --save @featurevisor/vue
```

## API

### `setupApp`

Set up Featurevisor SDK instance in your Vue.js application:

```js
import { createApp } from "vue";
import { createInstance } from "@featurevisor/sdk";
import { setupApp } from "@featurevisor/vue";

const sdk = createInstance({
  // ...
});

const app = createApp({
  /* root component options */
});

setupApp(app, sdk);
```

### `activateFeature`

> activateFeature(featureKey, context = {}): VariationValue | undefined

Function for activating feature.

### `useSdk`

> useSdk(): FeaturevisorInstance

Function for getting Featurevisor SDK instance.

### `useStatus`

> useStatus(): { isReady: boolean }

Function for checking if Featurevisor SDK is ready.

### `useVariation`

> useVariation(featureKey, context = {}): VariationValue | undefined

Function for getting variation value.

### `useVariable`

> useVariable(featureKey, variableKey, context = {}): VariableValue | undefined

Function for getting variable value.

## License <!-- omit in toc -->

MIT © [Fahad Heylaal](https://fahad19.com)
