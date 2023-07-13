---
title: Command Line Interface (CLI) Usage
description: Command Line Interface (CLI) Usage of Featurevisor
ogImage: /img/og/docs-cli.png
---

Beyond just initializing a project and building datafiles, Featurevisor CLI can be used for a few more purposes. {% .lead %}

## Installation

Install with `npm`:

```
$ npm install -g @featurevisor/cli
```

Or use `npx` to run the CLI without installing it:

```
$ npx @featurevisor/cli <command>
```

Rest of the documentation assumes that you have installed the CLI globally.

## Initializing a project

Scaffold a new project in your working directory:

```
$ mkdir my-project && cd my-project
$ featurevisor init
```

If you wish to initialize a specific example as available in the [monorepo](https://github.com/fahad19/featurevisor/tree/main/examples):

```
$ featurevisor init --example <name>
```

Learn more in [Quick start](/docs/quick-start).

## Linting YAMLs

Check if the YAML files have any syntax or structural errors:

```
$ featurevisor lint
```

Lear more in [Linting YAMLs](/docs/linting-yamls).

## Building datafiles

Generate JSON files on a per environment and tag combination as exists in project [configuration](/docs/configuration):

```
$ featurevisor build
```

Learn more in [Building datafiles](/docs/building-datafiles).

## Testing

Test your features and segments against built datafiles:

```
$ featurevisor test
```

Learn more in [Testing](/docs/testing).

## Restore state files

Building datafiles also generates [state files](/docs/state-files).

To restore them to last known state in Git, run:

```
$ featurevisor restore
```

## Generate static site

Build the site:

```
$ featurevisor site export
```

Serve the built site (defaults to port 3000):

```
$ featurevisor site serve
```

Serve it in a specific port:

```
$ featurevisor site serve -p 3000
```

Learn more in [Status site](/docs/status-site).


## Generate code

Generate TypeScript code from your YAMLs:

```
$ featurevisor generate-code --language typescript --out-dir ./src
```

See output in `./src` directory.

Learn more in [code generation](/docs/code-generation) page.
