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
