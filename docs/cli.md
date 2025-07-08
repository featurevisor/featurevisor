---
title: Command Line Interface (CLI) Usage
description: Command Line Interface (CLI) Usage of Featurevisor
ogImage: /img/og/docs-cli.png
---

Beyond just initializing a project and building datafiles, Featurevisor CLI can be used for a few more purposes. {% .lead %}

## Installation

Use `npx` to initialize a project first:

```
$ mkdir my-featurevisor-project && cd my-featurevisor-project
$ npx @featurevisor/cli init
```

If you wish to initialize a specific example as available in the [monorepo](https://github.com/featurevisor/featurevisor/tree/main/examples):

```
$ npx @featurevisor/cli init --example <name>
```

After you have installed the dependencies in the project:

```
$ npm install
```

You can access the Featurevisor CLI from inside the project via:

```
$ npx featurevisor
```

Learn more in [Quick start](/docs/quick-start).

## Linting YAMLs

Check if the YAML files have any syntax or structural errors:

```
$ npx featurevisor lint
```

Lear more in [Linting](/docs/linting).

## Building datafiles

Generate JSON files on a per environment and tag combination as exists in project [configuration](/docs/configuration):

```
$ npx featurevisor build
```

Learn more in [Building datafiles](/docs/building-datafiles).

## Testing

Test your features and segments:

```
$ npx featurevisor test
```

Learn more in [Testing](/docs/testing).

## Restore state files

Building datafiles also generates [state files](/docs/state-files).

To restore them to last known state in Git, run:

```
$ npx featurevisor restore
```

## Generate static site

Build the site:

```
$ npx featurevisor site export
```

Serve the built site (defaults to port 3000):

```
$ npx featurevisor site serve
```

Serve it in a specific port:

```
$ npx featurevisor site serve -p 3000
```

Learn more in [Status site](/docs/status-site).

## Generate code

Generate TypeScript code from your YAMLs:

```
$ npx featurevisor generate-code --language typescript --out-dir ./src
```

See output in `./src` directory.

Learn more in [code generation](/docs/code-generation) page.

## Find duplicate segments

It is possible to end up with multiple segments having same conditions in larger projects. This is not a problem per se, but we should be aware of it.

We can find these duplicates early on by running:

```
$ npx featurevisor find-duplicate-segments
```

If we want to know the names of authors who worked on the duplicate segments, we can pass `--authors`:

```
$ npx featurevisor find-duplicate-segments --authors
```

## Find usage

Learn where/if certain segments and attributes are used in.

For each of the `find-usage` commands below, you can optionally pass `--authors` to find who worked on the affected entities.

### Segment usage

```
$ npx featurevisor find-usage --segment=my_segment
```

### Attribute usage

```
$ npx featurevisor find-usage --attribute=my_attribute
```

### Unused segments

```
$ npx featurevisor find-usage --unusedSegments
```

### Unused attributes

```
$ npx featurevisor find-usage --unusedAttributes
```

### Feature usage

```
$ npx featurevisor find-usage --feature=my_feature
```

## Benchmarking

You can measure how fast or slow your SDK evaluations are for particular features.

The `--n` option is used to specify the number of iterations to run the benchmark for.

### Feature

To benchmark evaluating a feature itself if it is enabled or disabled via SDK's `.isEnabled()` method against provided [context](/docs/sdks/javascript/#context):

```
$ npx featurevisor benchmark \
  --environment=production \
  --feature=my_feature \
  --context='{"userId": "123"}' \
  --n=1000
```

### Variation

To benchmark evaluating a feature's variation via SDKs's `.getVariation()` method:

```
$ npx featurevisor benchmark \
  --environment=production \
  --feature=my_feature \
  --variation \
  --context='{"userId": "123"}' \
  --n=1000
```

### Variable

To benchmark evaluating a feature's variable via SDKs's `.getVariable()` method:

```
$ npx featurevisor benchmark \
  --environment=production \
  --feature=my_feature \
  --variable=my_variable_key \
  --context='{"userId": "123"}' \
  --n=1000
```

You can optionally pass `--schema-version=2` if you are using the new schema v2.

## Configuration

To view the project [configuration](/docs/configuration):

```
$ npx featurevisor config
```

Printing configuration as JSON:

```
$ npx featurevisor config --print --pretty
```

## Evaluate

To learn why certain values (like feature and its variation or variables) are evaluated as they are against provided [context](/docs/sdks/javascript/#context):

```
$ npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --context='{"userId": "123", "country": "nl"}'
```

This will show you full [evaluation details](/docs/sdks/javascript/#evaluation-details) helping you debug better in case of any confusion.

It is similar to [logging](/docs/sdks/javascript/#logging) in SDKs with `debug` level. But here instead, we are doing it at CLI directly in our Featurevisor project without having to involve our application(s).

If you wish to print the evaluation details in plain JSON, you can pass `--print` at the end:

```
$ npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --context='{"userId": "123", "country": "nl"}' \
  --print \
  --pretty
```

The `--pretty` flag is optional.

To print further logs in a more verbose way, you can pass `--verbose`:

```
$ npx featurevisor evaluate \
  --environment=production \
  --feature=my_feature \
  --context='{"userId": "123", "country": "nl"}' \
  --verbose
```

You can optionally pass `--schema-version=2` if you are using the new schema v2.

## List

### List features

To list all features in the project:

```
$ npx featurevisor list --features
```

Advanced search options:

| Option                         | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| `--archived=<true or false>`   | by [archived](/docs/features/#archiving) status    |
| `--description=<pattern>`      | by description pattern                             |
| `--disabledIn=<environment>`   | disabled in an [environment](/docs/environments)   |
| `--enabledIn=<environment>`    | enabled in an [environment](/docs/environments)    |
| `--json`                       | print as JSON                                      |
| `--keyPattern=<pattern>`       | by key pattern                                     |
| `--tag=<tag>`                  | by [tag](/docs/tags/)                              |
| `--variable=<variableKey>`     | containing specific variable key                   |
| `--variation=<variationValue>` | containing specific variation key                  |
| `--with-tests`                 | with [test specs](/docs/testing)                   |
| `--with-variables`             | with variables                                     |
| `--with-variations`            | with [variations](/docs/features/#variations)      |
| `--without-tests`              | without any test specs                             |
| `--without-variables`          | without any [variables](/docs/features/#variables) |
| `--without-variations`         | without any variations                             |

### List segments

To list all segments in the project:

```
$ npx featurevisor list --segments
```

Advanced search options:

| Option                       | Description                                     |
| ---------------------------- | ----------------------------------------------- |
| `--archived=<true or false>` | by [archived](/docs/segments/#archiving) status |
| `--description=<pattern>`    | by description pattern                          |
| `--json`                     | print as JSON                                   |
| `--keyPattern=<pattern>`     | by key pattern                                  |
| `--pretty`                   | pretty JSON                                     |
| `--with-tests`               | with [test specs](/docs/testing)                |
| `--without-tests`            | without any test specs                          |

### List attributes

To list all attributes in the project:

```
$ npx featurevisor list --attributes
```

Advanced search options:

| Option                       | Description                                       |
| ---------------------------- | ------------------------------------------------- |
| `--archived=<true or false>` | by [archived](/docs/attributes/#archiving) status |
| `--description=<pattern>`    | by description pattern                            |
| `--json`                     | print as JSON                                     |
| `--keyPattern=<pattern>`     | by key pattern                                    |
| `--pretty`                   | pretty JSON                                       |

### List tests

To list all tests specs in the project:

```
$ npx featurevisor list --tests
```

Advanced search options:

| Option                         | Description                                       |
| ------------------------------ | ------------------------------------------------- |
| `--applyMatrix`                | apply matrix for assertions                       |
| `--assertionPattern=<pattern>` | by assertion's description pattern                |
| `--json`                       | print as JSON                                     |
| `--keyPattern=<pattern>`       | by key pattern of feature or segment being tested |
| `--pretty`                     | pretty JSON                                       |

## Assess distribution

To check if the gradual rollout of a feature and the weight distribution of its variations (if any exists) are going to work as expected in a real world application with real traffic against provided [context](/docs/sdks/javascript/#context), we can imitate that by running:

```
$ npx featurevisor assess-distribution \
  --environment=production \
  --feature=my_feature \
  --context='{"country": "nl"}' \
  --populateUuid=userId \
  --n=1000
```

The `--n` option controls the number of iterations to run, and the `--populateUuid` option is used to simulate different users in each iteration in this particular case.

Further details about all the options:

- `--environment`: the environment name
- `--feature`: the feature key
- `--context`: the common [context](/docs/sdks/javascript/#context) object in stringified form
- `--populateUuid`: attribute key that should be populated with a new UUID, and merged with provided context.
  - You can pass multiple attributes in your command: `--populateUuid=userId --populateUuid=deviceId`
- `--n`: the number of iterations to run the assessment for
  - The higher the number, the more accurate the distribution will be
- `--verbose`: print the merged context for better debugging

Everything is happening locally in memory without modifying any content anywhere. This command exists only to add to our confidence if questions arise about how effective traffic distribution in Featurevisor is.

## Info

Shows count of various entities in the project:

```
$ npx featurevisor info
```

## Version

Get the current version number of Featurevisor CLI, and its relevant packages:

```
$ npx featurevisor --version
```

Or do:

```
$ npx featurevisor -v
```
