# Featurevisor OpenFeature provider for Node.js

Use Featurevisor through the OpenFeature server SDK in Node.js.

## Installation

```sh
npm install @featurevisor/openfeature-provider-node @openfeature/server-sdk
```

## Usage

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

OpenFeature keys map to Featurevisor evaluations:

| Key                  | Evaluation             |
| -------------------- | ---------------------- |
| `checkout`           | flag                   |
| `checkout:variation` | variation              |
| `checkout:title`     | variable named `title` |

Use the resolver matching the Featurevisor value type. Boolean variables use the boolean resolver with a suffixed key. Arrays, objects, and JSON variables use the object resolver.

The provider maps OpenFeature `targetingKey` to Featurevisor `userId` by default. Configure `targetingKeyField`, `keySeparator`, or `variationKey` when your project needs different names.

## Featurevisor instance

The provider can create and own a Featurevisor instance, or reuse one created by your application.

### Let the provider create the instance

Pass normal Featurevisor options to the provider:

```ts
const provider = new FeaturevisorOpenFeatureProvider({
  datafile,
  modules,
  onDiagnostic,
})
```

The provider exposes the created instance as `provider.featurevisor`. You can use it for datafile updates, events, diagnostics, and other Featurevisor APIs. When OpenFeature closes the provider, the provider closes this instance and releases its resources.

### Reuse an existing instance

Pass an instance created with `createFeaturevisor()` using the `featurevisor` option:

```ts
import { OpenFeature } from '@openfeature/server-sdk'
import { createFeaturevisor } from '@featurevisor/sdk'
import { FeaturevisorOpenFeatureProvider } from '@featurevisor/openfeature-provider-node'

const featurevisor = createFeaturevisor({ datafile })
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor })

await OpenFeature.setProviderAndWait(provider)
```

The same instance is available as `provider.featurevisor`. Evaluations, datafile updates, modules, diagnostics, and events continue to use that instance.

An instance passed this way remains owned by your application. Closing the OpenFeature provider does not close it, so other consumers can continue using it. Call `featurevisor.close()` when every consumer is finished.

If `featurevisor` and Featurevisor construction options such as `datafile` or `modules` are supplied together, the existing instance takes precedence and the construction options are ignored. Provider options such as `targetingKeyField`, `keySeparator`, `variationKey`, and `onTrack` still apply.

See [Featurevisor OpenFeature documentation](https://featurevisor.com/docs/sdks/openfeature/) for reasons, errors, metadata, tracking, lifecycle, and other language providers.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
