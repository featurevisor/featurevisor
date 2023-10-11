---
title: React Native SDK
description: Learn how to use Featurevisor SDK with React Native for evaluating feature flags when building iOS and Android apps
ogImage: /img/og/docs-react.png
---

Featurevisor SDK can be used with React Native for evaluating feature flags when building iOS and Android applications. {% .lead %}

## Installation

You can use the same Featurevisor React SDK in your React Native app. Just install it as a regular dependency:

```
$ npm install --save @featurevisor/react
```

See `@featurevisor/react` API docs [here](/docs/react).

## Example usage

```js
// ./MyComponent.js
import { Text } from "react-native";
import { useFlag } from "@featurevisor/react";

export default function MyComponent() {
  const featureKey = "my_feature";
  const context = { userId: "123" };

  const isEnabled = useFlag(featureKey, context);

  return (
    <Text>Feature is {isEnabled ? "enabled" : "disabled"}</Text>
  );
}
```

## Polyfills

Because Featurevisor's JavaScript SDK uses `fetch` API internally, it can be used with React Native without any additional dependencies.

The only extra polyfill you might need is for the `TextEncoder` API.

You can consider using [`fastestsmallesttextencoderdecoder`](https://www.npmjs.com/package/fastestsmallesttextencoderdecoder) package for that.

## Example repository

You can find a fully functioning example app built with React Native and Featurevisor SDK here: [https://github.com/featurevisor/featurevisor-example-react-native](https://github.com/featurevisor/featurevisor-example-react-native).
