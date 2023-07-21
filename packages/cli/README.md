# @featurevisor/cli

CLI package of Featurevisor.

Visit [https://featurevisor.com/docs/cli](https://featurevisor.com/docs/cli) for more information.

## Installation

```
$ npm install -g @featurevisor/cli
```

Or via `npx`:

```
$ npx featurevisor <command>
```

## Usage

### `init`

Initialize your project.

```
$ featurevisor init
```

If you want to initialize your project with a specific example:

```
$ featurevisor init --example <name>
```

Examples found [here](../../examples).

### `lint`

Check if your YAMLs are valid.

```
$ featurevisor lint
```


### `build`

Build your datafiles.

```
$ featurevisor build
```

### `test`

Test your generated datafiles using the SDK, against specs written in YAMLs.

```
$ featurevisor test
```

See test specs in YAMLs [here](../../examples/example-1/tests) for inspiration.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
