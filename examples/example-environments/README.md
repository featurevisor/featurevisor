# example-environments

Example project modeling `dev`, `staging`, and `production` as independent Featurevisor sets.

Each set contains the same `checkoutFlow` feature key, but rollout behavior differs by release lane.
The project omits `environments`, so feature rules live directly under `rules:` without another environment nesting layer.

```sh
npx featurevisor lint
npx featurevisor build --no-state-files
npx featurevisor test

npx featurevisor build --set=staging --no-state-files
npx featurevisor test --set=production
```
