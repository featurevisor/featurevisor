# example-split-environments

Example project demonstrating `splitByEnvironment` with environment-specific feature files under `environments/<environment>/`.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Initialize

```
$ mkdir my-featurevisor-project
$ cd my-featurevisor-project
$ npx @featurevisor/cli init --example example-split-environments
```

## Installation

```
$ npm install
```

## Usage

### Lint YAMLs

```
$ npx featurevisor lint
```

### Build datafiles

```
$ npx featurevisor build
```

### Test features

```
$ npx featurevisor test
```
