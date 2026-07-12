# example-test-environments

Example project modeling `dev`, `staging`, and `production` as independent Featurevisor sets with promotion flows.

Each set contains the same `checkoutFlow` feature key, but rollout behavior differs by release lane.
The project omits `environments`, so feature rules live directly under `rules:` without another environment nesting layer.

```sh
npx featurevisor lint --set=dev
npx featurevisor test --set=dev

npx featurevisor promote --from=dev --to=staging
npx featurevisor promote --from=dev --to=staging --apply --audit=markdown

npx featurevisor lint --set=staging
npx featurevisor test --set=staging
npx featurevisor build --set=staging --no-state-files
```
