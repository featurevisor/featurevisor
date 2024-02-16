---
title: Linting
description: Lint your Featurevisor definition files
---

Featurevisor provides a CLI command to lint your definition files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

Run:

```
$ featurevisor lint
```

And it will show you the errors in your definition files, if any.

If any errors are found, it will terminate with a non-zero exit code.

## CLI options

### `keyPattern`

You can also filter keys using regex patterns:

```
$ featurevisor lint --keyPattern="myKeyHere"
```

### `entityType`

If you want to filter it down further by entity type:

```
$ featurevisor lint --keyPattern="myKeyHere" --entityType="feature"
```

Possible values for `--entityType`:

- `attribute`
- `segment`
- `feature`
- `group`
- `test`

## NPM scripts

If you are using npm scripts for linting your Featurevisor project like this:

```js
// package.json

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
