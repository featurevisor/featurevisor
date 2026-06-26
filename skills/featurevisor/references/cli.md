# Featurevisor CLI reference

All commands assume you are inside a Featurevisor project (the directory containing `featurevisor.config.js`). Run them with `npx featurevisor <command>`.

Source of truth: <https://featurevisor.com/docs/cli>

## Setup

```bash
# inside an empty directory
npx @featurevisor/cli init                      # default example
npx @featurevisor/cli init --example=json       # specific example from the monorepo
npm install
```

## Lint

```bash
npx featurevisor lint
npx featurevisor lint --json --pretty                       # machine-readable
npx featurevisor lint --keyPattern="myKey"                  # filter by key
npx featurevisor lint --entityType=feature                  # feature | segment | attribute | group | test
npx featurevisor lint --keyPattern="my" --entityType=feature
```

The `--json` output has a stable shape:

```json
{
  "errors": [
    {
      "filePath": "segments/my-segment.yml",
      "entityType": "segment",
      "key": "my-segment",
      "message": "Required",
      "path": ["conditions", 0, "attribute"],
      "code": "invalid_type"
    }
  ]
}
```

Run this after every edit. It catches:

- Unknown segments/attributes referenced in features
- Variation weight sums ≠ 100
- Group slot percentage sums ≠ 100
- Rule percentages exceeding group slot caps
- Variable type mismatches against `variablesSchema`
- Missing required environments / tags

If `enforceCatchAllRule: true` is set in config, lint also requires every feature to end with a `segments: '*'` rule in every environment.

## Build datafiles

```bash
npx featurevisor build --no-state-files
npx featurevisor build --no-state-files --set=storefront   # one set only (sets projects)
```

**Always pass `--no-state-files` when an agent runs build** — without it, the project's revision number increments and `.featurevisor/state-*.json` files are written, which the user probably doesn't want in a non-CI run.

Datafiles end up in `<datafilesDirectoryPath>` organized (in sets projects) by set, then environment, then target.

## Test

```bash
npx featurevisor test
npx featurevisor test --keyPattern="myFeature"
npx featurevisor test --keyPattern="myFeature" --assertionPattern="in NL"
npx featurevisor test --entityType=feature       # or segment
npx featurevisor test --verbose                   # SDK trace per assertion
npx featurevisor test --quiet                     # suppress SDK warnings
npx featurevisor test --onlyFailures
npx featurevisor test --showDatafile              # combine with --keyPattern
npx featurevisor test --set=storefront            # one set only (sets projects)
```

Non-zero exit on failure.

## List

`list` is the agent's primary tool for discovery. Always pass `--json` (and `--pretty` while debugging) to get parseable output.

### Features

```bash
npx featurevisor list --features --json --pretty
```

Filter flags (combine as needed):

| Flag                                         | Effect                                   |
| -------------------------------------------- | ---------------------------------------- |
| `--archived=true|false`                      | by archived status                       |
| `--description=<pattern>`                    | description regex                        |
| `--disabledIn=<env>`                         | feature disabled in env (no rule, or 0%) |
| `--enabledIn=<env>`                          | feature has any rule >0% in env          |
| `--keyPattern=<regex>`                       | feature key regex                        |
| `--tag=<tag>`                                | includes a tag                           |
| `--variable=<key>`                           | has variable in its schema               |
| `--variation=<value>`                        | has a variation with given value         |
| `--with-tests` / `--without-tests`           | has any `.spec.yml` / has none           |
| `--with-variables` / `--without-variables`   | has / has not                            |
| `--with-variations` / `--without-variations` | has / has not                            |

### Segments

```bash
npx featurevisor list --segments --json --pretty
```

Flags: `--archived`, `--description`, `--keyPattern`, `--with-tests`, `--without-tests`.

### Attributes

```bash
npx featurevisor list --attributes --json --pretty
```

Flags: `--archived`, `--description`, `--keyPattern`.

### Tests

