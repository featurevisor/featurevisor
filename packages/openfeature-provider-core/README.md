# @featurevisor/openfeature-provider-core

Shared mapping used by Featurevisor's Node.js and browser OpenFeature providers.

An explicitly present string `targetingKey`, including `''`, replaces the configured Featurevisor targeting field. Untyped JavaScript contexts can also use finite numbers, including `0`. Nonfinite numbers do not replace the field.

Applications should install [`@featurevisor/openfeature-provider-node`](https://www.npmjs.com/package/@featurevisor/openfeature-provider-node) or [`@featurevisor/openfeature-provider-web`](https://www.npmjs.com/package/@featurevisor/openfeature-provider-web) instead of using this package directly.

See the [Featurevisor OpenFeature guide](https://featurevisor.com/docs/sdks/openfeature/) for key mapping, context, resolution details, tracking, and lifecycle behaviour.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
