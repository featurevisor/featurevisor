# Custom parsers (YAML / JSON / TOML / your own)

Full docs: <https://featurevisor.com/docs/advanced/custom-parsers>

Featurevisor reads definitions through a configurable parser. YAML is the default; JSON is built-in; anything else is a tiny custom function.

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
  environments: ['staging', 'production'],
  tags: ['all'],
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

Files end in `.json`. Every YAML example translates 1:1 — same keys, same nesting. Watch out for:

- **Comments** aren't valid JSON. The author loses inline `# notes`.
- **Multi-line strings** become escaped `"\n"` rather than YAML block scalars.
- **Quoting** is uniform — no special handling needed for mutation keys (no YAML-specific gotcha), but they still must contain the exact same syntax (`"hero.subtitle"`, `"items[id=2]:before"`, etc.).

YAML example:

```yaml
description: Sidebar
tags:
  - all
bucketBy: userId
rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

Same as JSON:

```json
{
  "description": "Sidebar",
  "tags": ["all"],
  "bucketBy": "userId",
  "rules": {
    "production": [
      { "key": "everyone", "segments": "*", "percentage": 100 }
    ]
  }
}
```

## TOML (or any custom format)

Install a parser for your format of choice, then point Featurevisor at it:

```js
// featurevisor.config.js
module.exports = {
  environments: ['staging', 'production'],
  tags: ['all'],

  parser: {
    extension: 'toml',
    parse: (content) => require('toml').parse(content),
  },
}
```

The `parse` function takes a file's raw string and returns the parsed JavaScript object. The data shape must match what Featurevisor expects — same keys, same nesting as YAML/JSON.

This lets teams keep configurations in whatever language they prefer (HCL, Dhall, KDL, JSON5, etc.) as long as a parser exists.

## Agent guidance

- If `parser: 'json'`, **author JSON** — don't add YAML files. Convert YAML examples from this skill to JSON before writing.
- If a custom parser is registered, **read several existing files** before authoring a new one — the syntax may be subtly different (e.g. TOML's lack of nested object literals affects how `variableOverrides` is expressed).
- Custom parsers don't change the data model — if you can write it in YAML, you can express it in any parser format. Templates in this skill stay in YAML; translate them when needed.
- Lint catches structural errors regardless of source format. Run `npx featurevisor lint` after every edit.

## Reference projects

The monorepo ships working examples for each:

- YAML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-yml>
- JSON: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-json>
- TOML: <https://github.com/featurevisor/featurevisor/tree/main/examples/example-toml>

If the user is migrating between formats, point them at these.
