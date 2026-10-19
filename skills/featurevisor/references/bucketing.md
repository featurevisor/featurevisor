# Bucketing and state

Full docs:

- Bucketing: <https://featurevisor.com/docs/bucketing/>
- State files: <https://featurevisor.com/docs/state-files/>

## How bucketing works

For each feature evaluation, the SDK builds a **bucket key** from the `bucketBy` attribute values and the feature key, such as `9b30.checkout`, and hashes it to a number from 0 to 100,000 (0% to 100% with three decimals). That number is the `bucketValue` in evaluation output.

- The first rule whose `conditions` match is selected. The feature is enabled when the bucket is below the rule's percentage.
- Variations divide the rule's range by weight, and the bucket picks one.

The hash is the same in every SDK and language, so a user in `treatment` on the web is in `treatment` on the backend and on mobile.

## Choose what to bucket by

| Surface                              | `bucketBy`                                          |
| ------------------------------------ | --------------------------------------------------- |
| Signed-in users                      | `userId`                                            |
| Anonymous visitors                   | `deviceId`                                          |
| Both                                 | `{ or: [userId, deviceId] }`, the first one present |
| Everyone in an organization together | `organizationId`                                    |
| Per user within each organization    | `[organizationId, userId]`                          |

**Attribute names differ between projects.** Read `attributes/` or `npx featurevisor list --attributes --json`, and ask when it is ambiguous. Every feature declares `bucketBy`, and lint rejects one without it.

A missing `bucketBy` attribute adds nothing to the key, so every context without a `userId` shares one bucket and is in or out together. With `{ or: [userId, deviceId] }`, a visitor who signs in moves from their device bucket to their user bucket, so their result can change at that moment.

## What changes a user's result

A user's bucket never changes for the same key, but their result can:

- **Lowering a percentage** removes users above the new value.
- **Lowering a percentage, changing weights or renaming a rule** redivides the variation ranges, so users can switch variations. Ranges are saved per rule key.
- **Losing the state files** that record those ranges.
- **Changing `bucketBy` or renaming the feature** changes every bucket key.
- **Reordering rules** can change which rule matches first.

Raising a percentage keeps everyone already in, and keeps their variation. Warn the user before any of the changes above, and do not make them silently.

## State files

`.featurevisor/` (or `stateDirectoryPath`) holds:

- `existing-state.json`, or `existing-state-<environment>.json` with environments: each rule's saved variation ranges, so the next build keeps users in their variation as percentages rise. In Sets projects it lives under `.featurevisor/sets/<set>/`.
- `REVISION`: the revision number each build increments and writes into datafiles.

**Only the deploying CI build updates and commits state.** A local build must use `--no-state-files`, so neither file changes. Never commit state generated locally, and never edit or delete it to fix an error. On `invalid_saved_allocation`, restore state from the deployed revision, or rename the rule deliberately after reviewing who would switch ([state files](https://featurevisor.com/docs/state-files/#traffic-allocation)).

CI can choose the revision:

```bash
npx featurevisor build --revision=1.2.3
npx featurevisor build --revision-from-hash
```

`--revision-from-hash` derives it from each datafile's content, so unchanged datafiles keep their revision, which suits CDN caching.

## Sticky values

Applications can supply results before the datafile is evaluated, with `setStickyFeatures` and `setStickyVariables` ([sdk-javascript.md](sdk-javascript.md#sticky)). Sticky state lives in application code, not in the project. To give a known user or QA a result, prefer a reviewed `force` entry ([features.md](features.md#force)). Sticky suits cases where the application already knows the answer, such as a plan returned by an entitlements service.

## Debugging

```bash
npx featurevisor evaluate \
  --feature=checkout \
  --context='{"userId":"9b30","country":"de"}' \
  --explain

npx featurevisor assess-distribution \
  --feature=checkout \
  --context='{"country":"de"}' \
  --populate-uuid=userId \
  --n=10000
```

`--explain` prints the bucket and its key, such as `Bucket: 67208 / 100000 · key "9b30.checkout"`. `assess-distribution` checks that a rollout and its variations split as intended across many generated users. In specs, `at` fixes the bucket so tests do not depend on real IDs ([testing.md](testing.md)).
