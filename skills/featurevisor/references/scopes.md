# Scopes

Full docs: <https://featurevisor.com/docs/scopes>

**Scopes produce smaller, partially-pre-evaluated datafiles** by applying a known context at build time. Use them when an application can commit to a context fact (platform, region, plan tier) before download — Featurevisor strips rules and segments that no longer apply.

Don't confuse with adjacent concepts:

| Concept       | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| Environments  | Different rollout rules per env (staging vs production)                          |
| Tags          | Group features so each app loads only relevant ones                              |
| Namespaces    | Hierarchical organization of feature/segment keys (purely organizational)        |
| **Scopes**    | **Pre-evaluate against a known context to produce a smaller, faster datafile**   |

## When scopes help

A feature targets `web`, `ios`, and `android` with three rules (one segment each). The web app already knows `platform: 'web'`, so the ios/android rules and their segments are dead weight in `featurevisor-tag-web.json`. A `browsers` scope strips them out.

## Defining a scope

In `featurevisor.config.js`:

```js
module.exports = {
  environments: ['production'],
  tags: ['web', 'ios', 'android'],

  scopes: [
    {
      name: 'browsers',
      tag: 'web',
      context: { platform: 'web' },
    },
  ],
}
```

Build as usual:

```bash
npx featurevisor build --no-state-files
```

Output now includes `featurevisor-scope-browsers.json` alongside the tagged datafiles. The application loads the scope file directly — SDK usage doesn't change.

## Picking features for a scope

### Single tag

```js
{ name: 'browsers', tag: 'web', context: { platform: 'web' } }
```

### Multiple tags (AND)

```js
{ name: 'mobile', tags: ['ios', 'android'], context: {} }
```

### Conditional tags (OR / AND)

```js
{ name: 'paid-users', tags: { or: ['ios', 'android'] }, context: {} }
{ name: 'core',       tags: { and: ['core', 'web'] }, context: {} }
```

### All features (no tag filter)

Omit `tag`/`tags`:

```js
{ name: 'ios-only', context: { platform: 'ios' } }
```

## Multi-attribute scope context

Pre-apply more than one attribute:

```js
{
  name: 'browsers-nl-premium',
  tag: 'web',
  context: {
    platform: 'web',
    country: 'nl',
    subscription: 'premium',
  },
}
```

The scoped datafile then drops rules and segments contradicted by *any* of those values. An empty context (`context: {}`) is also valid — you get a tag-filtered datafile without further pruning.

## Testing against scopes

Add `scope: <name>` to a feature test assertion to exercise the scope's datafile:

```yaml
feature: showBanner
assertions:
  - description: Default tagged datafile evaluation
    at: 10
    environment: production
    context:
      platform: web
    expectedToBeEnabled: true

  - description: Same case via the browsers scope
    scope: browsers
    at: 10
    context: {}                     # scope already provides platform
    expectedToBeEnabled: true
```

Run with:

```bash
npx featurevisor test --with-scopes
```

Without `--with-scopes`, the runner still merges the scope's context into the evaluation for confidence but doesn't build a separate scoped datafile in memory.

## Where scopes shine

- Multi-platform products (web / iOS / Android)
- Geo-segmented products (regional bundles)
- Tiered SaaS (free / pro / enterprise scopes)
- Any app whose context contains stable facts known **before** datafile download

The win is bandwidth + memory + evaluation cost on the client — especially valuable on mobile and low-end devices.

## Authoring tips

- Pick a scope **name** that mirrors the audience (`browsers-nl-premium`), not the implementation (`scope-v2`).
- A scope's context only contains attributes whose values are **knowable before the datafile is fetched** — don't put per-user attributes in there.
- Each scope produces an additional datafile per environment. More scopes = more build artifacts; balance against actual savings.
- Run `npx featurevisor lint` and `npx featurevisor test --with-scopes` to verify no scope drops a rule the app still needs.
