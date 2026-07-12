# Overview <!-- omit in toc -->

This is the original monorepo of Featurevisor, which is a Git-based feature management tool offering a CLI and also a SDK (in several different languages, but this monorepo has the original TypeScript/JavaScript SDK only).

- [Links](#links)
- [Stack](#stack)
- [Packages](#packages)
- [Examples](#examples)
- [Installation](#installation)
- [Building](#building)
- [Testing](#testing)
- [Linting](#linting)
- [Formatting](#formatting)
- [Documentation](#documentation)

## Links

- Website: https://featurevisor.com
- GitHub: https://github.com/featurevisor/featurevisor
- Full documentation as a single llms.txt file: https://featurevisor.com/llms.txt

## Stack

- The monorepo is managed with Lerna
- Using Node.js v24+
- Using npm workspaces
- Using TypeScript

## Packages

They can be found in the `packages/` directory which are published to npm.

Individual packages can be built and tested by `cd`ing into the package directory and then running `npm run build` and `npm run test` respectively.

- `packages/types`: TypeScript types for all other packages
- `packages/core`: Core package used in Featurevisor CLI
- `packages/cli`: Featurevisor CLI package
- `packages/sdk`: Featurevisor SDK package
- `packages/react`: Additional React-specific hooks and components

## Examples

Example projects are available as packages in the `examples/` directory, which are for testing and development purposes only, and not published to npm.

The `examples/example-1` project is used for testing and development purposes covering all possible use cases. You can run `npx featurevisor ...` commands there to test things out quickly while changing/adding any definitions in that project.

YAML is the default file format for the example projects, but Featurevisor projects also allow other formats via its custom parsers API.

## Installation

Dependencies of entire monorepo can be installed via:

```
$ make install
```

## Building

All the packages in the monorepo can be built via:

```
$ make build
```

To specifically build a particular package, you can `cd` into the package directory and then run `npm run build`:

```
$ (cd packages/core && npm run build)
```

## Testing

All the packages in the monorepo can be tested via:

```
$ make test
```

To specifically test a particular package, you can `cd` into the package directory and then run `npm run test`:

```
$ (cd packages/core && npm run test)
```

## Linting

All the packages in the monorepo can be linted via:

```
$ make lint
```

Uses both ESLint and Prettier to lint the code everywhere.

## Formatting

To automatically format the code everywhere, run:

```
$ make format
```

## Documentation

Documentation is maintained separately in the Featurevisor website repository and published at https://featurevisor.com. This repository does not contain the documentation source.
