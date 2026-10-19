# Custom parsers: YAML, JSON, TOML or your own

Full docs: <https://featurevisor.com/docs/advanced/custom-parsers/>

Featurevisor reads and writes definitions through a configurable parser. YAML is the default. JSON is built in. Other formats need a custom parser with `parse` and `stringify` functions.

## Detect the active parser first

Before authoring, **always run**:

```bash
npx featurevisor config --json --pretty
```

Look at `parser` in the output. Then peek at a few existing files (`features/`, `segments/`, `attributes/`) to mimic the on-disk style exactly.

## YAML (default)

```js
// featurevisor.config.js
module.exports = {
  parser: 'yml', // optional, this is the default
}
```

Files end in `.yml`. All examples in the docs and this skill default to YAML.

## JSON

```js
module.exports = {
  parser: 'json',
}
```

Files end in `.json`. Every YAML example translates directly, with the same keys and nesting. Watch out for:

- **Comments** are not valid JSON, so inline `# notes` have nowhere to go.
- **Multiline strings** become escaped `"\n"` rather than YAML block scalars.
- **Quoting** is uniform, so mutation keys need no special care, but they keep exactly the same syntax, such as `"hero.subtitle"` or `"items[id=2]:before"`.

YAML example:

```yaml
description: Checkout redesign

bucketBy: userId

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

Same as JSON:

```json
{
  "description": "Checkout redesign",
  "bucketBy": "userId",
  "rules": [
    { "key": "everyone", "conditions": "*", "percentage": 100 }
  ]
}
```

## TOML (or any custom format)

Install a library that can both parse and serialize the format:

```bash
npm install --save-dev smol-toml
```

```js
// featurevisor.config.js
const toml = require('smol-toml')

module.exports = {
  parser: {
    extension: 'toml',
    parse: (content) => toml.parse(content),
    stringify: (content) => toml.stringify(content),
  },
}
```

`parse(content, filePath?)` receives source text and returns the parsed value. `stringify(content, filePath?)` receives a value and returns source text when definitions are written, including `promote --apply`. The optional file path can inform either operation. Keep the same data shape as YAML or JSON.

Configuration loading requires a nonempty `extension` and both functions. A parser with only `parse` prevents project CLI commands from loading, even commands that do not write. The `toml` package is parse only. It cannot supply `stringify`. See [upgrading to v4](upgrading-to-v4.md#project).

These examples omit environments. If the project declares them, keep the environment keyed shape when converting formats. `init --example=json` and `init --example=toml` scaffold projects with staging and production environments, unlike the YAML default.

## Agent guidance

- If `parser: 'json'`, **author JSON** and add no YAML files. Convert YAML examples from this skill to JSON before writing.
- If a custom parser is registered, **read several existing files** before authoring a new one. The same data can look very different: TOML, for example, writes lists of objects such as `rules` as arrays of tables.
- Custom parsers do not change the data model. Anything you can write in YAML can be expressed in any parser's format. Templates in this skill stay in YAML, so translate them when needed.
- Lint catches structural errors regardless of source format. Run `npx featurevisor lint` after every edit.

## Reference projects

The monorepo ships working examples for each:

- YAML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-yml>
- JSON: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-json>
- TOML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-toml>

If the user is migrating between formats, point them at these.
