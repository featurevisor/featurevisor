# example-fel

Example 1 with its conditions written in FEL, the Featurevisor Expression Language. It sets `allowFEL: true` in `featurevisor.config.js`. Its datafiles evaluate exactly as Example 1's do, and its tests are Example 1's tests.

Three condition leaves stay as YAML objects beside FEL strings, since a disabled feature's variation has no FEL form.

This project is mostly used by the Featurevisor team for testing and development.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

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
