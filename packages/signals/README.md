# @featurevisor/signals

Reactive values for Featurevisor flags, variations and variables, for any signals library, React and Vue. A value evaluates again only when something its last answer read has changed, and tells its readers only when the answer differs.

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/signals
```

Install the signals library you use beside it, such as `@preact/signals-core` or `signal-polyfill`. Each is an optional peer dependency.

## Usage

Create a reader from an SDK instance with your library's adapter:

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSignals } from "@featurevisor/signals/preact";

const f = createFeaturevisor({
  datafile,
  context: {
    userId: "user-1",
    country: "nl",
  },
});

const fv = createSignals(f);

const checkout = fv.flag("checkout");
const label = fv.variable("buyButton", "label");
const banner = fv.variable("banner");
const [wishlist, liveChat] = fv.flags(["wishlist", "liveChat"]);
```

Each value is a Preact signal. When `country` changes, only the values whose answers read `country` evaluate again, and only those whose answers differ notify. Writes stay on the instance: `setContext`, `setDatafile`, `setStickyFeatures` and `setStickyVariables`.

## Adapters

| Import                         | Values are                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@featurevisor/signals`        | sources, with `read()` and `listen(changed)`                                                                                              |
| `@featurevisor/signals/preact` | Preact signals, updated in one batch per change                                                                                           |
| `@featurevisor/signals/tc39`   | TC39 `Signal.Computed` values from `signal-polyfill`, which work with Lit and plain watchers. This entry is ESM only, as the polyfill is. |
| `@featurevisor/signals/react`  | `useSource(source)`, which renders a component again only when the value changes                                                          |
| `@featurevisor/signals/vue`    | `useSource(source)`, a readonly ref                                                                                                       |

`@featurevisor/react` and `@featurevisor/vue` build their hooks and composables on this package, so most React and Vue applications use those instead.

## Context

Every value takes context as its last argument: an object, or a getter that reads other signals, which is followed:

```ts
import { signal } from "@preact/signals-core";

const productId = signal("1");
const reviews = fv.flag("productReviews", () => ({ productId: productId.value }));
```

`fv.scope(context)` returns a reader whose values merge that context under their own, as `FeaturevisorScope` does.

## Values from anything

`fv.from(compute, context)` makes a value from any function of the effective context, such as a package's getter. It follows exactly what the SDK evaluations inside it read:

```ts
const summary = fv.from((context) => ({
  checkout: f.isEnabled("checkout", context),
  banner: f.getVariable("banner", context),
}));
```

## Async values

`fv.async(load, options)` gives a value a promise away, such as a username check. It waits for `debounce` milliseconds of quiet input, aborts an older load through its signal when a newer input arrives, keeps ready answers per input, and loads nothing while nothing listens, so a server never waits:

```ts
const username = signal("");

const availability = fv.async(
  (name: string, { signal }) => api.isUsernameAvailable(name, { signal }),
  { input: () => username.value || undefined, debounce: 400 },
);
```

Its value is `{ status: "idle" }`, `{ status: "pending" }`, `{ status: "ready", value }` or `{ status: "failed", error }`.

## Instance state

`fv.revision` holds the datafile's revision, and `fv.status` is `"pending"` until the instance accepts a datafile, then `"ready"`.

## Precision

Values ask again only when a change touches what their last answer read, which the SDK reports. This holds for modules that pass changing application state through the context. A module that changes answers from state outside the context cannot be seen, so an application with one creates its reader with `precise: false`, and every value then asks again on every change.

A module with `beforeEvaluation`, `bucketKey` or `bucketValue` may read any attribute, so values it takes part in ask again on every context change.

## Values kept

An equal answer keeps the previous value, so objects and arrays keep their identity until they change. Development builds freeze the values a reader keeps, so a change made in place throws where it happens. `copy: true` gives each value its own copy instead.

## Server rendering

Reading a value on a server evaluates it without listening, so nothing attaches to an instance shared between requests.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
