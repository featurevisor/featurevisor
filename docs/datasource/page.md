---
title: Datasource & Adapters
nextjs:
  metadata:
    title: Datasource & Adapters
    description: Go beyond file system as source of your configuration with Featurevisor
    openGraph:
      title: Datasource & Adapters
      description: Go beyond file system as source of your configuration with Featurevisor
      images:
        - url: /img/og/docs-datasource.png
---

By default, Featurevisor [CLI](/docs/cli) uses the file system for reading and writing data in your project, given it's a Git repository after all. But the [configuration](/docs/configuration) API allows you to switch to any source via adapters. {% .lead %}

## Accessing datasource

It's unlikely that you will make use of the Datasource API yourself directly, unless you are a [plugin](/docs/plugins) developer.

The `datasource` object allows you to read and write data from/to the Featurevisor project, so that you don't have to deal with the file system (or any other custom source of your project data) directly.

You can refer to the full [datasource API](https://github.com/featurevisor/featurevisor/blob/main/packages/core/src/datasource/datasource.ts) for more details.

## Datasource methods

Once you have access to the `datasource` object, you can use the following methods from its instance:

### Revision

See [state files](/docs/state-files) for more details.

```js
const revision = await datasource.readRevision()
await datasource.writeRevision(revision + 1)
```

### Features

See [features](/docs/features) for more details.

```js
const features = await datasource.listFeatures()
const fooFeatureExists = await datasource.featureExists('foo')
const fooFeature = await datasource.readFeature('foo')
await datasource.writeFeature('foo', { ...fooFeature, ...newData })
await datasource.deleteFeature('foo')
```

If `splitByEnvironment` is enabled in project config, `readFeature()` still returns the same merged shape (`rules`, `force`, and `expose` grouped by environment), while data is read from:

- `features/<feature>.yml` for shared properties
- `environments/<environment>/<feature>.yml` for environment specific properties

### Segments

See [segments](/docs/segments) for more details.

```js
const segments = await datasource.listSegments()
const fooSegmentExists = await datasource.segmentExists('foo')
const fooSegment = await datasource.readSegment('foo')
await datasource.writeSegment('foo', { ...fooSegment, ...newData })
await datasource.deleteSegment('foo')
```

### Attributes

See [attributes](/docs/attributes) for more details.

```js
const attributes = await datasource.listAttributes()
const fooAttributeExists = await datasource.attributeExists('foo')
const fooAttribute = await datasource.readAttribute('foo')
await datasource.writeAttribute('foo', { ...fooAttribute, ...newData })
await datasource.deleteAttribute('foo')
```

### Groups

See [groups](/docs/groups) for more details.

```js
const groups = await datasource.listGroups()
const fooGroupExists = await datasource.groupExists('foo')
const fooGroup = await datasource.readGroup('foo')
await datasource.writeGroup('foo', { ...fooGroup, ...newData })
await datasource.deleteGroup('foo')
```

### Tests

See [testing](/docs/testing) for more details.

```js
const tests = await datasource.listTests()
const fooTest = await datasource.readTest('foo')
await datasource.writeTest('foo', { ...fooTest, ...newData })
await datasource.deleteTest('foo')
```

### State

See [state files](/docs/state-files) for more details.

```js
const existingState = await datasource.readState(environment)
datasource.writeState(environment, { ...existingState, ...newState })
```

### History

To get history of changes made to a specific entity:

```js
const fooChanges = await datasource.listHistoryEntries('feature', 'foo')
```

The first argument for entity type can be one of:

- `feature`
- `segment`
- `attribute`
- `group`
- `test`

## Adapters

Because a Featurevisor project is a Git repository by default, Featurevisor CLI ships with a default adapter that reads and writes data from/to the file system which is called `FilesystemAdapter`.

You don't have to configure this adapter explicitly anywhere, unless you are writing a custom one.

### Writing a custom adapter

You can write your own custom datasource adapter as follows:

```ts {% path="adapters/custom-adapter.ts" %}
import { Adapter } from '@featurevisor/core'

export class CustomAdapter extends Adapter {
  // ...implement the methods here
}
```

Refer to the implementation of [`FilesystemAdapter`](https://github.com/featurevisor/featurevisor/blob/main/packages/core/src/datasource/filesystemAdapter.ts) to understand more.

### Using a custom adapter

You can swap out the default file system adapter with your custom adapter via you [configuration](/docs/configuration) file as found in `featurevisor.config.js`:

```js {% path="featurevisor.config.js" %}
const { CustomAdapter } = require('./adapters/custom-adapter')

module.exports = {
  environments: ['staging', 'production'],
  tags: ['web', 'mobile'],

  adapter: CustomAdapter,
}
```
