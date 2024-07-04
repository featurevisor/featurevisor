---
title: Creating a new SDK
description: Learn how to create a new Featurevisor SDK in a programming language of your choice,
ogImage: /img/og/docs-sdks-create.png
---

Featurevisor is a programming language agnostic feature management solution meant to be used anywhere as long as you have an SDK for it. {% .lead %}

While the project comes with a few different [SDKs](/docs/sdks/) supporting different programming languages, you can also create your own to contribute to the growing ecosystem.

## Prior reading

You are highly recommended to read the following pages before creating a new SDK.

### Configuring the project

- [Configuration](/docs/configuration)

### Understanding the building blocks

- [Attributes](/docs/attributes)
- [Segments](/docs/segments)
- [Features](/docs/features)

### Building and deployment

- [Testing](/docs/testing)
- [Building datafiles](/docs/building-datafiles)
- [Deployment](/docs/deployment)
  - [GitHub Actions](/docs/integrations/github-actions)

### Consuming datafile with SDK

Use the following SDKs as a reference for implementation:

- [JavaScript SDK](/docs/sdks/javascript)

---

## SDK

We wish to maintain feature parity across all SDKs in various different programming languages, so we can provide a consistent experience to our developers.

To achieve this, we have defined a set of common [interfaces](https://github.com/featurevisor/featurevisor/blob/main/packages/types/src/index.ts) that each SDK should implement.

## Interfaces

It's worth referring to the common TypeScript interfaces defined [here](https://github.com/featurevisor/featurevisor/blob/main/packages/types/src/index.ts) that both the SDK and CLI use.

There are also additional interfaces defined for SDK alone [here](https://github.com/featurevisor/featurevisor/tree/main/packages/sdk/src).

### Instance

An SDK instance should be created by calling a function `createInstance`, which should receive a configuration object as an argument, that we call "constructor options".

Example in JavaScript:

```js
const instance = createInstance(options);
```

### Constructor options

When creating the SDK instance, it should receive an `options` object with the following properties:

| Property               | Type                  | Description                                                                      |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `bucketKeySeparator`   | `string` (optional)   | The separator used to split the bucket key from the feature key. Defaults to `.` |
| `configureBucketKey`   | `function` (optional) | A function that can be used to configure the bucket key                          |
| `configureBucketValue` | `function` (optional) | A function that can be used to configure the bucket value                        |
| `datafile`             | `object` (optional)   | The parsed datafile to be used by the SDK                                        |
| `datafileUrl`          | `string` (optional)   | The URL to fetch the datafile from                                               |
| `handleDatafileFetch`  | `function` (optional) | A function that can be used to handle the datafile fetch                         |
| `initialFeatures`      | `object` (optional)   | The initial features to be used before datafile is fetched                       |
| `interceptContext`     | `function` (optional) | A function that can be used to intercept and modify the context                  |
| `logger`               | `function` (optional) | A function that can be used to log messages                                      |
| `onActivation`         | `function` (optional) | A function that can be used to handle feature activation                         |
| `onReady`              | `function` (optional) | Triggered once when datafile has been fetched and SDK is ready                   |
| `onRefresh`            | `function` (optional) | Triggered when datafile has been refreshed                                       |
| `onUpdate`             | `function` (optional) | Triggered when datafile has been refreshed, and is of a new revision number      |
| `refreshInterval`      | `number` (optional)   | The interval in seconds to refresh the datafile                                  |
| `stickyFeatures`       | `object` (optional)   | Override feature evaluations for certain features                                |

All of the properties are optional indeed, but we must have either `datafile` or `datafileUrl` present in the `options` object.

Refer to JavaScript implementation [here](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/instance.ts).

### Bucketing

Featurevisor relies on a bucketing technique to determine the evaluated value of a feature, making sure the same user for the same feature key always gets the same value consistently.

The bucketing is done by generating a hash based on:

- the feature key, and
- usually the user/device ID as configured via feature's [`bucketBy`](/docs/features/#bucketing)

The bucketing key is generated by concatenating the feature key and the user key with a separator, and then hashing it against [MurmurHash](https://en.wikipedia.org/wiki/MurmurHash) v3 algorithm, entirely in memory.

Refer to the JavaScript implementation here:

- [Generating hash](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/bucket.ts)
- [Usage in instance](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/instance.ts)

### Logger

The SDK ships with a default logger that logs/prints messages to the console. However, you can override this behavior by providing your own logger function.

The `logger` property should receive an instance of `Logger` as found [here](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/logger.ts).

To make it convenient for developers to create their own loggers, we recommend that you also export a [`createLogger`](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/logger.ts) function that can be used to create a new custom logger instance.

### Methods

Several methods should be exposed publicly by the SDK instance:

| Method               | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `activate`           | Activate the feature                                  |
| `evaluateFlag`       | Get the feature's flag (true/false) evaluation        |
| `evaluateVariable`   | Get the feature's variable evaluation                 |
| `evaluateVariation`  | Get the feature's variation evaluation                |
| `getFeature`         | Get the feature definition from datafile              |
| `getRevision`        | Get the revision number from datafile                 |
| `getVariable`        | Get the feature's evaluated variable value            |
| `getVariableArray`   | Get the feature's evaluated variable value as array   |
| `getVariableBoolean` | Get the feature's evaluated variable value as boolean |
| `getVariableDouble`  | Get the feature's evaluated variable value as float   |
| `getVariableInteger` | Get the feature's evaluated variable value as integer |
| `getVariableJSON`    | Get the feature's evaluated variable value as JSON    |
| `getVariableObject`  | Get the feature's evaluated variable value as object  |
| `getVariableString`  | Get the feature's evaluated variable value as string  |
| `getVariation`       | Get the feature's evaluated variation value           |
| `isEnabled`          | Returns `true` if enabled, `false` otherwise          |
| `isReady`            | Synchronously check if the SDK instance is ready      |
| `onReady`            | Asynchronously resolves with instance once it's ready |
| `refresh`            | Refresh the datafile manually                         |
| `setDatafile`        | Set the datafile to be used by the SDK                |
| `setLogLevels`       | Get the evaluated value of a feature                  |
| `setStickyFeatures`  | Set the sticky features to be used by the SDK         |
| `startRefreshing`    | Start refreshing the datafile manually                |
| `stopRefreshing`     | Stop refreshing the datafile manually                 |

Refer to the JavaScript implementation [here](https://github.com/featurevisor/featurevisor/blob/main/packages/sdk/src/instance.ts).

## CLI

Besides creating a new SDK, we also recommend that you also (optionally) provide a CLI tool in your new SDK's language to help with testing and debugging Featurevisor project.

If you are building an SDK in Golang for example, you could potentially serve an executable called `featurevisor-go`, which can be used via command line to interact with the Featurevisor project.

### Commands

Some of the commands that you could potentially provide are:

| Command               | Description                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `test`                | For [testing](/docs/testing) the Featurevisor project                                     |
| `benchmark`           | For [benchmarking](/docs/cli/#benchmarking) evaluations                                   |
| `evaluate`            | For [evaluating](/docs/cli/#evaluate) feature flags, variation, variables                 |
| `assess-distribution` | For verifying if traffic split is [distributed](/docs/cli/#assess-distribution) correctly |

If you are writing a new CLI in Golang for Featurevisor, then the idea is to have these commands accessible as:

```
$ featurevisor-go test
$ featurevisor-go benchmark
$ featurevisor-go <command-name>
```

There's no strict rule for providing an executable/binary like mentioned above. Our goal is to somehow allow developers to interact with the Featurevisor project via command line that makes of the newly created SDK by you.

See our [CLI guide](/docs/cli) to get the full picture.

## Documentation

If you are confident with your newly developed SDK, and wish to let others know about it, you can document it on the same [Featurevisor website](https://featurevisor.com) that you are reading right now.

To do so:

- [Fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo) the [monorepo](https://github.com/featurevisor/featurevisor)
- Create a new [branch](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository)
- Create a new SDK page [here](https://github.com/featurevisor/featurevisor/tree/main/docs/sdks)
- Link to your SDK page from this root page [here](https://github.com/featurevisor/featurevisor/blob/main/docs/sdks/index.md)
- Link to your SDK page from sidebar navigation [here](https://github.com/featurevisor/featurevisor/blob/main/docs/sidebarNavigation.json)
- Send a [Pull Request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork) from your fork
