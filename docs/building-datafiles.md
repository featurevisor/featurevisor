---
title: Building datafiles
description: Build your Featurevisor project datafiles
---

Datafiles are JSON files that are created against combinations of tags and environments. They are used to evaluate features in your application via Featurevisor SDKs. {% .lead %}

## Usage

Use Featurevisor CLI to build your datafiles:

```
$ npx featurevisor build
```

## Output

The build output can be found in the `dist` directory.

If your `featurevisor.config.js` file looks like this:

```js
// featurevisor.config.js
module.exports = {
  tags: ["all"],
  environments: ["staging", "production"],
}
```

Then the contents of your `dist` directory will look like this:

```
$ tree dist
.
├── production
│   └── datafile-tag-all.json
└── staging
    └── datafile-tag-all.json

2 directories, 2 files
```

Next to datafiles, the build process will also generate some additional JSON files that we can learn about in [State files](/docs/state-files).

## Revision

By default, Featurevisor will increment the revision number as found in `.featurevisor/REVISION` file (learn more in [state files](/docs/state-files)).

You can optionally customize the `revision` value when building datafiles by passing a `--revision` flag:

```
$ npx featurevisor build --revision 1.2.3
```

If you wish to build datafiles without making any changes to [state files](/docs/state-files), you can pass the `--no-state-files` flag:

```
$ npx featurevisor build --no-state-files
```

## Printing

You can print the contents of a datafile for a single feature in/or an environment without writing anything to disk by passing these flags:

```
$ npx featurevisor build --feature=foo --environment=production --print --pretty
```

Or if you with to print datafile containing all features for a specific environment:

```
$ npx featurevisor build --environment=production --print --pretty
```

This is useful primarily for debugging and testing purposes.

If you are an SDK developer in other languages besides JavaScript, you may want to use this handy command to get the generated datafile content in JSON format that you can use in your own [test runner](/docs/testing).

## Datafiles directory

By default, datafiles will be generated in the `dist` directory, or your custom directory if you have specified it under `outputDirectoryPath` in your [`featurevisor.config.js`](/docs/configuration/) file.

You can optionally override it from CLI:

```
$ npx featurevisor build --datafiles-dir=./custom-directory
```

## Schema v2

In preparation for the upcoming [major v2.0](https://github.com/featurevisor/featurevisor/issues/326) release, current Featurevisor v1.x CLI can optionally build datafiles in the new schema format.

To enable this, you can pass `--schema-version=2` in CLI:

```
$ npx featurevisor build --schema-version=2
```

Before generating datafiles in the new schema format, make sure to upgrade to latest Featurevisor SDKs in your client application(s) which support both schema versions.
