---
title: React SDK
description: Learn how to use Featurevisor SDK with React for evaluating feature flags
ogImage: /img/og/docs-react.png
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
import React from "react";
import ReactDOM from "react-dom";

import { createInstance } from "@featurevisor/sdk";
import { FeaturevisorProvider } from "@featurevisor/react";

const f = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json"
});

ReactDOM.render(
  <FeaturevisorProvider instance={f}>
    <App />
  </FeaturevisorProvider>,
  document.getElementById("root")
);
```

## Hooks

The package comes with several hooks to use in your components:

### useStatus

Know if the SDK is ready to be used:

```jsx
import React from "react":
import { useStatus } from "@featurevisor/react";

function MyComponent(props) {
  const { isReady } = useStatus();

  if (!isReady) {
    return <p>Loading...</p>;
  }

  return <p>SDK is ready</p>;
};
```

### useFlag

Check if a feature is enabled or not:

```jsx
import React from "react";
import { useFlag } from "@featurevisor/react";

function MyComponent(props) {
  const featureKey = "myFeatureKey";
  const context = { userId: "123" };

  const isEnabled = useFlag(featureKey, context);

  if (isEnabled) {
    return <p>Feature is enabled</p>;
  }

  return <p>Feature is disabled</p>;
}
```

### useVariation

Get a feature's evaluated variation:

```jsx
import React from "react":
import { useVariation } from "@featurevisor/react";

function MyComponent(props) {
  const featureKey = "myFeatureKey";
  const context = { userId: "123" };

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
  const context = { userId: "123" };

  const colorValue = useVariable(featureKey, variableKey, context);

  return <p>Color: {colorValue}</p>;
};
```

### activateFeature

Same as `useVariation`, but it will also bubble an activation event up to the SDK for tracking purposes.

This should ideally be only called once per feature, and only when we know the feature has been exposed to the user.

### useSdk

Get the SDK instance:

```jsx
import React from "react":
import { useSdk } from "@featurevisor/react";

function MyComponent(props) {
  const f = useSdk();

  return <p>...</p>;
};
```

## Optimization

Given the nature of components in React, they can re-render many times.

You are advised to minimize the number of calls to Featurevisor SDK in your components by using memoization techniques.

## Example repository

You can find a fully functional example of a React application using Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-react](https://github.com/featurevisor/featurevisor-example-react).
