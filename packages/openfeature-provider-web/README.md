# Featurevisor OpenFeature provider for browsers

Use Featurevisor through the OpenFeature Web SDK in browser applications.

## Installation

```sh
npm install @featurevisor/openfeature-provider-web @openfeature/web-sdk
```

## Usage

```ts
import { OpenFeature } from '@openfeature/web-sdk'
import { FeaturevisorOpenFeatureProvider } from '@featurevisor/openfeature-provider-web'

const provider = new FeaturevisorOpenFeatureProvider({ datafile })
await OpenFeature.setProviderAndWait(provider)
await OpenFeature.setContext({ targetingKey: 'user-123', country: 'nl' })

const client = OpenFeature.getClient()
const enabled = client.getBooleanValue('checkout', false)
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
