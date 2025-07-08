---
title: Building datafiles
nextjs:
  metadata:
    title: Building datafiles
    description: Build your Featurevisor project datafiles
    openGraph:
      title: Building datafiles
      description: Build your Featurevisor project datafiles
      images:
        - url: /img/og/docs.png
---

Datafiles are JSON files that are created against combinations of [tags](/docs/tags/) and [environments](/docs/environments/). They are used to evaluate features in your application via Featurevisor [SDKs](/docs/sdks/). {% .lead %}

## Usage

Use Featurevisor CLI to build your datafiles:

```{% title="Command" %}
$ npx featurevisor build
```

## Output

The build output can be found in the `datafiles` directory.

If your `featurevisor.config.js` file looks like this:

```js {% path="featurevisor.config.js" %}
module.exports = {
  tags: ['all'],
  environments: ['staging', 'production'],
}
```

Then the contents of your `datafiles` directory will look like this:

```
$ tree datafiles
.
├── production
│   └── featurevisor-tag-all.json
└── staging
    └── featurevisor-tag-all.json

2 directories, 2 files
```

Next to datafiles, the build process will also generate some additional JSON files that we can learn more about in [State files](/docs/state-files).

## Revision

By default, Featurevisor will increment the revision number as found in `.featurevisor/REVISION` file (learn more in [state files](/docs/state-files)).

### Custom revision

You can optionally customize the `revision` value when building datafiles by passing a `--revision` flag:

```{% title="Command" %}
$ npx featurevisor build --revision 1.2.3
```

### Revision from hash

If instead of an incremented revision, you want to use the hash of the individual datafile content, you can pass `--revision-from-hash`:

```{% title="Command" %}
$ npx featurevisor build --revision-from-hash
```

If in a particular datafile the content has not changed, the revision will remain the same as the previous build.

This is useful for caching purposes.

### No state files

If you wish to build datafiles without making any changes to [state files](/docs/state-files), you can pass the `--no-state-files` flag:

```{% title="Command" %}
$ npx featurevisor build --no-state-files
```

## Printing

You can print the contents of a datafile for a single feature or all the features in an environment without writing anything to disk by passing these flags:

```{% title="Command" %}
$ npx featurevisor build \
    --feature=foo \
    --environment=production \
    --json \
    --pretty
```

Or if you with to print datafile containing all features for a specific environment:

```{% title="Command" %}
$ npx featurevisor build --environment=production --json --pretty
```

This is useful primarily for debugging and testing purposes.

If you are an SDK developer in other languages besides JavaScript, you may want to use this handy command to get the generated datafile content in JSON format that you can use in your own [test runner](/docs/testing).

## Datafiles directory

By default, datafiles will be generated in the `datafiles` directory, or your custom directory if you have specified it under `datafilesDirectoryPath` in your [`featurevisor.config.js`](/docs/configuration/) file.

You can optionally override it from CLI:

```{% title="Command" %}
$ npx featurevisor build --datafiles-dir=./custom-directory
```

## Schema version

If you are using older Featurevisor v1 SDKs, you can build datafiles in the v1 schema format by passing the `--schema=version=1` flag:

```bash {% title="Command" %}
# finish regular build first
$ npx featurevisor build

# then build v1-compatible datafiles
$ npx featurevisor build \
    --schema-version=1 \
    --datafiles-dir=./datafiles/v1 \
    --no-state-files
```
