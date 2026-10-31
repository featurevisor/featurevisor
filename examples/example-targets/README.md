# example-yml-targets

Example project showing how to use `targets` in Featurevisor.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```sh
mkdir my-featurevisor-project && cd my-featurevisor-project
npx @featurevisor/cli@latest init --example=targets
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
