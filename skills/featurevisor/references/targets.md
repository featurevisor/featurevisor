# Targets

Full docs: <https://featurevisor.com/docs/targets>

Targets define the datafiles Featurevisor builds. They live under `targets/`.

```yaml
description: Web app
tags:
  - web
context:
  platform: web
```

Only `description` is required. Omit `tags` to include all non-archived features.

Use `target` in feature test assertions:

```yaml
assertions:
  - target: web
    environment: production
    at: 50
    context: { userId: "123" }
    expectedToBeEnabled: true
```
