# example-yml

Basic example showing how Featurevisor works, with all definitions written in YAML.

This is the default scaffold. Rules are flat lists, tests do not select an
environment, and the `all` target includes every active feature and global
variable without requiring tags. Building writes `datafiles/featurevisor-all.json`.

For staging and production rules in shared definitions, use
`init --example=with-environments`. The existing `init --example=environments`
choice instead models release lanes with Sets.
To give this project environments or Sets later, run
`npx featurevisor convert` ([Converting](https://featurevisor.com/docs/convert/)).

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```sh
mkdir my-featurevisor-project
cd my-featurevisor-project
npx @featurevisor/cli@latest init
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