```bash
npx featurevisor list --tests --json --pretty
npx featurevisor list --tests --applyMatrix       # expand matrices into individual assertions
```

Flags: `--applyMatrix`, `--assertionPattern`, `--keyPattern`.

## find-usage

Find where entities are referenced. Append `--authors` to also list the `git log` authors who touched each.

```bash
npx featurevisor find-usage --segment=<key>
npx featurevisor find-usage --attribute=<key>
npx featurevisor find-usage --feature=<key>
npx featurevisor find-usage --unusedSegments
npx featurevisor find-usage --unusedAttributes
```

## find-duplicate-segments

```bash
npx featurevisor find-duplicate-segments
npx featurevisor find-duplicate-segments --authors
```

Finds segments with structurally identical `conditions`. Common in large projects; not necessarily a bug, but a candidate for consolidation.

## evaluate (debug)

The agent's main tool for "why did this evaluate that way?".

```bash
npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --context='{"userId":"123","country":"nl"}'

# extras
  --verbose                                       # more log detail
  --json --pretty                                 # JSON output
```

Returns the full evaluation chain (sticky → required → force → rules → bucketing → fallback), so you don't have to reason about it by hand.

You can also debug variation/variable:

```bash
npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --variation \
  --context='{"userId":"123"}'

npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --variable=bgColor \
  --context='{"userId":"123"}'
```

## assess-distribution

Simulate many users to verify a rollout's actual distribution.

```bash
npx featurevisor assess-distribution \
  --environment=production \
  --feature=my_feature \
  --context='{"country":"nl"}' \
  --populateUuid=userId \
  --n=1000 \
  [--verbose]
```

- `--populateUuid=<attr>` generates a fresh UUID per iteration for that attribute (repeatable for multiple attrs like `--populateUuid=userId --populateUuid=deviceId`).
- `--n` higher = more accurate.

Use this when the user asks "is my 25% rollout really going to hit 25%?" or "will my variation weights actually split traffic 50/50?".

## benchmark

Measure SDK evaluation latency.

```bash
npx featurevisor benchmark --environment=production --feature=my_feature --context='{"userId":"123"}' --n=1000
npx featurevisor benchmark --environment=production --feature=my_feature --variation --context='{}' --n=1000
npx featurevisor benchmark --environment=production --feature=my_feature --variable=bgColor --context='{}' --n=1000
```

## config

```bash
npx featurevisor config
npx featurevisor config --json --pretty
```

Always run this once at the start of a session to discover envs, tags, parser, sets, defaultBucketBy, and directory overrides.

## info

```bash
npx featurevisor info
```

Quick counts of features/segments/attributes/tests/groups/schemas. Useful sanity check.

## generate-code

```bash
npx featurevisor generate-code --language typescript --out-dir ./src
```

Generates typed accessors from feature definitions. Other languages: see <https://featurevisor.com/docs/code-generation>.

## promote (sets projects only)

```bash
npx featurevisor promote --from=dev --to=staging                       # preview
npx featurevisor promote --from=dev --to=staging --apply               # write destination files
npx featurevisor promote --from=dev --to=staging --includeFeatures="checkout*"
npx featurevisor promote --from=dev --to=staging --excludeFeatures="experimental*"
npx featurevisor promote --from=dev --to=staging --conflicts=fail      # source | destination | fail (default source)
npx featurevisor promote --from=dev --to=staging --apply --audit=markdown
```

Copies definitions (and their dependencies) between [sets](https://featurevisor.com/docs/sets). Allowed directions can be constrained by `promotionFlows` in the config, and a definition with `promotable: false` is never promoted. See <https://featurevisor.com/docs/promotions>.

## catalog

```bash
npx featurevisor catalog                          # export, serve, and watch the catalog
npx featurevisor catalog export                   # build the static catalog
npx featurevisor catalog serve [-p 3000]          # serve an exported catalog
```

## version

```bash
npx featurevisor --version
npx featurevisor -v
```
