# @featurevisor/react <!-- omit in toc -->

React components and hooks for Featurevisor.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

- [Installation](#installation)
- [API](#api)
  - [`FeaturevisorProvider`](#featurevisorprovider)
  - [`useStatus`](#usestatus)
  - [`useFlag`](#useflag)
  - [`useVariation`](#usevariation)
  - [`useVariable`](#usevariable)
  - [`activateFeature`](#activatefeature)
  - [`useSdk`](#usesdk)

## Installation

```
$ npm install --save @featurevisor/react
```

## API

### `FeaturevisorProvider`

React Provider component for setting SDK instance:

```js
import React from "react";
import { createInstance } from "@featurevisor/sdk";
import { FeaturevisorProvider } from "@featurevisor/react";

const sdk = createInstance({
  // ...
});

function Root() {
  return (
    <FeaturevisorProvider sdk={sdk}>
      <App />
    </FeaturevisorProvider>
  );
}
```

### `useStatus`

> useStatus(): { isReady: boolean }

Hook for checking if Featurevisor SDK is ready.

```js
import React from "react";
import { useStatus } from "@featurevisor/react";

function App() {
  const { isReady } = useStatus();

  if (!isReady) {
    return <div>Loading...</div>;
  }

  return <div>Ready!</div>;
}
```

### `useFlag`

> useFlag(featureKey, context = {}): boolean

Hook for checking if feature is enabled.

### `useVariation`

> useVariation(featureKey, context = {}): VariationValue | undefined

Hook for getting variation value.

### `useVariable`

> useVariable(featureKey, variableKey, context = {}): VariableValue | undefined

Hook for getting variable value.

### `activateFeature`

> activateFeature(featureKey, context = {}): VariationValue | undefined

Hook for activating feature.

### `useSdk`

> useSdk(): FeaturevisorInstance

Hook for getting Featurevisor SDK instance.

## License <!-- omit in toc -->

MIT © [Fahad Heylaal](https://fahad19.com)
