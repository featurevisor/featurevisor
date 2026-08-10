# Upgrading a project from v2 to v3

Full docs: <https://featurevisor.com/docs/migrations/v3>

Use this when the user is on Featurevisor v2 and asks to upgrade, or when you find v2-only shapes in a project (`scopes:` in the config, an `environments/` definition directory, `createInstance` in app code).

**First establish which version they're actually on** — don't assume:

```bash
npm ls @featurevisor/cli                                         # in the project repo
npm ls @featurevisor/sdk @featurevisor/react @featurevisor/vue   # in each app repo
```

(`npx featurevisor version` also prints CLI and core versions on v3.)

## The upgrade is two independent deployments

1. **Project repo** — upgrade the CLI, adjust config and definitions, build, deploy datafiles.
2. **Application repos** — upgrade each SDK afterwards, at their own pace.

They do **not** have to ship together. The datafile schema is unchanged (`schemaVersion: "2"`), so **v2 SDKs can keep reading v3-generated datafiles**. Say this explicitly — teams often assume a lockstep migration and delay the whole thing.

The one behavioural exception is [`not` semantics](#not-now-means-not-all-of-these) — see below before publishing v3 datafiles to apps still on v2 SDKs.

## Step 1 — project repo

```bash
npm install --save @featurevisor/cli@3
npx featurevisor lint       # the error list is your worklist
```

Work through lint output, then re-run until clean. What changes:

| v2                                              | v3                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `staging` + `production` assumed by default     | **No environments unless declared.** Add `environments: ['staging', 'production']` to keep them   |
| `environments: false`                           | Remove the key entirely                                                                           |
| `splitByEnvironment` + `environments/<env>/*.yml` | Removed. Move per-env `rules`/`force`/`expose` into the feature file, keyed by environment       |
| `scopes:` in `featurevisor.config.js`           | One file per scope in `targets/` ([targets.md](targets.md)). Leftover `scopes` is silently ignored |
| Datafiles built per tag automatically           | **Built from targets only** — no target, no datafile. Minimum: `targets/all.yml` with a description |
| `featurevisor-tag-web.json`                     | `featurevisor-<target>.json`. Name the target `tag-web` if consumers' URLs must not change        |
| Namespaced keys used `/`                        | Default separator is now `.` (`checkout/promo` → `checkout.promo`). Set `namespaceCharacter: '/'` to keep the old keys |
| `site` command, `out/` directory                | `catalog` command, `catalog/` directory; `siteExportDirectoryPath` → `catalogDirectoryPath`       |
| `--schema-version` flag                         | Removed (ignored if passed); output is always schema version 2                                    |
| Test assertion `scope:` / `tag:`                | Single `target:` property ([testing.md](testing.md))                                              |
| Generated `*Feature.ts` namespaces              | Shared typed functions only; `--no-individual-features` removed. Delete old output before regenerating ([code-generation.md](code-generation.md)) |

Two definition-level rules also tightened, and lint now rejects what used to pass:

- **Portable regex and dates.** Only `g`, `i`, `m`, `s` flags; `before`/`after` need a full ISO 8601 timestamp with timezone. See [operators.md](operators.md#portable-conditions-cross-sdk-subset).
- **Empty `and` / `or` / `not` arrays are rejected.** Common in generated or placeholder definitions.

New in v3 and worth mentioning if it fits their problem: [sets and promotions](sets-promotions.md) (independent trees for release lanes or surfaces) and `promotable: false` protection on definitions.

### `not` now means "not all of these"

The one change that alters evaluation for already-deployed users. In `segments:` on rules, multiple direct children of `not` are now an implicit **AND**, then negated — matching how conditions always behaved:

```yaml
# ambiguous across versions — don't leave this in place
segments:
  not: [premium, internal]

# "none of these match" (what v2 did)
segments:
  not:
    - or: [premium, internal]

# "not all of these match"
segments:
  not:
    - and: [premium, internal]
```

**Rewrite every multi-child `not` with an explicit `or` (or `and`) group before publishing v3 datafiles.** Both v2 and v3 SDKs then see a single child and agree on the result, so apps can upgrade whenever they want. Find them first:

```bash
grep -rn -A3 "not:" features/ segments/
```

### Then prove the project

```bash
npx featurevisor lint
npx featurevisor test
npx featurevisor build --no-state-files
```

Inspect a datafile per target and environment before deploying — target-based naming means the URLs apps fetch may have changed:

```bash
npx featurevisor list --datafiles --json --pretty
```

## Step 2 — each application repo

```bash
npm install --save @featurevisor/sdk@3   # plus @featurevisor/react / @featurevisor/vue
```

Renames (mechanical, do these first):

| v2                          | v3                    |
| --------------------------- | --------------------- |
| `createInstance`            | `createFeaturevisor`  |
| `FeaturevisorInstance` type | `Featurevisor`        |
| `InstanceOptions` type      | `FeaturevisorOptions` |
| `hooks` / `addHook` / `Hook` | `modules` / `addModule` / `FeaturevisorModule` |
| `logger` + `createLogger`   | `logLevel` + `onDiagnostic` |

Behaviour changes that renaming won't catch — check each one deliberately:

- **`setDatafile` merges by default.** Code that refreshes the *same* datafile must now pass `true` to replace, or features deleted upstream will linger: `f.setDatafile(fresh, true)`. ([sdk-javascript.md](sdk-javascript.md#setting-and-updating-the-datafile))
- **Per-evaluation `sticky` is gone.** `f.isEnabled(key, ctx, { sticky })` → `f.setSticky(...)` on the instance, or `f.spawn(ctx, { sticky })` for isolated state.
- **Child instances snapshot parent context** at spawn and must be `close()`d. ([sdk-javascript.md](sdk-javascript.md#child-instances-server-side))
- **Explicit defaults preserve falsey values** — `false`, `0`, `""`, `null` are honored. Strip `|| fallback` wrappers that were compensating for the old behavior.
- **Internal helpers are no longer exported**: `DatafileReader`, logger/emitter/evaluator internals, and the v1-only types. Replace reader calls with instance methods (`f.getRevision()`, `f.getFeature()`, `f.getFeatureKeys()`, `f.getVariableKeys()`, `f.hasVariations()`, `f.getSegment()`, `f.getSchemaVersion()`).
- **Vue** dropped `useStatus` and `activateFeature`; track exposure with a [module](sdk-javascript.md#modules) instead ([tracking.md](tracking.md)). **React**'s provider still takes an already-created instance.

### Other languages

Same story, idiomatic names ([sdk-other-languages.md](sdk-other-languages.md)):

| SDK    | v2 factory                     | v3 factory                         |
| ------ | ------------------------------ | ---------------------------------- |
| Go     | `NewFeaturevisor`              | `CreateFeaturevisor`               |
| Swift  | `createInstance`               | `createFeaturevisor`               |
| Java   | `Featurevisor.createInstance`  | `Featurevisor.createFeaturevisor`  |
| Ruby   | `Featurevisor.create_instance` | `Featurevisor.create_featurevisor` |
| Python | `create_instance`              | `create_featurevisor`              |
| PHP    | `Featurevisor::createInstance` | `Featurevisor::createFeaturevisor` |

Go: `Options` → `FeaturevisorOptions`. Java: `Featurevisor.Options` → `Featurevisor.FeaturevisorOptions`. Swift and Python: `FeaturevisorInstance` → `Featurevisor`. **PHP now requires 8.0+** — a team stuck on 7.4 stays on the v2 PHP SDK until their runtime moves. Custom logger injection is gone everywhere; use `logLevel` / `onDiagnostic`.

## Checklist

Project, in order:

1. Upgrade `@featurevisor/cli`; declare `environments` explicitly if the project uses them.
2. Fold `environments/<env>/*.yml` back into feature files (or model them as [sets](sets-promotions.md) if they were really independent copies).
3. Convert every scope to a target; ensure at least one target exists.
4. Decide dots vs slashes for namespaced keys — and remember application code and test specs use those keys too.
5. Rewrite multi-child `not`; delete empty logical arrays.
6. Fix regex flags and date values.
7. Replace assertion `scope`/`tag` with `target`; run the full test suite.
8. Build and inspect every target × environment datafile; check the deployed filenames against what apps fetch.
9. Update CI, Catalog, and code-generation commands and output paths.

Then per application: rename factory/types, replace logger and hook integrations, review `setDatafile`, sticky ownership, child cleanup, explicit defaults, and removed imports — and run the app's tests against the same v3 datafiles that will be deployed.

Migrating from **v1**, or want the full annotated diff? <https://featurevisor.com/docs/migrations/v2> and <https://featurevisor.com/docs/migrations/v3>.
