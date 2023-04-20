# @featurevisor/react

React components and hooks for Featurevisor.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Installation

```
$ npm install --save @featurevisor/react
```

## API

### FeaturevisorProvider

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

### activateFeature

> activateFeature(featureName, attributes = {}): VariationValue | undefined

Hook for activate feature.

### useSdk

> useSdk(): FeaturevisorInstance

Hook for getting Featurevisor SDK instance.

### useStatus

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

### useVariation

> useVariation(featureKey, attributes = {}): VariationValue | undefined

Hook for getting variation value.

### useVariable

> useVariable(featureKey, variableKey, attributes = {}): VariableValue | undefined

Hook for getting variable value.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
