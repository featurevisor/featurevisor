# example-1

Basic example showing how Featurevisor works.

This project is mostly used by the Featurevisor team for testing and development.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```
$ mkdir example-1
$ cd example-1
$ npx @featurevisor/cli init
```

## Installation

```
$ npm install
```

## Usage

### Lint YAMLs

```
$ npm run lint
```

### Build datafiles

```
$ npm run build
```

### Test features

```
$ npm test
```

### Start local server

Generates and serves status site:

```
$ npm start
```

### Generate code

For additional type safety and autocompletion, you can generate TypeScript code from your YAMLs:

```
$ npm run generate-code
```

See output in `./src` directory.

You may choose to publish the generated code as a private npm package and use it in multiple applications.
