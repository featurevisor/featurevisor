# JavaScript / TypeScript SDK

Full docs: <https://featurevisor.com/docs/sdks/javascript>

`@featurevisor/sdk` is universal — the same package works in Node.js, browsers, edge runtimes, and React Native. It evaluates features locally against a loaded [datafile](building-datafiles.md); **no network call happens at evaluation time**, so evaluations are synchronous and fast.

Framework wrappers: [sdk-react.md](sdk-react.md) (React / React Native), [sdk-vue.md](sdk-vue.md) (Vue).

**Featurevisor SDKs are cross-platform.** Python, Ruby, Go, Java, Swift, PHP, Roku, and a growing list of others live at <https://featurevisor.com/docs/sdks>. All SDKs consume the same datafiles, expose the same concepts (context, flag/variation/variable evaluation), and implement the same deterministic bucketing — the same user gets the same variation in every language, so one project can serve web, backend, and mobile consistently. Everything in this file transfers conceptually; only syntax differs.

## Install and initialize

```bash
npm install --save @featurevisor/sdk
```

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const datafileUrl = 'https://cdn.yoursite.com/production/featurevisor-web.json'
const datafile = await fetch(datafileUrl).then((res) => res.json())

const f = createFeaturevisor({ datafile })
```

`createFeaturevisor()` accepts:

| Option         | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `datafile`     | Datafile content (object or JSON string). Can also be set later.            |
| `context`      | Initial [context](#context) values                                          |
| `sticky`       | Per-feature overrides consulted before evaluation (see [Sticky](#sticky))   |
| `logLevel`     | `fatal` \| `error` \| `warn` \| `info` (default) \| `debug`                 |
| `onDiagnostic` | Custom handler instead of console output (see [Diagnostics](#diagnostics))  |
| `modules`      | Evaluation interceptors (see [Modules](#modules) and [tracking.md](tracking.md)) |

Create **one instance per application** and share it — don't create a new instance per evaluation. For server-side per-request isolation, see [Child instances](#child-instances-server-side).

## Context

Context is the plain object of [attribute](attributes.md) values that evaluations run against — the same attributes referenced by the project's segment conditions.

```js
// at init
const f = createFeaturevisor({ context: { deviceId: 'abc', country: 'nl' } })

// merge in more later (e.g. after login)
f.setContext({ userId: '123' })

// replace entirely (second arg true)
f.setContext({ deviceId: 'abc', userId: '123' }, true)

// or pass per evaluation — merged on top of instance context for that call only
f.isEnabled('checkout', { country: 'de' })
```

Attribute names and value types must match the project's `attributes/` definitions — check with `npx featurevisor list --attributes --json` when in doubt; don't invent attribute names in application code.

## Evaluating

Three evaluation types, mirroring what features define in YAML:

```js
// flag — boolean
if (f.isEnabled('checkout')) { /* ... */ }

// variation — string or null (A/B tests)
const variation = f.getVariation('checkout')
if (variation === 'treatment') { /* ... */ }

