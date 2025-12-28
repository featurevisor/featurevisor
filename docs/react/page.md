---
title: React SDK
nextjs:
  metadata:
    title: React SDK
    description: Learn how to use Featurevisor SDK with React for evaluating feature flags
    openGraph:
      title: React SDK
      description: Learn how to use Featurevisor SDK with React for evaluating feature flags
      images:
        - url: /img/og/docs-react.png
---

Featurevisor comes with an additional package for React.js, for ease of integration in your React.js application for evaluating feature flags. {% .lead %}

## Installation

Install with npm:

```
$ npm install --save @featurevisor/react
```

## Setting up the provider

Use `FeaturevisorProvider` component to set up the SDK instance in your React application:

```jsx
import React from 'react'
import ReactDOM from 'react-dom'

import { createInstance } from '@featurevisor/sdk'
import { FeaturevisorProvider } from '@featurevisor/react'

const DATAFILE_URL = '...'

const datafileContent = await fetch(DATAFILE_URL)
  .then(response => response.json())

const f = createInstance({
  datafile: datafileContent,
})

f.setContext({
  userId: '123',
})

ReactDOM.render(
  <FeaturevisorProvider instance={f}>
    <App />
  </FeaturevisorProvider>,
  document.getElementById('root'),
)
```

## Hooks

The package comes with several hooks to use in your components:

### useFlag

Check if a feature is enabled or not:

```jsx
import React from 'react'
import { useFlag } from '@featurevisor/react'

function MyComponent(props) {
  const featureKey = 'myFeatureKey'

  const isEnabled = useFlag(featureKey)

  if (isEnabled) {
    return <p>Feature is enabled</p>
  }

  return <p>Feature is disabled</p>
}
```

### useVariation

Get a feature's evaluated variation:

```jsx
import React from 'react':
import { useVariation } from '@featurevisor/react';

function MyComponent(props) {
  const featureKey = 'myFeatureKey';

  const variation = useVariation(featureKey);

  if (variation === 'b') {
    return <p>B variation</p>;
  }

  if (variation === 'c') {
    return <p>C variation</p>;
  }

  // default
  return <p>Default experience</p>;
};
```

### useVariable

Get a feature's evaluated variable value:

```jsx
import React from 'react':
import { useVariable } from '@featurevisor/react';

function MyComponent(props) {
  const featureKey = 'myFeatureKey';
  const variableKey = 'color';

  const colorValue = useVariable(featureKey, variableKey);

  return <p>Color: {colorValue}</p>;
};
```

### useFeaturevisor

In case you need to access the underlying Featurevisor SDK instance directly:

```jsx
import React from 'react'
import { useFeaturevisor } from '@featurevisor/react'

function MyComponent(props) {
  const f = useFeaturevisor()

  return <p>...</p>
}
```

### useSdk

Alias of `useFeaturevisor` hook.

## Passing additional context

All the evaluation hooks accept an optional argument for passing additional component-level context:

```js
const context = {
  // ... additional context here in component
}

useFlag(featureKey, context)
useVariation(featureKey, context)
useVariable(featureKey, variableKey, context)
```

## Reactivity

All the evaluation hooks are reactive. This means that your components will automatically re-render when:

- a newer [datafile is set](/docs/sdks/javascript/#setting-datafile)
- [context is set or updated](/docs/sdks/javascript/#context)
- [sticky features are set or updated](/docs/sdks/javascript/#sticky)

The re-rendering logic is smart enough to compare previously known value with the new evaluated value, and will only re-render the component if the value has changed.

If you do not want any reactivity, you are better off using the Featurevisor SDK instance directly in your component.

## Optimization

Given the nature of components in React, they can re-render many times.

You are advised to minimize the number of calls to Featurevisor SDK in your components by using memoization techniques.

## Example repository

You can find a fully functional example of a React application using Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-react](https://github.com/featurevisor/featurevisor-example-react).
