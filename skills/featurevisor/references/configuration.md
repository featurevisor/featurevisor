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

## Keys you will encounter

| Key                                                                                                                                      | Purpose                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `environments`                                                                                                                           | Optional array of env names; omit for no environments                           |
| `tags`                                                                                                                                   | Array of tag names — features must tag themselves with a subset                 |
| `sets`                                                                                                                                   | `true` → each `sets/<set>/` directory is an independent project tree            |
| `promotionFlows`                                                                                                                         | Optional allowed set promotion directions, for example dev → staging            |
| `targetsDirectoryPath`                                                                                                                   | Directory containing target definitions (default `targets/`)                    |
| `parser`                                                                                                                                 | `"json"`, `"yml"` (default), or custom parser                                   |
| `defaultBucketBy`                                                                                                                        | Default `bucketBy` for features (defaults to `userId`)                          |
| `enforceCatchAllRule`                                                                                                                    | Lint requires a `segments: '*'` last rule in every feature/env                  |
| `attributesDirectoryPath`                                                                                                                | default `attributes/`                                                           |
| `segmentsDirectoryPath`                                                                                                                  | default `segments/`                                                             |
| `featuresDirectoryPath`                                                                                                                  | default `features/`                                                             |
| `groupsDirectoryPath`                                                                                                                    | default `groups/`                                                               |
| `testsDirectoryPath`                                                                                                                     | default `tests/`                                                                |
| `datafilesDirectoryPath`                                                                                                                 | default `dist/`                                                                 |
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

Targets define generated datafiles under `targets/`. They can include optional tag filters and build-time context. See <https://featurevisor.com/docs/targets>.
