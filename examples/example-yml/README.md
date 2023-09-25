# example-yml

Basic example showing how Featurevisor works, with all definitions written in YAML.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```
$ mkdir my-featurevisor-project
$ cd my-featurevisor-project
$ npx @featurevisor/cli init --example example-yml
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
