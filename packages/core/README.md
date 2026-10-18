# @featurevisor/core

Project configuration, validation, datafile building and testing for Featurevisor tooling. Applications evaluating datafiles should use `@featurevisor/sdk` instead. Requires Node.js 24 or later.

## Installation

```bash
npm install @featurevisor/core
```

## Usage

Read the configuration of a Featurevisor project:

```js
import process from "node:process";
import { getProjectConfig } from "@featurevisor/core";

const config = getProjectConfig(process.cwd());
console.log(config.datafilesDirectoryPath);
```

See the [documentation](https://featurevisor.com/docs/plugins/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
