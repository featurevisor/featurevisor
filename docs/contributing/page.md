---
title: Contributing
nextjs:
  metadata:
    title: Contributing
    description: Learn how to contribute to Featurevisor
    openGraph:
      title: Contributing
      description: Learn how to contribute to Featurevisor
      images:
        - url: /img/og/docs.png
---

## Code of Conduct

We have adopted the [Contributor Covenant](https://www.contributor-covenant.org/) as our [Code of Conduct](https://github.com/featurevisor/featurevisor/blob/main/CODE_OF_CONDUCT.md), and we expect project participants to adhere to it.

## Branch organization

You can send your pull requests against the `main` branch.

## Bugs

We use [GitHub Issues](https://github.com/featurevisor/featurevisor/issues) for bug reporting.

Before reporting any new ones, please check if it has been reported already.

## License

By contributing to Featurevisor, you agree that your contributions will be licensed under its [MIT license](https://github.com/featurevisor/featurevisor/blob/main/LICENSE).

## Development workflow

Prerequsites:

- [Node.js](https://nodejs.org/en/) v20+
- [npm](https://www.npmjs.com/) v8+
- [Git](https://git-scm.com/) v2+

### Commands

Clone the [repository](https://github.com/featurevisor/featurevisor).

Run:

```{% title="Command" %}
$ npm ci
$ npm run bootstrap
```

Make your desired changes to any packages or documentation.

To test everything:

```{% title="Command" %}
$ npm run build
$ npm test
```

Apply project-wide code styles:

```{% title="Command" %}
$ npm run lint
```

If you need to override code style and linter configurations for individual packages, you can do so by adding or changing specific rules in package-level configuration files. For example:

```js {% path="packages/sdk/prettier.config.js" %}
const rootConfig = require('../../prettier.config')

/** @type {import('prettier').Config} */
const config = {
  ...rootConfig,
  singleQuote: true,
}

module.exports = config
```

```js {% path="packages/sdk/.eslintrc.js" %}
const rootConfig = require('../../.eslintrc.js')

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  env: {
    node: true,
  },
  rules: {
    ...rootConfig.rules,
    '@typescript-eslint/no-explicit-any': 'off',
  },
}

module.exports = config
```

### Testing

You are advised to test your changes locally before submitting a pull request.

The core team uses the `example-1` project as a playground for testing new features and changes.

```{% title="Command" %}
$ cd examples/example-1

$ npm run lint
$ npm run build
$ npm test
$ npm start
```

### Pull Requests

Send Pull Requests against the `main` branch.
