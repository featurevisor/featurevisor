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

const datafileContent = fetch('https://cdn.yoursite.com/datafile.json')
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
  const context = {
    // ...additional context
  }

  const isEnabled = useFlag(featureKey, context)

  if (isEnabled) {
    return <p>Feature is enabled</p>
  }

  return <p>Feature is disabled</p>
}
```

### useVariation

Get a feature's evaluated variation:

```jsx
import React from "react":
import { useVariation } from "@featurevisor/react";

function MyComponent(props) {
  const featureKey = "myFeatureKey";
  const context = {
    // ...additional context
  };

  const variation = useVariation(featureKey, context);

  if (variation === "b") {
    return <p>B variation</p>;
  }

  if (variation === "c") {
    return <p>C variation</p>;
  }

  // default
  return <p>Default experience</p>;
};
```

### useVariable

Get a feature's evaluated variable value:

```jsx
import React from "react":
import { useVariable } from "@featurevisor/react";

function MyComponent(props) {
  const featureKey = "myFeatureKey";
  const variableKey = "color";
  const context = {
    // ...additional context
  };

  const colorValue = useVariable(featureKey, variableKey, context);

  return <p>Color: {colorValue}</p>;
};
```

## Optimization

Given the nature of components in React, they can re-render many times.

You are advised to minimize the number of calls to Featurevisor SDK in your components by using memoization techniques.

## Example repository

You can find a fully functional example of a React application using Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-react](https://github.com/featurevisor/featurevisor-example-react).
