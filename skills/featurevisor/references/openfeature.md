# OpenFeature providers

Full docs: <https://featurevisor.com/docs/sdks/openfeature>

[OpenFeature](https://openfeature.dev/) is a vendor-neutral feature-flag API. Featurevisor ships **providers** that let an application evaluate Featurevisor features through the standard OpenFeature client, in JavaScript (Node.js and browser), Go, Swift, Java, Ruby, Python, and PHP.

Providers are **optional**. The native Featurevisor SDKs ([sdk-javascript.md](sdk-javascript.md)) remain fully available and don't depend on OpenFeature.

## When to recommend a provider (and when not to)

Use a provider when:

- The codebase already standardizes on OpenFeature, or the team wants to keep the option of swapping vendors without rewriting call sites.
- A platform team mandates one flag interface across services in several languages.

Stay on the native SDK when:

- Featurevisor is the only flag system in play. The native API is simpler, synchronous, and exposes everything (events, sticky, `spawn`, `getAllEvaluations`, modules) — OpenFeature's surface is deliberately smaller.
- You need Featurevisor-specific features at call sites. They're still reachable through `provider.featurevisor`, but at that point you're using both APIs.

The two mix cleanly: an application can hand an existing Featurevisor instance to the provider and keep using both.

## Install and set up (JavaScript)

Server (Node.js):

```bash
npm install @featurevisor/openfeature-provider-node @openfeature/server-sdk
```

```ts
import { OpenFeature } from '@openfeature/server-sdk'
import { FeaturevisorOpenFeatureProvider } from '@featurevisor/openfeature-provider-node'

const provider = new FeaturevisorOpenFeatureProvider({ datafile })
await OpenFeature.setProviderAndWait(provider)

const client = OpenFeature.getClient()
const enabled = await client.getBooleanValue('checkout', false, {
  targetingKey: 'user-123',
  country: 'nl',
})
```

Browser:

```bash
npm install @featurevisor/openfeature-provider-web @openfeature/web-sdk
```

```ts
import { OpenFeature } from '@openfeature/web-sdk'
import { FeaturevisorOpenFeatureProvider } from '@featurevisor/openfeature-provider-web'

const provider = new FeaturevisorOpenFeatureProvider({ datafile })
await OpenFeature.setProviderAndWait(provider)
await OpenFeature.setContext({ targetingKey: 'user-123', country: 'nl' })

const client = OpenFeature.getClient()
const enabled = client.getBooleanValue('checkout', false) // sync in the web SDK
```

Both packages export the same class name, `FeaturevisorOpenFeatureProvider`. Server resolvers are async; web resolvers are sync and read from the context set via `OpenFeature.setContext`.

## Flag keys: one key, three evaluation types

OpenFeature has a single flag key; Featurevisor has flags, variations, and variables. Providers bridge that with a suffix convention:

| OpenFeature key      | Featurevisor evaluation                  |
| -------------------- | ---------------------------------------- |
| `checkout`           | flag (`evaluateFlag`)                    |
| `checkout:variation` | variation (`evaluateVariation`)          |
| `checkout:title`     | variable `title` (`evaluateVariable`)    |

The **first** `:` separates feature key from selector. Match the resolver to the Featurevisor value type:

- Plain feature key → **boolean resolver only**. Any other resolver returns `TYPE_MISMATCH`.
- `:variation` → string resolver.
- `:<variableKey>` → resolver matching the variable's type; `array`, `object`, and `json` variables all use the **object** resolver (`json` values are parsed for you).

If a project's own keys collide with the convention, configure `keySeparator` (default `":"`) and `variationKey` (default `"variation"`).

## Context and targeting key

The OpenFeature evaluation context is copied into Featurevisor without mutating it, and `targetingKey` is additionally exposed as **`userId`** — matching the usual `bucketBy` convention. If the project buckets by something else, set `targetingKeyField`:

```ts
new FeaturevisorOpenFeatureProvider({ datafile, targetingKeyField: 'deviceId' })
```

Dates are normalized to ISO strings; nested arrays and objects are preserved.

OpenFeature owns context merging and **hooks**; Featurevisor modules still run inside Featurevisor's evaluation. Providers do **not** translate hooks into modules or vice versa — pick the right layer: hooks for OpenFeature-wide concerns, [modules](sdk-javascript.md#modules) for Featurevisor evaluation concerns (including [activation tracking](tracking.md)).

## Resolution details

Providers return the caller's default value when the feature is missing, the type doesn't match, or evaluation fails.

| Featurevisor reason                                                                              | OpenFeature reason |
| ------------------------------------------------------------------------------------------------ | ------------------ |
| `required`, `forced`, `sticky`, `rule`, `variable_override_variation`, `variable_override_rule`   | `TARGETING_MATCH`  |
| `allocated`                                                                                      | `SPLIT`            |
| `disabled`, `variation_disabled`, `variable_disabled`                                            | `DISABLED`         |
| `feature_not_found`, `variable_not_found`, `no_variations`, `error`                              | `ERROR`            |
| anything else                                                                                    | `DEFAULT`          |

Error codes: `FLAG_NOT_FOUND` (missing feature, missing variable, no variations), `TYPE_MISMATCH` (wrong resolver, including non-finite numbers), `PARSE_ERROR` (invalid datafile JSON), `GENERAL` (evaluation error).

A `PARSE_ERROR` is sticky only until a good datafile arrives: every resolution returns the default while the loaded datafile is malformed, and normal resolution resumes as soon as `setDatafile` succeeds. So a bad CDN response degrades to defaults rather than poisoning the provider permanently.

Flag metadata carries `featureKey`, `featurevisorReason`, `schemaVersion`, and — when present — `revision`, `variableKey`, `ruleKey`, `bucketKey`, `bucketValue`, `forceIndex`, `variableOverrideIndex`. Variation evaluations also set the OpenFeature `variant`.

That `featurevisorReason` is the debugging bridge: when a value surprises someone, read it, then reproduce with `npx featurevisor evaluate` in the project ([querying.md](querying.md)).

## Instance ownership and lifecycle

The provider either creates its own Featurevisor instance or reuses one from the application. **Ownership decides who closes it.**

```ts
// provider creates and owns the instance — closed on provider shutdown
const provider = new FeaturevisorOpenFeatureProvider({ datafile, modules, onDiagnostic })

// application owns the instance — NOT closed by provider shutdown
const featurevisor = createFeaturevisor({ datafile })
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor })
```

Either way `provider.featurevisor` exposes the instance for datafile updates, events, diagnostics, sticky, and everything else the native SDK offers — this is how you keep refreshing datafiles while serving evaluations through OpenFeature.

If both `featurevisor` and construction options (`datafile`, `modules`, …) are passed, **the existing instance wins** and the construction options are ignored; provider options (`targetingKeyField`, `keySeparator`, `variationKey`, `onTrack`) still apply. Call `featurevisor.close()` yourself once every consumer is done.

## Tracking

`client.track(...)` is a **no-op unless** the provider is given an `onTrack` handler:

```ts
new FeaturevisorOpenFeatureProvider({
  datafile,
  onTrack: ({ name, context, details }) => analytics.track(name, { ...context, ...details }),
})
```

For experiment activation specifically, a Featurevisor [module](tracking.md) is usually the better hook because it fires on evaluation rather than requiring explicit `track` calls.

## Other languages

Every provider follows the same key convention, context mapping, reason mapping, and ownership rules; only packaging differs. Each is published separately so non-OpenFeature applications don't pull the dependency.

| Platform | Notes                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Node.js  | `@featurevisor/openfeature-provider-node` + `@openfeature/server-sdk`    |
| Browser  | `@featurevisor/openfeature-provider-web` + `@openfeature/web-sdk`        |
| Go       | Separate Go module                                                       |
| Swift    | `FeaturevisorOpenFeature` library product (explicit close available)      |
| Java     | Separate artifact, versioned with the Java SDK                            |
| Ruby     | Separate gem (requires Ruby 3.4+, per the OpenFeature Ruby SDK)          |
| Python   | `featurevisor.openfeature` module; OpenFeature Python SDK `0.10.x`        |
| PHP      | OpenFeature PHP SDK `2.x` (explicit shutdown available)                   |

Per-language setup lives on each SDK page under its "OpenFeature" section — see [sdk-other-languages.md](sdk-other-languages.md) for the index.

A complete runnable server example: <https://github.com/featurevisor/featurevisor-example-openfeature-nodejs>

## Authoring implications

Nothing about the project's YAML changes when an app uses OpenFeature. Two things are worth telling users:

- **Variable keys become part of the flag-key string** (`checkout:paymentMethods`). Renaming a variable breaks OpenFeature call sites exactly like renaming a feature does.
- If a feature key ever contains the separator character, set a different `keySeparator` rather than renaming the feature.
