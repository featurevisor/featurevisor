---
title: Plugins API
description: Extend Featurevisor CLI with additional tooling using the plugins API.
ogImage: /img/og/docs-plugins.png
---

While Featurevisor [CLI](/docs/cli) is packed with various core functionalities, it also has a plugins API allowing you to extend with further tooling as per your needs. {% .lead %}

## CLI

The entire CLI is built on top of the plugins API. This means that all the core functionalities are implemented as plugins. You can also create your own plugins to extend the CLI with additional tooling.

## Installing plugins

Additional plugins can be installed from [npm](https://www.npmjs.com/) directly.

```
$ cd my-featurevisor-project
$ npm install --save @featurevisor/plugin-example
```

Plugins can also be created locally without needing any additional npm package or publishing to a central registry.

## Registering plugins

You can register plugins via [configuration](/docs/configuration) file found at `featurevisor.config.js`:

```js
// featurevisor.config.js

module.exports = {
  environments: ["staging", "production"],
  tags: ["web", "mobile"],

  // register plugins here
  plugins: [
    require("@featurevisor/plugin-example"),
    // require("./plugins/my-local-plugin"),
  ],
};
```

## Creating a plugin

A plugin is a simple JavaScript module that exports an object following below structure:

```js
// plugins/example.js

module.exports = {
  // this will be made available as "example" command:
  //
  //   $ npx featurevisor example
  //
  command: "example",

  // handle the command
  handler: async function ({
    rootDirectoryPath,
    projectConfig,
    parsed,
    datasource,
  }) {
    console.log("Running the example command!");

    if (somethingFailed) {
      return false; // this will exit the CLI with an error
    }
  },

  // self-documenting examples
  examples: [
    {
      command: "example",
      description: "run the example command",
    },
    {
      command: "example --foo=bar",
      description: "run the example command with additional options",
    },
  ],
};
```

## Using TypeScript

For type-safety, you can make use of the `Plugin` type:

```ts
// plugins/example.ts

import { Plugin } from "@featurevisor/core";

const examplePlugin: Plugin = {
  command: "example",
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
};

export default examplePlugin;
```

## Handler options

### rootDirectoryPath

This is the root directory path of the project where the CLI was executed from.

### projectConfig

This is the fully processed configuration object as found in `featurevisor.config.js` file in the root of your Featurevisor project.

For full details of what this object contains, refer to the [configuration](/docs/configuration) documentation.

### parsed

This object will contain the parsed command line arguments.

For example, if the command was:

```
$ npx featurevisor example --foo=bar
```

Then `parsed` will be:

```js
{
  foo: "bar"
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
const revision = await datasource.readRevision();
await datasource.writeRevision(revision + 1);
```

#### Features

See [features](/docs/features) for more details.

```js
const features = await datasource.listFeatures();
const fooFeatureExists = await datasource.featureExists("foo");
const fooFeature = await datasource.readFeature("foo");
await datasource.writeFeature("foo", { ...fooFeature, ...newData });
await datasource.deleteFeature("foo");
```

#### Segments

See [segments](/docs/segments) for more details.

```js
const segments = await datasource.listSegments();
const fooSegmentExists = await datasource.segmentExists("foo");
const fooSegment = await datasource.readSegment("foo");
await datasource.writeSegment("foo", { ...fooSegment, ...newData });
await datasource.deleteSegment("foo");
```

#### Attributes

See [attributes](/docs/attributes) for more details.

```js
const attributes = await datasource.listAttributes();
const fooAttributeExists = await datasource.attributeExists("foo");
const fooAttribute = await datasource.readAttribute("foo");
await datasource.writeAttribute("foo", { ...fooAttribute, ...newData });
await datasource.deleteAttribute("foo");
```

#### Groups

See [groups](/docs/groups) for more details.

```js
const groups = await datasource.listGroups();
const fooGroupExists = await datasource.groupExists("foo");
const fooGroup = await datasource.readGroup("foo");
await datasource.writeGroup("foo", { ...fooGroup, ...newData });
await datasource.deleteGroup("foo");
```

#### Tests

See [testing](/docs/testing) for more details.

```js
const tests = await datasource.listTests();
const fooTest = await datasource.readTest("foo");
await datasource.writeTest("foo", { ...fooTest, ...newData });
await datasource.deleteTest("foo");
```

#### State

See [state files](/docs/state-files) for more details.

```js
const existingState = await datasource.readState(environment);
datasource.writeState(environment, { ...existingState, ...newState });
```
