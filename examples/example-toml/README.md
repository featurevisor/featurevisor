# example-toml

Basic example showing how Featurevisor works, with all definitions written in TOML.

Unlike the default YAML scaffold's flat rules, this example configures staging and production environments, an `all` tag and a target selected by that tag, with its own test filenames.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```sh
mkdir my-featurevisor-project
cd my-featurevisor-project
npx @featurevisor/cli init --example=toml
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

### Generate code

For additional type safety and autocompletion, you can generate TypeScript code from your TOML definitions:

```sh
npm run generate-code
```

See output in `./src` directory.

You may choose to publish the generated code as a private npm package and use it in multiple applications.
