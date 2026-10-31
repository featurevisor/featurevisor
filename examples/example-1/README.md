# example-1

Basic example showing how Featurevisor works.

This project is mostly used by the Featurevisor team for testing and development.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```sh
mkdir example-1
cd example-1
npx @featurevisor/cli@latest init --example=1
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

### Format definitions

Lays out definitions and test specs in one house style, without changing what they mean:

```sh
npm run fmt
```

### Build datafiles

```sh
npm run build
```

### Run tests

```sh
npm test
```

### Global mutation parity

The `mutationConformance` global variable exercises all mutation operations,
nested overrides, literal replacements and feature or variable prerequisites.
Its staging overrides use first match selection. Its production overrides also
demonstrate continuation. The `mutation-conformance` Target selects this variable
and its dependencies.

Run its focused spec with:

```sh
npx featurevisor test --entity-type=variable --key-pattern='^mutationConformance$'
```

From the monorepo root, `make test-mutation-conformance RUNNERS="javascript go"`
compares the same spec with global mutations precomputed and computed at runtime.
Omit `RUNNERS` to include all native SDKs after building their CLI runners. The
comparison uses temporary project copies and does not change this project's
configuration.

### Browse the Catalog

Generates and serves the project catalog:

```sh
npm start
```

### Generate code

For additional type safety and autocompletion, you can generate TypeScript code from your definitions:

```sh
npm run generate-code
```

See output in `./src` directory.

You may choose to publish the generated code as a private npm package and use it in multiple applications.
