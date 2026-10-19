# OpenFeature providers

Full docs: <https://featurevisor.com/docs/sdks/openfeature/>

[OpenFeature](https://openfeature.dev/) is a vendor neutral feature flag API. Featurevisor ships **providers** that let an application evaluate Featurevisor features through the standard OpenFeature client, in JavaScript (Node.js and browser), Go, Swift, Java and Kotlin, Ruby, Python, PHP, Rust and Elixir.

Providers are **optional**. The native Featurevisor SDKs ([sdk-javascript.md](sdk-javascript.md)) remain fully available and do not depend on OpenFeature.

## When to recommend a provider

Use a provider when:

- The codebase already standardizes on OpenFeature, often while moving from another flagging service, or the team wants to keep the option of swapping vendors without rewriting call sites.
- A platform team mandates one flag interface across services in several languages.

Stay on the native SDK when:

- Featurevisor is the only flag system in play. The native API is simpler and synchronous, and exposes everything: events, sticky values, `spawn`, aggregate feature and variable evaluations and modules. OpenFeature's surface is deliberately smaller.
- You need features specific to Featurevisor at call sites. They are still reachable through `provider.featurevisor`, but then the application uses both APIs.

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
const context = {
  targetingKey: '8f2a',
  country: 'nl',
}

const enabled = await client.getBooleanValue('checkout', false, context)
// true: 8f2a is Dutch, and checkout is on for every Dutch user
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
await OpenFeature.setContext({ targetingKey: '8f2a', country: 'nl' })

const client = OpenFeature.getClient()
const enabled = client.getBooleanValue('checkout', false) // sync in the web SDK
```

Both packages export the same class name, `FeaturevisorOpenFeatureProvider`. Server resolvers are async. Web resolvers are sync and read the context set through `OpenFeature.setContext`.

## Flag keys: one key, three evaluation types

OpenFeature has a single flag key. Featurevisor has flags, variations and variables. Providers bridge that with a key convention:

| OpenFeature key         | Featurevisor evaluation                             |
| ----------------------- | --------------------------------------------------- |
| `checkout`              | flag (`evaluateFlag`)                               |
| `checkout:variation`    | variation (`evaluateVariation`)                     |
| `checkout:title`        | variable `title` (`evaluateVariable`)               |
| `variable:supportEmail` | global variable `supportEmail` (`evaluateVariable`) |

The **first** `:` separates the routing prefix or feature key from the remaining selector. Match the resolver to the Featurevisor value type:

- A plain feature key takes the **boolean resolver only**. Any other resolver returns `TYPE_MISMATCH`.
- `:variation` takes the string resolver.
- `:<variableKey>` takes the resolver matching the variable's type. `array`, `object` and `json` variables all use the **object** resolver, and `json` values are parsed for you.
- `variable:<variableKey>` reads a global variable, compositions included.

The prefix is checked first. `checkout:variable` therefore remains a feature variable named `variable`, while `variable:checkout` is global variable `checkout`.

If a project's own keys collide with the convention, configure `keySeparator` (default `":"`), `variationKey` (default `"variation"`) or `globalVariablePrefix` (default `"variable"`).

## Context and targeting key

The OpenFeature evaluation context is copied into Featurevisor without mutating it, and `targetingKey` is additionally exposed as **`userId`**, matching the usual `bucketBy` convention. If the project buckets by something else, set `targetingKeyField`:

```ts
new FeaturevisorOpenFeatureProvider({ datafile, targetingKeyField: 'deviceId' })
```

Dates are normalized to ISO strings. Nested arrays and objects are preserved.

An explicitly supplied `targetingKey: ''` replaces an existing `userId` or configured targeting field with an empty string in the Node.js and web clients. Omit `targetingKey` to leave that field unchanged. Use a string targeting key in the public OpenFeature API. The JavaScript provider also accepts a finite number through an untyped context as a fallback, but do not rely on it as the portable contract. Go, Swift, Python and PHP have distinct upstream empty key limitations. Follow their provider guides instead of copying the JavaScript behaviour.

OpenFeature owns context merging and **hooks**. Featurevisor modules still run inside Featurevisor's evaluation. Providers do **not** translate hooks into modules or vice versa. Pick the right layer: hooks for concerns across OpenFeature, [modules](sdk-javascript.md#modules) for Featurevisor evaluation concerns, [activation tracking](tracking.md) included.

## Resolution details

Providers return the caller's default value when the feature is missing, the type does not match or evaluation fails.

| Featurevisor reason                                                                 | OpenFeature reason |
| ----------------------------------------------------------------------------------- | ------------------ |
| `forced`, `sticky`, `rule`, `variable_override_variation`, `variable_override_rule` | `TARGETING_MATCH`  |
| `allocated`                                                                         | `SPLIT`            |
| `disabled`, `variation_disabled`, `variable_disabled`, `conditions_unmet`           | `DISABLED`         |
| `feature_not_found`, `variable_not_found`, `no_variations`, `error`                 | `ERROR`            |
| anything else                                                                       | `DEFAULT`          |

The provider retains the Featurevisor evaluation reason in metadata. An unmet root gate reports `conditions_unmet` for both features and global variables and maps to OpenFeature `DISABLED`, regardless of the condition leaf kinds.

Providers resolve composed global variables through the existing global path for the inferred result type. String aliases inherit the source's evaluated type, while map compositions return objects. `variable_composed` maps to `TARGETING_MATCH`. Upgrade every consumer to a v4 SDK and provider before publishing composed datafiles.

Error codes: `FLAG_NOT_FOUND` (missing feature, missing variable, no variations), `TYPE_MISMATCH` (wrong resolver, including non-finite numbers), `PARSE_ERROR` (invalid datafile JSON), `GENERAL` (evaluation error).

A `PARSE_ERROR` is sticky only until a good datafile arrives: every resolution returns the default while the loaded datafile is malformed, and normal resolution resumes as soon as `setDatafile` succeeds. So a bad CDN response degrades to defaults rather than poisoning the provider permanently.

Flag metadata always carries `featurevisorReason` and `schemaVersion`, plus, when present, `featureKey`, `revision`, `variableKey`, `ruleKey`, `bucketKey`, `bucketValue`, `forceIndex`, `variableOverrideIndex` and `variableOverrideKey`. Global variable resolutions carry no `featureKey`, so read `variableKey` to identify them. Variation evaluations also set the OpenFeature `variant`.

That `featurevisorReason` is the debugging bridge: when a value surprises someone, read it, then reproduce with `npx featurevisor evaluate` in the project ([querying.md](querying.md)).

## Instance ownership and lifecycle

The provider either creates its own Featurevisor instance or reuses one from the application. **Ownership decides who closes it.**

```ts
// the provider creates and owns the instance, and closes it on shutdown
const provider = new FeaturevisorOpenFeatureProvider({ datafile, modules, onDiagnostic })

// the application owns the instance, which provider shutdown does NOT close
const featurevisor = createFeaturevisor({ datafile })
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor })
```

Either way `provider.featurevisor` exposes the instance for datafile updates, events, diagnostics, sticky values and everything else the native SDK offers. That is how an application keeps refreshing datafiles while serving evaluations through OpenFeature.

If both `featurevisor` and construction options such as `datafile` and `modules` are passed, **the existing instance wins** and the construction options are ignored. Provider options (`targetingKeyField`, `keySeparator`, `variationKey`, `globalVariablePrefix`, `onTrack`) still apply. Call `featurevisor.close()` yourself once every consumer is done.

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

Every provider follows the same key convention, context mapping, reason mapping and ownership rules. Only packaging differs. Each is published separately, so applications without OpenFeature do not pull in the dependency.

| Platform | Notes                                                                  |
| -------- | ---------------------------------------------------------------------- |
| Node.js  | `@featurevisor/openfeature-provider-node` + `@openfeature/server-sdk`  |
| Browser  | `@featurevisor/openfeature-provider-web` + `@openfeature/web-sdk`      |
| Go       | Separate Go module                                                     |
| Swift    | `FeaturevisorOpenFeature` library product (explicit close available)   |
| Java     | Separate artifact, versioned with the Java SDK                         |
| Ruby     | Separate gem (requires Ruby 3.4+, per the OpenFeature Ruby SDK)        |
| Python   | `featurevisor.openfeature` module with OpenFeature Python SDK `0.10.x` |
| PHP      | OpenFeature PHP SDK `2.x` (explicit shutdown available)                |
| Kotlin   | the Java provider                                                      |
| Rust     | see the Rust SDK page                                                  |
| Elixir   | see the Elixir SDK page                                                |

Setup for each language lives on its SDK page, in the "OpenFeature" section. See [sdk-other-languages.md](sdk-other-languages.md) for the index.

A complete runnable server example: <https://github.com/featurevisor/featurevisor-example-openfeature-nodejs>

## Authoring implications

Nothing about the project's YAML changes when an app uses OpenFeature. Two things are worth telling users:

- **Variable keys become part of the flag key string** (`checkout:paymentMethods`). Renaming a variable breaks OpenFeature call sites exactly as renaming a feature does.
- If a feature key ever contains the separator character, set a different `keySeparator` rather than renaming the feature.
