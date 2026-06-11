# example-sets

Example project demonstrating independent Featurevisor sets.

Each set under `sets/` owns its own attributes, segments, features, and tests.
The same feature key can exist in multiple sets with different rollout rules.

```sh
npx featurevisor lint
npx featurevisor build --no-state-files
npx featurevisor test

npx featurevisor build --set=storefront --no-state-files
npx featurevisor test --set=admin
```
