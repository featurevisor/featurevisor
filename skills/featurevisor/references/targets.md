# Targets

Full docs: <https://featurevisor.com/docs/targets>

Targets define the datafiles Featurevisor builds. They live under `targets/`.

```yaml
description: Web app
tag: web
context:
  platform: web
```

Only `description` is required. Use `tag` for one tag, or `tags` for multi-tag selectors like `{ or: [...] }` and `{ and: [...] }`. `tag` and `tags` are mutually exclusive. Omit both to include all non-archived features.

In a sets project, a target can carry `promotable: false` to keep it out of [promotions](https://featurevisor.com/docs/promotions).

Use `target` in feature test assertions:

```yaml
assertions:
  - target: web
    environment: production
    at: 50
    context: { userId: "123" }
    expectedToBeEnabled: true
```
