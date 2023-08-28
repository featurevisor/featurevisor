---
title: Contributing
description: Learn how to contribute to Featurevisor
---

## Code of Conduct

We have adopted the [Contributor Covenant](https://www.contributor-covenant.org/) as our [Code of Conduct](https://github.com/fahad19/featurevisor/blob/main/CODE_OF_CONDUCT.md), and we expect project participants to adhere to it.

## Branch organization

You can send your pull requests against the `main` branch.

## Bugs

We use [GitHub Issues](https://github.com/fahad19/featurevisor/issues) for bug reporting.

Before reporting any new ones, please check if it has been reported already.

## License

By contributing to Featurevisor, you agree that your contributions will be licensed under its [MIT license](https://github.com/fahad19/featurevisor/blob/main/LICENSE).

## Development workflow

Prerequsites:

- [Node.js](https://nodejs.org/en/) v16+
- [npm](https://www.npmjs.com/) v8+
- [Git](https://git-scm.com/) v2+

### Commands

Clone the [repository](https://github.com/fahad19/featurevisor).

Run:

```
$ npm ci
$ npm run bootstrap
```

Make your desired changes to any packages or documentation.

To test everything:

```
$ npm run build
$ npm test
```

Apply project-wide code styles:

```
$ npm run lint
```

If you wish to override certain Prettier configuration in particular package, add (or edit) following file to the package level:

```js
const rootConfig = require("../../prettier.config");

/** @type {import('prettier').Config} */
const config = {
  ...rootConfig,
  // Here you can add local Prettier overrides
};

module.exports = config;
```

### Pull Requests

Send Pull Requests against the `main` branch.
