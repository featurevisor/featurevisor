# @featurevisor/signals

Reactive values for Featurevisor flags, variations and variables, which evaluate again only when something they read has changed. Adapters turn them into Preact signals, TC39 signals, React hooks and Vue refs.

This package is experimental: its API may change in a minor release.

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/signals
```

## Usage

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSignals } from "@featurevisor/signals";

const f = createFeaturevisor({
  datafile,
  context: { userId: "user-1", country: "nl" },
});

const signals = createSignals(f);
const checkout = signals.flag("checkout");

checkout.read(); // true
checkout.listen(() => console.log("checkout is now", checkout.read()));

f.setContext({ country: "de" });
```

Import from `@featurevisor/signals/preact`, `/tc39`, `/react` or `/vue` for each library's values.

See the [documentation](https://featurevisor.com/docs/signals/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
