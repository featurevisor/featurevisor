# @featurevisor/sdk

Universal Featurevisor SDK for both Node.js and the browser.

Visit [https://featurevisor.com/docs/sdks/](https://featurevisor.com/docs/sdks/) for more information.

## Installation

```
$ npm install --save @featurevisor/sdk
```

## Usage

Initialize the SDK:

```js
import { createInstance } from "@featurevisor/sdk";

const datafileContent = fetch(datafileURL).then((res) => res.json());

const sdk = createInstance({
  // required
  datafile: datafileContent,

 // optional
 onActivation: (featureKey, variant, attributes, captureAttributes) => {
   console.log(`Feature ${featureKey} activated with variant ${variant}`);
 },
});
```

## API

### `getVariation`

> `getVariation(featureKey: string, attributes: Attributes): VariationValue`

### `getVariable`

> `getVariable(featureKey: string, variableKey: string, attributes: Attributes): VariableValue`

### `activate`

> `activate(featureKey: string, attributes: Attributes): VariationValue`

Same as `getVariation`, but also calls the `onActivation` callback.

This is a convenience method meant to be called when you know the User has been exposed to your Feature, and you also want to track the activation.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
