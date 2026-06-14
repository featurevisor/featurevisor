# Tags

Full docs: <https://featurevisor.com/docs/tags>

Tags mark features so targets can build per-application bundles. Each app downloads the target datafile relevant to it — smaller payloads, less memory, faster evaluation.

## Configure

Declare the universe of tags up front in `featurevisor.config.js`:

```js
module.exports = {
  tags: ['web', 'ios', 'android', 'internal-tools'],
  environments: ['staging', 'production'],
}
```

Lint rejects any feature with a tag not listed here, so add the tag to config first if you're introducing a new one.

## Tag a feature

```yaml
description: Show banner
tags:
  - web
  - ios
# ...
```

A feature may carry multiple tags. Targets decide which tagged features become part of a datafile.

## Build output with targets

```bash
npx featurevisor build --no-state-files
```

Define `targets/web.yml` with `tag: web` to produce `datafiles/<environment>/featurevisor-web.json`.

## Choosing tags

| Strategy                     | Use when                                                 |
| ---------------------------- | -------------------------------------------------------- |
| By **surface** (`web`/`ios`) | One Featurevisor project serves several client platforms |
| By **microfrontend**         | Each MF needs its own bundle; tags map to MF names       |
| By **service**               | Backend services consuming feature flags                 |
| `all` catch-all              | Cross-cutting features used by every consumer            |

Common convention: include an `all` tag in config and tag features that every consumer uses.

## Testing against a target

Add `target:` to a feature test assertion to evaluate against the target datafile:

```yaml
feature: showBanner
assertions:
  - environment: production
    at: 90
    context: { country: nl }
    target: web
    expectedToBeEnabled: true
```

```bash
npx featurevisor test
```

## Tags vs targets vs namespaces

- **Tags**: feature metadata used by targets.
- **[Targets](targets.md)**: generated datafile definitions with optional tag filters and build-time context.
- **[Namespaces](namespaces.md)**: organize feature/segment keys via directories. Pure organization, no runtime effect.

You typically tag features by consumer surface, namespace freely, and create targets for the actual datafiles consumers load.

## Adding a new tag

1. Add to `featurevisor.config.js -> tags`.
2. Add it to relevant features' `tags:` lists.
3. `npx featurevisor lint`.
4. `npx featurevisor build --no-state-files`.
5. Create or update a target that selects the tag.
6. Point the consumer at the new URL.

## Renaming or removing a tag

- **Renaming**: change config + every feature's `tags:` + affected target files.
- **Removing**: drop the tag from config and from every feature. Don't remove from config alone — lint fails.
