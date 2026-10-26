# Targets

Full docs: <https://featurevisor.com/docs/targets/>

A target defines one datafile. Targets live in `targets/<key>.yml`, and the build writes `featurevisor-<key>.json` for each, per environment when environments are configured.

```yaml
description: All features and global variables
```

A target without selectors, like the scaffold's `targets/all.yml`, includes every active feature and global variable. No `all` tag is needed.

## One datafile per application

Select by tag, after declaring the tags in the configuration and tagging definitions ([tags.md](tags.md)):

```yaml
description: Web app

tag: web
```

```yaml
description: Mobile apps

tags:
  or:
    - ios
    - android
```

`tag` takes one tag. `tags` takes `{ or: [...] }` or `{ and: [...] }`, nonempty. Use one or the other. Tags select both features and global variables.

## Narrow by key

```yaml
description: Checkout frontend

includeFeatures:
  - checkout*
excludeFeatures:
  - checkout.internal*
includeVariables:
  - checkout*
```

- Patterns use `*` as a wildcard. Exclusions win over inclusions.
- `includeFeatures` and `excludeFeatures` affect features only. `includeVariables` and `excludeVariables` affect global variables only.
- Tag and key selectors combine with AND: a feature must match both.

## What comes along

The build adds everything the selected definitions need, even when selectors or tags would leave it out:

- features and variables referenced in `conditions`, and their own dependencies
- segments used anywhere, with their references
- every source of a composition

Every branch of an `and`, `or` or `not` counts. The exception is `expose: false`, which keeps a feature out, so never hide a prerequisite. For a composition, a hidden or archived source fails the build. Target filtering is not a confidentiality boundary: dependencies arrive as whole definitions.

## Known context

When every user of a datafile shares some context, give it to the target. The build resolves what that context decides, and the datafile gets smaller:

```yaml
description: Dutch web storefront

tag: web

context:
  country: nl
```

Serve such a datafile only to users matching that context. Its results assume it, so a German user evaluated against it would be treated as Dutch.

## Applications on the v3 SDK

Applications still on `@featurevisor/sdk` 3 read schema "2" datafiles. Give their target `schemaVersion: "2"`, in quotes:

```yaml
description: Mobile apps on @featurevisor/sdk 3

schemaVersion: "2"

tag: mobile
```

The build converts that target's datafiles for `@featurevisor/sdk` 3.8, the latest v3 JavaScript SDK. Lint checks every definition the target carries, dependencies included, and reports on the definition's own file anything schema "2" cannot express:

- variable conditions
- feature conditions in rules, force entries or segments, or under `or` and `not`
- root conditions that compare attributes or segments
- `isNull`, `notNull`, `empty`, `notEmpty`, `includesAny` and `notIncludesAny`
- compositions, and overrides that need runtime mutations (`continue`, `precomputeMutations: false`)

Keep such definitions out of the target, or keep them in the v3 shape. Removing a definition an older release reads turns it off there, so serve new releases from a schema "4" target rather than changing what the old one selects. Projects and targets without `schemaVersion: "2"` are not affected.

## Test and inspect

```yaml
feature: checkout

assertions:
  - key: web
    target: web
    at: 50
    context:
      country: nl
    expectedToBeEnabled: true
```

A `target` assertion evaluates against that target's datafile, as the application would. A definition the target leaves out evaluates as missing. Commands that take repeatable `--target=<key>`:

```bash
npx featurevisor build --no-state-files --target=web
npx featurevisor test --target=web
npx featurevisor evaluate --target=web --feature=checkout --context='{"country":"nl"}'
npx featurevisor list --features --target=web --json
npx featurevisor info --target=web
```

In a Sets project, `promotable: false` on a target protects the destination's version during promotion.
