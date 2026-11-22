# @featurevisor/signals

Reactive values for Featurevisor flags, variations and variables. A value evaluates again only when something its last answer read has changed, and tells whoever listens only when the answer differs.

The core works on its own, in any JavaScript runtime. Adapters turn its values into Preact signals, TC39 signals, React hooks and Vue refs.

This package is experimental: its API may change in a minor release until the first package hooks built on it are released.

## Contents

- [Installation](#installation)
- [Basic usage](#basic-usage)
- [Context](#context)
- [Values from anything](#values-from-anything)
- [Async values](#async-values)
- [Revision](#revision)
- [Options](#options)
- [Libraries and frameworks](#libraries-and-frameworks)
  - [Preact signals](#preact-signals)
  - [TC39 signals and Lit](#tc39-signals-and-lit)
  - [React](#react)
  - [Vue](#vue)
  - [Other libraries](#other-libraries)
- [How values update](#how-values-update)
- [Server rendering](#server-rendering)
- [License](#license)

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/signals
```

The core needs nothing else. To use an adapter, install its library beside it, such as `@preact/signals-core` or `signal-polyfill`. Each is an optional peer dependency.

## Basic usage

Create a reader from an SDK instance, and ask it for values:

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSignals } from "@featurevisor/signals";

const f = createFeaturevisor({
  datafile,
  context: {
    userId: "user-1",
    country: "nl",
  },
});

const signals = createSignals(f);

const checkout = signals.flag("checkout");

checkout.read(); // true
```

Each value is a source with two methods. `read()` answers now, and `listen(changed)` calls `changed` whenever the answer changes, until the function it returns is called:

```ts
const stop = checkout.listen(() => {
  console.log("checkout is now", checkout.read());
});

f.setContext({ country: "de" });
// checkout is now false

stop();
```

When `country` changes, only the values whose answers read `country` evaluate again, and only those whose answers differ call their listeners. Changes stay on the instance, through `setContext`, `setDatafile`, `setStickyFeatures` and `setStickyVariables`.

A reader has a method for each kind of value:

| Method                              | Value                                           |
| ----------------------------------- | ----------------------------------------------- |
| `flag(featureKey)`                  | Whether the feature is enabled                  |
| `variation(featureKey)`             | The feature's variation, or `null`              |
| `variable(featureKey, variableKey)` | A feature variable, or `null`                   |
| `variable(variableKey)`             | A global variable, or `null`                    |
| `flags(featureKeys)`                | One value per feature, in the order of the keys |
| `everyFlag(featureKeys)`            | Whether every feature is enabled                |
| `someFlag(featureKeys)`             | Whether any feature is enabled                  |

`everyFlag` and `someFlag` evaluate in order and stop at the first feature that decides the answer.

Each call makes a new value, so keep the value you listen to rather than asking the reader again.

## Context

Every method takes a context as its last argument, which is merged over the instance's context:

```ts
const context = { productId: "1" };

const reviews = signals.flag("productReviews", context);
```

A getter instead of an object is read each time the value answers, so a value can follow state that changes:

```ts
const product = { id: "1" };

const reviews = signals.flag("productReviews", () => ({
  productId: product.id,
}));
```

With plain sources, a change the getter would read is seen at the next `read()`. With a signals library's adapter, a getter that reads that library's signals is followed, and the value updates when they change.

`signals.scope(context)` returns a reader whose values all merge that context under their own, as `FeaturevisorScope` does in React and Vue.

## Values from anything

`signals.from(compute, context)` makes a value from any function of the effective context, such as another package's getter. It follows exactly what the SDK evaluations inside it read:

```ts
const summary = signals.from((context) => ({
  checkout: f.isEnabled("checkout", context),
  banner: f.getVariable("banner", context),
}));
```

Its answers compare by value, so an equal answer keeps the previous object. Pass `{ equals }` as a third argument to compare differently.

## Async values

`signals.async(load, options)` gives a value that is a promise away, such as a username check:

```ts
let username = "";

const availability = signals.async(
  (name: string, { signal }) => api.isUsernameAvailable(name, { signal }),
  {
    input: () => username || undefined,
    debounce: 400,
  },
);
```

Its value is `{ status: "idle" }`, `{ status: "pending" }`, `{ status: "ready", value }` or `{ status: "failed", error }`.

- **A pause.** It waits for `debounce` milliseconds of the same input before loading.
- **The latest input wins.** A newer input aborts the older load through `signal`, and an older answer that arrives late is dropped.
- **Answers kept.** A ready answer is kept for its input, so returning to that input asks nothing. A failure is not kept. `keepAnswers` keeps only that many answers, the most recently used.
- **No input.** An input of `undefined` or `null` leaves the value idle.
- **Nothing on a server.** Nothing loads while nothing listens, so a server never waits.
- **Keys.** Inputs are told apart by value, strings and numbers as they are and anything else by its JSON, or by a `key` function.

## Revision

`signals.revision` holds the datafile's revision, and changes when a datafile brings another.

The SDK fetches nothing, and an instance can start without a datafile or never have one, so there is no status of a datafile here. Whoever sets the datafile knows when it arrives, and a package that loads datafiles can offer its own status through `signals.from`.

## Options

`createSignals(f, options)` takes:

| Option        | Default                                     | What it does                                                                                                                                                                                                |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `precise`     | `true`                                      | Asks again only when a change touches what the last answer read. With `false`, every value asks again on every change, for modules that read state outside the context. `from` takes its own `precise` too. |
| `freeze`      | In development builds, unless `copy` is set | Freezes the values kept, so changing one in place throws where it happens.                                                                                                                                  |
| `copy`        | `false`                                     | Gives each value its own copy of what the SDK returned, so changing it in place reaches nothing else.                                                                                                       |
| `keepAnswers` | Every answer                                | How many ready answers each async value keeps, the most recently used. An async value's own `keepAnswers` overrides it, and `0` keeps none.                                                                 |

Adapters also set `batch`, which runs the engine's work inside their library's batch.

## Libraries and frameworks

Each adapter is a subpath of this package, and returns the same reader with its library's values:

| Import                         | Values are                                       |
| ------------------------------ | ------------------------------------------------ |
| `@featurevisor/signals`        | Sources, with `read()` and `listen(changed)`     |
| `@featurevisor/signals/preact` | Preact signals                                   |
| `@featurevisor/signals/tc39`   | TC39 `Signal.Computed` values                    |
| `@featurevisor/signals/react`  | `useSource(source)`, for a source in a component |
| `@featurevisor/signals/vue`    | `useSource(source)`, a readonly ref              |

### Preact signals

```ts
import { effect, signal } from "@preact/signals-core";
import { createSignals } from "@featurevisor/signals/preact";

const signals = createSignals(f);

const productId = signal("1");
const reviews = signals.flag("productReviews", () => ({
  productId: productId.value,
}));

effect(() => {
  console.log("reviews", reviews.value);
});
```

Each value is a `ReadonlySignal`. A context getter that reads other signals is followed, and one SDK change that alters several values updates them in one batch, so an effect reading several runs once. A value listens to the instance only while something watches it.

Setting the context inside an effect does not make that effect depend on the values the change updates.

### TC39 signals and Lit

```ts
import { createSignals } from "@featurevisor/signals/tc39";

const signals = createSignals(f);

const checkout = signals.flag("checkout");

checkout.get(); // true
```

Each value is a `Signal.Computed` from `signal-polyfill`, so it works inside other computed signals, with a `Signal.subtle.Watcher`, and with Lit's signals integration. A value listens to the instance only while a watcher watches it.

This entry is ESM only, as the polyfill is.

### React

`@featurevisor/react` builds its hooks on this package, so `useFlag`, `useVariation`, `useVariable` and the others already render a component again only when their own value changes. Most applications need nothing more.

For values the hooks do not cover, such as `from` and `async`, read the reader of the nearest `FeaturevisorProvider` with `useSignals`, and a value with `useSource`:

```tsx
import { useMemo } from "react";
import { useSignals } from "@featurevisor/react";
import { useSource } from "@featurevisor/signals/react";

function Checkout() {
  const signals = useSignals();
  const checkout = useMemo(() => signals.flag("checkout"), [signals]);
  const enabled = useSource(checkout);

  return enabled ? <NewCheckout /> : <OldCheckout />;
}
```

`useMemo` keeps the same value between renders, since each call to a reader makes a new one. `useSource` works from React 16.8, through `useSyncExternalStore` from React 18.

### Vue

`@featurevisor/vue` builds its composables on this package, so `useFlag`, `useVariation`, `useVariable` and the others are already precise. Most applications need nothing more.

For other values, make them in `setup` and read each with `useSource`, which returns a readonly ref:

```ts
import { defineComponent } from "vue";
import { useSdk } from "@featurevisor/vue";
import { createSignals } from "@featurevisor/signals";
import { useSource } from "@featurevisor/signals/vue";

export default defineComponent({
  setup() {
    const signals = createSignals(useSdk());
    const checkout = useSource(signals.flag("checkout"));

    return { checkout };
  },
});
```

In a component, a ref listens once mounted and stops when unmounted. Outside one, it listens at once and stops with the effect scope.

### Other libraries

`createReader(f, wrap, options)` builds a reader whose values are whatever `wrap` turns each source into. For a Svelte store:

```js
import { readable } from "svelte/store";
import { createReader } from "@featurevisor/signals";

const signals = createReader(f, (source) =>
  readable(source.read(), (set) => {
    set(source.read());
    return source.listen(() => set(source.read()));
  }),
);
```

In TypeScript, declare the library's type in the `Wrapped` interface, as the adapters do.

## How values update

A value asks the SDK again only when a change touches what its last answer read: an attribute of the context, a segment, a feature or a global variable, its dependencies included. The SDK reports what each answer read and what each change touched.

An equal answer keeps the previous value, so objects and arrays keep their identity until they change. Flags and variations compare by identity, and variables by value.

Modules are seen this way:

- A module that changes answers from application state should pass that state through the context. State a module reads from elsewhere is not seen. A reader created with `precise: false` asks again on every change instead, while the React and Vue hooks are always precise.
- A module with `beforeEvaluation`, `bucketKey` or `bucketValue` may read any attribute, so the values it takes part in ask again on every context change.
- An `afterEvaluation` hook that changes answers by the context is not seen.
- A module added or removed after values have answered changes them from the next change to the context, datafile or sticky values.

Values on a child instance from `spawn` follow every change.

## Server rendering

Reading a value on a server evaluates it without listening, so nothing attaches to an instance shared between requests. Async values stay idle there.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
