---
title: Scopes
nextjs:
  metadata:
    title: Scopes
    description: Scopes have been replaced by Targets in Featurevisor.
    openGraph:
      title: Scopes
      description: Scopes have been replaced by Targets in Featurevisor.
      images:
        - url: /img/og/docs.png
---

Scopes have been replaced by [Targets](/docs/targets/). Everything that scopes used to do is now handled by target definitions. {% .lead %}

## What changed

In earlier versions of Featurevisor, scopes were configured inside `featurevisor.config.js` to generate smaller and more optimized [datafiles](/docs/building-datafiles/) by:

- picking [features](/docs/features/) belonging to one or more [tags](/docs/tags/), and
- applying a partially known [context](/docs/sdks/javascript/#context) to remove redundant rules and segments.

Targets now own that responsibility. Instead of generating a datafile per tag and an extra datafile per scope, every datafile is now produced from a target definition that lives in the `targets` directory.

The `scopes` key in `featurevisor.config.js` is no longer supported. If it is present, Featurevisor will throw an error asking you to define [targets](/docs/targets/) instead.

## Mapping scopes to targets

A scope used to be defined like this:

```js {% path="featurevisor.config.js" %}
module.exports = {
  scopes: [
    {
      name: 'browsers',
      tag: 'web',
      context: { platform: 'web' },
    },
  ],
}
```

The same intent is now expressed as a target file:

```yml {% path="targets/browsers.yml" %}
description: Web browsers
tag: web
context:
  platform: web
```

Both `tag` and `tags` selectors carry over unchanged, including the `or` and `and` shapes for selecting multiple tags. The partially known `context` works exactly as before: Featurevisor applies it while building the target datafile and removes any rules or segments that are no longer relevant.

## Testing

The `scope` property in test assertions, and the `--with-scopes` CLI flag, are no longer available. Assertions now choose a [target](/docs/targets/) directly:

```yml {% path="tests/features/showBanner.spec.yml" highlight="4" %}
feature: showBanner
assertions:
  - environment: production
    target: browsers
    at: 10
    context: {}
    expectedToBeEnabled: true
```

The test runner builds target datafiles in memory automatically, so no extra flag is needed.

## Learn more

- [Targets](/docs/targets/): define the datafiles your project builds
- [Tags](/docs/tags/): group features so targets can select them
- [Building datafiles](/docs/building-datafiles/): how datafiles are generated from targets
