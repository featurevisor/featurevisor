---
title: Linting
nextjs:
  metadata:
    title: Linting
    description: Lint your Featurevisor definition files
    openGraph:
      title: Linting
      description: Lint your Featurevisor definition files
      images:
        - url: /img/og/docs.png
---

Featurevisor provides a CLI command to lint your definition files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

Run:

```{% title="Command" %}
$ npx featurevisor lint
```

And it will show you the errors in your definition files, if any.

If any errors are found, it will terminate with a non-zero exit code.

## CLI options

### `keyPattern`

You can also filter keys using regex patterns:

```{% title="Command" %}
$ npx featurevisor lint --keyPattern="myKeyHere"
```

### `entityType`

If you want to filter it down further by entity type:

```{% title="Command" %}
$ npx featurevisor lint --keyPattern="myKeyHere" --entityType="feature"
```

Possible values for `--entityType`:

- `attribute`
- `segment`
- `feature`
- `group`
- `test`

### `json`

If you want machine-readable lint output, pass `--json`:

```{% title="Command" %}
$ npx featurevisor lint --json
```

The output format is always an object with an `errors` array:

```json
{
  "errors": [
    {
      "filePath": "segments/my-segment.yml",
      "entityType": "segment",
      "key": "my-segment",
      "message": "Required",
      "path": ["conditions", 0, "attribute"],
      "code": "invalid_type"
    }
  ]
}
```

If no lint errors are found, output is:

```json
{
  "errors": []
}
```

To pretty-print JSON output:

```{% title="Command" %}
$ npx featurevisor lint --json --pretty
```

The `--pretty` flag is only applied when `--json` is passed.

In JSON mode, lint still exits with non-zero status when errors are found, and exits with `0` when no errors are found.

## NPM scripts

If you are using npm scripts for linting your Featurevisor project like this:

```js {% path="package.json" %} }
{
  "scripts": {
    "lint": "featurevisor lint"
  }
}
```

You can then pass your options in CLI after `--`:

```
$ npm run lint -- --keyPattern="myKeyHere"
```
