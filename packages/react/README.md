# @featurevisor/react

React components and hooks for Featurevisor, with updates when the SDK instance changes. React is a peer dependency supplied by your application.

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/react
```

## Usage

Share an instance through the provider. This example bundles a CLI generated datafile:

Pass imported JSON as a string. TypeScript infers some JSON properties as broader types than the datafile type accepts.

```tsx
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorProvider, useFlag } from "@featurevisor/react";
import datafile from "./datafile.json";

const f = createFeaturevisor({ datafile: JSON.stringify(datafile) });
function Checkout() {
  return useFlag("checkout", { userId: "123" }) ? <button>Checkout</button> : null;
}
export function App() {
  return <FeaturevisorProvider instance={f}><Checkout /></FeaturevisorProvider>;
}
```

See the [documentation](https://featurevisor.com/docs/react/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
