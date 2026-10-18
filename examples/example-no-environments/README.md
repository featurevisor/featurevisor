# example-no-environments

Example project with no environments.

The `no-environments` choice remains available as an alias for the default YAML
scaffold, with the same configuration, definitions and tests. Rules are flat lists
and the `all` target includes every active feature and global variable without
requiring tags. Building writes `datafiles/featurevisor-all.json`.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```sh
mkdir my-featurevisor-project
cd my-featurevisor-project
npx @featurevisor/cli init --example=no-environments
```

## Installation

```sh
npm install
```

## Usage

### Validate definitions

```sh
npm run lint
```

### Build datafiles

```sh
npm run build
```

### Run tests

```sh
npm test
```

### Browse the Catalog

Generates and serves the project catalog:

```sh
npm start
```