// variable — typed value or null (remote config)
const methods = f.getVariable('checkout', 'paymentMethods')
```

Type-specific variable getters return `null` when the stored value doesn't match the requested type (no coercion — `"1"` is not an integer, `"true"` is not a boolean):

```ts
f.getVariableBoolean(featureKey, variableKey, context?)
f.getVariableString(featureKey, variableKey, context?)
f.getVariableInteger(featureKey, variableKey, context?)
f.getVariableDouble(featureKey, variableKey, context?)
f.getVariableArray<T>(featureKey, variableKey, context?)
f.getVariableObject<T>(featureKey, variableKey, context?)
f.getVariableJSON<T>(featureKey, variableKey, context?)
```

Namespaced features use the full key with the project's separator (default `.`): `f.isEnabled('checkout.promo')`.

### Per-call defaults instead of null

`getVariation` and the variable getters accept an options object with fallback values, so call sites don't need null-handling:

```js
f.getVariation('checkout', context, { defaultVariationValue: 'control' })
f.getVariable('checkout', 'paymentMethods', context, { defaultVariableValue: ['creditCard'] })
```

Prefer defining sane `defaultValue` (and `useDefaultWhenDisabled`) in the project's `variablesSchema` — per-call defaults are the app-side safety net, not the source of truth.

### All evaluations at once

```js
const all = f.getAllEvaluations(context)
// { checkout: { enabled: true, variation: 'control', variables: {…} }, … }
```

Useful for passing a server-evaluated snapshot to the frontend, which can then feed it into a client instance as [sticky](#sticky) values — see [SSR handoff](#ssr-handoff) below.

### Why did it evaluate that way?

```js
const evaluation = f.evaluateFlag('checkout', context)
const evaluation = f.evaluateVariation('checkout', context)
const evaluation = f.evaluateVariable('checkout', 'paymentMethods', context)
```

Every evaluation object has `featureKey`, `type`, and `reason` (`sticky`, `required`, `forced`, `rule`, `allocated`, `out_of_range`, `no_match`, `disabled`, `feature_not_found`, `error`, …), plus context-dependent fields like `bucketValue` (0–100,000), `ruleKey`, `enabled`, `variationValue`, `variableValue`, and `variableSchema`. When debugging **authored definitions** rather than app code, prefer `npx featurevisor evaluate` in the project repo ([querying.md](querying.md)).

## Setting and updating the datafile

```js
f.setDatafile(datafile)        // merge (default)
f.setDatafile(datafile, true)  // replace
```

**Merging is the default**: incoming features/segments override matching keys, missing ones are kept, and `revision` comes from the incoming datafile. This enables loading multiple [target](targets.md) datafiles on demand into one instance:

```js
const f = createFeaturevisor({})

async function loadDatafile(target) {
  const datafile = await fetch(
    `https://cdn.yoursite.com/production/featurevisor-${target}.json`,
  ).then((res) => res.json())
  f.setDatafile(datafile) // merges into whatever was loaded before
}

await loadDatafile('products')
// later, when the user reaches checkout:
await loadDatafile('checkout')
```

When **refreshing** the same datafile (rather than adding another), pass `true` to replace, so features removed upstream don't linger.

### Keeping the datafile fresh

The SDK does not fetch anything itself — the application decides when to refetch:

```js
setInterval(async () => {
  const datafile = await fetch(datafileUrl).then((res) => res.json())
  f.setDatafile(datafile, true)
}, 5 * 60 * 1000)
```

Or trigger refetch from a push signal (websocket / SSE) sent by the deploy pipeline. Either way, react to updates via the `datafile_set` event below.

## Events

```js
const unsubscribe = f.on('datafile_set', ({ revision, previousRevision, revisionChanged, features, replaced }) => {
  // `features` lists keys added/updated/removed vs the previous content —
  // re-evaluate and re-render just those parts of the UI
})

f.on('context_set', ({ context, replaced }) => {})
f.on('sticky_set', ({ features, replaced }) => {})
f.on('error', ({ diagnostic }) => {})

unsubscribe() // every f.on() returns an unsubscribe function
```

## Sticky

Sticky values are per-feature overrides consulted **before** any datafile evaluation. Use them when the application already knows the answer (an entitlements service returned the user's plan, or a server passed down pre-computed evaluations) or to freeze experiences mid-session:

```js
f.setSticky({
  checkout: {
    enabled: true,
    variation: 'treatment',                  // optional
    variables: { paymentMethods: ['ideal'] } // optional
  },
})
// second arg true replaces instead of merging
```

For forcing specific users/QA from the **project side**, prefer a `force:` rule in YAML ([features.md](features.md#force)) — it's reviewed in PRs and visible to everyone. Sticky is application-side state.

## Child instances (server-side)

A browser app has one user, but a server handles many concurrent requests. `spawn()` creates a cheap child instance with request-scoped context layered over the parent's:

```js
// once, at server startup
const f = createFeaturevisor({ datafile })

// per request
app.get('/dashboard', (req, res) => {
  const childF = f.spawn({ userId: req.user.id, country: req.user.country })

  if (childF.isEnabled('newDashboard')) { /* ... */ }
})
```

Children support the same evaluation methods plus `setContext`, `setSticky`, `getAllEvaluations`, `on`, and `close`. `spawn(context, { sticky })` also accepts child-scoped sticky values. Datafile updates on the parent are visible to children automatically.

### SSR handoff

For server-rendered apps, avoid client/server mismatch (and flag "flicker" on load) by evaluating once on the server and handing the results to the client as sticky values:

```js
// server (per request)
const childF = f.spawn({ userId: req.user.id })
const evaluations = childF.getAllEvaluations()
// serialize `evaluations` into the rendered page

