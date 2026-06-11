# example-environments

Example project modeling `dev`, `staging`, and `production` as independent Featurevisor sets.

Each set contains the same `checkoutFlow` feature key, but rollout behavior differs by release lane.

```sh
npx featurevisor lint
npx featurevisor build --no-state-files
npx featurevisor test

npx featurevisor build --set=staging --no-state-files
npx featurevisor test --set=production
```
