# Project configuration

Full docs:

- Configuration: <https://featurevisor.com/docs/configuration>
- Environments: <https://featurevisor.com/docs/environments>
- Tags: <https://featurevisor.com/docs/tags>
- Targets: <https://featurevisor.com/docs/targets>
- Projects: <https://featurevisor.com/docs/projects>

The single source of truth is `featurevisor.config.js` at the project root.

```js
/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ['staging', 'production'],
  tags: ['all', 'web', 'mobile'],
};
```

Always inspect the active config before authoring:

```bash
npx featurevisor config --json --pretty
```

## The four shape-changers

Four values determine the *shape* of every file in the project — classify the project on these before writing anything:

| Value                | If set / changed                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `sets`               | `true` → every definition lives under `sets/<set>/…`; commands scope with `--set`. See [sets-promotions.md](sets-promotions.md).      |
| `environments`       | Present → `rules`/`force`/`expose` are per-env maps. **Absent → they are direct lists** (no env level).                                |
| `parser`             | `"json"` → author `.json` files; custom parser → author in that format. See [custom-parsers.md](custom-parsers.md).                    |
| `namespaceCharacter` | Key separator for namespaced entities — default `.`, sometimes `/`. Every key reference must use it. See [namespaces.md](namespaces.md). |

The same request ("add a feature at 10%") produces structurally different files depending on these four — always detect first, then author.

## Keys you will encounter

| Key                                                                                                                                      | Purpose                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `environments`                                                                                                                           | Optional array of env names; omit for no environments                           |
| `tags`                                                                                                                                   | Array of tag names — features must tag themselves with a subset                 |
| `sets`                                                                                                                                   | `true` → each `sets/<set>/` directory is an independent project tree            |
| `promotionFlows`                                                                                                                         | Optional allowed set promotion directions, for example dev → staging            |
| `namespaceCharacter`                                                                                                                     | Separator for namespaced keys (default `.`)                                     |
| `targetsDirectoryPath`                                                                                                                   | Directory containing target definitions (default `targets/`)                    |
| `parser`                                                                                                                                 | `"json"`, `"yml"` (default), or custom parser                                   |
| `defaultBucketBy`                                                                                                                        | Default `bucketBy` for features (defaults to `userId`)                          |
| `enforceCatchAllRule`                                                                                                                    | Lint requires a `segments: '*'` last rule in every feature/env                  |
| `attributesDirectoryPath`                                                                                                                | default `attributes/`                                                           |
| `segmentsDirectoryPath`                                                                                                                  | default `segments/`                                                             |
| `featuresDirectoryPath`                                                                                                                  | default `features/`                                                             |
| `groupsDirectoryPath`                                                                                                                    | default `groups/`                                                               |
| `schemasDirectoryPath`                                                                                                                   | default `schemas/`                                                             |
| `setsDirectoryPath`                                                                                                                      | default `sets/`                                                                 |
| `testsDirectoryPath`                                                                                                                     | default `tests/`                                                                |
| `datafilesDirectoryPath`                                                                                                                 | default `datafiles/`                                                            |
| `catalogDirectoryPath`                                                                                                                   | default `catalog/`                                                             |
| `datafileNamePattern`                                                                                                                    | default `featurevisor-%s.json`                                                  |
| `revisionFileName`                                                                                                                       | default `REVISION`                                                              |
| `stateDirectoryPath`                                                                                                                     | default `.featurevisor/`                                                        |
| `prettyState`, `prettyDatafile`                                                                                                          | pretty-printing toggles                                                         |
| `stringify`                                                                                                                              | stringify conditions in datafiles for lazy client-side parsing (default `true`) |
| `maxVariableStringLength`, `maxVariableArrayStringifiedLength`, `maxVariableObjectStringifiedLength`, `maxVariableJSONStringifiedLength` | Per-variable size caps                                                          |
| `plugins`                                                                                                                                | Featurevisor plugins to hook into build / lint                                  |

## Tags

Each feature lists tags it belongs to. Targets use tags to decide which features are included in each generated datafile.

Tag a feature with `all` (or your project's chosen catch-all) only if every consumer should load it. Otherwise tag by surface (`web`, `ios`, `android`, `internal-tools`, etc.).

## Targets

Targets define generated datafiles under `targets/`. They can include optional tag filters, feature-key filters (`includeFeatures` / `excludeFeatures`), and build-time context. See <https://featurevisor.com/docs/targets>.

## Sets and promotions

When `sets: true`, the project is split into independent trees under `sets/<set>/` — each with its own `attributes/`, `segments/`, `features/`, `targets/`, and `tests/`. The same feature key can exist in several sets with different definitions. `npx featurevisor promote --from=<set> --to=<set>` copies definitions (plus their full dependency closure) between sets, previewing by default and writing only with `--apply`; `promotionFlows` restricts allowed directions.

**Read [sets-promotions.md](sets-promotions.md) in full before working in a sets project** — it covers when sets are (and aren't) the right tool, layout, per-set builds and state, `--set` scoping, promotion filters, conflicts, and `promotable: false` semantics.
