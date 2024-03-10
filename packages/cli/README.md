# @featurevisor/cli

CLI package of Featurevisor.

Visit [https://featurevisor.com/docs/cli](https://featurevisor.com/docs/cli) for more information.

## Installation

```
$ npm install --save-dev @featurevisor/cli
```

## Usage

### `init`

Initialize your project.

```
$ mkdir my-featurevisor-project && cd my-featurevisor-project
$ npx @featurevisor/cli init
$ npm install
```

If you want to initialize your project with a specific example:

```
$ npx @featurevisor/cli init --example <name>
```

Examples found [here](../../examples).

### `lint`

Check if your YAMLs are valid.

```
$ npx featurevisor lint
```


### `build`

Build your datafiles.

```
$ npx featurevisor build
```

### `test`

Test your generated datafiles using the SDK, against specs written in YAMLs.

```
$ npx featurevisor test
```

See test specs in YAMLs [here](../../examples/example-1/tests) for inspiration.

### `site`

Start a local server to view your project's site.

```
$ npx featurevisor site export
$ npx featurevisor site serve
```

## License

MIT © [Fahad Heylaal](https://fahad19.com)
