# Custom parsers (YAML / JSON / TOML / your own)

Full docs: <https://featurevisor.com/docs/advanced/custom-parsers>

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
  parser: 'yml',          // optional; this is the default
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

- **Comments** aren't valid JSON. The author loses inline `# notes`.
- **Multi-line strings** become escaped `"\n"` rather than YAML block scalars.
- **Quoting** is uniform: no special handling needed for mutation keys (no YAML-specific gotcha), but they still must contain the exact same syntax (`"hero.subtitle"`, `"items[id=2]:before"`, etc.).

YAML example:

```yaml
description: Sidebar

bucketBy: userId

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

Same as JSON:

```json
{
  "description": "Sidebar",
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

These examples omit environments. If the project declares them, keep the environment keyed shape when converting formats.

## Agent guidance

- If `parser: 'json'`, **author JSON**: don't add YAML files. Convert YAML examples from this skill to JSON before writing.
- If a custom parser is registered, **read several existing files** before authoring a new one: the syntax may be subtly different (e.g. TOML's lack of nested object literals affects how `variableOverrides` is expressed).
- Custom parsers don't change the data model: if you can write it in YAML, you can express it in any parser format. Templates in this skill stay in YAML. Translate them when needed.
- Lint catches structural errors regardless of source format. Run `npx featurevisor lint` after every edit.

## Reference projects

The monorepo ships working examples for each:

- YAML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-yml>
- JSON: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-json>
- TOML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-toml>

If the user is migrating between formats, point them at these.
