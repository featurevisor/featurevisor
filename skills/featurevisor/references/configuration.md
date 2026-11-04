# Project configuration

Full docs:

- Configuration: <https://featurevisor.com/docs/configuration/>
- Environments: <https://featurevisor.com/docs/environments/>
- Converting: <https://featurevisor.com/docs/convert/>
- Projects: <https://featurevisor.com/docs/projects/>

`featurevisor.config.js` at the project root is the single source of truth. Read the resolved values before authoring:

```bash
npx featurevisor config --json --pretty
```

The default scaffold:

```js
/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  prettyState: true,
}
```

No environments, and a `targets/all.yml` without selectors.

## The four shape changers

The same request ("add a feature at 10%") produces different files depending on these. Classify the project before writing anything.

| Value                | Effect                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sets`               | `true` puts every definition under `sets/<set>/` and commands take `--set` ([sets-promotions.md](sets-promotions.md))                             |
| `environments`       | when present, feature `rules`, `force` and `expose`, and global variable `overrides`, are maps keyed by environment, and tests need `environment` |
| `parser`             | `'yml'` (default), `'json'`, or a custom parser ([custom-parsers.md](custom-parsers.md))                                                          |
| `namespaceCharacter` | separator for keys from subdirectories, default `.` ([namespaces.md](namespaces.md))                                                              |

`environments`, when present, is a nonempty list of unique names, such as `['staging', 'production']`. Sets and environments are independent: a Sets project may or may not have environments.

## Other options

| Option                                                        | Default                            | Purpose                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tags`                                                        | `['all']`                          | tags definitions may use ([tags.md](tags.md))                                                                                 |
| `defaultBucketBy`                                             | `userId`                           | used by the build for a feature without `bucketBy`, but lint requires `bucketBy` on every feature                             |
| `promotionFlows`                                              | none                               | allowed promotion directions between sets, such as `[{ from: 'dev', to: 'staging' }]`                                         |
| `enforceCatchAllRule`                                         | `false`                            | lint requires every rule list to end with `conditions: '*'`                                                                   |
| `requireOverrideKeysInFeatures`                               | `false`                            | lint requires a `key` on every feature variable override                                                                      |
| `allowFeatureAndVariableKeyCollisions`                        | `false`                            | allow a feature and a global variable to share a key                                                                          |
| `reservedKeys`                                                | `feature`, `variation`, `variable` | keys lint rejects for features and variables                                                                                  |
| `disallowOperators`                                           | `[]`                               | operators lint and build reject, for consumers on older SDKs ([operators.md](operators.md#restricting-operators-per-project)) |
| `allowedConditions`                                           | none                               | kinds of condition lint accepts per location ([conditions.md](conditions.md#allowed-condition-kinds))                         |
| `conditionExpressions`                                        | `false`                            | lets conditions be written as text, such as `country == 'nl'` ([expressions.md](expressions.md))                              |
| `simplifyConditions`                                          | `false`                            | `fmt` writes each condition in its simplest form, as `--simplify` does, and promote writes the conditions it changes that way |
| `precomputeMutations`                                         | `true`                             | resolve global variable mutations at build time. `false` emits runtime programs, which need newer SDKs                        |
| `stringify`                                                   | `true`                             | store conditions as strings in datafiles, parsed lazily by SDKs                                                               |
| `prettyState`                                                 | `true`                             | format state files                                                                                                            |
| `prettyDatafile`                                              | `false`                            | format datafiles                                                                                                              |
| `maxVariableStringLength` and the other `maxVariable*` limits | none                               | lint size limits for feature and global variable values, defaults and overrides included                                      |
| `catalogBasePath`                                             | `/`                                | URL path when the Catalog is hosted under a prefix                                                                            |
| `plugins`                                                     | `[]`                               | custom CLI commands ([plugins-datasource.md](plugins-datasource.md))                                                          |
| `adapter`                                                     | filesystem                         | custom datasource adapter                                                                                                     |

Directories: `attributesDirectoryPath`, `segmentsDirectoryPath`, `featuresDirectoryPath`, `variablesDirectoryPath`, `schemasDirectoryPath`, `targetsDirectoryPath`, `testsDirectoryPath`, `setsDirectoryPath`, `datafilesDirectoryPath`, `stateDirectoryPath` and `catalogDirectoryPath`. File names: `datafileNamePattern` (default `featurevisor-%s.json`) and `revisionFileName` (default `REVISION`).

## Environments

Add environments when the same definitions need different rules per deployment stage:

```js
module.exports = {
  environments: ['staging', 'production'],
}
```

```yaml
rules:
  staging:
    - key: everyone
      conditions: '*'
      percentage: 100
  production:
    - key: everyone
      conditions: '*'
      percentage: 10
```

Adding environments to an existing project changes every feature's `rules`, `force` and `expose`, every global variable's `overrides`, and every test assertion. It is a migration, so propose it explicitly rather than as a side effect. When the user asks, `npx featurevisor convert --to=environments` previews it and `--apply` writes it, configuration included ([cli.md](cli.md#convert)). Removing environments is `convert --to=flat --keep=<environment>`. When lanes need separate review and promotion rather than per environment rules, Sets fit better ([sets-promotions.md](sets-promotions.md)).

### Add another environment later

A project that already has environments can gain one without touching any definition, which is the right answer when only some teams need it:

```js
module.exports = {
  environments: ['dev', 'staging', 'production'],

  inheritEnvironments: {
    dev: { from: 'staging' },
  },
}
```

| A definition says for `dev` | In `dev`                    |
| --------------------------- | --------------------------- |
| Nothing                     | what it has for `staging`   |
| `dev: []`                   | none, and nothing inherited |
| `dev:` with entries         | its own                     |

- `rules`, `force`, `expose` and `overrides` each inherit separately, and a list replaces the inherited one whole. `expose: { dev: true }` exposes in `dev` what staging does not.
- It is resolved at build time, so `dev`'s datafiles match staging's until a definition differs. SDKs need no change.
- Inherited rules allocate from staging's state file, so a user gets the same variation in both. Do not copy state files by hand.
- Only one level, so `from` cannot be an environment that inherits. Several environments may inherit from one.
- Test assertions do not inherit. Add ones that name `dev` when asked.
- If `dev` already exists, a definition that leaves it out is off there today, and this setting turns it on without anyone editing that file. Run `npx featurevisor list --features --not-defined-in=dev` and the same with `--variables` first, and write `dev: []` in each that must stay as it is. `force` and `expose` inherit too.
- To roll out a new `dev`, a deployment script naming each environment needs a line for it, a workflow naming each state file has to add `.featurevisor/existing-state-dev.json`, and applications running in `dev` load `dev/featurevisor-<target>.json`.
- Without the setting, every feature is disabled in `dev`, including features that a team enabled there but which depend on a feature nobody else touched. Do not write `dev` entries into every definition to work around that. Propose this setting.

`npx featurevisor list --features --defined-in=dev` lists who has written their own rules, and `--not-defined-in=dev` who has not. Both work with `--variables`.

### Require an environment

Leaving out an environment passes lint, so a forgotten `production` entry ships a feature disabled. `requireRulesIn: ['production']` makes every feature's `rules` write it, and `requireOverridesIn: ['production']` every global variable's `overrides`, with the lint code `missing_required_environment`. `production: []` satisfies them, archived definitions are exempt, and an environment that inherits cannot be listed.
