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

## Find usage

Learn where/if certain segments are attributes are used in.

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
``
