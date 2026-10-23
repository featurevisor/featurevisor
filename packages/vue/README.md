# @featurevisor/vue

Vue functions for Featurevisor using a shared SDK instance. Vue is a peer dependency supplied by your application.

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/vue
```

## Usage

Provide an instance when creating your app. This example bundles a CLI generated datafile:

Pass imported JSON as a string. TypeScript infers some JSON properties as broader types than the datafile type accepts.

```ts
import { createApp } from "vue";
import { createFeaturevisor } from "@featurevisor/sdk";
import { setupApp } from "@featurevisor/vue";
import App from "./App.vue";
import datafile from "./datafile.json";

const f = createFeaturevisor({ datafile: JSON.stringify(datafile) });
const app = createApp(App);
setupApp(app, f);
app.mount("#app");
```

Inside a component's setup, call `useFlag("checkout", { userId: "123" })` from `@featurevisor/vue`. It returns a readonly ref that updates when the datafile, the context or sticky values change. See the guide for reactive context and other value types.

See the [documentation](https://featurevisor.com/docs/vue/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
