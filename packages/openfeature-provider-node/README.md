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

The provider maps OpenFeature `targetingKey` to Featurevisor `userId` by default. Configure `targetingKeyField`, `keySeparator`, or `variationKey` when your project needs different names. The underlying instance is available as `provider.featurevisor` for datafile updates and Featurevisor events.

You can also reuse an existing Featurevisor instance:

```ts
import { createFeaturevisor } from '@featurevisor/sdk'

const featurevisor = createFeaturevisor({ datafile })
const provider = new FeaturevisorOpenFeatureProvider({ featurevisor })
```

An instance passed this way remains owned by the caller. Closing the provider does not close it. Call `featurevisor.close()` when every consumer is finished with it. When the provider creates the instance from options, the provider owns and closes it. If an instance and construction options are both supplied, the existing instance takes precedence.

See [Featurevisor OpenFeature documentation](https://featurevisor.com/docs/sdks/openfeature/) for reasons, errors, metadata, tracking, lifecycle, and other language providers.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
