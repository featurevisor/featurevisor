# Overview <!-- omit in toc -->

This is the original monorepo of Featurevisor, which is a Git-based feature management tool offering a CLI and also a SDK (in several different languages, but this monorepo has the original TypeScript/JavaScript SDK only).

- [Links](#links)
- [Stack](#stack)
- [Packages](#packages)
- [Installation](#installation)
- [Building](#building)
- [Testing](#testing)
- [Linting](#linting)

## Links

- Website: https://featurevisor.com
- GitHub: https://github.com/featurevisor/featurevisor

## Stack

- The monorepo is managed with Lerna
- Using Node.js v24+
- Using npm workspaces
- using TypeScript

## Packages

They can be found in the `packages/` directory which are published to npm.

Example projects are available as packages in the `examples/` directory, which are for testing and development purposes only, and not published to npm.

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
