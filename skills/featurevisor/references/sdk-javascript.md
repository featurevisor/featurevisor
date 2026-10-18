# JavaScript and TypeScript SDK

Full docs: <https://featurevisor.com/docs/sdks/javascript/>

`@featurevisor/sdk` is universal: the same package runs in Node.js, browsers, edge runtimes and React Native. It evaluates a loaded [datafile](building-datafiles.md) locally. **No network call happens at evaluation time**, so evaluations are synchronous.

Framework wrappers: [sdk-react.md](sdk-react.md) and [sdk-vue.md](sdk-vue.md). Other languages: [sdk-other-languages.md](sdk-other-languages.md). The vendor neutral alternative: [openfeature.md](openfeature.md). Upgrading an application from v3: [upgrading-to-v4.md](upgrading-to-v4.md#applications).

## Install and initialize

```bash
npm install --save @featurevisor/sdk
```

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const response = await fetch('https://cdn.yoursite.com/featurevisor-all.json')
const datafile = await response.json()

const f = createFeaturevisor({ datafile })
```

| Option            | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `datafile`        | Datafile content, as an object or JSON string. Can be set later   |
| `context`         | Initial [context](#context)                                       |
| `stickyFeatures`  | Feature results consulted before the datafile ([Sticky](#sticky)) |
| `stickyVariables` | Global variable values consulted before the datafile              |
| `logLevel`        | `fatal`, `error`, `warn`, `info` (default) or `debug`             |
| `onDiagnostic`    | Handler replacing console output ([Diagnostics](#diagnostics))    |
| `modules`         | Evaluation interceptors ([Modules](#modules))                     |

Create **one instance per application** and share it. On servers, [spawn a child per request](#child-instances-server-side).

## Context

Context is the object of [attribute](attributes.md) values evaluations run against.

```js
const f = createFeaturevisor({
  context: {
    deviceId: 'd-123',
    country: 'nl',
  },
})

// merge more later, for example after signing in
f.setContext({ userId: '8f2a' })

// replace entirely
f.setContext({ deviceId: 'd-123', userId: '8f2a' }, true)

// or per evaluation, merged over the instance context for that call only
const context = {
  country: 'de',
}

f.isEnabled('checkout', context)
```

Attribute names and types must match the project's `attributes/`. Check with `npx featurevisor list --attributes --json` instead of guessing. The SDK does not validate context, so a wrong type silently fails to match.

- **Timestamps** for `format: date-time` attributes: pass a `Date` or a full ISO 8601 string with a timezone, such as `'2026-11-28T10:00:00Z'`. A date only string makes `before` and `after` false.
- **Versions**: pass strings such as `'5.5.0'`.
- **Objects**: pass the object, such as `account: { plan: 'paid' }`, for dotted attribute paths.

## Evaluate

```js
const context = {
  userId: '8f2a',
  country: 'nl',
}

// flag: boolean
if (f.isEnabled('checkout', context)) {
  // ...
}

// variation: string or null
const variation = f.getVariation('pricing', context)

// feature variable: typed value or null
const label = f.getVariable('buyButton', 'label', context)

// global variable: two arguments
const supportEmail = f.getVariable('supportEmail', context)
```

Typed getters return `null` when the stored value does not match the requested type, without coercion:

```ts
f.getVariableBoolean(featureKey, variableKey, context?)
f.getVariableString(featureKey, variableKey, context?)
f.getVariableInteger(featureKey, variableKey, context?)
f.getVariableNumber(featureKey, variableKey, context?)
f.getVariableArray<T = unknown>(featureKey, variableKey, context?)
f.getVariableObject<T>(featureKey, variableKey, context?)
f.getVariableJSON<T>(featureKey, variableKey, context?)
```

Each also takes `(globalVariableKey, context?)` for a global variable. `getVariableNumber` reads `number` variables, including `double` variables in datafiles built by v3.

Namespaced keys use the project's separator: `f.isEnabled('checkout.promo')`.

### Fallbacks per call

```js
f.getVariation('pricing', context, { defaultVariationValue: 'control' })
f.getVariable('checkout', 'paymentMethods', context, { defaultVariableValue: ['card'] })
```

Defaults are presence based: `""`, `0`, `false` and `null` are honoured as written. Do not write `getVariable(...) || 'x'`, which discards a deliberate `false` or `0`. Prefer `defaultValue`, `disabledValue` and `useDefaultWhenDisabled` in the project. Per call defaults are the application's safety net.

### Several at once

```js
const features = f.getFeatureEvaluations(context)
// { checkout: { enabled: true, variation: 'control', variables: { … } }, … }

const variables = f.getVariableEvaluations(context)
// { supportEmail: 'support@example.com', … }
```

An optional second argument limits either to selected keys. Both maps can be passed straight to another instance as `stickyFeatures` and `stickyVariables`, which is how [SSR handoff](#ssr-handoff) works.

### Global variables and compositions

Global variables, aliases and compositions all read through the two argument getters. A string alias such as `compose: supportEmail` returns its source's type, so use the source's getter, such as `getVariableString`. A `compose` map returns an object: read it with `getVariable` or `getVariableObject`. Returned objects and arrays may be shared with the SDK's internal state, so treat them as read only.

### Why did it evaluate that way?

```js
f.evaluateFlag('checkout', context)
f.evaluateVariation('pricing', context)
f.evaluateVariable('buyButton', 'label', context)
f.evaluateVariable('supportEmail', context)
```

Each returns an evaluation with `type` and `reason`, plus fields such as `bucketValue` (0 to 100,000), `ruleKey`, `enabled`, `variation`, `variableValue`, `variableOverrideKey` and `variableOverridePath`. Reasons:

| Reason                                                     | Meaning                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `sticky`                                                   | a sticky value supplied the result                                    |
| `forced`                                                   | a force entry matched                                                 |
| `rule`                                                     | a rule matched, or set the variation or variable                      |
| `allocated`                                                | the bucket fell in a variation's range                                |
| `conditions_unmet`                                         | the root gate failed                                                  |
| `no_match`                                                 | no rule matched, or the bucket is above the matched rule's percentage |
| `disabled`, `variation_disabled`, `variable_disabled`      | the feature is disabled, so the disabled fallback applies             |
| `variable_default`                                         | the variable's default applied                                        |
| `variable_override_rule`, `variable_override_variation`    | a variable override matched                                           |
| `variable_composed`                                        | a composition was assembled                                           |
| `feature_not_found`, `variable_not_found`, `no_variations` | missing from the datafile or schema                                   |
| `error`                                                    | evaluation failed, for example a dependency cycle                     |

When debugging definitions rather than application code, use `npx featurevisor evaluate --explain` in the project ([querying.md](querying.md)).

### Inspect the loaded datafile

```js
f.getRevision() // the datafile revision this instance runs
f.getSchemaVersion() // "4" for v4 datafiles
f.getFeatureKeys()
f.getFeature('checkout') // raw definition, or undefined
f.getVariableKeys() // global variables
f.getVariableKeys('checkout') // feature variables of checkout
f.hasVariations('checkout')
```

**Check `getRevision()` first** when an application and the project disagree. The application is usually holding an older datafile. `getFeature(key) === undefined` means the feature is not in this target's datafile: a target or tag question, not a rule question.

## Set and refresh the datafile

```js
f.setDatafile(datafile) // merge (default)
f.setDatafile(datafile, true) // replace
```

`setDatafile` returns `true` when accepted, including unchanged content, and `false` when rejected or the instance is closed. A rejected update keeps the previous datafile.

Merging, the default, overrides matching keys and keeps the rest, so several target datafiles can be loaded into one instance on demand:

```js
const f = createFeaturevisor({})

async function load(target) {
  const response = await fetch(`https://cdn.yoursite.com/featurevisor-${target}.json`)
  f.setDatafile(await response.json())
}

await load('products')
// later, when the user reaches checkout
await load('checkout')
```

When **refreshing** the same datafile, replace with `true`, so definitions removed upstream do not linger. The SDK never fetches on its own:

```js
setInterval(async () => {
  const response = await fetch(datafileUrl)
  if (response.ok) f.setDatafile(await response.json(), true)
}, 5 * 60 * 1000)
```

## Events

```js
const unsubscribe = f.on('datafile_set', ({ revision, previousRevision, revisionChanged, features, variables, replaced }) => {
  // features and variables list everything whose result may have changed,
  // including through segments, conditions and compositions
})

f.on('context_set', ({ context, replaced }) => {})
f.on('sticky_features_set', ({ features, replaced }) => {})
f.on('sticky_variables_set', ({ variables, replaced }) => {})
f.on('error', ({ diagnostic }) => {})

unsubscribe()
```

## Sticky

Sticky values are application supplied results consulted before the datafile. Use them when the application already knows the answer, to freeze an experience during a session, or for SSR handoff:

```js
f.setStickyFeatures({
  checkout: {
    enabled: true,
    variation: 'treatment',
    variables: { paymentMethods: ['ideal'] },
  },
})

f.setStickyVariables({ supportEmail: 'help@example.com' })
// a second argument of true replaces instead of merging
```

To force a known user or QA into a result, prefer a reviewed `force` entry in the project ([features.md](features.md#force)). Sticky is application state.

## Child instances (server side)

A server handles many users at once. `spawn()` creates a cheap child with request scoped context:

```js
// once, at startup
const f = createFeaturevisor({ datafile })

// per request
app.get('/dashboard', (req, res) => {
  const child = f.spawn({ userId: req.user.id, country: req.user.country })

  try {
    if (child.isEnabled('newDashboard')) {
      // ...
    }
  } finally {
    child.close()
  }
})
```

Children have every evaluation method, `setContext`, `setStickyFeatures`, `setStickyVariables`, `getFeatureEvaluations`, `getVariableEvaluations`, `on` and `close`. `spawn(context, { stickyFeatures, stickyVariables })` sets child sticky values. Children do not inherit sticky values from the parent, and see parent datafile updates automatically.

Context model, the same in every SDK: a child snapshots the parent context at spawn time, keeps inheriting parent keys added later, and its own keys always win.

**Always `close()` a child** when the request ends, or its listeners leak on the long lived parent.

### SSR handoff

Evaluate once on the server and hand the results to the client as sticky values, so the first client render matches:

```js
// server, per request
const child = f.spawn({ userId: req.user.id })
const stickyFeatures = child.getFeatureEvaluations()
const stickyVariables = child.getVariableEvaluations()
// serialize both into the page

// client, at startup
const f = createFeaturevisor({
  stickyFeatures: window.__FEATURES__,
  stickyVariables: window.__VARIABLES__,
})
// once a datafile is loaded, clear the sticky maps to return to live rules
```

## Resilience

Evaluations never throw: `isEnabled` returns `false` and the getters return `null`, with a diagnostic. Plan for a failed fetch:

- Make the disabled path the safe path in application code.
- For critical screens, bundle a datafile snapshot as a fallback, then replace it with a fetched one.
- Route the `error` event or diagnostics to monitoring, so silent fallback is noticed.

## Testing application code

Unit tests do not need a datafile. Sticky values force any result:

```js
const f = createFeaturevisor({
  stickyFeatures: {
    checkout: { enabled: true, variation: 'treatment' },
    newDashboard: { enabled: false },
  },
  stickyVariables: {
    supportEmail: 'test@example.com',
  },
})
```

For tests closer to production, print a datafile from the project with `npx featurevisor build --print` and pass it as `datafile`. The project's own rules are tested with its specs ([testing.md](testing.md)).

## Diagnostics

```js
const f = createFeaturevisor({
  logLevel: 'debug', // explains every evaluation step
  onDiagnostic: ({ level, code, message, details, originalError }) => {
    // route to your observability system instead of the console
  },
})

f.setLogLevel('warn')
```

A throwing diagnostic handler never breaks evaluation. Codes worth knowing:

- `deprecated_feature` and `deprecated_variable`: something deprecated is still read, at `warn` level. A feature variable's details include `featureKey`, a global variable's do not.
- `conditions_parse_error`: malformed stringified selector JSON in the datafile. It is reported at error level once per selector per datafile load, on first read for v4 datafiles and during `setDatafile()` for v3 datafiles, with details `{ conditions: raw, entityType, entityKey }` where `entityType` is `'feature'`, `'segment'` or `'variable'`. The whole selector returns false, even under NOT referencing a malformed segment, and other entities keep working. Replacing an entity lets its diagnostic fire again. Retained entities do not repeat it.
- `evaluation_error`: a dependency cycle or too deep a chain. The getter returns `false` or `null` with reason `error`.

## Modules

Modules intercept evaluation. They power analytics ([tracking.md](tracking.md)), context enrichment and custom bucketing:

```js
const myModule = {
  name: 'my-module',
  setup({ getRevision, onDiagnostic, reportDiagnostic }) {},
  beforeEvaluation(options) {
    return options // may adjust context
  },
  afterEvaluation(evaluation, options) {
    return evaluation // always return it
  },
  bucketKey({ featureKey, context, bucketBy, bucketKey }) {
    return bucketKey
  },
  bucketValue({ featureKey, context, bucketKey, bucketValue }) {
    return bucketValue
  },
  close() {},
}

const f = createFeaturevisor({ modules: [myModule] })
// or later
const remove = f.addModule(myModule)
```

- `beforeEvaluation` and `afterEvaluation` run for feature and global variable evaluations. A variable evaluation without `featureKey` is a global variable.
- **Always return** the options or evaluation from every branch. Returning nothing turns every flag off.
- Dependency reads from conditions arrive with `options.dependencyPurpose === 'condition'` and `dependencyOf`. Skip them when recording exposure. Reads for a composition arrive with `'composition'` and are real exposures.
- `bucketKey` and `bucketValue` apply to features only. Global variables are never bucketed.

`await f.close()` removes listeners and closes modules when the application shuts down.

## TypeScript

```ts
import {
  createFeaturevisor,
  type Featurevisor,
  type FeaturevisorOptions,
  type FeaturevisorModule,
  type Evaluation,
  type Context,
  type DatafileContent,
} from '@featurevisor/sdk'
```

For compile time checked keys and value types, generate bindings from the project ([code-generation.md](code-generation.md)).

## Integration checklist

1. Find the datafile URL from the project's deployment. The default scaffold builds `datafiles/featurevisor-all.json`. Targets and environments add others.
2. Choose the datafile for this application: its target, and its environment when configured.
3. Create **one** instance. Set context as identity becomes known: `deviceId` at startup, `userId` after sign in, with the project's attribute names.
4. Branch with `isEnabled` and `getVariation`, and read configuration with the variable getters.
5. Decide a refresh strategy if changes must arrive without redeploying the application.
6. On servers, `spawn()` a child per request instead of changing shared context.
7. Check the installed SDK version against the [compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) for the capabilities the project uses.
