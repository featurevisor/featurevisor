# Targets

Full docs: <https://featurevisor.com/docs/targets>

Targets define the datafiles Featurevisor builds. They live under `targets/`.

```yaml
description: Web app datafile
tag: web
context:
  platform: web
```

Only `description` is required.

## Tags

Use `tag` for one tag, or `tags` for multiple tag selectors like `{ or: [...] }` and `{ and: [...] }`. The arrays must not be empty.

Supported shapes:

```yaml
tag: web
```

```yaml
tags:
  or:
    - ios
    - android
```

```yaml
tags:
  and:
    - web
    - checkout
```

`tag` and `tags` are mutually exclusive. Omit both when the target should not narrow by tag.

## Features

Use `includeFeatures` and `excludeFeatures` to select features by key. Patterns use glob style `*` matching:

```yaml
description: Checkout datafile
includeFeatures:
  - checkout*
  - shared.navigation
excludeFeatures:
  - checkout.internal*
```

Exclusions take precedence over inclusions. If `includeFeatures` is omitted, all features are candidates. To state that explicitly, `*` can be used directly:

```yaml
description: All features
includeFeatures: "*"
```

Pattern arrays must not be empty. Patterns must not have surrounding spaces or repeated `**`. A direct string value is only valid when it is exactly `*`.

Feature and tag selectors are combined with **AND** semantics. If both `tag`/`tags` and `includeFeatures`/`excludeFeatures` are present, a feature must satisfy the tag selector and the feature-key selector to be included.

```yaml
description: Web checkout features
tag: web
includeFeatures:
  - checkout*
```

In this example, a `checkout` feature without the `web` tag is not included, even though its key matches `checkout*`.

If all selectors are omitted, the target includes all non-archived features.

## Context

Target `context` represents values known at build time. Featurevisor applies this context while building the target datafile and removes redundant rules or segments where possible.

In a sets project, a target can carry `promotable: false` to protect an existing destination target from later [promotion](https://featurevisor.com/docs/promotions) updates. A missing destination target is still created.

Use `target` in feature test assertions:

```yaml
assertions:
  - target: web
    environment: production
    at: 50
    context: { userId: "123" }
    expectedToBeEnabled: true
```