// client (at startup)
const f = createFeaturevisor({ sticky: window.__FEATURES__ })
// render matches the server exactly; later, once a datafile is loaded,
// f.setSticky({}, true) releases evaluation back to live rules
```

## Resilience

Evaluations never throw: `isEnabled` returns `false`, `getVariation`/`getVariable` return `null`, and errors surface as diagnostics — so a missing or stale datafile degrades to "features off", not a crash. Still, plan for the fetch failing:

- Write app code so the **disabled path is always the safe path** (that's also what un-shipped datafiles mean).
- For critical UIs, bundle a datafile snapshot at build time as a fallback, then refresh from the CDN: `createFeaturevisor({ datafile: bundledSnapshot })` followed by a fetched `setDatafile(fresh, true)`.
- Watch the `error` event / diagnostics in your observability system so silent fallback doesn't go unnoticed.

## Testing application code

To unit-test code that consumes flags, you don't need datafile fixtures — an instance with only **sticky** values forces any state:

```js
const f = createFeaturevisor({
  sticky: {
    checkout: { enabled: true, variation: 'treatment', variables: { paymentMethods: ['ideal'] } },
    newDashboard: { enabled: false },
  },
})
// f.isEnabled('checkout') === true — no datafile involved
```

Sticky is consulted before the datafile, so this works for every evaluation method. For closer-to-production tests, generate a real datafile from the project (`npx featurevisor build --environment=<env> --print`) and pass it as `datafile`. Note this tests *your app's branching*; the project's own rules are tested with spec files in the project repo ([testing.md](testing.md)).

## Diagnostics

By default the SDK logs to the console (prefix `[Featurevisor]`) at `info` and above. Tune or capture:

```js
const f = createFeaturevisor({
  logLevel: 'debug', // very verbose; explains every evaluation step
  onDiagnostic: ({ level, code, message, details, originalError }) => {
    // route to your observability system instead of console
  },
})

f.setLogLevel('debug') // also adjustable at runtime
```

A throwing diagnostic handler never breaks evaluations — the SDK reports the handler failure and continues.

## Modules

Modules intercept evaluation — the mechanism behind analytics activation tracking ([tracking.md](tracking.md)), context enrichment, and custom bucketing:

```js
const myModule = {
  name: 'my-module',
  setup({ getRevision, onDiagnostic, reportDiagnostic }) {},
  before(options) { return options },              // mutate context/options pre-evaluation
  after(evaluation, options) { return evaluation }, // observe/adjust result
  bucketKey({ featureKey, context, bucketBy, bucketKey }) { return bucketKey },
  bucketValue({ featureKey, context, bucketKey, bucketValue }) { return bucketValue },
  close() {},
}

const f = createFeaturevisor({ modules: [myModule] })
// or later: const remove = f.addModule(myModule); await f.removeModule('my-module')
```

## Cleanup

```js
await f.close() // removes listeners, closes modules; instance becomes inert
```

## TypeScript

All types ship with the package:

```ts
import {
  createFeaturevisor,
  type Featurevisor,
  type FeaturevisorOptions,
  type FeaturevisorModule,
  type FeaturevisorDiagnostic,
  type Evaluation,
  type Context,
  type DatafileContent,
} from '@featurevisor/sdk'
```

For compile-time-checked feature keys, variable keys, and context attribute types, generate typed bindings from the project — see [code-generation.md](code-generation.md).

## Integration checklist

When wiring Featurevisor into an application:

1. Find the datafile URL (ask the user, or derive from the project's CI/CDN setup; the file is `featurevisor-<target>.json` per environment).
2. Pick the right environment's datafile per app environment (staging app → staging datafile).
3. Initialize **one** shared instance; set context as identity becomes known (`deviceId` at startup, `userId` after login — match the project's attribute names).
4. Guard code with `isEnabled` / branch on `getVariation` / read config from `getVariable`.
5. Decide a refresh strategy (interval or push) if flags must change without redeploying the app.
6. Server-side: `spawn()` a child per request instead of mutating shared context.
