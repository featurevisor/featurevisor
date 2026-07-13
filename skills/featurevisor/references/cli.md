# Featurevisor CLI reference

All commands assume you are inside a Featurevisor project (the directory containing `featurevisor.config.js`). Run them with `npx featurevisor <command>`.

Source of truth: <https://featurevisor.com/docs/cli>

## Setup

```bash
# inside an empty directory
npx @featurevisor/cli init                      # scaffold the default (yml) example
npx @featurevisor/cli init --example=json       # or a specific example: yml | json | toml | sets | targets | no-environments | …
npm install
```

`init` downloads an `examples/example-<name>` project from the Featurevisor GitHub repo into the current directory (network required). The scaffold includes `featurevisor.config.js`, starter attributes/segments/features, a `targets/all.yml`, and tests — a working project out of the box.

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
npx featurevisor build --no-state-files --target=web --target=mobile
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
npx featurevisor test --target=web --target=mobile # selected target assertions and untargeted assertions
```

Non-zero exit on failure.

## List

`list` is the agent's primary tool for discovery. Always pass `--json` (and `--pretty` while debugging) to get parseable output.

### Datafiles

```bash
npx featurevisor list --datafiles --json --pretty
```

Lists generated datafile paths relative to `datafiles/` with uncompressed and gzip-compressed sizes in aligned columns, excluding `REVISION` and hidden files. Sizes are right-aligned with two decimal places, and padded `B` suffixes align with `kB`/`mB`; `dev*` directories appear first and `prod*` directories last. `--json` returns `{ path, size, gzipSize }` items with byte sizes in the same order. Run `build` first when you need freshly generated output.

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
| `--target=<target>`                          | selected by target; repeatable union     |
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

Use repeatable `--target=<target>` options to evaluate each selected target datafile independently. With `--json`, repeated targets return an array of target and evaluation entries.

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
- `--target=<target>` assesses one target datafile and can be repeated.

Use this when the user asks "is my 25% rollout really going to hit 25%?" or "will my variation weights actually split traffic 50/50?".

## benchmark

Measure SDK evaluation latency.

```bash
npx featurevisor benchmark --environment=production --feature=my_feature --context='{"userId":"123"}' --n=1000
npx featurevisor benchmark --environment=production --feature=my_feature --variation --context='{}' --n=1000
npx featurevisor benchmark --environment=production --feature=my_feature --variable=bgColor --context='{}' --n=1000
```

Use repeatable `--target=<target>` options to benchmark each selected target datafile independently.

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

With repeatable `--target=<target>` options, it prints feature, segment, variable, and datafile size information per selected target and environment.

## generate-code

```bash
npx featurevisor generate-code --language typescript --out-dir ./src
npx featurevisor generate-code --language typescript --out-dir ./src --tag=shared --target=web --target=mobile
```

Generates typed accessors from feature definitions. Repeatable `--tag` and `--target` selectors form a union. Other languages: see <https://featurevisor.com/docs/code-generation>.

## promote (sets projects only)

```bash
npx featurevisor promote --from=dev --to=staging                       # preview
npx featurevisor promote --from=dev --to=staging --apply               # write destination files
npx featurevisor promote --from=dev --to=staging --target=web          # target and its feature dependency closure
npx featurevisor promote --from=dev --to=staging --tag=web             # tagged features and their dependencies
npx featurevisor promote --from=dev --to=staging --includeFeatures="checkout*"
npx featurevisor promote --from=dev --to=staging --excludeFeatures="experimental*"
npx featurevisor promote --from=dev --to=staging --conflicts=fail      # source | destination | fail (default source)
npx featurevisor promote --from=dev --to=staging --apply --audit=markdown
```

Copies definitions and their dependencies between [sets](https://featurevisor.com/docs/sets). `--target` applies the target's tag and feature selectors and includes the target definition. `--tag` selects features carrying that tag. Positive selectors combine with AND semantics, exclusions take precedence, and dependency closure includes required features, groups, segments, attributes, schemas, and tests. Allowed directions can be constrained by `promotionFlows` in the config. See <https://featurevisor.com/docs/promotions>.

## catalog

Static, read-only web UI for browsing the whole project — features, segments, attributes, targets, groups, schemas, relationships, tests, and Git history. Ideal for sharing with non-engineers.

```bash
npx featurevisor catalog                          # export, serve at http://127.0.0.1:3000, and watch
npx featurevisor catalog --port=4000              # (-p also works)
npx featurevisor catalog export                   # build static output to catalogDirectoryPath (default catalog/)
npx featurevisor catalog export --outDir=./out    # write elsewhere
npx featurevisor catalog export --hash-router     # for static hosts without an index.html fallback
npx featurevisor catalog serve [-p 3000]          # serve an existing export (exports first if missing)
```

Full docs: <https://featurevisor.com/docs/catalog>

## version

```bash
npx featurevisor --version
npx featurevisor -v
```

## Custom commands (plugins)

Projects can register their own CLI subcommands via `plugins` in `featurevisor.config.js`. If `npx featurevisor --help` shows commands not listed here, they're project plugins — read their source before using. Docs: <https://featurevisor.com/docs/plugins>.
