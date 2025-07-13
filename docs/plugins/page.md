---
title: Plugins API
nextjs:
  metadata:
    title: Plugins API
    description: Extend Featurevisor CLI with additional tooling using the plugins API.
    openGraph:
      title: Plugins API
      description: Extend Featurevisor CLI with additional tooling using the plugins API.
      images:
        - url: /img/og/docs-plugins.png
---

While Featurevisor [CLI](/docs/cli) is packed with various core functionalities, it also has a plugins API allowing you to extend it with further tooling as per your needs. {% .lead %}

## CLI

The entire CLI is built on top of the plugins API. This means that all the core functionalities are implemented as plugins internally.

You can create your own plugins either locally at individual project level, or even share them with others in the form of reusable npm packages.

## Installing plugins

Additional plugins can be installed from [npm](https://www.npmjs.com/) directly.

```{% title="Command" %}
$ cd my-featurevisor-project
$ npm install --save featurevisor-plugin-example
```

Plugins can also be created locally without needing any additional npm package or publishing to a central registry.

## Registering plugins

You can register plugins via [configuration](/docs/configuration) file found at `featurevisor.config.js`:

```js {% path="featurevisor.config.js" %}
module.exports = {
  environments: ['staging', 'production'],
  tags: ['web', 'mobile'],

  // register plugins here
  plugins: [
    require('featurevisor-plugin-example'),
    // require("./plugins/my-local-plugin"),
  ],
}
```

## Running a plugin

Once registered, you can run the plugin via the CLI:

```{% title="Command" %}
$ npx featurevisor example

Hello world!
```

## Creating a plugin

A plugin is a simple JavaScript module that exports an object following below structure:

```js {% path="plugins/example.js" %}
module.exports = {
  // this will be made available as "example" command:
  //
  //   $ npx featurevisor example
  //
  command: 'example',

  // handle the command
  handler: async function ({
    rootDirectoryPath,
    projectConfig,
    parsed,
    datasource,
  }) {
    console.log('Hello world!')

    if (somethingFailed) {
      return false // this will exit the CLI with an error
    }
  },

  // self-documenting examples
  examples: [
    {
      command: 'example',
      description: 'run the example command',
    },
    {
      command: 'example --foo=bar',
      description: 'run the example command with additional options',
    },
  ],
}
```

## Using TypeScript

For type-safety, you can make use of the `Plugin` type:

```ts {% path="plugins/example.ts" %}
import { Plugin } from '@featurevisor/core'

const examplePlugin: Plugin = {
  command: 'example',
  handler: async function ({
    rootDirectoryPath,
    projectConfig,
    parsed,
    datasource,
  }) {
    // handle the command here...
  },
  examples: [
    // examples here...
  ],
}

export default examplePlugin
```

## Advice for reusable plugins

Above example shows how to create a simple plugin. However, if you are creating a plugin that you wish to share with others, it's recommended to make it configurable when registering them.

Instead of exporting the plugin object directly from a module, we can export a function that returns the plugin object:

```js
// npm package: featurevisor-plugin-example

module.exports = function configureExamplePlugin(options) {
  // use `options` here as needed

  // return the plugin object
  return {
    command: 'example',
    handler: async function ({
      rootDirectoryPath,
      projectConfig,
      parsed,
      datasource,
    }) {
      // ...
    },
    examples: [
      // ...
    ],
  }
}
```

When registering the plugin, the configuration options can be passed based on project specific needs:

```js {% path="featurevisor.config.js" %}
module.exports = {
  environments: ['staging', 'production'],
  tags: ['web', 'mobile'],
  plugins: [
    require('featurevisor-plugin-example')({
      // custom options here...
      someProperty: 'some value',
    }),
  ],
}
```

## Handler options

### rootDirectoryPath

This is the root directory path of the Featurevisor project where the CLI was executed from.

### projectConfig

This is the fully processed configuration object as found in `featurevisor.config.js` file in the root of your Featurevisor project.

For full details of what this object contains, refer to the [configuration](/docs/configuration) documentation.

### parsed

This object will contain the parsed command line arguments.

For example, if the command was:

```
$ npx featurevisor example --foo=bar
```

Then `parsed` object will be:

```js
{
  foo: 'bar'
}
```

It uses [yargs](https://www.npmjs.com/package/yargs) internally for parsing the command line arguments.

### datasource

Datasource allows reading/writing data from/to the Featurevisor project, so that you don't have to deal with the file system directly.

Read further in [datasource](/docs/datasource) documentation.

Here's a quick summary of reading and writing various types of entities using the datasource API:

#### Revision

See [state files](/docs/state-files) for more details.

```js
const revision = await datasource.readRevision()
await datasource.writeRevision(revision + 1)
```

#### Features

See [features](/docs/features) for more details.

```js
const features = await datasource.listFeatures()
const fooFeatureExists = await datasource.featureExists('foo')
const fooFeature = await datasource.readFeature('foo')
await datasource.writeFeature('foo', { ...fooFeature, ...newData })
await datasource.deleteFeature('foo')
```

#### Segments

See [segments](/docs/segments) for more details.

```js
const segments = await datasource.listSegments()
const fooSegmentExists = await datasource.segmentExists('foo')
const fooSegment = await datasource.readSegment('foo')
await datasource.writeSegment('foo', { ...fooSegment, ...newData })
await datasource.deleteSegment('foo')
```

#### Attributes

See [attributes](/docs/attributes) for more details.

```js
const attributes = await datasource.listAttributes()
const fooAttributeExists = await datasource.attributeExists('foo')
const fooAttribute = await datasource.readAttribute('foo')
await datasource.writeAttribute('foo', { ...fooAttribute, ...newData })
await datasource.deleteAttribute('foo')
```

See more in [datasource](/docs/datasource) documentation.
