# @featurevisor/signals

Reactive values for Featurevisor flags, variations and variables. A value evaluates again only when something its last answer read has changed, and tells whoever listens only when the answer differs.

The core works on its own, in any JavaScript runtime. Adapters turn its values into Preact signals, TC39 signals, React hooks and Vue refs, and any other library can have its own.

This package is experimental: its API may change in a minor release until the first package hooks built on it are released.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Reading values](#reading-values)
  - [Flags](#flags)
  - [Variations](#variations)
  - [Variables](#variables)
  - [Several flags at once](#several-flags-at-once)
- [Listening](#listening)
- [Context](#context)
  - [A context per value](#a-context-per-value)
  - [Context from a getter](#context-from-a-getter)
  - [Scopes](#scopes)
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
- [Single values](#single-values)
- [How values update](#how-values-update)
- [Errors](#errors)
- [Server rendering](#server-rendering)
- [API reference](#api-reference)
- [License](#license)

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/signals
```

The core needs nothing else. To use an adapter, install its library beside it:

| Adapter                        | Install                |
| ------------------------------ | ---------------------- |
| `@featurevisor/signals/preact` | `@preact/signals-core` |
| `@featurevisor/signals/tc39`   | `signal-polyfill`      |
| `@featurevisor/signals/react`  | `react`                |
| `@featurevisor/signals/vue`    | `vue`                  |

Each is an optional peer dependency, so only what you import is needed.

## Quick start

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

const stop = checkout.listen(() => {
  console.log("checkout is now", checkout.read());
});

f.setContext({ country: "de" });
// checkout is now false

stop();
```

Each value is a source with two methods. `read()` answers now, and `listen(changed)` calls `changed` whenever the answer changes, until the function it returns is called.

When `country` changes, only the values whose answers read `country` evaluate again, and only those whose answers differ call their listeners. Changes stay on the instance, through `setContext`, `setDatafile`, `setStickyFeatures` and `setStickyVariables`, so a reader only reads.

## Reading values

Each method of a reader makes a new value. Keep the value you read and listen to, rather than asking the reader again for the same one.

### Flags

`flag(featureKey)` is whether the feature is enabled:

```ts
const checkout = signals.flag("checkout");

checkout.read(); // true
```

### Variations

`variation(featureKey)` is the feature's variation, or `null` when it has none or is disabled. A type parameter narrows it:

```ts
const buttonColor = signals.variation<"blue" | "green">("buyButton");

buttonColor.read(); // "green"
```

### Variables

`variable(featureKey, variableKey)` is a feature's variable, and `variable(variableKey)` a global variable. Each is `null` when there is none:

```ts
const label = signals.variable<string>("buyButton", "label");

label.read(); // "Buy now"

const banner = signals.variable<{ title: string }>("banner");

banner.read(); // { title: "Welcome" }
```

Variables compare by value, so an answer equal to the last keeps the same object and tells no listener.

### Several flags at once

`flags(featureKeys)` gives one value per feature, in the order of the keys:

```ts
const [wishlist, liveChat] = signals.flags(["wishlist", "liveChat"]);

wishlist.read(); // true
liveChat.read(); // false
```

`everyFlag(featureKeys)` is whether every feature is enabled, and `someFlag(featureKeys)` whether any is:

```ts
const allOn = signals.everyFlag(["wishlist", "liveChat"]);
const anyOn = signals.someFlag(["wishlist", "liveChat"]);

allOn.read(); // false
anyOn.read(); // true
```

Both evaluate in order and stop at the first feature that decides the answer, so a later feature is not evaluated, and not followed, while an earlier one decides. A key listed twice is evaluated once. With no keys, `everyFlag` is `true` and `someFlag` is `false`.

## Listening

`listen(changed)` returns a function that stops listening. Calling it again does nothing:

```ts
const checkout = signals.flag("checkout");

const stop = checkout.listen(() => {
  render(checkout.read());
});

// later
stop();
```

While a value has listeners, a change that touches what it read makes it evaluate at once, and its listeners are called only if the answer differs. A value nobody listens to evaluates when it is next read.

One SDK change that alters several values calls each of their listeners once, after every touched value has answered, so a listener that reads another value sees its new answer.

A value that starts listening after the instance changed calls its listener a moment later if its answer changed in between, so nothing is missed between reading and listening.

## Context

### A context per value

Every method takes a context as its last argument. The SDK merges it over the instance's context, as it does for its own getters:

```ts
const context = { productId: "1" };

const reviews = signals.flag("productReviews", context);
```

A context compares by value, so the same values in a new object ask nothing again, and a context changed in place and given again does.

### Context from a getter

A getter in place of an object is read each time the value answers, so a value can follow state that changes:

```ts
const product = { id: "1" };

const reviews = signals.flag("productReviews", () => ({
  productId: product.id,
}));

reviews.read(); // true

product.id = "2";
reviews.read(); // false
```

With plain sources, a change the getter would read is seen at the next `read()`, and calls no listener. With a signals library's adapter, a getter that reads that library's signals is followed, so the value updates and tells its listeners when they change ([Preact](#preact-signals), [TC39](#tc39-signals-and-lit), [Vue](#vue)).

### Scopes

`scope(context)` returns a reader whose values all merge that context under their own, as `FeaturevisorScope` does in React and Vue:

```ts
const product = signals.scope({ productId: "1" });

const reviews = product.flag("productReviews");
const price = product.variable("pricing", "price");
```

A value's own context wins over its scopes:

```ts
const context = { productId: "2" };

const other = product.flag("productReviews", context);
```

Scopes nest, the outermost merged first, and a scope can take a getter too:

```ts
const page = signals.scope({ page: "checkout" });
const current = page.scope(() => ({ productId: selected.id }));

const offers = current.flag("offers");
// evaluated with { page: "checkout", productId: selected.id }
```

## Values from anything

`from(compute, context)` makes a value from any function of a context, such as another package's getter or a combination of your own:

```ts
const summary = signals.from((context) => ({
  checkout: f.isEnabled("checkout", context),
  banner: f.getVariable("banner", context),
}));

summary.read(); // { checkout: true, banner: { title: "Welcome" } }
```

`compute` receives the value's context merged over its scopes, which the SDK's getters merge over the instance's context as usual. The value follows exactly what the SDK evaluations inside `compute` read, so it asks again only when one of them could answer differently.

Answers compare by value, so an equal answer keeps the previous object. A third argument changes how they compare, or turns precision off for this value alone:

```ts
const options = {
  equals: (previous, next) => previous.checkout === next.checkout,
  precise: false,
};

const loose = signals.from(compute, undefined, options);
```

`compute` should read changing state only through the context or the SDK. State it reads from elsewhere is not followed, unless `precise` is `false`.

## Async values

`async(load, options)` makes a value that is a promise away, such as a username check:

```ts
let username = "";

const availability = signals.async(
  (name: string, { signal }) => api.isUsernameAvailable(name, { signal }),
  {
    input: () => username || undefined,
    debounce: 400,
  },
);

availability.listen(() => {
  console.log(availability.read());
});
```

Its value is one of:

| Value                         | When                                           |
| ----------------------------- | ---------------------------------------------- |
| `{ status: "idle" }`          | No input, or nothing listening yet             |
| `{ status: "pending" }`       | Waiting for the pause, or loading              |
| `{ status: "ready", value }`  | `load` answered for the current input          |
| `{ status: "failed", error }` | `load` threw or rejected for the current input |

How it loads:

- **The input.** `input` is read each time the value answers. `undefined` or `null` means no input, and the value is idle.
- **A pause.** `debounce` waits that many milliseconds of the same input before loading. It is `0` by default.
- **The latest input wins.** A newer input aborts the older load through `signal`, an `AbortSignal` where the runtime has one, and an older answer that arrives late is dropped.
- **Answers kept.** A ready answer is kept for its input, so returning to that input answers at once, with no load. A failure is not kept, so coming back to that input loads it again.
- **Nothing without a listener.** Nothing loads while nothing listens, and a load waiting for its pause, or running, is cancelled when the last listener leaves.

`load` may return a value or a promise of one.

Inputs are told apart by value: strings and numbers as they are, and anything else by its JSON. `key` names an input another way:

```ts
const quote = signals.async((cart: Cart, { signal }) => api.quote(cart, { signal }), {
  input: () => currentCart,
  key: (cart) => cart.id,
});
```

Every ready answer is kept for as long as the value lives. `keepAnswers` keeps only that many, the most recently used, for one value, or for every async value of a reader through its [options](#options):

```ts
const search = signals.async((query: string) => api.search(query), {
  input: () => query || undefined,
  debounce: 200,
  keepAnswers: 20,
});
```

`keepAnswers: 0` keeps none.

## Revision

`revision` holds the datafile's revision, as the SDK's `getRevision()` gives it, and tells its listeners when a datafile brings another:

```ts
signals.revision.read(); // "1"

signals.revision.listen(() => {
  console.log("datafile now at", signals.revision.read());
});
```

The SDK fetches nothing, and an instance can start without a datafile or never have one, so there is no status of a datafile here. Whoever sets the datafile knows when it arrives, and a package that loads datafiles can offer its own status through `from`.

## Options

`createSignals(f, options)` takes:

| Option        | Default                                     | What it does                                                                                                                                                            |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `precise`     | `true`                                      | Asks again only when a change touches what the last answer read. With `false`, every value asks again on every change, for modules that read state outside the context. |
| `freeze`      | In development builds, unless `copy` is set | Freezes the values kept, so changing one in place throws where it happens.                                                                                              |
| `copy`        | `false`                                     | Gives each value its own copy of what the SDK returned, so changing it in place reaches nothing else.                                                                   |
| `keepAnswers` | Every answer                                | How many ready answers each async value keeps, the most recently used. An async value's own `keepAnswers` overrides it, and `0` keeps none.                             |

```ts
const signals = createSignals(f, {
  copy: true,
  keepAnswers: 100,
});
```

Development builds are those where `process.env.NODE_ENV` is not `"production"`, as bundlers set it. Adapters also set `batch`, which runs the engine's work inside their library's batch.

## Libraries and frameworks

Each adapter is a subpath of this package. Its `createSignals` returns the same reader, with its library's values:

| Import                         | Values are                                       |
| ------------------------------ | ------------------------------------------------ |
| `@featurevisor/signals`        | Sources, with `read()` and `listen(changed)`     |
| `@featurevisor/signals/preact` | Preact signals                                   |
| `@featurevisor/signals/tc39`   | TC39 `Signal.Computed` values                    |
| `@featurevisor/signals/react`  | `useSource(source)`, for a source in a component |
| `@featurevisor/signals/vue`    | `useSource(source)`, a readonly ref              |

### Preact signals

```ts
import { computed, effect, signal } from "@preact/signals-core";
import { createSignals } from "@featurevisor/signals/preact";

const signals = createSignals(f);

const productId = signal("1");
const reviews = signals.flag("productReviews", () => ({
  productId: productId.value,
}));

const heading = computed(() => (reviews.value ? "Reviews" : "No reviews yet"));

effect(() => {
  console.log(heading.value);
});

productId.value = "2";
```

Each value is a `ReadonlySignal`, so it works in `computed`, `effect` and Preact components alike.

- A context getter that reads other signals is followed, as `productId` is here.
- One SDK change that alters several values updates them in one batch, so an effect reading several runs once.
- A value listens to the instance only while something watches it.
- Setting the context inside an effect does not make that effect depend on the values the change updates.

An async value's input can read signals the same way:

```ts
const username = signal("");

const availability = signals.async(
  (name: string, { signal }) => api.isUsernameAvailable(name, { signal }),
  {
    input: () => username.value || undefined,
    debounce: 400,
  },
);
```

`toSignal(source)` turns any source into a Preact signal, such as one from [`createValue`](#single-values).

### TC39 signals and Lit

```ts
import { Signal } from "signal-polyfill";
import { createSignals } from "@featurevisor/signals/tc39";

const signals = createSignals(f);

const checkout = signals.flag("checkout");

const label = new Signal.Computed(() => (checkout.get() ? "New checkout" : "Checkout"));

label.get(); // "New checkout"
```

Each value is a `Signal.Computed` from `signal-polyfill`, so it works inside other computed signals, with a `Signal.subtle.Watcher`, and with Lit's signals integration. A value listens to the instance only while a watcher watches it.

An effect, as the proposal shapes it, is a computed signal a watcher watches:

```ts
let needsEnqueue = true;

const watcher = new Signal.subtle.Watcher(() => {
  if (needsEnqueue) {
    needsEnqueue = false;
    queueMicrotask(processPending);
  }
});

function processPending() {
  needsEnqueue = true;
  for (const signal of watcher.getPending()) signal.get();
  watcher.watch();
}

function effect(callback: () => void) {
  const computed = new Signal.Computed(callback);
  watcher.watch(computed);
  computed.get();

  return () => watcher.unwatch(computed);
}

const stop = effect(() => {
  console.log("checkout", checkout.get());
});
```

A context getter that reads other TC39 signals is followed, as in Preact, and setting the context inside a computed signal does not make it depend on the values the change updates.

`toSignal(source)` turns any source into a `Signal.Computed`.

This entry is ESM only, as the polyfill is.

### React

`@featurevisor/react` builds its hooks on this package, so `useFlag`, `useFlags`, `useEveryFlag`, `useSomeFlag`, `useVariation` and `useVariable` already render a component again only when their own value changes. Most applications need nothing more.

For anything else, such as `from` and `async`, read the reader of the nearest `FeaturevisorProvider` with `useSignals`, and a value with `useSource`:

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

`useMemo` keeps the same value between renders, since each call to a reader makes a new one. `useSource` takes any source and renders the component again only when its value changes:

```tsx
import { useMemo } from "react";
import { useSdk, useSignals } from "@featurevisor/react";
import { useSource } from "@featurevisor/signals/react";

function Summary() {
  const f = useSdk();
  const signals = useSignals();
  const summary = useMemo(
    () =>
      signals.from((context) => ({
        checkout: f.isEnabled("checkout", context),
        banner: f.getVariable("banner", context),
      })),
    [f, signals],
  );
  const { checkout, banner } = useSource(summary);

  return checkout ? <Banner {...banner} /> : null;
}
```

`useSignals` gives one reader per instance, made with the default [options](#options), so its values are frozen in development builds. `useSource` works from React 16.8, through `useSyncExternalStore` from React 18.

### Vue

`@featurevisor/vue` builds its composables on this package, so `useFlag`, `useFlags`, `useEveryFlag`, `useSomeFlag`, `useVariation` and `useVariable` already update only when their own value changes. Most applications need nothing more.

For anything else, make values in `setup` and read each with `useSource`, which returns a readonly ref:

```ts
import { defineComponent, ref } from "vue";
import { useSdk } from "@featurevisor/vue";
import { createSignals } from "@featurevisor/signals";
import { useSource } from "@featurevisor/signals/vue";

export default defineComponent({
  setup() {
    const signals = createSignals(useSdk());
    const username = ref("");

    const checkout = useSource(signals.flag("checkout"));
    const availability = useSource(
      signals.async(
        (name: string, { signal }) => api.isUsernameAvailable(name, { signal }),
        {
          input: () => username.value || undefined,
          debounce: 400,
        },
      ),
    );

    return { checkout, username, availability };
  },
});
```

Refs and props that a context getter or an async input reads are followed, as `username` is here.

- In a component, a ref listens once mounted and stops when unmounted, so server rendering attaches nothing.
- Outside a component, it listens at once and stops with the current effect scope, if there is one.

### Other libraries

`createReader(f, wrap, options)` builds a reader whose values are whatever `wrap` turns each source into. For Svelte stores:

```ts
import { readable, type Readable } from "svelte/store";
import { createReader, type Source } from "@featurevisor/signals";

declare module "@featurevisor/signals" {
  interface Wrapped<T> {
    svelte: Readable<T>;
  }
}

function toStore<T>(source: Source<T>): Readable<T> {
  return readable(source.read(), (set) => {
    set(source.read());
    return source.listen(() => set(source.read()));
  });
}

const signals = createReader<"svelte">(f, toStore);

const checkout = signals.flag("checkout"); // Readable<boolean>
```

Declaring the library's type in `Wrapped` under a name types every value of a reader made with that name. A `wrap` should listen only while its own library watches the value, so the instance is not listened to for nothing.

## Single values

`createValue(f, compute, context, options)` makes one source without a reader, which is what the React and Vue hooks build on:

```ts
import { createValue } from "@featurevisor/signals";

const checkout = createValue(
  f,
  (context) => f.isEnabled("checkout", context),
  () => ({ productId: "1" }),
  {
    equals: Object.is,
    follows: { features: ["checkout"] },
  },
);
```

`context` is always a getter. Its options are `equals`, `precise`, `copy`, `freeze` and `batch`, as above, and `follows`, the features and global variables a value asks again for when the SDK cannot say what it read, such as on a child instance.

## How values update

A value asks the SDK again only when a change touches what its last answer read:

| Change                                       | Asks again                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `setContext`                                 | Values that read a changed top level key, compared by value                           |
| `setDatafile`                                | Values that read a changed feature, global variable or segment, dependencies included |
| `setStickyFeatures` and `setStickyVariables` | Values that read a named feature or global variable                                   |

A value that answered without reading anything the SDK can name, as `from` over a function that calls no SDK getter, follows every change.

An equal answer keeps the previous value, so objects and arrays keep their identity until they change. Flags and variations compare by identity, and variables and `from` answers by value: arrays and plain objects item by item, and dates by time.

The engine listens to an instance with one set of listeners, however many values there are. It starts when a value first listens, or at a value's first read in a browser or React Native, and stops a moment after the last listener leaves.

Modules are seen this way:

- A module that changes answers from application state should pass that state through the context. State a module reads from elsewhere is not seen. A reader created with `precise: false` asks again on every change instead, while the React and Vue hooks are always precise.
- A module with `beforeEvaluation`, `bucketKey` or `bucketValue` may read any attribute, so the values it takes part in ask again on every context change.
- An `afterEvaluation` hook that changes answers by the context is not seen.
- A module added or removed after values have answered changes them from the next change to the context, datafile or sticky values.

Values on a child instance from `spawn` follow every change, since a child cannot say what an answer read.

## Errors

An evaluation that throws, such as a `from` whose `compute` throws, throws from `read()`, where your library can report it. When it happens during an SDK change, the value's listeners are called, so the next read throws in their hands.

A listener that throws is reported through `console.error`, and the other listeners are still called.

## Server rendering

Reading a value on a server evaluates it without listening, so nothing attaches to an instance shared between requests, and async values stay idle. The React and Vue hooks evaluate directly on a server, and make no value on the engine.

## API reference

`@featurevisor/signals`:

| Export                                       | What it is                                                      |
| -------------------------------------------- | --------------------------------------------------------------- |
| `createSignals(f, options?)`                 | A reader whose values are sources                               |
| `createReader(f, wrap, options?)`            | A reader whose values are what `wrap` makes of each source      |
| `createValue(f, compute, context, options?)` | One source, without a reader                                    |
| `sameValue(first, second)`                   | Compares by value, as values do                                 |
| `copyValue(value)`                           | A deep copy of arrays, plain objects and dates, as `copy` makes |

Types: `Reader`, `ReaderOptions`, `FromOptions`, `ContextSource`, `Source`, `AsyncValue`, `AsyncOptions`, `AsyncLoad`, `ValueOptions`, `Follows`, `Batch`, `Wrapped` and `WrappedKind`.

Adapters:

| Import                         | Exports                                          |
| ------------------------------ | ------------------------------------------------ |
| `@featurevisor/signals/preact` | `createSignals(f, options?)`, `toSignal(source)` |
| `@featurevisor/signals/tc39`   | `createSignals(f, options?)`, `toSignal(source)` |
| `@featurevisor/signals/react`  | `useSource(source)`                              |
| `@featurevisor/signals/vue`    | `useSource(source)`                              |

`@featurevisor/react` also exports `useSignals()`, the reader of the nearest `FeaturevisorProvider`.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
