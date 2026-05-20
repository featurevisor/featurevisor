# Tags

Full docs: <https://featurevisor.com/docs/tags>

Tags slice features into per-application bundles. Each app downloads only the datafile(s) for tags relevant to it — smaller payloads, less memory, faster evaluation.

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

A feature may carry multiple tags — it will be included in every matching tag's datafile. A feature with no tags is excluded from all tagged builds (rare; usually a mistake — lint may flag it depending on project config).

## Build output

```bash
npx featurevisor build --no-state-files
```

```
datafiles/
├── staging/
│   ├── featurevisor-tag-web.json
│   ├── featurevisor-tag-ios.json
│   ├── featurevisor-tag-android.json
│   └── featurevisor-tag-internal-tools.json
└── production/
    ├── featurevisor-tag-web.json
    ├── featurevisor-tag-ios.json
    ├── featurevisor-tag-android.json
    └── featurevisor-tag-internal-tools.json
```

## Choosing tags

| Strategy                      | Use when                                                  |
| ----------------------------- | --------------------------------------------------------- |
| By **surface** (`web`/`ios`)  | One Featurevisor project serves several client platforms  |
| By **microfrontend**          | Each MF needs its own bundle; tags map to MF names        |
| By **service**                | Backend services consuming feature flags                  |
| `all` catch-all               | Cross-cutting features used by every consumer             |

Common convention: include an `all` tag in config and tag features that every consumer uses.

## Testing against a tag

Add `tag:` to a feature test assertion to evaluate against the tagged datafile:

```yaml
feature: showBanner
assertions:
  - environment: production
    at: 90
    context: { country: nl }
    tag: web
    expectedToBeEnabled: true
```

```bash
npx featurevisor test --with-tags
```

## Tags vs scopes vs namespaces

- **Tags**: bundle features into datafiles. Per-consumer payload reduction.
- **[Scopes](scopes.md)**: pre-evaluate against a known context. Further payload + compute reduction on top of a tag.
- **[Namespaces](namespaces.md)**: organize feature/segment keys via directories. Pure organization, no runtime effect.

You typically tag every feature (required for any reasonable consumer setup), namespace freely (organizational), and add scopes selectively (optimization).

## Adding a new tag

1. Add to `featurevisor.config.js -> tags`.
2. Add it to relevant features' `tags:` lists.
3. `npx featurevisor lint`.
4. `npx featurevisor build --no-state-files`.
5. Deploy the new `featurevisor-tag-<new>.json` file.
6. Point the consumer at the new URL.

## Renaming or removing a tag

- **Renaming**: change config + every feature's `tags:`. The old `featurevisor-tag-<old>.json` will disappear on the next build; consumers must switch URLs first.
- **Removing**: drop the tag from config and from every feature. Don't remove from config alone — lint fails.
