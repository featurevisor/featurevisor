# @featurevisor/sdk

Evaluate Featurevisor flags, variations and configuration values locally in browsers and Node.js.

## Installation

```bash
npm install @featurevisor/sdk
```

## Usage

Fetch a datafile from your hosting and handle loading failures in your application:

```js
import { createFeaturevisor } from "@featurevisor/sdk";

const response = await fetch("/datafiles/featurevisor-all.json");
if (!response.ok) throw new Error("Could not fetch datafile");
const f = createFeaturevisor({ datafile: await response.json() });
const context = { userId: "123" };
const enabled = f.isEnabled("checkout", context);
const variation = f.getVariation("checkout", context);
const title = f.getVariable("checkout", "title", context);
const email = f.getVariable("supportEmail", context);
```

Your application owns fetching and refreshing datafiles. In Node.js, use an absolute URL. The browser SDK targets ES2015 and does not require `TextEncoder`, `structuredClone` or `Promise.allSettled`. Adapt the example's `fetch` and top level await to your application's browser targets.

See the [documentation](https://featurevisor.com/docs/sdks/javascript/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
