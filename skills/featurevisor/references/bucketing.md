# Bucketing and state

Full docs:

- Bucketing: <https://featurevisor.com/docs/bucketing>
- State files: <https://featurevisor.com/docs/state-files>

## How bucketing works

For each evaluation, the SDK builds a **bucketing key** from:

1. The feature key (string)
2. The value of the feature's `bucketBy` attribute(s) in the provided context

The key is hashed deterministically to a number in **[0, 100]** with 2-decimal precision. Then:

- Rules are evaluated top-to-bottom against `context`. The first rule whose `segments` match wins.
- If that rule's `percentage` is ≥ the hash, the flag evaluates true; else false.
- If the feature has `variations`, the same hash space is partitioned by variation `weight`s — the user lands in the variation whose band contains the hash.

Because the hash is deterministic, the **same user** evaluating the **same feature** with the **same `bucketBy` value** always lands in the same place. That's "consistent bucketing."

## Picking `bucketBy`

| Surface                                 | Use                                           |
| --------------------------------------- | --------------------------------------------- |
| Signed-in (you have a user identity)    | `userId`                                      |
| Anonymous (web/mobile pre-login)        | `deviceId`                                    |
| Mixed (could be either)                 | `bucketBy: {or: [userId, deviceId]}`          |
| Org-scoped product (B2B)                | `bucketBy: [organizationId, userId]` (concat) |
| Org-scoped rollout (everyone in an org) | `bucketBy: organizationId`                    |

**Attribute names may differ in this project.** Always inspect `attributes/` (or `npx featurevisor list --attributes --json`) and ask the user when ambiguous — don't invent.

The default if a feature doesn't specify `bucketBy` is `featurevisor.config.js -> defaultBucketBy` (defaults to `userId`).

## What breaks consistency

Each of these silently re-buckets users:

- **Changing `bucketBy`** on an existing feature.
- **Renaming a rule's `key`** — the key participates in bucketing namespacing for that rule.
- **Decreasing a rule's `percentage`** — users in `(newPercentage, oldPercentage]` lose the feature.
- **Reordering rules** such that a different rule now matches first.
- **Changing variation `weight`s** — users may land in a different variation.

Featurevisor tries to minimize disruption when increasing `percentage` (existing users stay in), but **decreasing** or **reweighting** is fundamentally inconsistent and warned about in the docs.

## State files

Featurevisor maintains state in `<stateDirectoryPath>` (default `.featurevisor/`):

- `state-<environment>.json` — traffic allocation snapshots used so the **next** build preserves bucketing for already-exposed users when percentages change.
- `REVISION` — integer revision number, incremented by every successful `featurevisor build`. Stamped into generated datafiles.

### Authoring guidance

- **Commit state files** to Git from CI (after a successful `build`). The next build needs them to maintain consistency.
- **Do not commit them from local builds.** When an agent runs `build`, always pass `--no-state-files` so neither `state-*.json` nor `REVISION` changes locally.
- The user does not edit state files manually.

### Custom revision

CI can pin revisions to a build SHA, semver, or content hash:

```bash
npx featurevisor build --revision 1.2.3
npx featurevisor build --revision-from-hash    # per-datafile hash; unchanged content = unchanged revision (cache-friendly)
```

## Sticky values (SDK-side override)

Independent of bucketing, the SDK supports **sticky** values — application-supplied per-feature overrides (variation/variables/enabled) consulted **before** evaluation. Documented for completeness; sticky is set at SDK init time, not in YAML:

```js
f.setSticky({
  plan: { enabled: true, variation: 'premium' },
})
```

When the user asks "how do I force a known user into a specific variation?" — prefer authoring a `force:` rule in the feature ([features.md](features.md#force)) over sticky, because YAML is the source of truth and reviewed in PRs. Sticky is best for cases where the application _itself_ already knows the answer (e.g. an entitlements service returned a plan).

## Debugging bucketing

```bash
# what does this evaluation look like for one context?
npx featurevisor evaluate \
  --environment=production \
  --feature=myFeature \
  --context='{"userId":"u_42","country":"nl"}' \
  --verbose

# at scale: does my 25% rollout really hit 25%?
npx featurevisor assess-distribution \
  --environment=production \
  --feature=myFeature \
  --context='{"country":"nl"}' \
  --populateUuid=userId \
  --n=10000
```

Both commands accept repeatable `--target=<target>` options and run independently against every selected target datafile.
