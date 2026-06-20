---
title: Targets
nextjs:
  metadata:
    title: Targets
    description: Define Featurevisor datafile targets with feature patterns, tag filters, and build-time context.
    openGraph:
      title: Targets
      description: Define Featurevisor datafile targets with feature patterns, tag filters, and build-time context.
      images:
        - url: /img/og/docs.png
---

Targets define the datafiles that Featurevisor builds. A target can represent an app, platform, surface, or any other runtime artifact shape. {% .lead %}

## Defining Targets

Create target files in the `targets` directory:

```yml {% path="targets/web.yml" %}
description: Web app datafile
tag: web
context:
  platform: web
```

Only `description` is required.

## Tags

Target `tag` selects features matching one tag:

```yml {% path="targets/web.yml" %}
description: Web app
tag: web
```

Use `tags` when a target needs a multi-tag selector:

```yml {% path="targets/mobile.yml" %}
description: Mobile apps
tags:
  or:
    - ios
    - android
```

Supported shapes:

- `tag: "web"`
- `tags: ["web"]`
- `tags: { or: ["web", "mobile"] }`
- `tags: { and: ["web", "checkout"] }`

`tag` and `tags` are mutually exclusive. If both are omitted, the target includes all non-archived features.

## Features

Use `includeFeatures` and `excludeFeatures` to select features by key. Patterns support `*` wildcards:

```yml {% path="targets/checkout.yml" %}
description: Checkout datafile
includeFeatures:
  - checkout*
  - shared.navigation
excludeFeatures:
  - checkout.internal*
```

Exclusions take precedence over inclusions. If `includeFeatures` is omitted, all features are candidates. To state that explicitly, `*` can be used directly:

```yml {% path="targets/all.yml" %}
description: All features
includeFeatures: "*"
```

Feature and tag selectors are combined with AND semantics. A feature must match both selectors to be included:

```yml {% path="targets/web-checkout.yml" %}
description: Web checkout features
tag: web
includeFeatures:
  - checkout*
```

In this example, a `checkout` feature without the `web` tag is not included, even though its key matches `checkout*`.

## Context

Target `context` represents values known at build time. Featurevisor applies this context while building the target datafile and removes redundant rules or segments where possible.

```yml {% path="targets/chrome.yml" %}
description: Chrome users
tag: web
context:
  browser: chrome
```

## Build Output

`npx featurevisor build` writes one datafile per target and environment:

```{% title="Output" %}
datafiles/staging/featurevisor-web.json
datafiles/production/featurevisor-web.json
```

Projects without environments write directly under `datafiles`:

```{% title="Output" %}
datafiles/featurevisor-web.json
```

Nested target files keep their directory structure:

```{% title="Nested target" %}
targets/apps/admin.yml
datafiles/apps/featurevisor-admin.json
```

## Testing

Feature assertions can choose a target:

```yml {% path="tests/features/checkout.spec.yml" %}
feature: checkout
assertions:
  - target: web
    environment: production
    at: 50
    context:
      userId: "123"
    expectedToBeEnabled: true
```

The test runner builds target datafiles in memory automatically.
