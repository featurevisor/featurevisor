# Extending the CLI: plugins, datasource, adapters

Full docs:

- Plugins: <https://featurevisor.com/docs/plugins>
- Datasource: <https://featurevisor.com/docs/datasource>

Every built-in `featurevisor` command is itself a plugin, so a project can add commands with the same shape and the same option validation. Reach for this when the user wants **repeatable project automation**: a bulk edit across features, an export to another system, a scheduled audit, anything that would otherwise be a fragile YAML-parsing script.

Two situations to recognize before writing one:

- **A plugin already exists in the project.** `npx featurevisor --help` listing commands not in [cli.md](cli.md) means project plugins are registered. Read their source (from `plugins:` in `featurevisor.config.js`) before running them, because a plugin can write definition files.
- **The task is a one-off.** Don't build a plugin for a single bulk edit; edit the files, lint, done. Plugins earn their keep when the operation repeats or belongs in CI.

## Registering

```js
// featurevisor.config.js
module.exports = {
  environments: ['staging', 'production'],
  tags: ['web', 'mobile'],

  plugins: [
    require('./plugins/my-local-plugin'),        // local file
    require('featurevisor-plugin-example')({     // npm package, configured
      someProperty: 'some value',
    }),
  ],
}
```

Local plugins need no npm package. Reusable ones should export a **factory** that takes options and returns the plugin object, as above, which is what lets each project configure it. A minimal working local plugin lives in the monorepo at [`examples/example-1/plugins/example.js`](https://github.com/featurevisor/featurevisor/blob/main/examples/example-1/plugins/example.js).

Command names must be unique: registering a plugin whose `command` collides with a built-in (or another plugin) fails with `duplicate_cli_command`. Pick a name that won't clash with future built-ins.

## Plugin shape

```ts
import type { Plugin } from '@featurevisor/core'

const examplePlugin: Plugin = {
  // exposed as: npx featurevisor example
  command: 'example',
  description: 'run the example command',

  // declaring options turns on validation for this command
  options: {
    foo: { type: 'string', description: 'value to print' },
    verbose: { type: 'boolean', alias: 'v' },
    format: { type: 'string', choices: ['json', 'text'] },
    key: { type: 'array', description: 'repeatable feature key' },
  },

  async handler({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    // ...do the work

    if (somethingFailed) {
      return false // exits the CLI with a non-zero code
    }
  },

  // shown in `npx featurevisor --help`
  examples: [
    { command: 'example', description: 'run the example command' },
    { command: 'example --foo=bar', description: 'run with options' },
  ],
}

export default examplePlugin
```

| Field         | Notes                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `command`     | Subcommand name. May declare positionals, e.g. `'example [subcommand]'`                            |
| `description` | Shown next to the command in help; falls back to the first example's description                  |
| `options`     | Optional map. Each entry takes `type` (`string` \| `number` \| `boolean` \| `array`), `alias`, `choices`, `description`, `demandOption`, `hidden` |
| `handler`     | Async; receives the four values below. Return `false` to fail the command                          |
| `examples`    | Required list of `{ command, description }`                                                        |

**Always declare `options`.** Doing so makes Featurevisor reject unknown flags, wrong types, and stray positionals *before* your handler runs, so `--fo=value` fails loudly instead of silently doing the wrong thing. Plugins that omit `options` stay in the old permissive parsing mode for backwards compatibility; that is a legacy affordance, not a default to copy. Use `array` for options that can be passed more than once.

Handler arguments:

- `rootDirectoryPath`: project root the CLI resolved (respects `--rootDirectoryPath`).
- `projectConfig`: the fully processed config ([configuration.md](configuration.md)).
- `datasource`: read and write project entities without touching the filesystem (below).
- `parsed`: yargs-parsed arguments, e.g. `{ foo: 'bar' }` for `--foo=bar`.

## Datasource API

Use `datasource` instead of `fs` plus a YAML parser: it honours the project's `parser`, directory overrides, namespace character, and adapter, so a plugin keeps working in a JSON or TOML project without changes.

```js
// features / segments / attributes / groups / schemas / targets follow one pattern
const features = await datasource.listFeatures()
const exists = await datasource.featureExists('foo')
const feature = await datasource.readFeature('foo')
await datasource.writeFeature('foo', { ...feature, ...changes })
await datasource.deleteFeature('foo')
```

Same quartet for `Segment`, `Attribute`, `Group`, `Schema`, and `Target` (`listSegments`/`readSegment`/…). Beyond those:

| Call                                            | Purpose                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `listTests()` / `readTest(key)` / `writeTest()` / `deleteTest()` | Test specs ([testing.md](testing.md))            |
| `getTestSpecName(key)`                          | Spec file name for a test key                                     |
| `listFlattenedAttributes()`                     | Attribute keys, with object attributes' properties expanded as `key.property` |
| `getRequiredFeaturesChain(key)`                 | Transitive `required:` dependencies of a feature                  |
| `readRevision()` / `writeRevision(value)`       | `.featurevisor/REVISION` ([building-datafiles.md](building-datafiles.md)) |
| `readState(env)` / `writeState(env, state)`     | Traffic allocation state (pass `false` when the project has no environments) |
| `listDatafiles()` / `readDatafile(opts)` / `writeDatafile(content, opts)` | Generated datafiles                      |
| `listHistoryEntries(entityType?, key?)` / `readCommit(hash, …)` | Git history for `feature` \| `segment` \| `attribute` \| `group` \| `test` |
| `getConfig()` / `getExtension()`                | Active config; file extension for the configured parser           |
| `listSets()` / `getSet()` / `forSet(set)`       | Sets projects. `forSet()` returns a datasource scoped to one set ([sets-promotions.md](sets-promotions.md)) |

In a sets project a plugin that ignores `forSet()` will read the wrong tree. Scope explicitly, or accept `--set` and honour it.

Writes go through the same code path the CLI uses, so **lint and test after a plugin run** exactly as you would after hand-editing:

```bash
npx featurevisor lint && npx featurevisor test
```

## Custom adapters

The default `FilesystemAdapter` reads and writes the Git repository. Swapping it points the whole CLI (and every plugin) at a different store, such as a database, an API, or an object store:

```ts
// adapters/custom-adapter.ts
import { Adapter } from '@featurevisor/core'

export class CustomAdapter extends Adapter {
  // implement the abstract methods
}
```

```js
// featurevisor.config.js
const { CustomAdapter } = require('./adapters/custom-adapter')

module.exports = {
  environments: ['staging', 'production'],
  tags: ['web', 'mobile'],
  adapter: CustomAdapter,
}
```

Mirror [`FilesystemAdapter`](https://github.com/featurevisor/featurevisor/blob/main/packages/core/src/datasource/filesystemAdapter.ts) when implementing one.

**Rarely the right answer.** Featurevisor's value is that definitions are reviewed in Git like code, and an adapter that moves them into a database gives that up. Before writing one, check whether the actual need is a plugin that *syncs* to the external system while Git stays the source of truth. Say so plainly if the user is about to trade away the GitOps workflow by accident.
